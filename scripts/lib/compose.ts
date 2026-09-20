import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  ThresholdsSchema,
  formatIssues,
  parseRulebook,
  validateThresholdsForQuestion,
  type Override,
  type Rule,
  type Rulebook,
  type Thresholds,
  type ThresholdsOverride,
} from './rulebook.schema.ts';

export class RulebookCompositionError extends Error {}

export interface ResolvedBase {
  rulebook: Rulebook;
  sha256: string;
  path: string;
}

export type BaseResolver = (id: string) => ResolvedBase | null;

export interface ComposedRulebook {
  rulebook: Rulebook;
  rules: Rule[];
  sources: Record<string, string>;
  warnings: string[];
  uncalibrated: boolean;
}

export function sha256Of(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function collectRules(
  rulebook: Rulebook,
  resolve: BaseResolver,
  visiting: Set<string>,
  collected: Map<string, string>,
  warnings: string[],
): { rules: Rule[]; sources: Record<string, string> } {
  if (visiting.has(rulebook.id)) {
    throw new RulebookCompositionError(`extends cycle detected at rulebook '${rulebook.id}'`);
  }
  visiting.add(rulebook.id);

  const rules: Rule[] = [];
  const sources: Record<string, string> = {};

  for (const entry of rulebook.extends) {
    const base = resolve(entry.id);
    if (!base) {
      throw new RulebookCompositionError(`rulebook '${rulebook.id}' extends unknown base '${entry.id}'`);
    }
    const alreadyCollected = collected.get(entry.id);
    if (alreadyCollected !== undefined) {
      if (alreadyCollected !== entry.sha256) {
        warnings.push(`rulebook-mismatch for '${entry.id}': '${rulebook.id}' stamps ${entry.version}@${entry.sha256.slice(0, 8)} but the base was already composed as @${alreadyCollected.slice(0, 8)}`);
      }
      continue;
    }
    collected.set(entry.id, base.sha256);
    if (base.sha256 !== entry.sha256) {
      warnings.push(
        `rulebook-mismatch for '${entry.id}': expected ${entry.version}@${entry.sha256.slice(0, 8)}, found ${base.rulebook.version}@${base.sha256.slice(0, 8)} (${base.path}); decisions are uncalibrated`,
      );
    }
    const inherited = collectRules(base.rulebook, resolve, visiting, collected, warnings);
    for (const rule of inherited.rules) {
      if (sources[rule.id] !== undefined) {
        throw new RulebookCompositionError(
          `rule id '${rule.id}' is defined by both '${sources[rule.id]}' and '${inherited.sources[rule.id]}'`,
        );
      }
      rules.push(rule);
      sources[rule.id] = inherited.sources[rule.id];
    }
  }

  for (const rule of rulebook.rules) {
    if (sources[rule.id] !== undefined) {
      throw new RulebookCompositionError(
        `rule id '${rule.id}' in '${rulebook.id}' collides with the same id from '${sources[rule.id]}'`,
      );
    }
    rules.push(rule);
    sources[rule.id] = rulebook.id;
  }

  visiting.delete(rulebook.id);
  return { rules, sources };
}

function mergeThresholds(rule: Rule, patch: ThresholdsOverride): Thresholds {
  const current = rule.thresholds;
  const base: Record<string, unknown> = current ? { ...current } : {};
  if (patch.ask !== undefined) base.ask = patch.ask;
  if (patch.advise !== undefined) base.advise = patch.advise;
  if (patch.minConfidence !== undefined) base.minConfidence = patch.minConfidence;
  if (patch.uncertain !== undefined) {
    const currentUncertain = current && 'uncertain' in current ? current.uncertain : { lo: undefined, hi: undefined };
    base.uncertain = {
      lo: patch.uncertain.lo ?? currentUncertain.lo,
      hi: patch.uncertain.hi ?? currentUncertain.hi,
    };
  }
  const mismatch = validateThresholdsForQuestion(rule.question, base);
  if (mismatch) {
    throw new RulebookCompositionError(`override for '${rule.id}': ${mismatch}`);
  }
  const parsed = ThresholdsSchema.safeParse(base);
  if (!parsed.success) {
    throw new RulebookCompositionError(`invalid thresholds after override: ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

function applyOverride(rule: Rule, override: Override): Rule | null {
  if (override.disabled) {
    return null;
  }
  const next: Rule = { ...rule, scope: { ...rule.scope } };
  if (override.severity) {
    next.severity = override.severity;
  }
  if (override.scope) {
    if (override.scope.include) {
      next.scope.include = [...override.scope.include];
    }
    if (override.scope.exclude) {
      next.scope.exclude = [...new Set([...rule.scope.exclude, ...override.scope.exclude])];
    }
  }
  if (override.thresholds) {
    next.thresholds = mergeThresholds(rule, override.thresholds);
  }
  return next;
}

export function composeRulebook(rulebook: Rulebook, resolve: BaseResolver): ComposedRulebook {
  const warnings: string[] = [];
  const collected = collectRules(rulebook, resolve, new Set(), new Map(), warnings);
  const byId = new Map(collected.rules.map((rule) => [rule.id, rule]));

  for (const override of rulebook.overrides) {
    const target = byId.get(override.id);
    if (!target) {
      throw new RulebookCompositionError(`override targets unknown rule id '${override.id}'`);
    }
    const next = applyOverride(target, override);
    if (next === null) {
      byId.delete(override.id);
    } else {
      byId.set(override.id, next);
    }
  }

  const rules = collected.rules.filter((rule) => byId.has(rule.id)).map((rule) => byId.get(rule.id) ?? rule);
  const sources: Record<string, string> = {};
  for (const rule of rules) {
    sources[rule.id] = collected.sources[rule.id];
  }

  return {
    rulebook,
    rules,
    sources,
    warnings,
    uncalibrated: warnings.some((warning) => warning.startsWith('rulebook-mismatch')),
  };
}

export function readRulebookFile(path: string): { rulebook: Rulebook; text: string } {
  const text = readFileSync(path, 'utf8');
  const parsed = parseRulebook(parse(text));
  if (!parsed.ok) {
    throw new RulebookCompositionError(`invalid rulebook at ${path}:\n${parsed.error}`);
  }
  return { rulebook: parsed.rulebook, text };
}

export function rulebookPathForId(rulebooksDir: string, id: string): string {
  return join(rulebooksDir, `${id}.rulebook.yaml`);
}

export function createDirectoryResolver(rulebooksDir: string): BaseResolver {
  return (id) => {
    const path = rulebookPathForId(rulebooksDir, id);
    if (!existsSync(path)) {
      return null;
    }
    const { rulebook, text } = readRulebookFile(path);
    return { rulebook, sha256: sha256Of(text), path };
  };
}

export function loadComposedRulebook(path: string, rulebooksDir: string): ComposedRulebook {
  const { rulebook } = readRulebookFile(path);
  return composeRulebook(rulebook, createDirectoryResolver(rulebooksDir));
}
