import './helpers/no-network.ts';
import { assertNetworkForbidden } from './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createJevClient, toJevQuestion, type FetchLike, type JevQuestion, type JevRequest } from '../lib/jev-client.ts';
import { QuestionSchema } from '../lib/rulebook.schema.ts';

const PIN = 'jev-1.13.0';
const KEY = 'sk-test-secret-key-000';

interface CannedResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  hang?: boolean;
}

interface FakeFetch {
  fetch: FetchLike;
  calls: Array<{ url: string; init: RequestInit }>;
}

function fakeFetch(responses: CannedResponse[]): FakeFetch {
  const calls: FakeFetch['calls'] = [];
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, init });
    const canned = responses[Math.min(calls.length - 1, responses.length - 1)];
    if (canned === undefined) {
      return Promise.reject(new Error('no canned response'));
    }
    if (canned.hang) {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('aborted', 'AbortError'));
        });
      });
    }
    return Promise.resolve(
      new Response(JSON.stringify(canned.body), {
        status: canned.status,
        headers: { 'content-type': 'application/json', ...(canned.headers ?? {}) },
      }),
    );
  };
  return { fetch: fetchImpl, calls };
}

function okBody(model = PIN): unknown {
  return {
    model,
    answers: {
      'hex/rule-a': { type: 'noul', noul: 0.91 },
      'hex/rule-b': { type: 'choice', choice: 'none', confidence: 0.8, probabilities: { none: 0.8, other: 0.2 } },
    },
    usage: { input_tokens: 512, output_tokens: 8 },
  };
}

const request: JevRequest = {
  state: { preamble: 'p', path: 'a.ts', layer: 'application', slice: 'file', code: 'const secret = 1;' },
  questions: {
    'hex/rule-a': { type: 'noul', instructions: 'Is it a?' },
    'hex/rule-b': { type: 'choice', instructions: 'Which?', criteria: { none: 'nothing', other: 'else' } },
  },
};

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), 'jev-client-'));
}

function client(overrides: Partial<Parameters<typeof createJevClient>[0]> = {}) {
  return createJevClient({ apiKey: KEY, pin: PIN, timeoutMs: 50, sleep: () => Promise.resolve(), random: () => 0, ...overrides });
}

