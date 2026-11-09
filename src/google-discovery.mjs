import { LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm';

const MAX_PAGES = 100;
const PAGE_SIZE = 1000;

function positiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

/** Read the native Google Models response, retaining chat models only. */
export function readGoogleListing(body) {
  if (body === null || typeof body !== 'object' || !Array.isArray(body.models)) {
    throw new LlmError('the Gemini endpoint did not return a "models" array; enter this provider\'s models by hand', 'DISCOVERY_FAILED');
  }
  const models = [];
  for (const entry of body.models) {
    if (entry === null || typeof entry !== 'object' || typeof entry.name !== 'string') continue;
    if (Array.isArray(entry.supportedGenerationMethods) && !entry.supportedGenerationMethods.includes('generateContent') && !entry.supportedGenerationMethods.includes('streamGenerateContent')) continue;
    const id = entry.name.replace(/^models\//, '');
    if (id.length === 0) continue;
    const contextWindow = positiveInteger(entry.inputTokenLimit);
    const maxTokens = positiveInteger(entry.outputTokenLimit);
    models.push({
      id,
      name: typeof entry.displayName === 'string' && entry.displayName.length > 0 ? entry.displayName : id,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
    });
  }
  return models;
}

/** Use the host adapter's bounded body reader and already-resolved credential. */
export async function discoverGoogleModels(request, storedHeaders, apiKey, readBounded) {
  const endpoint = `${request.baseURL.replace(/\/+$/, '')}/models`;
  const headers = new Headers(storedHeaders);
  headers.set('accept', 'application/json');
  if (apiKey !== undefined) headers.set('x-goog-api-key', apiKey);
  for (const [name, value] of Object.entries(attributionHeaders())) headers.set(name, value);
  const models = new Map();
  const visited = new Set();
  let pageToken;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = new URL(endpoint);
    url.searchParams.set('pageSize', String(PAGE_SIZE));
    if (pageToken !== undefined) url.searchParams.set('pageToken', pageToken);
    let response;
    try {
      response = await fetch(url, { headers, ...(request.signal === undefined ? {} : { signal: request.signal }) });
    } catch (error) {
      if (request.signal?.aborted) throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error });
      throw new LlmError(`could not reach ${url}`, 'DISCOVERY_FAILED', { cause: error });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new LlmError(`${url} answered ${response.status}${response.status === 401 || response.status === 403 ? '; check the API key' : ''}`, 'DISCOVERY_FAILED');
    }
    let text;
    try {
      text = await readBounded(response, String(url));
    } catch (error) {
      if (request.signal?.aborted) throw new LlmError('model discovery aborted by caller', 'ABORTED', { cause: error });
      throw error;
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      throw new LlmError(`${url} did not answer with JSON`, 'DISCOVERY_FAILED', { cause: error });
    }
    for (const model of readGoogleListing(body)) {
      if (!models.has(model.id)) models.set(model.id, model);
    }
    const next = body.nextPageToken;
    if (typeof next !== 'string' || next.length === 0) return [...models.values()];
    if (visited.has(next)) throw new LlmError('the Gemini model listing repeated a page token', 'DISCOVERY_FAILED');
    visited.add(next);
    pageToken = next;
  }
  throw new LlmError(`the Gemini model listing exceeded ${MAX_PAGES} pages`, 'DISCOVERY_FAILED');
}
