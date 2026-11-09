// Offline development: resolve direct dependencies from an installed DSH.
import { readFile, mkdir, lstat, realpath, symlink } from 'node:fs/promises';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argument = process.argv[2] ?? process.env.DSH_RUNTIME_ROOT;
if (!argument) throw new Error('Usage: node scripts/link-installed.mjs DSH_RUNTIME_ROOT');
const runtime = resolve(argument);
const installed = JSON.parse(await readFile(join(runtime, 'package.json'), 'utf8'));
if (installed.name !== '@deepseek-ai/dsh' || installed.version !== '0.2.2-rc.1') throw new Error('Expected @deepseek-ai/dsh 0.2.2-rc.1');
const manifest = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'));
const expectedPi = JSON.parse(await readFile(join(runtime, 'node_modules/@earendil-works/pi-ai/package.json'), 'utf8'));
if (expectedPi.version !== manifest.dependencies['@earendil-works/pi-ai']) throw new Error('Installed pi-ai version differs from the tested dependency');
const names = Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies, ...manifest.devDependencies });
for (const name of names) {
  const source = join(runtime, 'node_modules', name);
  await lstat(source);
  const target = join(project, 'node_modules', name);
  await mkdir(dirname(target), { recursive: true });
  let existing;
  try { existing = await lstat(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (existing.isSymbolicLink() && await realpath(target) === await realpath(source)) continue;
    throw new Error(`Refusing to replace existing dependency: ${target}`);
  }
  await symlink(relative(dirname(target), source), target, 'dir');
}
console.log(`Linked ${names.length} development dependencies; installed packages unchanged.`);
