import assert from 'node:assert/strict';
import test from 'node:test';
import { capture, collect, localServer, profile, sse, TEST_KEY, user } from './helpers.mjs';

const tools = [{ name: 'fixture_lookup', description: 'Read isolated synthetic fixture data', parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }];

test('custom provider sends native Google SSE requests, custom headers and reasoning settings', async t => {
  const { baseURL, requests } = await localServer(t, (_request, response) => sse(response, [{ text: 'native fixture reply' }]));
  const { adapter } = capture({ 'custom-gemini': profile(baseURL) });
  const chunks = await collect(adapter, [user()], { reasoningEffort: 'low', maxTokens: 128, tools });
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url.pathname, '/v1beta/models/gemini-3-flash-preview:streamGenerateContent');
  assert.equal(request.url.searchParams.get('alt'), 'sse');
  assert.equal(request.headers['x-goog-api-key'], TEST_KEY);
  assert.equal(request.headers['x-fixture-header'], 'custom-header');
  assert.equal(request.body.generationConfig.maxOutputTokens, 128);
  assert.equal(request.body.generationConfig.thinkingConfig.thinkingLevel.toLowerCase(), 'low');
  assert.equal(request.body.tools[0].functionDeclarations[0].name, 'fixture_lookup');
  assert.equal(chunks.find(chunk => chunk.type === 'text-delta').text, 'native fixture reply');
  assert.equal(chunks.at(-1).reason.kind, 'stop');
  assert.equal(chunks.at(-1).replayState.response.api, 'google-generative-ai');
});

test('thought signatures survive JSON persistence and a new adapter before the next tool turn', async t => {
  const signature = Buffer.from('isolated synthetic thought signature').toString('base64');
  const { baseURL, requests } = await localServer(t, (_request, response, call) => {
    if (call === 1) sse(response, [{ functionCall: { name: 'fixture_lookup', args: { query: 'fixture' } }, thoughtSignature: signature }]);
    else sse(response, [{ text: 'tool round trip complete' }]);
  });
  const providers = { 'custom-gemini': profile(baseURL) };
  const first = await collect(capture(providers).adapter, [user()], { tools });
  const content = first.filter(chunk => chunk.type === 'block-end').map(chunk => chunk.block);
  assert.equal(content[0].type, 'tool-call');
  assert.equal(first.at(-1).reason.kind, 'tool-calls');
  assert.equal(first.at(-1).replayState.blocks[0].thoughtSignature, signature);
  const history = JSON.parse(JSON.stringify([
    user(),
    { role: 'assistant', content, source: { provider: 'custom-gemini', model: 'gemini-3-flash-preview', replayState: first.at(-1).replayState } },
    { role: 'tool', toolCallId: content[0].id, content: [{ type: 'text', text: 'isolated synthetic result' }] },
  ]));
  const second = await collect(capture(providers).adapter, history, { tools });
  assert.equal(second.at(-1).reason.kind, 'stop');
  const modelMessage = requests[1].body.contents.find(message => message.role === 'model');
  assert.equal(modelMessage.parts[0].thoughtSignature, signature);
  assert.deepEqual(modelMessage.parts[0].functionCall.args, { query: 'fixture' });
  assert.equal(requests[1].body.contents.at(-1).parts[0].functionResponse.name, 'fixture_lookup');
});

test('native model discovery authenticates and follows pagination, preserving names and limits', async t => {
  const { baseURL, requests } = await localServer(t, (request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    if (!request.url.searchParams.has('pageToken')) response.end(JSON.stringify({ models: [
      { name: 'models/gemini-first', displayName: 'First', inputTokenLimit: 100000, outputTokenLimit: 4096, supportedGenerationMethods: ['generateContent'] },
      { name: 'models/embedding-fixture', supportedGenerationMethods: ['embedContent'] },
    ], nextPageToken: 'second fixture page' }));
    else response.end(JSON.stringify({ models: [
      { name: 'models/gemini-first', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-second', supportedGenerationMethods: ['generateContent'] },
    ] }));
  });
  const { discovery } = capture({ 'custom-gemini': profile(baseURL) });
  const models = await discovery({ provider: 'custom-gemini', api: 'google-generative-ai', baseURL });
  assert.deepEqual(models, [{ id: 'gemini-first', name: 'First', contextWindow: 100000, maxTokens: 4096 }, { id: 'gemini-second', name: 'gemini-second' }]);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers['x-goog-api-key'], TEST_KEY);
  assert.equal(requests[0].headers.authorization, undefined);
  assert.equal(requests[0].headers['x-fixture-header'], 'custom-header');
  assert.equal(requests[1].url.searchParams.get('pageToken'), 'second fixture page');
});

test('existing OpenAI discovery still sends bearer auth and reads a data array', async t => {
  const { baseURL, requests } = await localServer(t, (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ data: [{ id: 'openai-fixture' }] }));
  });
  const { discovery } = capture();
  assert.deepEqual(await discovery({ api: 'openai-completions', baseURL, apiKey: TEST_KEY }), [{ id: 'openai-fixture', name: 'openai-fixture' }]);
  assert.equal(requests[0].headers.authorization, `Bearer ${TEST_KEY}`);
  assert.equal(requests[0].headers['x-goog-api-key'], undefined);
});
