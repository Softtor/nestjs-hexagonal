import { readFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { appendHookLog, type HookDecision, type HookLogEntry } from '../../lib/hook-log.ts';
import { resolveDataDir } from '../../lib/session-store.ts';
import { PREFIX, logFields, type HookContext, type HookHandler, type HookResult } from './hook-common.ts';
import { findLeak, forbiddenOutput, parseHookInput, readStdin, serializeOutput } from './hook-io.ts';

export interface HookIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

function pluginVersion(pluginRoot: string): string {
  try {
    const parsed: unknown = JSON.parse(readFileSync(resolve(pluginRoot, 'package.json'), 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string') {
      return parsed.version;
    }
  } catch {
    void 0;
  }
  return 'unknown';
}

function writeLog(context: HookContext, entry: HookLogEntry, secrets: string[], io: HookIo): void {
  const line = JSON.stringify(entry);
  if (secrets.some((secret) => line.includes(secret))) {
    io.stderr(`${PREFIX} log line suppressed: it would contain a secret\n`);
    return;
  }
  try {
    appendHookLog(resolveDataDir(context.env), entry);
  } catch (error) {
    io.stderr(`${PREFIX} could not append the hook log: ${error instanceof Error ? error.message : String(error)}\n`);
  }
}

/**
 * Runs one hook end to end: parse stdin, run the handler, guard the output
 * against secrets and raw bodies, log the decision. Always exits 0: a hook
 * that fails must never block the agent, only stay silent.
 */
export async function executeHook(hook: string, handler: HookHandler, raw: string, context: HookContext, io: HookIo): Promise<number> {
  const now = context.now ?? Date.now;
  const started = now();
  const parsed = parseHookInput(raw);
  if (!parsed.ok) {
    io.stderr(`${PREFIX} ${hook}: ${parsed.error} (ignored)\n`);
    return 0;
  }
  const input = parsed.input;
  let result: HookResult;
  try {
    result = await handler(input, context);
  } catch (error) {
    io.stderr(`${PREFIX} ${hook}: ${error instanceof Error ? error.message : String(error)} (fail-open)\n`);
    result = { output: null, decision: 'error' };
  }
  if (result.stderr !== undefined && result.stderr !== '') {
    io.stderr(`${result.stderr}\n`);
  }

  const forbidden = forbiddenOutput(context.env, result.bodies ?? []);
  let decision: HookDecision = result.decision;
  if (result.output !== null) {
    const text = serializeOutput(result.output);
    const leak = findLeak(text, forbidden);
    if (leak === null) {
      io.stdout(text);
    } else {
      io.stderr(`${PREFIX} ${hook}: output suppressed because it would contain a ${leak === 'secret' ? 'secret' : 'raw file body'}\n`);
      decision = 'error';
    }
  }

  const entry: HookLogEntry = {
    ts: new Date(now()).toISOString(),
    ...logFields(input, hook, decision, result),
    latencyMs: Math.max(0, now() - started),
    binarySource: context.env.NESTJS_HEXAGONAL_BINARY_SOURCE ?? null,
    version: pluginVersion(context.pluginRoot),
  };
  writeLog(context, entry, forbidden.secrets, io);
  return 0;
}

export function isMainModule(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return moduleUrl === pathToFileURL(isAbsolute(entry) ? entry : resolve(entry)).href;
}

export async function runHookMain(hook: string, handler: HookHandler, moduleUrl: string): Promise<void> {
  if (!isMainModule(moduleUrl)) {
    return;
  }
  const pluginRoot = dirname(dirname(dirname(fileURLToPath(moduleUrl))));
  const raw = await readStdin();
  const io: HookIo = { stdout: (text) => void process.stdout.write(text), stderr: (text) => void process.stderr.write(text) };
  process.exitCode = await executeHook(hook, handler, raw, { env: process.env, cwd: process.cwd(), pluginRoot }, io);
}
