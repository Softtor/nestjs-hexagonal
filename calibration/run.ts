import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadComposedRulebook } from '../scripts/lib/compose.ts';
import { decide } from '../scripts/lib/decide.ts';
import { createJevClient, toJevQuestion, type JevClient } from '../scripts/lib/jev-client.ts';
import type { Rule } from '../scripts/lib/rulebook.schema.ts';
import { runPool } from '../scripts/lib/semantic-engine.ts';
import { buildState } from '../scripts/lib/state-builder.ts';
import { loadGoldenCases, type GoldenCase } from './lib/golden.ts';
import { appendResult, openResults, type ResultRecord } from './lib/results.ts';

export const DEFAULT_MAX_REQUESTS = 500;
export const DEFAULT_CONCURRENCY = 4;

export interface RunCalibrationOptions {
  rules: Rule[];
  goldenRoot: string;
  pluginRoot: string;
  outDir: string;
  pin: string;
  client: JevClient;
  concurrency?: number;
  maxRequests?: number;
  log?: (message: string) => void;
}

export type RunCalibrationResult =
  | { ok: true; records: Map<string, ResultRecord[]>; requests: number; errors: number; files: string[] }
  | { ok: false; error: string };

async function askCase(rule: Rule, item: GoldenCase, options: RunCalibrationOptions): Promise<ResultRecord> {
  const question = rule.question;
  if (!question) {
    throw new Error(`rule ${rule.id} has no question`);
  }
  const built = buildState({ rule, file: item.file });
  const result = await options.client.ask({ state: built.state, questions: { [rule.id]: toJevQuestion(question) } });
  const base = { pin: options.pin, ruleId: rule.id, caseId: item.caseId, expected: item.expected, primitive: question.type, cached: false };
  if (!result.ok) {
    return { ...base, model: options.pin, value: 0, answer: '', latencyMs: 0, inputTokens: 0, error: `${result.error}${result.status === undefined ? '' : ` ${result.status}`}: ${result.detail}` };
  }
  const answer = result.answers[rule.id];
  if (answer === undefined) {
    return { ...base, model: result.model, value: 0, answer: '', latencyMs: result.latencyMs, inputTokens: result.usage.inputTokens, error: 'no answer for the rule id' };
  }
  if (answer.type !== question.type) {
    return { ...base, model: result.model, value: 0, answer: '', latencyMs: result.latencyMs, inputTokens: result.usage.inputTokens, error: `answer type ${answer.type} does not match question type ${question.type}` };
  }
  const outcome = decide(rule, answer);
  const record: ResultRecord = {
    ...base,
    model: result.model,
    value: outcome.value,
    answer: outcome.answer,
    latencyMs: result.latencyMs,
    inputTokens: result.usage.inputTokens,
    cached: result.cached,
  };
  if (outcome.confidence !== undefined) {
    record.confidence = outcome.confidence;
  }
  return record;
}

