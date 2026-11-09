import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import z from '@deepseek-ai/schemastery';
import Llm from '@deepseek-ai/dsh-llm';
import * as official from '@deepseek-ai/dsh-llm-pi-ai';
import * as gemini from '../src/adapter.mjs';
import { profile } from './helpers.mjs';

const protocols = ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-ai'];

test('the serialized schema delivered to Models adds Gemini after the existing protocols', () => {
  assert.deepEqual(gemini.supportedProtocols(), protocols);
  const schema = new z(gemini.Config.toJSON());
  assert.deepEqual(schema.dict.providers.inner.dict.api.list.map(entry => entry.value), protocols);
  const providers = gemini.Config({ providers: { 'custom-gemini': profile('http://127.0.0.1/v1beta') } }).providers.get();
  assert.equal(providers['custom-gemini'].api, 'google-generative-ai');
  assert.throws(() => official.Config({ providers: { 'custom-gemini': profile('http://127.0.0.1/v1beta') } }));
  assert.throws(() => gemini.Config({ providers: { example: { api: 'invented-protocol' } } }));
});

test('real Cordis/LLM mount, disposal and replacement use one settings namespace and one route', async () => {
  const ctx = new Context();
  ctx.provide('launchEnvironment', { get() {} });
  try {
    await ctx.plugin(Llm);
    const original = await ctx.plugin(official);
    assert.equal(ctx.llm.listProviders().length, 0);
    await original.dispose();
    const extension = await ctx.plugin(gemini, { providers: { 'custom-gemini': profile('http://127.0.0.1/v1beta') } });
    assert.deepEqual(ctx.llm.listProviders().map(row => row.id), ['custom-gemini']);
    const model = await ctx.llm.resolveModelInfo('custom-gemini', 'gemini-3-flash-preview');
    assert.equal(model.id, 'gemini-3-flash-preview');
    const empty = new AbortController();
    empty.abort();
    await assert.rejects(ctx.llm.discoverModels('llm-pi-ai', { api: 'google-generative-ai', baseURL: 'http://127.0.0.1/v1beta' }, empty.signal), error => error.code === 'ABORTED');
    await extension.dispose();
    assert.equal(ctx.llm.listProviders().length, 0);
    await ctx.plugin(official);
    assert.equal(ctx.llm.listProviders().length, 0);
  } finally {
    await ctx.fiber.dispose();
  }
});

test('the fork has a recorded matching upstream baseline and untouched old protocol behavior', async () => {
  const metadata = JSON.parse(await readFile(new URL('../vendor/upstream.json', import.meta.url), 'utf8'));
  const upstream = await readFile(new URL(import.meta.resolve('@deepseek-ai/dsh-llm-pi-ai')));
  assert.equal(createHash('sha256').update(upstream).digest('hex'), metadata.files[0].sha256);
  for (const api of official.supportedProtocols()) {
    const config = { providers: { gateway: { ...profile('http://127.0.0.1/v1'), api, models: [{ id: 'fixture-model' }] } } };
    assert.deepEqual(gemini.Config(config).providers.get(), official.Config(config).providers.get());
  }
});
