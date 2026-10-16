// Bring your own key: which provider classifies a save, what it is sent, and
// that every failure lands on the built-in rules. Providers answer from
// recorded response shapes; nothing reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startWorker, setupAccount } from './helpers.mjs';

const ANSWER = { title: 'Paper Satellites', media_type: 'series', source_name: 'friend', source_url: '', reason_saved: 'a friend loved it', confidence: 0.9, needs_clarification: false };

function claudeMessage(text, stop_reason = 'end_turn') {
  return Response.json({
    id: 'msg_test', type: 'message', role: 'assistant', model: 'claude-opus-5-5',
    content: [{ type: 'text', text }], stop_reason, stop_sequence: null,
    usage: { input_tokens: 120, output_tokens: 40 },
  });
}

function chatCompletion(content) {
  return Response.json({ id: 'chatcmpl-test', choices: [{ index: 0, message: { role: 'assistant', content } }] });
}

// Records each provider request, answers with `respond(url)` or a 404.
function recorder(respond) {
  const seen = [];
  const outbound = async (request) => {
    const body = request.method === 'POST' ? await request.json() : null;
    seen.push({ url: request.url, headers: Object.fromEntries(request.headers), body });
    return respond(request.url) ?? new Response('offline in tests', { status: 404 });
  };
  return { seen, outbound };
}

async function saveWith(vars, outbound, text = 'Paper Satellites, my friend loved it') {
  const worker = await startWorker(vars, { outbound });
  try {
    const cookie = await setupAccount(worker);
    const res = await worker.api('/items', { method: 'POST', cookie, body: { text, media_type: 'auto' } });
    const health = await worker.api('/health');
    return { res, health: health.json };
  } finally {
    await worker.close();
  }
}

test('with ANTHROPIC_API_KEY, Claude classifies with low effort, a JSON schema and refusal fallbacks', async () => {
  const { seen, outbound } = recorder((url) => (url.startsWith('https://api.anthropic.com/v1/messages') ? claudeMessage(JSON.stringify(ANSWER)) : null));
  const { res, health } = await saveWith({ ANTHROPIC_API_KEY: 'sk-ant-test' }, outbound);
  assert.equal(res.status, 200);
  assert.equal(res.json.item.media_type, 'series');
  assert.equal(res.json.item.title, 'Paper Satellites');
  const call = seen.find((r) => r.url.startsWith('https://api.anthropic.com/'));
  assert.ok(call, 'Claude was called');
  assert.equal(call.headers['x-api-key'], 'sk-ant-test');
  assert.match(call.headers['anthropic-beta'] ?? '', /server-side-fallback-2026-07-01/);
  assert.equal(call.body.model, 'claude-opus-5-5');
  assert.equal(call.body.fallbacks, 'default');
  assert.equal(call.body.output_config.effort, 'low');
  assert.equal(call.body.output_config.format.type, 'json_schema');
  assert.equal(health.ai, 'anthropic');
  assert.doesNotMatch(JSON.stringify(health), /sk-ant/, 'health names the provider, never the key');
});

test('a model without server-side fallbacks is not sent them', async () => {
  const { seen, outbound } = recorder((url) => (url.startsWith('https://api.anthropic.com/') ? claudeMessage(JSON.stringify(ANSWER)) : null));
  await saveWith({ ANTHROPIC_API_KEY: 'sk-ant-test', ANTHROPIC_MODEL: 'claude-haiku-5-5' }, outbound);
  const call = seen.find((r) => r.url.startsWith('https://api.anthropic.com/'));
  assert.equal(call.body.model, 'claude-haiku-5-5');
  assert.equal(call.body.fallbacks, undefined);
  assert.doesNotMatch(call.headers['anthropic-beta'] ?? '', /server-side-fallback/);
});

test('a refusal from Claude falls back to the built-in rules, and the save still works', async () => {
  const { outbound } = recorder((url) => (url.startsWith('https://api.anthropic.com/') ? claudeMessage('', 'refusal') : null));
  const { res } = await saveWith({ ANTHROPIC_API_KEY: 'sk-ant-test' }, outbound, 'read the novel Northbound');
  assert.equal(res.status, 200);
  assert.equal(res.json.item.media_type, 'book', 'the rules-based classifier answered');
});

test('OpenRouter answers wrapped in a code fence are still read', async () => {
  const { seen, outbound } = recorder((url) => (url === 'https://openrouter.ai/api/v1/chat/completions'
    ? chatCompletion('Here you go:\n```json\n' + JSON.stringify(ANSWER) + '\n```') : null));
  const { res, health } = await saveWith({ OPENROUTER_API_KEY: 'or-test', OPENROUTER_MODEL: 'some/free-model' }, outbound);
  assert.equal(res.json.item.media_type, 'series');
  const call = seen.find((r) => r.url.startsWith('https://openrouter.ai/'));
  assert.equal(call.headers.authorization, 'Bearer or-test');
  assert.equal(call.body.model, 'some/free-model');
  assert.equal(health.ai, 'openrouter');
});

test('any OpenAI-compatible server works, a local one without a key', async () => {
  const { seen, outbound } = recorder((url) => (url === 'http://ollama.test:11434/v1/chat/completions' ? chatCompletion(JSON.stringify(ANSWER)) : null));
  const { res, health } = await saveWith({ OPENAI_BASE_URL: 'http://ollama.test:11434/v1/', OPENAI_MODEL: 'llama3.2' }, outbound);
  assert.equal(res.json.item.media_type, 'series');
  const call = seen.find((r) => r.url.startsWith('http://ollama.test'));
  assert.equal(call.headers.authorization, undefined, 'no empty bearer token');
  assert.equal(call.body.model, 'llama3.2');
  assert.equal(health.ai, 'openai');
});

test('AI_PROVIDER picks between several configured keys, and "none" turns the model off', async () => {
  const both = { ANTHROPIC_API_KEY: 'sk-ant-test', OPENROUTER_API_KEY: 'or-test' };
  const picked = await saveWith({ ...both, AI_PROVIDER: 'openrouter' }, () => new Response('offline', { status: 404 }));
  assert.equal(picked.health.ai, 'openrouter');
  const unnamed = await saveWith(both, () => new Response('offline', { status: 404 }));
  assert.equal(unnamed.health.ai, 'anthropic', 'Anthropic first when nothing is named');
  const off = await saveWith({ ...both, AI_PROVIDER: 'none' }, () => new Response('offline', { status: 404 }));
  assert.equal(off.health.ai, 'none');
});

test('a provider that is down leaves the built-in rules in charge', async () => {
  const { outbound } = recorder((url) => (url.startsWith('https://openrouter.ai/') ? new Response('upstream down', { status: 502 }) : null));
  const { res } = await saveWith({ OPENROUTER_API_KEY: 'or-test' }, outbound, 'read the novel Northbound');
  assert.equal(res.status, 200);
  assert.equal(res.json.item.media_type, 'book');
});
