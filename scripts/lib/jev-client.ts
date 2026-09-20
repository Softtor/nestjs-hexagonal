import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { Question } from './rulebook.schema.ts';

export const JEV_ENDPOINT = 'https://api.typesafe.ai/v1/systemone';
export const STATE_TOKEN_BUDGET = 32_000;
export const REQUEST_TOKEN_BUDGET = 64_000;

const MAX_RETRIES = 3;
const BACKOFF_BASE_MS = 250;
const BREAKER_FAILURES = 3;
const BREAKER_WINDOW_MS = 2 * 60_000;
const BREAKER_OPEN_MS = 5 * 60_000;

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export type JevQuestion =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string> }
  | { type: 'score'; instructions: string; criteria: string[] };

export interface JevRequest {
  state: JsonValue;
  questions: Record<string, JevQuestion>;
}

const Probability = z.number().min(0).max(1);

const AnswerSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('noul'), noul: Probability }),
  z.object({ type: z.literal('choice'), choice: z.string(), confidence: Probability, probabilities: z.record(z.string(), Probability) }),
  z.object({
    type: z.literal('score'),
    score: z.number(),
    confidence: Probability,
    legend: z.record(z.string(), z.string()),
    probabilities: z.record(z.string(), Probability),
  }),
]);

const ResponseSchema = z.object({
  model: z.string().min(1),
  answers: z.record(z.string(), AnswerSchema),
  usage: z.object({ input_tokens: z.number().int().nonnegative(), output_tokens: z.number().int().nonnegative() }),
});

export type JevAnswer = z.infer<typeof AnswerSchema>;
type JevResponse = z.infer<typeof ResponseSchema>;

export type JevErrorCode = 'no-key' | 'timeout' | 'http' | 'rate-limited' | 'invalid-response' | 'breaker-open' | 'too-large';

export interface JevSuccess {
  ok: true;
  answers: Record<string, JevAnswer>;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
  latencyMs: number;
  cached: boolean;
  uncalibrated: boolean;
}

export interface JevFailure {
  ok: false;
  error: JevErrorCode;
  status?: number;
  detail: string;
}

export type JevAskResult = JevSuccess | JevFailure;