describe('createJevClient', () => {
  it('returns no-key without touching the network when the key is missing', async () => {
    const result = await createJevClient({ apiKey: undefined, pin: PIN }).ask(request);
    expect(result).toEqual({ ok: false, error: 'no-key', detail: 'TYPESAFE_API_KEY is not set' });
    assertNetworkForbidden();
  });

  it('posts the pinned model, bearer key and questions, and returns validated answers', async () => {
    const fake = fakeFetch([{ status: 200, body: okBody() }]);
    const result = await client({ fetchImpl: fake.fetch }).ask(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model).toBe(PIN);
    expect(result.uncalibrated).toBe(false);
    expect(result.cached).toBe(false);
    expect(result.usage).toEqual({ inputTokens: 512, outputTokens: 8 });
    expect(result.answers['hex/rule-a']).toEqual({ type: 'noul', noul: 0.91 });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]?.url).toBe('https://api.typesafe.ai/v1/systemone');
    const headers = new Headers(fake.calls[0]?.init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${KEY}`);
    const body: unknown = JSON.parse(String(fake.calls[0]?.init.body));
    expect(body).toEqual({ model: PIN, state: request.state, questions: request.questions });
  });

  it('flags model mismatch as uncalibrated but still returns the answers', async () => {
    const fake = fakeFetch([{ status: 200, body: okBody('jev-2.0.0') }]);
    const result = await client({ fetchImpl: fake.fetch }).ask(request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.uncalibrated).toBe(true);
    expect(result.model).toBe('jev-2.0.0');
  });

  it('rejects a response that fails the schema', async () => {
    const fake = fakeFetch([{ status: 200, body: { model: PIN, answers: { 'hex/rule-a': { type: 'noul', p: 0.5 } }, usage: {} } }]);
    const result = await client({ fetchImpl: fake.fetch }).ask(request);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid-response');
  });

  it('maps 4xx other than 429 to http without retrying', async () => {
    const fake = fakeFetch([{ status: 401, body: { error: 'bad key' } }]);
    const result = await client({ fetchImpl: fake.fetch }).ask(request);
    expect(result).toMatchObject({ ok: false, error: 'http', status: 401 });
    expect(fake.calls).toHaveLength(1);
  });

  it('retries 429 and 5xx up to three times honouring Retry-After, then reports rate-limited', async () => {
    const waits: number[] = [];
    const fake = fakeFetch([
      { status: 429, body: {}, headers: { 'retry-after': '2' } },
      { status: 503, body: {} },
      { status: 429, body: {} },
      { status: 429, body: {} },
      { status: 200, body: okBody() },
    ]);
    const result = await client({
      fetchImpl: fake.fetch,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    }).ask(request);
    expect(result).toMatchObject({ ok: false, error: 'rate-limited', status: 429 });
    expect(fake.calls).toHaveLength(4);
    expect(waits).toHaveLength(3);
    expect(waits[0]).toBe(2000);
    expect(waits[1]).toBeGreaterThan(0);
  });

  it('succeeds after a transient 529', async () => {
    const fake = fakeFetch([{ status: 529, body: {} }, { status: 200, body: okBody() }]);
    const result = await client({ fetchImpl: fake.fetch }).ask(request);
    expect(result.ok).toBe(true);
    expect(fake.calls).toHaveLength(2);
  });

  it('aborts on timeout', async () => {
    const fake = fakeFetch([{ status: 200, body: {}, hang: true }]);
    const result = await client({ fetchImpl: fake.fetch, timeoutMs: 5 }).ask(request);
    expect(result).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('serves the second identical request from the cache without a network call', async () => {
    const cacheDir = tempDir();
    const fake = fakeFetch([{ status: 200, body: okBody() }]);
    const jev = client({ fetchImpl: fake.fetch, cacheDir, rulebookVersion: '1.3.0' });
    const first = await jev.ask(request);
    const second = await jev.ask(request);
    expect(first.ok && !first.cached).toBe(true);
    expect(second.ok && second.cached).toBe(true);
    expect(fake.calls).toHaveLength(1);
    const otherVersion = client({ fetchImpl: fake.fetch, cacheDir, rulebookVersion: '1.4.0' });
    await otherVersion.ask(request);
    expect(fake.calls).toHaveLength(2);
    expect(readdirSync(cacheDir)).toHaveLength(2);
  });

  it('logs one JSONL line per call with values only, never the state text nor the key', async () => {
    const dir = tempDir();
    const logPath = join(dir, 'jev.jsonl');
    const fake = fakeFetch([{ status: 200, body: okBody() }, { status: 401, body: {} }]);
    const jev = client({
      fetchImpl: fake.fetch,
      logPath,
      onResult: () => ({ 'hex/rule-a': 'advise', 'hex/rule-b': 'pass' }),
    });
    await jev.ask(request);
    await jev.ask({ ...request, questions: { 'hex/rule-a': request.questions['hex/rule-a'] ?? { type: 'noul', instructions: 'x' } } });
    const lines = readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    const first: unknown = JSON.parse(lines[0] ?? '');
    expect(first).toMatchObject({
      keys: ['hex/rule-a', 'hex/rule-b'],
      answers: { 'hex/rule-a': 0.91, 'hex/rule-b': 'none' },
      model: PIN,
      inputTokens: 512,
      cached: false,
      decision: { 'hex/rule-a': 'advise', 'hex/rule-b': 'pass' },
    });
    const second: unknown = JSON.parse(lines[1] ?? '');
    expect(second).toMatchObject({ keys: ['hex/rule-a'], error: 'http', status: 401 });
    const raw = readFileSync(logPath, 'utf8');
    expect(raw).not.toContain('const secret');
    expect(raw).not.toContain(KEY);
  });

  it('opens the breaker after three consecutive failures within two minutes and closes it after five', async () => {
    const dir = tempDir();
    const breakerPath = join(dir, 'breaker.json');
    let now = 1_000_000;
    const fake = fakeFetch([{ status: 503, body: {} }]);
    const jev = client({ fetchImpl: fake.fetch, breakerPath, clock: () => now });
    for (let i = 0; i < 3; i += 1) {
      const result = await jev.ask(request);
      expect(result).toMatchObject({ ok: false, error: 'http', status: 503 });
      now += 10_000;
    }
    const callsBefore = fake.calls.length;
    const blocked = await jev.ask(request);
    expect(blocked).toMatchObject({ ok: false, error: 'breaker-open' });
    expect(fake.calls).toHaveLength(callsBefore);
    expect(existsSync(breakerPath)).toBe(true);
    now += 5 * 60_000 + 1;
    const again = await client({ fetchImpl: fakeFetch([{ status: 200, body: okBody() }]).fetch, breakerPath, clock: () => now }).ask(request);
    expect(again.ok).toBe(true);
  });

  it('does not open the breaker when failures are spread over more than two minutes', async () => {
    const dir = tempDir();
    let now = 0;
    const fake = fakeFetch([{ status: 200, body: {}, hang: true }]);
    const jev = client({ fetchImpl: fake.fetch, breakerPath: join(dir, 'b.json'), clock: () => now, timeoutMs: 1 });
    for (let i = 0; i < 3; i += 1) {
      expect(await jev.ask(request)).toMatchObject({ ok: false, error: 'timeout' });
      now += 70_000;
    }
    expect(await jev.ask(request)).toMatchObject({ ok: false, error: 'timeout' });
  });

  it('refuses a request whose state exceeds the 32k token budget', async () => {
    const fake = fakeFetch([{ status: 200, body: okBody() }]);
    const huge: JevRequest = { ...request, state: { preamble: 'p', code: 'x'.repeat(33_000 * 4) } };
    const result = await client({ fetchImpl: fake.fetch }).ask(huge);
    expect(result).toMatchObject({ ok: false, error: 'too-large' });
    expect(fake.calls).toHaveLength(0);
  });
});

describe('toJevQuestion', () => {
  it('maps rulebook choice options to a criteria map and score levels to an ordered list', () => {
    const choice = QuestionSchema.parse({
      type: 'choice',
      instructions: 'Which?',
      options: [
        { id: 'a', criteria: 'A' },
        { id: 'other', criteria: 'O' },
      ],
      violatingOptions: ['a'],
    });
    const expectedChoice: JevQuestion = { type: 'choice', instructions: 'Which?', criteria: { a: 'A', other: 'O' } };
    expect(toJevQuestion(choice)).toEqual(expectedChoice);
    const score = QuestionSchema.parse({
      type: 'score',
      instructions: 'How?',
      levels: [
        { id: 'low', criteria: 'L' },
        { id: 'high', criteria: 'H' },
      ],
      violatingLevels: ['high'],
    });
    const expectedScore: JevQuestion = { type: 'score', instructions: 'How?', criteria: ['L', 'H'] };
    expect(toJevQuestion(score)).toEqual(expectedScore);
    expect(toJevQuestion({ type: 'noul', instructions: 'Yes?' })).toEqual({ type: 'noul', instructions: 'Yes?' });
  });
});

describe('createJevClient hardening', () => {
  it('never lets a throwing onResult hook break the call and logs the hook error', async () => {
    const dir = tempDir();
    const logPath = join(dir, 'jev.jsonl');
    const fake = fakeFetch([{ status: 200, body: okBody() }]);
    const result = await client({ fetchImpl: fake.fetch, logPath }).ask(request, {
      onResult: () => {
        throw new TypeError('observer exploded');
      },
    });
    expect(result.ok).toBe(true);
    const line: unknown = JSON.parse(readFileSync(logPath, 'utf8').trim());
    expect(line).toMatchObject({ hookError: 'observer exploded', decision: null });
  });

  it('retries a network rejection once, then reports http and counts it in the breaker', async () => {
    const dir = tempDir();
    const breakerPath = join(dir, 'breaker.json');
    let now = 0;
    const calls: number[] = [];
    const failing: FetchLike = () => {
      calls.push(1);
      return Promise.reject(new Error('connect ECONNREFUSED'));
    };
    const jev = client({ fetchImpl: failing, breakerPath, clock: () => now });
    const result = await jev.ask(request);
    expect(result).toMatchObject({ ok: false, error: 'http', detail: 'connect ECONNREFUSED' });
    expect(result).not.toHaveProperty('status');
    expect(calls).toHaveLength(2);
    now += 1000;
    await jev.ask(request);
    now += 1000;
    await jev.ask(request);
    expect(calls).toHaveLength(6);
    expect(await jev.ask(request)).toMatchObject({ ok: false, error: 'breaker-open' });
    expect(calls).toHaveLength(6);
  });

  it('caps Retry-After at ten seconds', async () => {
    const waits: number[] = [];
    const fake = fakeFetch([{ status: 429, body: {}, headers: { 'retry-after': '120' } }, { status: 200, body: okBody() }]);
    const result = await client({
      fetchImpl: fake.fetch,
      sleep: (ms) => {
        waits.push(ms);
        return Promise.resolve();
      },
    }).ask(request);
    expect(result.ok).toBe(true);
    expect(waits).toEqual([10_000]);
  });
});
