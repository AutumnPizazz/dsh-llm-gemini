import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import yaml from 'js-yaml';
import { applyEntryPatches, entryListSchema } from '@deepseek-ai/cordis-plugin-include';

function rows(entries) {
  return entries.flatMap(entry => [entry, ...(entry.group && Array.isArray(entry.config) ? rows(entry.config) : [])]);
}

async function patch(url) { return yaml.load(await readFile(new URL(url), 'utf8'), { schema: entryListSchema }); }

test('bundle preserves the official entry and stored provider configuration for the profile alias', async () => {
  const warnings = [];
  const warn = (...args) => warnings.push(args);
  const base = await patch(import.meta.resolve('@deepseek-ai/dsh-base/cordis.patch.yml'));
  const addon = await patch(new URL('../cordis.patch.yml', import.meta.url));
  const prior = applyEntryPatches([], base, warn);
  const providers = { existing: { api: 'openai-responses', models: [{ id: 'fixture' }], baseURL: 'https://fixture.invalid/v1' } };
  const configured = applyEntryPatches(prior, [{ id: 'llm-pi-ai', config: { providers } }], warn);
  const composed = applyEntryPatches(configured, addon, warn);
  const before = rows(configured);
  const after = rows(composed);
  assert.deepEqual(warnings, []);
  assert.equal(after.length, before.length);
  assert.equal(after.filter(row => row.id === 'llm-pi-ai').length, 1);
  const adapter = after.find(row => row.id === 'llm-pi-ai');
  assert.equal(adapter.name, '@deepseek-ai/dsh-llm-pi-ai');
  assert.deepEqual(adapter.config.providers, providers);
  for (const row of before.filter(row => row.id !== 'llm-pi-ai')) assert.deepEqual(after.find(other => other.id === row.id), row);
  const restored = applyEntryPatches(composed, [{ id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' }], warn);
  assert.deepEqual(rows(restored).find(row => row.id === 'llm-pi-ai').config.providers, providers);
});

test('MIT package exports its Cordis bundle and keeps the upstream plugin identity', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.license, 'MIT');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(import.meta.resolve('dsh-llm-gemini/cordis.patch.yml'), new URL('../cordis.patch.yml', import.meta.url).href);
  const plugin = await import('dsh-llm-gemini');
  assert.equal(plugin.name, 'llm-pi-ai');
  assert.deepEqual(plugin.inject, ['llm']);
});
