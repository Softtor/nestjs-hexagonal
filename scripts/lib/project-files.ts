import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { normalizePath } from './scope.ts';
import type { SourceFile } from './static-engine.ts';

const PROJECT_TREE_IGNORED = new Set(['node_modules', '.git', 'dist']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

export function gitTopLevel(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return out === '' ? null : out;
  } catch {
    return null;
  }
}

export function gitHead(cwd: string): string | null {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[0-9a-f]{40}$/.test(out) ? out : null;
  } catch {
    return null;
  }
}

function walkTree(dir: string, base: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (PROJECT_TREE_IGNORED.has(entry.name)) {
      continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTree(full, base, out);
    } else if (entry.isFile() && SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      out.push(normalizePath(relative(base, full)));
    }
  }
}

export function readSources(paths: string[], base: string): SourceFile[] {
  return paths.map((path) => ({ path, content: readFileSync(resolve(base, path), 'utf8') }));
}

/** Every TypeScript source of the project tree, with paths relative to `base`. */
export function projectSources(base: string): SourceFile[] {
  const root = gitTopLevel(base) ?? base;
  const paths: string[] = [];
  walkTree(root, base, paths);
  return readSources(paths, base);
}

function existingFiles(lines: string, base: string): string[] {
  return lines
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => existsSync(resolve(base, line)) && statSync(resolve(base, line)).isFile())
    .map((line) => normalizePath(line));
}

/**
 * Files changed since `ref` plus untracked files, relative to `base`.
 * Returns null when git is unavailable or `base` is not inside a repository.
 */
export function changedFilesSince(ref: string, base: string): string[] | null {
  try {
    const diff = execFileSync('git', ['diff', '--name-only', '--relative', '--diff-filter=ACMR', ref], { cwd: base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const untracked = execFileSync('git', ['ls-files', '--others', '--exclude-standard'], { cwd: base, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return [...new Set(existingFiles(`${diff}\n${untracked}`, base))].sort();
  } catch {
    return null;
  }
}
