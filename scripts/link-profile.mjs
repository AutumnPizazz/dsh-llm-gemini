import { readFile, writeFile, mkdir, lstat, realpath, symlink, unlink, rename, copyFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import YAML from 'yaml';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageName = 'dsh-llm-gemini';
const alias = '@deepseek-ai/dsh-llm-pi-ai';

async function optionalText(path) {
  try { return await readFile(path, 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function stat(path) {
  try { return await lstat(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}
async function atomicText(path, text) {
  const temporary = `${path}.${packageName}.tmp`;
  let created = false;
  try {
    await writeFile(temporary, text, { mode: 0o600, flag: 'wx' });
    created = true;
    await rename(temporary, path);
  } finally {
    if (created) await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** Add/remove only this project's links and dependency entries. Does not read provider settings. */
export async function linkProfile({ home = process.env.DSH_HOME ?? join(homedir(), '.dsh'), profile = 'web', remove = false } = {}) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profile)) throw new Error('Invalid profile name');
  home = resolve(home);
  const profileDir = join(home, 'profiles', profile);
  const manifestPath = join(profileDir, 'package.json');
  const lockPath = join(profileDir, 'pnpm-lock.yaml');
  const statePath = join(profileDir, '.plugin-manager', `${packageName}.json`);
  const originalManifest = await optionalText(manifestPath);
  if (originalManifest === undefined) throw new Error('Profile manifest not found; create the DSH profile first');
  const originalLock = await optionalText(lockPath);
  const originalState = await optionalText(statePath);
  const state = originalState === undefined ? undefined : JSON.parse(originalState);
  const manifest = JSON.parse(originalManifest);
  const lock = originalLock === undefined ? undefined : YAML.parseDocument(originalLock);
  if (lock?.errors.length) throw new Error('Profile lockfile cannot be parsed');
  const linkSpec = `link:${relative(profileDir, project).split('\\').join('/')}`;
  const links = [
    { key: 'plugin', path: join(home, 'plugins', packageName) },
    { key: 'package', path: join(profileDir, 'node_modules', packageName) },
    { key: 'alias', path: join(profileDir, 'node_modules', alias) },
  ];
  for (const link of links) {
    link.existed = await stat(link.path) !== undefined;
    if (link.existed && (!(await lstat(link.path)).isSymbolicLink() || await realpath(link.path) !== await realpath(project))) {
      throw new Error(`Refusing to replace an unrelated ${link.key} link`);
    }
  }
  if (remove && state === undefined) throw new Error('No installation record found for this plugin');
  for (const name of [packageName, alias]) {
    const previous = manifest.dependencies?.[name];
    if (previous !== undefined && (!previous.startsWith('link:') || resolve(profileDir, previous.slice(5)) !== project)) {
      throw new Error('The profile already declares a different adapter or plugin dependency');
    }
  }
  const nextState = state ?? {
    dependencies: Object.fromEntries([packageName, alias].map(name => [name, manifest.dependencies?.[name] ?? null])),
    lockDependencies: Object.fromEntries([packageName, alias].map(name => [name, lock?.getIn(['importers', '.', 'dependencies', name])?.toJSON() ?? null])),
    bundleExisted: manifest.dsh?.profile?.bundles?.includes(packageName) ?? false,
    linksCreated: Object.fromEntries(links.map(link => [link.key, !link.existed])),
  };
  if (remove) {
    for (const name of [packageName, alias]) {
      if (state.dependencies[name] === null) delete manifest.dependencies[name];
      else manifest.dependencies[name] = state.dependencies[name];
      if (lock) {
        if (state.lockDependencies[name] === null) lock.deleteIn(['importers', '.', 'dependencies', name]);
        else lock.setIn(['importers', '.', 'dependencies', name], state.lockDependencies[name]);
      }
    }
    if (!state.bundleExisted) manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== packageName);
  } else {
    manifest.dependencies ??= {};
    manifest.dsh ??= {};
    manifest.dsh.profile ??= {};
    manifest.dsh.profile.bundles ??= [];
    for (const name of [packageName, alias]) {
      manifest.dependencies[name] = linkSpec;
      if (lock) lock.setIn(['importers', '.', 'dependencies', name], { specifier: linkSpec, version: linkSpec });
    }
    if (!manifest.dsh.profile.bundles.includes(packageName)) manifest.dsh.profile.bundles.push(packageName);
  }
  const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const nextLock = lock?.toString();
  const linksToChange = links.filter(link => remove ? state.linksCreated[link.key] && link.existed : !link.existed);
  if (!remove && state !== undefined && nextManifest === originalManifest && nextLock === originalLock && linksToChange.length === 0) {
    return { profile, changed: false, restartRequired: true };
  }
  const backupName = `${packageName}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const backupDir = join(profileDir, '.plugin-manager', 'backups', backupName);
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await copyFile(manifestPath, join(backupDir, 'package.json'));
  if (originalLock !== undefined) await copyFile(lockPath, join(backupDir, 'pnpm-lock.yaml'));
  const changedLinks = [];
  try {
    for (const link of linksToChange) {
      if (remove) await unlink(link.path);
      else {
        await mkdir(dirname(link.path), { recursive: true });
        await symlink(relative(dirname(link.path), project), link.path, 'dir');
      }
      changedLinks.push(link);
    }
    await atomicText(manifestPath, nextManifest);
    if (nextLock !== undefined && nextLock !== originalLock) await atomicText(lockPath, nextLock);
    await mkdir(dirname(statePath), { recursive: true, mode: 0o700 });
    if (remove) await unlink(statePath);
    else await atomicText(statePath, `${JSON.stringify(nextState, null, 2)}\n`);
  } catch (error) {
    await atomicText(manifestPath, originalManifest);
    if (originalLock !== undefined) await atomicText(lockPath, originalLock);
    if (originalState !== undefined) await atomicText(statePath, originalState);
    for (const link of changedLinks.reverse()) {
      if (remove) await symlink(relative(dirname(link.path), project), link.path, 'dir');
      else await unlink(link.path);
    }
    throw error;
  }
  return { profile, changed: true, removed: remove, linksChanged: changedLinks.length, backup: relative(profileDir, backupDir), restartRequired: true };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  let profile = 'web';
  let home;
  let remove = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--profile' && args[index + 1]) profile = args[++index];
    else if (arg === '--home' && args[index + 1]) home = args[++index];
    else if (arg === '--remove') remove = true;
    else throw new Error('Usage: node scripts/link-profile.mjs [--profile web] [--home DSH_HOME] [--remove]');
  }
  console.log(JSON.stringify(await linkProfile({ profile, ...(home === undefined ? {} : { home }), remove }), null, 2));
}
