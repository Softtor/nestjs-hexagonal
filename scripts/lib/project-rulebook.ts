import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { composeRulebook, createDirectoryResolver, readRulebookFile, rulebookPathForId, type ComposedRulebook } from './compose.ts';
import { registerBuiltinExecutors } from './executors/index.ts';

export class RulebookNotFoundError extends Error {}

export interface RulebookLookup {
  cwd: string;
  env: Record<string, string | undefined>;
  pluginRoot: string;
  rulebook?: string;
  projectRulebook?: string;
}

export function projectDirOf(env: Record<string, string | undefined>, cwd: string): string {
  const fromEnv = env.CLAUDE_PROJECT_DIR;
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : cwd;
}

/**
 * Resolves the rulebook a run should start from: an explicit `--rulebook`
 * (path or plugin id), an explicit project rulebook, `NESTJS_HEXAGONAL_RULEBOOK`
 * or `$CLAUDE_PROJECT_DIR/.claude/rulebook.yaml`. The CLI and the hooks share
 * this so both read the same file for the same project.
 */
export function resolveRootRulebook(lookup: RulebookLookup): string {
  const rulebooksDir = join(lookup.pluginRoot, 'rulebooks');
  if (lookup.rulebook !== undefined) {
    const asPath = resolve(lookup.cwd, lookup.rulebook);
    if (/\.ya?ml$/.test(lookup.rulebook) || existsSync(asPath)) {
      return asPath;
    }
    const byId = rulebookPathForId(rulebooksDir, lookup.rulebook);
    if (existsSync(byId)) {
      return byId;
    }
    throw new RulebookNotFoundError(`rulebook '${lookup.rulebook}' is neither a file nor an id under ${rulebooksDir}`);
  }
  if (lookup.projectRulebook !== undefined) {
    const path = resolve(lookup.cwd, lookup.projectRulebook);
    if (!existsSync(path)) {
      throw new RulebookNotFoundError(`--project-rulebook ${lookup.projectRulebook} does not exist (${path})`);
    }
    return path;
  }

  const candidates: string[] = [];
  const fromEnv = lookup.env.NESTJS_HEXAGONAL_RULEBOOK;
  if (fromEnv !== undefined && fromEnv !== '') {
    candidates.push(resolve(lookup.cwd, fromEnv));
  }
  const projectDir = projectDirOf(lookup.env, lookup.cwd);
  candidates.push(join(projectDir, '.claude', 'rulebook.yaml'));
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  throw new RulebookNotFoundError(
    `no rulebook found: pass --rulebook <path|id>, --project-rulebook <path>, set NESTJS_HEXAGONAL_RULEBOOK or create ${join(projectDir, '.claude', 'rulebook.yaml')}`,
  );
}

export interface LoadedRulebook {
  path: string;
  composed: ComposedRulebook;
}

export function loadProjectRulebook(lookup: RulebookLookup): LoadedRulebook {
  const path = resolveRootRulebook(lookup);
  const { rulebook } = readRulebookFile(path);
  registerBuiltinExecutors();
  const composed = composeRulebook(rulebook, createDirectoryResolver(join(lookup.pluginRoot, 'rulebooks')));
  return { path, composed };
}
