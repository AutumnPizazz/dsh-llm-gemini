import { once } from 'node:events';
import { createServer } from 'node:http';
import { Config, apply } from '../src/adapter.mjs';

export const TEST_KEY = 'isolated-gemini-fixture-key';

/** No real credentials, launch environment, filesystem configuration, or remote HTTP. */
export function capture(providers = {}) {
  let adapter;
  let discovery;
  let directory;
  const listeners = new Map();
  const registration = () => Object.assign(() => {}, { replace() {} });
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    logger: { warn() {}, error() {} },
    get(name) {
      if (name === 'launchEnvironment') return { get() {} };
      if (name === 'credentials') return {
        async resolve() { return { value: TEST_KEY }; },
        async readRecord() {},
        async listRecords() { return []; },
      };
    },
    inject() {},
    on(event, listener) { listeners.set(event, listener); },
    waterfall(_event, _request, _headers, next) { return next(); },
    llm: {
      registerAdapter(_routes, value) { adapter = value; return registration(); },
      registerConfigurableProviders(value) { directory = value; return registration(); },
      registerModelDiscovery(ns, value) {
        if (ns !== 'llm-pi-ai') throw new Error('Settings namespace changed');
        discovery = value;
        return () => {};
      },
    },
  };
  apply(ctx, Config({ providers }));
  return { adapter, discovery, directory, listeners, ctx };
}

export async function localServer(t, handler) {
  const requests = [];
  const server = createServer(async (request, response) => {
    try {
      let body = '';
      for await (const chunk of request) body += chunk;
      const captured = { method: request.method, url: new URL(request.url, 'http://localhost'), headers: request.headers, body: body ? JSON.parse(body) : undefined };
      requests.push(captured);
      await handler(captured, response, requests.length);
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: String(error) }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { baseURL: `http://127.0.0.1:${server.address().port}/v1beta`, requests };
}

export function sse(response, parts, finishReason = 'STOP') {
  response.writeHead(200, { 'content-type': 'text/event-stream' });
  response.end(`data: ${JSON.stringify({
    candidates: [{ content: { role: 'model', parts }, finishReason }],
    usageMetadata: { promptTokenCount: 4, candidatesTokenCount: 3, totalTokenCount: 7 },
  })}\n\n`);
}

export function profile(baseURL, api = 'google-generative-ai') {
  return {
    api, baseURL, apiKeyEnv: 'GEMINI_FIXTURE_KEY',
    headers: { 'x-fixture-header': 'custom-header' },
    models: [{ id: 'gemini-3-flash-preview', input: ['text'], reasoningEfforts: { off: null, low: 'low', high: 'high' } }],
  };
}

export function user(text = 'fixture prompt') {
  return { role: 'user', content: [{ type: 'text', text }] };
}

export async function collect(adapter, messages, options = {}) {
  return Array.fromAsync(adapter.stream({ provider: 'custom-gemini', model: 'gemini-3-flash-preview', messages, ...options }));
}
