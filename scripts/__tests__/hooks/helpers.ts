import '../helpers/no-network.ts';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { sha256Of } from '../../lib/compose.ts';
import type { FetchLike } from '../../lib/jev-client.ts';
import { createSessionStore, type SessionStore } from '../../lib/session-store.ts';
import type { HookContext, HookHandler } from '../../hooks/lib/hook-common.ts';
import { executeHook } from '../../hooks/lib/runner.ts';

export const PLUGIN_ROOT = resolve(import.meta.dir, '../../..');

export interface Project {
  dir: string;
  dataDir: string;
  store: SessionStore;
}

export function makeProject(options: { rulebook?: boolean; git?: boolean } = {}): Project {
  const dir = mkdtempSync(join(tmpdir(), 'hex-hook-'));
  if (options.rulebook !== false) {
    const base = readFileSync(join(PLUGIN_ROOT, 'rulebooks', 'hexagonal.rulebook.yaml'), 'utf8');
    mkdirSync(join(dir, '.claude'));
    writeFileSync(
      join(dir, '.claude', 'rulebook.yaml'),
      `$schema: nestjs-hexagonal/rulebook@1\nid: p\nversion: 0.1.0\nextends:\n  - { id: hexagonal, version: 1.3.0, sha256: ${sha256Of(base)} }\nmodel: { provider: typesafe, pin: jev-1.13.0 }\n`,
    );
  }
  if (options.git) {
    execFileSync('git', ['init', '-q'], { cwd: dir });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init'], { cwd: dir });
  }
  const dataDir = mkdtempSync(join(tmpdir(), 'hex-hook-data-'));
  return { dir, dataDir, store: createSessionStore({ dataDir, random: () => 1 }) };
}

export function writeProjectFile(project: Project, relativePath: string, content: string): string {
  const absolute = join(project.dir, relativePath);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
  return absolute;
}

export function context(project: Project, env: Record<string, string | undefined> = {}, fetchImpl?: FetchLike): HookContext {
  return {
    env: { CLAUDE_PROJECT_DIR: project.dir, CLAUDE_PLUGIN_DATA: project.dataDir, ...env },
    cwd: project.dir,
    pluginRoot: PLUGIN_ROOT,
    store: project.store,
    ...(fetchImpl ? { fetchImpl } : {}),
  };
}

export interface HookRun {
  code: number;
  stdout: string;
  stderr: string;
  json: unknown;
}

export async function runHook(name: string, handler: HookHandler, input: Record<string, unknown>, ctx: HookContext): Promise<HookRun> {
  const out: string[] = [];
  const err: string[] = [];
  const code = await executeHook(name, handler, JSON.stringify(input), ctx, { stdout: (text) => void out.push(text), stderr: (text) => void err.push(text) });
  const stdout = out.join('');
  return { code, stdout, stderr: err.join(''), json: stdout === '' ? null : JSON.parse(stdout) };
}

export function readLog(project: Project): Array<Record<string, unknown>> {
  const dir = join(project.dataDir, 'logs');
  const lines: Array<Record<string, unknown>> = [];
  if (!existsSync(dir)) {
    return lines;
  }
  for (const name of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, name), 'utf8').split('\n')) {
      if (line.trim() !== '') {
        const parsed: unknown = JSON.parse(line);
        if (typeof parsed === 'object' && parsed !== null) {
          lines.push(Object.fromEntries(Object.entries(parsed)));
        }
      }
    }
  }
  return lines;
}

export const DOMAIN_AGENT = 'nestjs-hexagonal:domain-agent';
export const APPLICATION_AGENT = 'nestjs-hexagonal:application-agent';

export const NEST_SERVICE = "import { Injectable } from '@nestjs/common';\n\n@Injectable()\nexport class OrderService {\n  run(): void {}\n}\n";
export const PLAIN_SERVICE = 'export class OrderService {\n  run(): void {}\n}\n';

export function jevFetch(noul: number, model = 'jev-1.13.0'): { fetchImpl: FetchLike; calls: number[] } {
  const calls: number[] = [];
  const fetchImpl: FetchLike = async (_url, init) => {
    calls.push(1);
    const body = typeof init.body === 'string' ? init.body : '';
    const request: unknown = JSON.parse(body);
    const questionIds =
      typeof request === 'object' && request !== null && 'questions' in request && typeof request.questions === 'object' && request.questions !== null
        ? Object.keys(request.questions)
        : [];
    const answers = Object.fromEntries(questionIds.map((id) => [id, { type: 'noul', noul }]));
    return new Response(JSON.stringify({ model, answers, usage: { input_tokens: 10, output_tokens: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  return { fetchImpl, calls };
}
