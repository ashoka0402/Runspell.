import assert from 'node:assert/strict';
import { test } from 'node:test';
import { geminiFromEnv, type PlannerInput } from '../src/gemini.js';

const env = {
  RUNSPELL_ENABLE_GEMINI: 'true',
  GEMINI_API_KEY: 'synthetic-test-key',
  GEMINI_MODEL: 'gemini-test',
};
const input: PlannerInput = {
  prompt: 'Review an invoice',
  current: { name: 'Invoice review' },
  catalog: [{ actionType: 'human.approval' }],
  allowedOrigins: ['https://portal.example'],
};

function unexpectedFetch(): Promise<Response> {
  assert.fail('Gemini should receive no request');
}

test('Gemini requires explicit opt-in and valid private configuration', () => {
  assert.equal(geminiFromEnv({ ...env, RUNSPELL_ENABLE_GEMINI: 'false' }, unexpectedFetch), undefined);
  assert.equal(geminiFromEnv({}, unexpectedFetch), undefined);
  assert.throws(() => geminiFromEnv({ ...env, GEMINI_API_KEY: ' ' }, unexpectedFetch), /GEMINI_API_KEY/);
  assert.throws(() => geminiFromEnv({ ...env, GEMINI_MODEL: 'gemini-test/other' }, unexpectedFetch), /GEMINI_MODEL/);
});

test('Gemini uses the expected JSON endpoint and returns draft output with reported token usage', async () => {
  const output = { status: 'clarification', message: 'Which invoice is in scope?' };
  let calls = 0;
  const request: typeof fetch = async (url, options) => {
    calls += 1;
    assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent');
    assert.equal(options?.method, 'POST');
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal instanceof AbortSignal);
    const headers = new Headers(options?.headers);
    assert.equal(headers.get('x-goog-api-key'), env.GEMINI_API_KEY);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(typeof options?.body, 'string');
    const body = JSON.parse(options.body as string);
    assert.deepEqual(JSON.parse(body.contents[0].parts[0].text), input);
    assert.deepEqual(body.generationConfig, { responseMimeType: 'application/json', maxOutputTokens: 4096 });
    assert.ok(!body.tools && !body.toolConfig);
    assert.ok(!(options.body as string).includes(env.GEMINI_API_KEY));
    return Response.json({
      candidates: [{
        finishReason: 'STOP',
        content: { parts: [{ text: 'thought text', thought: true }, { text: JSON.stringify(output) }] },
      }],
      usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 24, thoughtsTokenCount: 6, totalTokenCount: 150 },
    });
  };

  assert.deepEqual(await geminiFromEnv(env, request)!(input), {
    output,
    usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
  });
  assert.equal(calls, 1);
});

test('Gemini bounds input size and sanitizes malformed, truncated, and upstream responses', async () => {
  const provider = geminiFromEnv(env, unexpectedFetch)!;
  await assert.rejects(provider({ ...input, prompt: '€'.repeat(25_000) }), /size limit/);

  const responses = [
    new Response('upstream private detail', { status: 429 }),
    new Response('malformed provider response'),
    new Response('y'.repeat(129 * 1024)),
    Response.json({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{}' }] } }] }),
    Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'non-JSON candidate' }] } }] }),
  ];
  let calls = 0;
  const request: typeof fetch = async () => responses[calls++]!;
  const bounded = geminiFromEnv(env, request)!;
  for (const _ of responses) {
    await assert.rejects(bounded(input), { message: 'Gemini planning request failed' });
  }
  assert.equal(calls, responses.length);
});