export interface JevClientOptions {
  apiKey: string | undefined;
  pin: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
  cacheDir?: string;
  logPath?: string;
  breakerPath?: string;
  rulebookVersion?: string;
  endpoint?: string;
  onResult?: (result: JevAskResult, request: JevRequest) => Record<string, string> | undefined;
  clock?: () => number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

export interface JevAskHooks {
  onResult?: (result: JevAskResult, request: JevRequest) => Record<string, string> | undefined;
}

export interface JevClient {
  ask(request: JevRequest, hooks?: JevAskHooks): Promise<JevAskResult>;
}

export function estimateTokens(value: JsonValue | JevQuestion): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export function toJevQuestion(question: Question): JevQuestion {
  switch (question.type) {
    case 'noul':
      return { type: 'noul', instructions: question.instructions };
    case 'choice': {
      const criteria: Record<string, string> = {};
      for (const option of question.options) {
        criteria[option.id] = option.criteria;
      }
      return { type: 'choice', instructions: question.instructions, criteria };
    }
    case 'score':
      return { type: 'score', instructions: question.instructions, criteria: question.levels.map((level) => level.criteria) };
  }
}

export function answerValue(answer: JevAnswer): number | string {
  switch (answer.type) {
    case 'noul':
      return answer.noul;
    case 'choice':
      return answer.choice;
    case 'score':
      return answer.score;
  }
}

interface BreakerState {
  failures: number[];
  openUntil: number | null;
}

const BreakerSchema = z.object({ failures: z.array(z.number()), openUntil: z.number().nullable() });

function writeAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

function createBreaker(path: string | undefined, clock: () => number) {
  let memory: BreakerState = { failures: [], openUntil: null };

  const read = (): BreakerState => {
    if (path === undefined) {
      return memory;
    }
    if (!existsSync(path)) {
      return { failures: [], openUntil: null };
    }
    try {
      const parsed = BreakerSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      return parsed.success ? parsed.data : { failures: [], openUntil: null };
    } catch {
      return { failures: [], openUntil: null };
    }
  };

  const write = (state: BreakerState): void => {
    memory = state;
    if (path !== undefined) {
      writeAtomic(path, JSON.stringify(state));
    }
  };

  return {
    isOpen(): boolean {
      const state = read();
      const now = clock();
      if (state.openUntil !== null && now < state.openUntil) {
        return true;
      }
      if (state.openUntil !== null) {
        write({ failures: [], openUntil: null });
      }
      return false;
    },
    recordFailure(): void {
      const state = read();
      const now = clock();
      const failures = state.failures.filter((at) => now - at < BREAKER_WINDOW_MS);
      failures.push(now);
      const openUntil = failures.length >= BREAKER_FAILURES ? now + BREAKER_OPEN_MS : null;
      write({ failures: openUntil === null ? failures : [], openUntil });
    },
    recordSuccess(): void {
      const state = read();
      if (state.failures.length > 0 || state.openUntil !== null) {
        write({ failures: [], openUntil: null });
      }
    },
  };
}

function cacheKey(request: JevRequest, pin: string, rulebookVersion: string): string {
  return createHash('sha256')
    .update(JSON.stringify(request.state))
    .update(JSON.stringify(request.questions))
    .update(pin)
    .update(rulebookVersion)
    .digest('hex');
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (header === null) {
    return null;
  }
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const at = Date.parse(header);
  return Number.isNaN(at) ? null : Math.max(0, at - Date.now());
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type Attempt = { kind: 'ok'; response: JevResponse } | { kind: 'retry'; status: number; waitMs: number | null } | { kind: 'fail'; result: JevFailure };

export function createJevClient(options: JevClientOptions): JevClient {
  const clock = options.clock ?? Date.now;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const random = options.random ?? Math.random;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const endpoint = options.endpoint ?? JEV_ENDPOINT;
  const rulebookVersion = options.rulebookVersion ?? '';
  const breaker = createBreaker(options.breakerPath, clock);

  const log = (request: JevRequest, result: JevAskResult, decision: Record<string, string> | undefined): void => {
    if (options.logPath === undefined) {
      return;
    }
    const keys = Object.keys(request.questions);
    const entry: Record<string, JsonValue> = { ts: new Date(clock()).toISOString(), pin: options.pin, keys };
    if (result.ok) {
      const answers: Record<string, number | string> = {};
      const confidence: Record<string, number> = {};
      for (const [key, answer] of Object.entries(result.answers)) {
        answers[key] = answerValue(answer);
        if (answer.type !== 'noul') {
          confidence[key] = answer.confidence;
        }
      }
      Object.assign(entry, {
        answers,
        confidence,
        model: result.model,
        latencyMs: result.latencyMs,
        inputTokens: result.usage.inputTokens,
        cached: result.cached,
        uncalibrated: result.uncalibrated,
      });
    } else {
      entry.error = result.error;
      if (result.status !== undefined) {
        entry.status = result.status;
      }
    }
    entry.decision = decision ?? null;
    mkdirSync(dirname(options.logPath), { recursive: true });
    appendFileSync(options.logPath, `${JSON.stringify(entry)}\n`);
  };

  const finish = (request: JevRequest, result: JevAskResult, hooks: JevAskHooks | undefined): JevAskResult => {
    const onResult = hooks?.onResult ?? options.onResult;
    log(request, result, onResult?.(result, request));
    return result;
  };

  const readCache = (key: string): JevResponse | null => {
    if (options.cacheDir === undefined) {
      return null;
    }
    const path = join(options.cacheDir, `${key}.json`);
    if (!existsSync(path)) {
      return null;
    }
    try {
      const parsed = ResponseSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  };

  const writeCache = (key: string, response: JevResponse): void => {
    if (options.cacheDir === undefined) {
      return;
    }
    writeAtomic(join(options.cacheDir, `${key}.json`), JSON.stringify(response));
  };

  const attempt = async (body: string, apiKey: string): Promise<Attempt> => {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response: Response;
    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } catch (error) {
      if (isAbortError(error)) {
        return { kind: 'fail', result: { ok: false, error: 'timeout', detail: `no response within ${timeoutMs} ms` } };
      }
      return { kind: 'fail', result: { ok: false, error: 'http', detail: errorMessage(error) } };
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429 || response.status >= 500) {
      return { kind: 'retry', status: response.status, waitMs: retryAfterMs(response) };
    }
    if (!response.ok) {
      return { kind: 'fail', result: { ok: false, error: 'http', status: response.status, detail: `HTTP ${response.status}` } };
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      return { kind: 'fail', result: { ok: false, error: 'invalid-response', status: response.status, detail: errorMessage(error) } };
    }
    const parsed = ResponseSchema.safeParse(json);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`).join('; ');
      return { kind: 'fail', result: { ok: false, error: 'invalid-response', status: response.status, detail } };
    }
    return { kind: 'ok', response: parsed.data };
  };

  const send = async (request: JevRequest, apiKey: string): Promise<JevAskResult> => {
    const body = JSON.stringify({ model: options.pin, state: request.state, questions: request.questions });
    const started = clock();
    let lastStatus = 0;
    for (let retry = 0; retry <= MAX_RETRIES; retry += 1) {
      const outcome = await attempt(body, apiKey);
      if (outcome.kind === 'ok') {
        breaker.recordSuccess();
        return {
          ok: true,
          answers: outcome.response.answers,
          model: outcome.response.model,
          usage: { inputTokens: outcome.response.usage.input_tokens, outputTokens: outcome.response.usage.output_tokens },
          latencyMs: clock() - started,
          cached: false,
          uncalibrated: outcome.response.model !== options.pin,
        };
      }
      if (outcome.kind === 'fail') {
        if (outcome.result.error === 'timeout') {
          breaker.recordFailure();
        }
        return outcome.result;
      }
      lastStatus = outcome.status;
      if (retry < MAX_RETRIES) {
        const backoff = BACKOFF_BASE_MS * 2 ** retry * (1 + random());
        await sleep(outcome.waitMs ?? backoff);
      }
    }
    breaker.recordFailure();
    if (lastStatus === 429) {
      return { ok: false, error: 'rate-limited', status: lastStatus, detail: `HTTP 429 after ${MAX_RETRIES} retries` };
    }
    return { ok: false, error: 'http', status: lastStatus, detail: `HTTP ${lastStatus} after ${MAX_RETRIES} retries` };
  };

  return {
    async ask(request, hooks) {
      const apiKey = options.apiKey;
      if (apiKey === undefined || apiKey === '') {
        return finish(request, { ok: false, error: 'no-key', detail: 'TYPESAFE_API_KEY is not set' }, hooks);
      }
      const stateTokens = estimateTokens(request.state);
      const questionTokens = Object.values(request.questions).map(estimateTokens);
      const longest = Math.max(0, ...questionTokens);
      const total = stateTokens + questionTokens.reduce((sum, tokens) => sum + tokens, 0);
      if (stateTokens + longest > STATE_TOKEN_BUDGET || total > REQUEST_TOKEN_BUDGET) {
        return finish(request, {
          ok: false,
          error: 'too-large',
          detail: `estimated ${stateTokens} state tokens + ${longest} question tokens (limit ${STATE_TOKEN_BUDGET}), ${total} total (limit ${REQUEST_TOKEN_BUDGET})`,
        }, hooks);
      }
      const key = cacheKey(request, options.pin, rulebookVersion);
      const hit = readCache(key);
      if (hit !== null) {
        return finish(request, {
          ok: true,
          answers: hit.answers,
          model: hit.model,
          usage: { inputTokens: hit.usage.input_tokens, outputTokens: hit.usage.output_tokens },
          latencyMs: 0,
          cached: true,
          uncalibrated: hit.model !== options.pin,
        }, hooks);
      }
      if (breaker.isOpen()) {
        return finish(request, { ok: false, error: 'breaker-open', detail: 'circuit breaker is open after repeated failures' }, hooks);
      }
      const result = await send(request, apiKey);
      if (result.ok) {
        writeCache(key, {
          model: result.model,
          answers: result.answers,
          usage: { input_tokens: result.usage.inputTokens, output_tokens: result.usage.outputTokens },
        });
      }
      return finish(request, result, hooks);
    },
  };
}
