import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, readlink, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import Loader from '@deepseek-ai/cordis-plugin-loader';
import { createRuntimeResolution, loadProfileDirectory, composeEntries, PluginPackages } from '@deepseek-ai/dsh-app-boot';
import { linkProfile } from '../scripts/link-profile.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));

async function fixture(t) {
  const home = await mkdtemp(join(tmpdir(), 'gemini-link-test-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const profileDir = join(home, 'profiles', 'fixture');
  await mkdir(profileDir, { recursive: true });
  const manifest = { name: 'dsh-profile-fixture', private: true, dependencies: {}, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base'] } } };
  const patch = '- id: llm-pi-ai\n  config:\n    providers:\n      existing:\n        api: openai-responses\n        baseURL: https://fixture.invalid/v1\n        models:\n          - id: fixture-model\n';
  await writeFile(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(profileDir, 'cordis.patch.yml'), patch);
  await writeFile(join(profileDir, 'pnpm-lock.yaml'), "lockfileVersion: '9.0'\n\nimporters:\n  .:\n    dependencies: {}\n");
  return { home, profileDir, patch, manifest };
}

function rows(entries) { return entries.flatMap(entry => [entry, ...(entry.group && Array.isArray(entry.config) ? rows(entry.config) : [])]); }

test('relative-link install is idempotent and removal restores existing profile configuration', async t => {
  const { home, profileDir, patch, manifest } = await fixture(t);
  assert.equal((await linkProfile({ home, profile: 'fixture' })).linksChanged, 3);
  const installed = JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8'));
  for (const name of ['dsh-llm-gemini', '@deepseek-ai/dsh-llm-pi-ai']) {
    assert.ok(installed.dependencies[name].startsWith('link:..'));
    const link = join(profileDir, 'node_modules', name);
    assert.equal(isAbsolute(await readlink(link)), false);
    assert.equal(await realpath(link), await realpath(project));
  }
  assert.equal((await linkProfile({ home, profile: 'fixture' })).changed, false);
  assert.equal(await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8'), patch);
  const result = await linkProfile({ home, profile: 'fixture', remove: true });
  assert.equal(result.linksChanged, 3);
  assert.deepEqual(JSON.parse(await readFile(join(profileDir, 'package.json'), 'utf8')), manifest);
  assert.equal(await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8'), patch);
});

test('fresh profile uses the alias through the official runtime package resolver and keeps llm-pi-ai settings', async t => {
  const { home, profileDir, patch } = await fixture(t);
  await linkProfile({ home, profile: 'fixture' });
  // The actual installation anchor is found from an installed package, never a machine path.
  const baseManifest = fileURLToPath(new URL('./package.json', import.meta.resolve('@deepseek-ai/dsh-base/package.json')));
  let directory = dirname(baseManifest);
  let anchor;
  for (;;) {
    const candidate = join(directory, 'package.json');
    try {
      if (JSON.parse(await readFile(candidate, 'utf8')).name === '@deepseek-ai/dsh') { anchor = candidate; break; }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const parent = dirname(directory);
    if (parent === directory) throw new Error('Cannot locate the installed DSH manifest');
    directory = parent;
  }
  const profile = loadProfileDirectory('dsh', profileDir, anchor);
  assert.equal(profile.skippedBundles.length, 0);
  const warnings = [];
  const entries = composeEntries([...profile.layers.map(layer => layer.patches), profile.patches], warning => warnings.push(warning));
  const entry = rows(entries).find(row => row.id === 'llm-pi-ai');
  assert.equal(entry.name, '@deepseek-ai/dsh-llm-pi-ai');
  assert.equal(entry.config.providers.existing.api, 'openai-responses');
  assert.equal(warnings.length, 0);
  const resolution = await createRuntimeResolution({ installAnchor: anchor, profile, home });
  assert.ok(resolution.localPackageNames.includes('@deepseek-ai/dsh-llm-pi-ai'));
  const ctx = new Context();
  ctx.baseUrl = pathToFileURL(join(profileDir, 'cordis.yml')).href;
  try {
    await ctx.plugin(PluginPackages, { resolution });
    await ctx.plugin(Loader);
    const loaded = await ctx.loader.import('@deepseek-ai/dsh-llm-pi-ai');
    assert.ok(loaded.supportedProtocols().includes('google-generative-ai'));
    const probe = join(profileDir, 'probe.mjs');
    await writeFile(probe, "export { Config, supportedProtocols } from '@deepseek-ai/dsh-llm-pi-ai';\n");
    const plugin = await import(pathToFileURL(probe));
    assert.ok(plugin.supportedProtocols().includes('google-generative-ai'));
    assert.equal(ctx.pluginPackages.packageOf('@deepseek-ai/dsh-llm-pi-ai', pathToFileURL(probe).href).name, 'dsh-llm-gemini');
    assert.equal(await readFile(join(profileDir, 'cordis.patch.yml'), 'utf8'), patch);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('installer refuses an unrelated adapter link before changing the manifest', async t => {
  const { home, profileDir } = await fixture(t);
  const link = join(profileDir, 'node_modules/@deepseek-ai/dsh-llm-pi-ai');
  await mkdir(dirname(link), { recursive: true });
  await symlink(project, link, 'dir');
  const manifestPath = join(profileDir, 'package.json');
  const text = await readFile(manifestPath, 'utf8');
  const manifest = JSON.parse(text);
  manifest.dependencies = { '@deepseek-ai/dsh-llm-pi-ai': 'a-different-existing-adapter' };
  const before = JSON.stringify(manifest);
  await writeFile(manifestPath, before);
  await assert.rejects(linkProfile({ home, profile: 'fixture' }), /different adapter/);
  assert.equal(await readFile(manifestPath, 'utf8'), before);
});
