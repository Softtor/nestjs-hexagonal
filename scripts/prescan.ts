import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { CliIo, CliOptions } from './check.ts';
import { apiKey as resolveApiKey } from './lib/api-key.ts';
import { readRulebookFile, rulebookPathForId } from './lib/compose.ts';
import { createJevClient, type JevQuestion } from './lib/jev-client.ts';
import { pluginDataPaths } from './lib/plugin-data-paths.ts';
import { changedFilesSince, expandGlobs, readSources } from './lib/project-files.ts';
import { normalizePath } from './lib/scope.ts';
import { runPool } from './lib/semantic-engine.ts';
import { truncateToTokens } from './lib/state-builder.ts';
import type { SourceFile } from './lib/static-engine.ts';

export const ARTIFACT_KINDS = ['entity', 'vo', 'event', 'repo-interface', 'use-case', 'handler', 'controller', 'dto', 'module', 'listener', 'adapter', 'test', 'other'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

export const PRESCAN_LAYERS = ['domain', 'application', 'infrastructure', 'presentation', 'other'] as const;
export type PrescanLayer = (typeof PRESCAN_LAYERS)[number];

export interface SemanticKind {
  kind: string;
  confidence: number;
  agrees: boolean;
}

export interface PrescanEntry {
  path: string;
  layer: PrescanLayer;
  kind: ArtifactKind;
  lines: number;
  hasTests: boolean;
  semantic?: SemanticKind;
}

export interface PrescanReport {
  files: number;
  entries: PrescanEntry[];
  semantic?: { requests: number; skippedReason?: string; errors: string[] };
}

const SEMANTIC_CONCURRENCY = 4;
const STATE_TOKEN_BUDGET = 8_000;

const KIND_CRITERIA: Record<ArtifactKind, string> = {
  entity: 'A domain entity or aggregate root: a class holding identity and state with methods that enforce invariants or apply domain events.',
  vo: 'A value object: an immutable class compared by value that validates itself in its constructor.',
  event: 'A domain event: a class or interface carrying the data of something that happened, with no behavior.',
  'repo-interface': 'A repository interface or namespace declaring persistence operations without implementing them.',
  'use-case': 'A plain application use case class with an execute method and no framework decorators.',
  handler: 'A CQRS command or query handler decorated with @CommandHandler or @QueryHandler.',
  controller: 'An HTTP controller decorated with @Controller that maps requests to commands, queries or use cases.',
  dto: 'A data transfer object: an interface, type or class that only describes input or output data, possibly with validation decorators.',
  module: 'A NestJS module decorated with @Module that wires providers, imports and exports.',
  listener: 'An event handler decorated with @EventsHandler that reacts to a domain event.',
  adapter: 'An infrastructure adapter or concrete repository implementing a port or repository interface against a database, SDK or transport.',
  test: 'A test file with describe, it or test blocks.',
  other: 'None of the above: a mapper, a helper, a data builder, an error class, a port interface or configuration.',
};

export function isArtifactKind(value: string): value is ArtifactKind {
  return ARTIFACT_KINDS.some((kind) => kind === value);
}

export function classifyLayer(path: string): PrescanLayer {
  const normalized = `/${normalizePath(path)}`;
  if (normalized.includes('/domain/')) {
    return 'domain';
  }
  if (normalized.includes('/application/')) {
    return 'application';
  }
  if (normalized.includes('/controllers/') || normalized.includes('/presentation/')) {
    return 'presentation';
  }
  if (normalized.includes('/infrastructure/')) {
    return 'infrastructure';
  }
  return 'other';
}

function isTestPath(path: string): boolean {
  return path.includes('/__tests__/') || /\.(?:spec|test)\.tsx?$/.test(path);
}

export function classifyKind(path: string, content: string): ArtifactKind {
  const normalized = `/${normalizePath(path)}`;
  const name = basename(normalized);
  if (isTestPath(normalized)) {
    return 'test';
  }
  if (/@Module\s*\(/.test(content)) {
    return 'module';
  }
  if (/@Controller\s*\(/.test(content)) {
    return 'controller';
  }
  if (/@EventsHandler\s*\(/.test(content)) {
    return 'listener';
  }
  if (/@(?:CommandHandler|QueryHandler)\s*\(/.test(content)) {
    return 'handler';
  }
  if (normalized.includes('/dtos/') || /\.dto\.tsx?$/.test(name)) {
    return 'dto';
  }
  if (/extends\s+(?:AggregateRoot|Entity)\b/.test(content) || /\.entity\.ts$/.test(name)) {
    return 'entity';
  }
  if (/extends\s+ValueObject\b/.test(content) || /\.vo\.ts$/.test(name)) {
    return 'vo';
  }
  if (/implements\s+IEvent\b/.test(content) || /\.event\.ts$/.test(name)) {
    return 'event';
  }
  if (normalized.includes('/domain/repositories/') || (/\.repository\.ts$/.test(name) && !/\bclass\s/.test(content))) {
    return 'repo-interface';
  }
  if (/\.(?:usecase|use-case)\.ts$/.test(name)) {
    return 'use-case';
  }
  if (/\.adapter\.ts$/.test(name) || (normalized.includes('/infrastructure/') && /\.repository\.ts$/.test(name))) {
    return 'adapter';
  }
  return 'other';
}

/** Spec paths that would count as tests of `path`, in the order they are probed; a `.tsx` source also accepts `.spec.tsx`/`.test.tsx`. */
export function testSiblings(path: string): string[] {
  const normalized = normalizePath(path);
  const dir = dirname(normalized);
  const stem = basename(normalized).replace(/\.tsx?$/, '');
  const extensions = normalized.endsWith('.tsx') ? ['ts', 'tsx'] : ['ts'];
  const prefixes = [dir === '.' ? '__tests__' : `${dir}/__tests__`, dir === '.' ? '' : dir];
  const out: string[] = [];
  for (const prefix of prefixes) {
    for (const kind of ['spec', 'test']) {
      for (const extension of extensions) {
        out.push(`${prefix === '' ? '' : `${prefix}/`}${stem}.${kind}.${extension}`);
      }
    }
  }
  return out;
}

export function prescanFiles(files: SourceFile[], exists: (path: string) => boolean): PrescanEntry[] {
  const entries = files.map((file): PrescanEntry => {
    const kind = classifyKind(file.path, file.content);
    return {
      path: file.path,
      layer: classifyLayer(file.path),
      kind,
      lines: file.content.split('\n').length,
      hasTests: kind === 'test' ? true : testSiblings(file.path).some(exists),
    };
  });
  const rank = (layer: PrescanLayer): number => PRESCAN_LAYERS.indexOf(layer);
  return entries.sort((a, b) => rank(a.layer) - rank(b.layer) || a.path.localeCompare(b.path));
}

export function kindQuestion(): JevQuestion {
  return {
    type: 'choice',
    instructions: 'What kind of artifact is this TypeScript file, judging its executable code and declarations rather than its path? Pick the single best option; pick other when none of the specific kinds fits.',
    criteria: { ...KIND_CRITERIA },
  };
}

interface PrescanArgs {
  files: string[];
  diff?: string;
  semantic: boolean;
  format: 'json' | 'text';
}

const PRESCAN_USAGE = `Usage: nestjs-hexagonal-check prescan (--files <glob...> | --diff <base>) [--semantic] [--format json|text]

  Cheap static map of the files: layer from the path, kind from the content
  (${ARTIFACT_KINDS.join('|')}), line count and whether a spec sibling exists.
  --semantic asks Jev one choice question per file (needs TYPESAFE_API_KEY;
  skipped with a notice otherwise) and sends the whole file content, up to
  8,000 tokens, plus its path. Output is sorted by layer.
`;

class PrescanUsageError extends Error {}

function parsePrescanArgs(argv: string[]): PrescanArgs {
  const parsed: PrescanArgs = { files: [], semantic: false, format: 'text' };
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    switch (arg) {
      case '--files':
        while (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) {
          parsed.files.push(argv[i + 1]);
          i += 1;
        }
        if (parsed.files.length === 0) {
          throw new PrescanUsageError('--files requires at least one glob');
        }
        break;
      case '--diff': {
        const value = argv[i + 1];
        if (value === undefined || value.startsWith('--')) {
          throw new PrescanUsageError('--diff requires a value');
        }
        parsed.diff = value;
        i += 1;
        break;
      }
      case '--semantic':
        parsed.semantic = true;
        break;
      case '--format': {
        const value = argv[i + 1];
        if (value !== 'json' && value !== 'text') {
          throw new PrescanUsageError(`unknown format '${value ?? ''}'`);
        }
        parsed.format = value;
        i += 1;
        break;
      }
      case '--help':
      case '-h':
        throw new PrescanUsageError('');
      default:
        throw new PrescanUsageError(`unknown option '${arg}'`);
    }
    i += 1;
  }
  if (parsed.files.length === 0 && parsed.diff === undefined) {
    throw new PrescanUsageError('pass --files <glob...> or --diff <base>');
  }
  return parsed;
}

async function semanticKinds(entries: PrescanEntry[], files: SourceFile[], io: CliIo, options: CliOptions): Promise<NonNullable<PrescanReport['semantic']>> {
  const key = resolveApiKey(options.env);
  if (key === undefined) {
    const reason = 'TYPESAFE_API_KEY is not set; --semantic skipped';
    io.stderr(`${reason}\n`);
    return { requests: 0, skippedReason: reason, errors: [] };
  }
  const { rulebook } = readRulebookFile(rulebookPathForId(join(options.pluginRoot, 'rulebooks'), 'hexagonal'));
  const client = createJevClient({
    apiKey: key,
    pin: rulebook.model.pin,
    rulebookVersion: rulebook.version,
    timeoutMs: 8_000,
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    ...pluginDataPaths(options.env),
  });
  const contentByPath = new Map(files.map((file) => [file.path, file.content]));
  const errors: string[] = [];
  let requests = 0;
  await runPool(entries, SEMANTIC_CONCURRENCY, async (entry) => {
    const code = truncateToTokens(contentByPath.get(entry.path) ?? '', STATE_TOKEN_BUDGET).code;
    requests += 1;
    const result = await client.ask({ state: { path: entry.path, layer: entry.layer, code }, questions: { kind: kindQuestion() } });
    if (!result.ok) {
      const status = result.status === undefined ? '' : ` (HTTP ${result.status})`;
      errors.push(`${entry.path}: ${result.error}${status}: ${result.detail}`);
      return;
    }
    const answer = result.answers.kind;
    if (answer === undefined || answer.type !== 'choice') {
      errors.push(`${entry.path}: no choice answer`);
      return;
    }
    entry.semantic = { kind: answer.choice, confidence: answer.confidence, agrees: answer.choice === entry.kind };
  });
  return { requests, errors };
}

function formatPrescanText(report: PrescanReport): string {
  const lines: string[] = [];
  let current: PrescanLayer | null = null;
  for (const entry of report.entries) {
    if (entry.layer !== current) {
      current = entry.layer;
      lines.push(`${lines.length === 0 ? '' : '\n'}${current}:`);
    }
    const tests = entry.kind === 'test' ? '' : entry.hasTests ? ' tests' : ' no-tests';
    const semantic = entry.semantic === undefined ? '' : ` jev=${entry.semantic.kind}@${entry.semantic.confidence.toFixed(2)}${entry.semantic.agrees ? '' : ' (disagrees)'}`;
    lines.push(`  ${entry.kind.padEnd(14)} ${String(entry.lines).padStart(5)} ${entry.path}${tests}${semantic}`);
  }
  lines.push('');
  lines.push(`${report.files} file(s)`);
  if (report.semantic) {
    const skipped = report.semantic.skippedReason === undefined ? '' : ` (${report.semantic.skippedReason})`;
    lines.push(`semantic: ${report.semantic.requests} request(s), ${report.semantic.errors.length} error(s)${skipped}`);
  }
  return `${lines.join('\n')}\n`;
}

export async function runPrescan(argv: string[], io: CliIo, options: CliOptions): Promise<number> {
  let args: PrescanArgs;
  try {
    args = parsePrescanArgs(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`${message === '' ? '' : `${message}\n`}${PRESCAN_USAGE}`);
    return message === '' ? 0 : 2;
  }
  const paths = args.diff !== undefined ? changedFilesSince(args.diff, options.cwd) : expandGlobs(args.files, options.cwd);
  if (paths === null) {
    io.stderr(`--diff ${args.diff ?? ''}: git is unavailable or ${options.cwd} is not inside a repository\n${PRESCAN_USAGE}`);
    return 2;
  }
  const files = readSources(paths.filter((path) => /\.tsx?$/.test(path)), options.cwd);
  if (files.length === 0) {
    io.stderr(`warning: no files matched ${args.diff !== undefined ? `--diff ${args.diff}` : args.files.join(' ')}; nothing was checked\n`);
  }
  const entries = prescanFiles(files, (candidate) => existsSync(resolve(options.cwd, candidate)));
  const report: PrescanReport = { files: entries.length, entries };
  if (args.semantic) {
    report.semantic = await semanticKinds(entries, files, io, options);
    for (const error of report.semantic.errors) {
      io.stderr(`warning: ${error}\n`);
    }
  }
  io.stdout(args.format === 'json' ? `${JSON.stringify(report, null, 2)}\n` : formatPrescanText(report));
  return 0;
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(isAbsolute(entry) ? entry : resolve(entry)).href;
}

if (isMainModule()) {
  const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  const code = await runPrescan(
    process.argv.slice(2),
    { stdout: (text) => process.stdout.write(text), stderr: (text) => process.stderr.write(text) },
    { cwd: process.cwd(), env: process.env, pluginRoot },
  );
  process.exitCode = code;
}