export async function runCalibration(options: RunCalibrationOptions): Promise<RunCalibrationResult> {
  const log = options.log ?? (() => undefined);
  const maxRequests = options.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const semanticRules = options.rules.filter((rule) => rule.class === 'semantic' && rule.question !== undefined);
  const work: Array<{ rule: Rule; item: GoldenCase }> = [];
  for (const rule of semanticRules) {
    for (const item of loadGoldenCases(options.goldenRoot, rule.id, options.pluginRoot)) {
      work.push({ rule, item });
    }
  }
  if (work.length === 0) {
    return { ok: false, error: 'no golden cases found for the selected rules' };
  }
  if (work.length > maxRequests) {
    return { ok: false, error: `budget guard: ${work.length} requests exceed --max-requests ${maxRequests}; nothing was sent` };
  }

  const records = new Map<string, ResultRecord[]>();
  const paths = new Map<string, string>();
  for (const rule of semanticRules) {
    if (work.some((entry) => entry.rule.id === rule.id)) {
      paths.set(rule.id, openResults(options.outDir, rule.id));
      records.set(rule.id, []);
    }
  }
  let done = 0;
  await runPool(work, options.concurrency ?? DEFAULT_CONCURRENCY, async ({ rule, item }) => {
    let record: ResultRecord;
    try {
      record = await askCase(rule, item, options);
    } catch (error) {
      const question = rule.question;
      record = {
        pin: options.pin,
        model: options.pin,
        ruleId: rule.id,
        caseId: item.caseId,
        expected: item.expected,
        primitive: question?.type ?? 'noul',
        value: 0,
        answer: '',
        latencyMs: 0,
        inputTokens: 0,
        cached: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const path = paths.get(rule.id);
    if (path !== undefined) {
      appendResult(path, record);
    }
    const list = records.get(rule.id) ?? [];
    list.push(record);
    records.set(rule.id, list);
    done += 1;
    log(`[${done}/${work.length}] ${rule.id} ${item.label}/${item.caseId}: ${record.error ?? `${record.primitive}=${record.answer} value=${record.value.toFixed(2)} ${record.latencyMs}ms`}`);
  });

  const files: string[] = [];
  let errors = 0;
  for (const [ruleId, list] of records) {
    list.sort((a, b) => a.expected.localeCompare(b.expected) || a.caseId.localeCompare(b.caseId));
    errors += list.filter((record) => record.error !== undefined).length;
    const path = paths.get(ruleId);
    if (path !== undefined) {
      files.push(path);
    }
  }
  return { ok: true, records, requests: work.length, errors, files: files.sort() };
}

interface RunCliArgs {
  rule: string;
  pin: string;
  out?: string;
  maxRequests: number;
  concurrency: number;
  cacheDir?: string;
}

export function parseRunArgs(argv: string[]): RunCliArgs {
  const args: RunCliArgs = { rule: 'all', pin: 'jev-1.13.0', maxRequests: DEFAULT_MAX_REQUESTS, concurrency: DEFAULT_CONCURRENCY };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (value === undefined) {
      throw new Error(`${flag} requires a value`);
    }
    switch (flag) {
      case '--rule':
        args.rule = value;
        break;
      case '--pin':
        args.pin = value;
        break;
      case '--out':
        args.out = value;
        break;
      case '--max-requests':
        args.maxRequests = Number(value);
        break;
      case '--concurrency':
        args.concurrency = Number(value);
        break;
      case '--cache-dir':
        args.cacheDir = value;
        break;
      default:
        throw new Error(`unknown option '${flag}'`);
    }
    i += 1;
  }
  if (!Number.isInteger(args.maxRequests) || args.maxRequests <= 0) {
    throw new Error('--max-requests must be a positive integer');
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency <= 0) {
    throw new Error('--concurrency must be a positive integer');
  }
  return args;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  return entry !== undefined && import.meta.url === pathToFileURL(isAbsolute(entry) ? entry : resolve(entry)).href;
}

if (isMainModule()) {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const args = parseRunArgs(process.argv.slice(2));
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (apiKey === undefined || apiKey === '') {
    process.stderr.write('TYPESAFE_API_KEY is not set; calibration needs the real model\n');
    process.exit(2);
  }
  const composed = loadComposedRulebook(join(pluginRoot, 'rulebooks', 'hexagonal.rulebook.yaml'), join(pluginRoot, 'rulebooks'));
  if (composed.rulebook.model.pin !== args.pin) {
    process.stderr.write(`rulebook pins ${composed.rulebook.model.pin} but --pin is ${args.pin}\n`);
    process.exit(2);
  }
  const rules = args.rule === 'all' ? composed.rules : composed.rules.filter((rule) => rule.id === args.rule);
  if (rules.length === 0) {
    process.stderr.write(`unknown rule '${args.rule}'\n`);
    process.exit(2);
  }
  const outDir = resolve(args.out ?? join(pluginRoot, 'calibration', 'results', args.pin));
  mkdirSync(outDir, { recursive: true });
  const client = createJevClient({
    apiKey,
    pin: args.pin,
    rulebookVersion: composed.rulebook.version,
    timeoutMs: 15_000,
    logPath: join(outDir, 'client-log.jsonl'),
    ...(args.cacheDir ? { cacheDir: resolve(args.cacheDir) } : {}),
  });
  const result = await runCalibration({
    rules,
    goldenRoot: join(pluginRoot, 'calibration', 'golden'),
    pluginRoot,
    outDir,
    pin: args.pin,
    client,
    concurrency: args.concurrency,
    maxRequests: args.maxRequests,
    log: (message) => process.stderr.write(`${message}\n`),
  });
  if (!result.ok) {
    process.stderr.write(`${result.error}\n`);
    process.exit(2);
  }
  process.stdout.write(`${result.requests} request(s), ${result.errors} error(s); results:\n${result.files.join('\n')}\n`);
  process.exitCode = result.errors > 0 ? 1 : 0;
}
