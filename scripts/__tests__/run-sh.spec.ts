import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, symlinkSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const RUN_SH = join(PLUGIN_ROOT, 'scripts', 'run.sh');

interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runSh(script: string, args: string[], env: Record<string, string | undefined>, stdin = ''): RunResult {
  const cleanEnv: Record<string, string> = { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '' };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      cleanEnv[key] = value;
    }
  }
  const result = spawnSync('sh', [script, ...args], { env: cleanEnv, input: stdin, encoding: 'utf8', cwd: PLUGIN_ROOT });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function makeProject(withRulebook: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), 'hex-run-'));
  if (withRulebook) {
    mkdirSync(join(dir, '.claude'));
    writeFileSync(join(dir, '.claude', 'rulebook.yaml'), '$schema: nestjs-hexagonal/rulebook@1\nid: p\nversion: 0.1.0\nmodel: { provider: typesafe, pin: jev-1.13.0 }\n');
  }
  return dir;
}

function hookInput(filePath: string): string {
  return JSON.stringify({ tool_name: 'Write', tool_input: { file_path: filePath, content: 'x' } });
}

describe('run.sh hook gate', () => {
  it('exits 0 with empty output when the project has no rulebook', () => {
    const dir = makeProject(false);
    const result = runSh(RUN_SH, ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir }, hookInput(join(dir, 'a.ts')));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('exits 0 with empty output when NESTJS_HEXAGONAL_RULEBOOK points to a missing file', () => {
    const dir = makeProject(false);
    const result = runSh(RUN_SH, ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir, NESTJS_HEXAGONAL_RULEBOOK: join(dir, 'nope.yaml') }, hookInput(join(dir, 'a.ts')));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
  });

  it('exits 0 with empty output when NESTJS_HEXAGONAL_DISABLE=1', () => {
    const dir = makeProject(true);
    const result = runSh(RUN_SH, ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir, NESTJS_HEXAGONAL_DISABLE: '1' }, hookInput(join(dir, 'a.ts')));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');
  });

  it('exits 0 with empty output when file_path resolves outside the project', () => {
    const dir = makeProject(true);
    const outside = mkdtempSync(join(tmpdir(), 'hex-outside-'));
    const result = runSh(RUN_SH, ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir }, hookInput(join(outside, 'a.ts')));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('');

    const traversal = runSh(RUN_SH, ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir }, hookInput(join(dir, 'src', '..', '..', 'escape.ts')));
    expect(traversal.status).toBe(0);
    expect(traversal.stdout).toBe('');
  });

  it('reaches check.ts for a file inside the project, even when it does not exist yet', () => {
    const dir = makeProject(true);
    const result = runSh(RUN_SH, ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir }, hookInput(join(dir, 'src', 'new', 'file.ts')));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('not implemented in this version');
  });

  it('prefers the project node_modules binary when it is not itself', () => {
    const dir = makeProject(true);
    const binDir = join(dir, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    const fakeBin = join(binDir, 'nestjs-hexagonal-check');
    writeFileSync(fakeBin, '#!/bin/sh\necho FROM_PROJECT_BIN "$@"\n');
    chmodSync(fakeBin, 0o755);
    const result = runSh(RUN_SH, ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir }, hookInput(join(dir, 'a.ts')));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('FROM_PROJECT_BIN --hook pre-tool-use');
  });

  it('does not recurse when the project binary is a link to itself', () => {
    const dir = makeProject(true);
    const binDir = join(dir, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    symlinkSync(RUN_SH, join(binDir, 'nestjs-hexagonal-check'));
    const result = runSh(RUN_SH, ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir }, hookInput(join(dir, 'a.ts')));
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('not implemented in this version');
  });

  it('does not recurse when the project binary is a relative link to an installed copy of itself', () => {
    const dir = makeProject(true);
    const pkgDir = join(dir, 'node_modules', 'nestjs-hexagonal');
    mkdirSync(join(pkgDir, 'scripts'), { recursive: true });
    cpSync(RUN_SH, join(pkgDir, 'scripts', 'run.sh'));
    const binDir = join(dir, 'node_modules', '.bin');
    mkdirSync(binDir, { recursive: true });
    symlinkSync('../nestjs-hexagonal/scripts/run.sh', join(binDir, 'nestjs-hexagonal-check'));
    const result = runSh(join(binDir, 'nestjs-hexagonal-check'), ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir }, hookInput(join(dir, 'a.ts')));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('bun install');
    expect(result.stderr).toContain(pkgDir);
  });
});

describe('run.sh without dependencies', () => {
  function copyPluginWithoutNodeModules(): string {
    const dir = mkdtempSync(join(tmpdir(), 'hex-copy-'));
    for (const entry of ['scripts', 'rulebooks', 'package.json']) {
      cpSync(join(PLUGIN_ROOT, entry), join(dir, entry), { recursive: true });
    }
    return dir;
  }

  it('fails open in hook mode with an actionable message', () => {
    const copy = copyPluginWithoutNodeModules();
    const dir = makeProject(true);
    const result = runSh(join(copy, 'scripts', 'run.sh'), ['--hook', 'pre-tool-use'], { CLAUDE_PROJECT_DIR: dir }, hookInput(join(dir, 'a.ts')));
    expect(result.status).toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`bun install`);
    expect(result.stderr).toContain(copy);
  });

  it('fails with exit 1 and the same message in CLI mode', () => {
    const copy = copyPluginWithoutNodeModules();
    const result = runSh(join(copy, 'scripts', 'run.sh'), ['--rulebook', 'hexagonal', '--files', 'x'], {});
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bun install');
  });
});

describe('run.sh CLI mode', () => {
  it('bypasses the opt-in gate and forwards arguments to check.ts', () => {
    const dir = makeProject(false);
    const result = runSh(RUN_SH, ['--rulebook', 'hexagonal', '--files', 'calibration/golden/hex/no-circular-import/bad/**', '--format', 'json'], { CLAUDE_PROJECT_DIR: dir });
    expect(result.status).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(typeof parsed === 'object' && parsed !== null && 'findings' in parsed).toBe(true);
  });

  it('falls back to node when bun is not on PATH', () => {
    const shimDir = mkdtempSync(join(tmpdir(), 'hex-path-'));
    const nodeBin = process.execPath.endsWith('bun') ? '' : process.execPath;
    const nodePath = spawnSync('sh', ['-c', 'command -v node'], { encoding: 'utf8' }).stdout.trim();
    symlinkSync(nodeBin || nodePath, join(shimDir, 'node'));
    for (const tool of ['sh', 'dirname', 'basename', 'readlink', 'sed', 'head', 'cat', 'printf']) {
      const found = spawnSync('sh', ['-c', `command -v ${tool}`], { encoding: 'utf8' }).stdout.trim();
      if (found) {
        try {
          symlinkSync(found, join(shimDir, tool));
        } catch {
          void 0;
        }
      }
    }
    const result = spawnSync('sh', [RUN_SH, '--rulebook', 'hexagonal', '--files', 'calibration/golden/hex/no-circular-import/bad/**', '--format', 'json'], {
      env: { PATH: shimDir, HOME: process.env.HOME ?? '' },
      encoding: 'utf8',
      cwd: PLUGIN_ROOT,
    });
    expect(result.stderr).not.toContain('bun');
    expect(result.status).toBe(0);
    const parsed: unknown = JSON.parse(result.stdout);
    expect(typeof parsed === 'object' && parsed !== null && 'findings' in parsed).toBe(true);
  });
});
