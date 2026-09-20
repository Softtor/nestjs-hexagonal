import { decide, type Decision, type FittedFile } from './decide.ts';
import { REQUEST_TOKEN_BUDGET, STATE_TOKEN_BUDGET, estimateTokens, toJevQuestion, type JevAnswer, type JevClient, type JevQuestion } from './jev-client.ts';
import type { Rule, Severity } from './rulebook.schema.ts';
import { isInScope } from './scope.ts';
import { buildStateFromConfig, type Hunk, type JevState, type Slice, type StateConfig } from './state-builder.ts';
import type { SourceFile } from './static-engine.ts';

export interface SemanticFinding {
  ruleId: string;
  severity: Severity;
  path: string;
  line?: number;
  evidence: string;
  fix: string;
  class: 'semantic';
  decision: Exclude<Decision, 'pass'>;
  calibrated: boolean;
  value: number;
  confidence?: number;
}

export interface PlannedRequest {
  path: string;
  slice: Slice;
  state: JevState;
  startLine: number;
  truncated: boolean;
  rules: Rule[];
  questions: Record<string, JevQuestion>;
}

export interface SemanticPlan {
  requests: PlannedRequest[];
  applied: Record<string, string[]>;
}

export interface SemanticExplain {
  path: string;
  slice: Slice;
  code: string;
  questions: Record<string, JevQuestion>;
}

export interface SemanticRunOptions {
  client: JevClient;
  fitted: FittedFile | null;
  uncalibrated: boolean;
  hunksByPath?: Record<string, Hunk[]>;
  concurrency?: number;
}

export interface SemanticRunResult {
  findings: SemanticFinding[];
  warnings: string[];
  applied: Record<string, string[]>;
  requests: number;
  cached: number;
  inputTokens: number;
}

function groupConfig(rules: Rule[], slice: Slice): StateConfig {
  const preambles: string[] = [];
  let contextLines = 0;
  let maxTokens = 0;
  for (const rule of rules) {
    const config = rule.state;
    if (!config) {
      continue;
    }
    contextLines = Math.max(contextLines, config.contextLines);
    maxTokens = Math.max(maxTokens, config.maxTokens);
    if (config.preamble !== '' && !preambles.includes(config.preamble)) {
      preambles.push(config.preamble);
    }
  }
  return { slice, contextLines, maxTokens: maxTokens || 4000, preamble: preambles.join('\n') };
}

export function planSemanticRequests(rules: Rule[], files: SourceFile[], hunksByPath: Record<string, Hunk[]> = {}): SemanticPlan {
  const requests: PlannedRequest[] = [];
  const applied: Record<string, string[]> = {};
  const semanticRules = rules.filter((rule) => rule.class === 'semantic' && rule.question !== undefined && rule.state !== undefined);

  for (const file of files) {
    const inScope = semanticRules.filter((rule) => isInScope(rule.scope, file.path));
    if (inScope.length === 0) {
      continue;
    }
    applied[file.path] = inScope.map((rule) => rule.id);
    const bySlice = new Map<Slice, Rule[]>();
    for (const rule of inScope) {
      const slice = rule.state?.slice ?? 'file';
      const group = bySlice.get(slice) ?? [];
      group.push(rule);
      bySlice.set(slice, group);
    }
    for (const [slice, group] of bySlice) {
      const config = groupConfig(group, slice);
      const built = buildStateFromConfig({ config, layer: group[0]?.layer ?? 'any', file, hunks: hunksByPath[file.path] });
      const questions: Record<string, JevQuestion> = {};
      for (const rule of group) {
        if (rule.question) {
          questions[rule.id] = toJevQuestion(rule.question);
        }
      }
      requests.push({ path: file.path, slice, state: built.state, startLine: built.startLine, truncated: built.truncated, rules: group, questions });
    }
  }
  return { requests, applied };
}

export function splitByBudget(request: PlannedRequest): PlannedRequest[] {
  const stateTokens = estimateTokens(request.state);
  const entries = Object.entries(request.questions);
  const batches: PlannedRequest[] = [];
  let current: Array<[string, JevQuestion]> = [];
  let currentTokens = stateTokens;
  for (const entry of entries) {
    const tokens = estimateTokens(entry[1]);
    if (stateTokens + tokens > STATE_TOKEN_BUDGET) {
      continue;
    }
    if (current.length > 0 && currentTokens + tokens > REQUEST_TOKEN_BUDGET) {
      batches.push(withQuestions(request, current));
      current = [];
      currentTokens = stateTokens;
    }
    current.push(entry);
    currentTokens += tokens;
  }
  if (current.length > 0) {
    batches.push(withQuestions(request, current));
  }
  return batches;
}

function withQuestions(request: PlannedRequest, entries: Array<[string, JevQuestion]>): PlannedRequest {
  const ids = new Set(entries.map(([id]) => id));
  return { ...request, questions: Object.fromEntries(entries), rules: request.rules.filter((rule) => ids.has(rule.id)) };
}

export function explainRequests(plan: SemanticPlan): SemanticExplain[] {
  return plan.requests.map((request) => ({ path: request.path, slice: request.slice, code: request.state.code, questions: request.questions }));
}

function evidenceFor(answer: JevAnswer, decision: Decision): string {
  switch (answer.type) {
    case 'noul':
      return `jev noul=${answer.noul.toFixed(2)} decision=${decision}`;
    case 'choice':
      return `jev choice=${answer.choice} confidence=${answer.confidence.toFixed(2)} decision=${decision}`;
    case 'score':
      return `jev score=${answer.score.toFixed(2)} confidence=${answer.confidence.toFixed(2)} decision=${decision}`;
  }
}

async function runPool<T>(items: T[], concurrency: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      if (item !== undefined) {
        await worker(item);
      }
    }
  });
  await Promise.all(lanes);
}

export async function runSemanticRules(rules: Rule[], files: SourceFile[], options: SemanticRunOptions): Promise<SemanticRunResult> {
  const plan = planSemanticRequests(rules, files, options.hunksByPath ?? {});
  const batches = plan.requests.flatMap(splitByBudget);
  const findings: SemanticFinding[] = [];
  const warnings: string[] = [];
  let cached = 0;
  let inputTokens = 0;

  for (const request of plan.requests) {
    if (request.truncated) {
      warnings.push(`${request.path}: state slice '${request.slice}' was truncated to the rule maxTokens; the answer covers the head of the file only`);
    }
  }

  await runPool(batches, options.concurrency ?? 4, async (batch) => {
    const ruleById = new Map(batch.rules.map((rule) => [rule.id, rule]));
    const decisions: Record<string, string> = {};
    const result = await options.client.ask(
      { state: batch.state, questions: batch.questions },
      {
        onResult: (asked) => {
          if (!asked.ok) {
            return undefined;
          }
          for (const [ruleId, answer] of Object.entries(asked.answers)) {
            const rule = ruleById.get(ruleId);
            if (rule) {
              decisions[ruleId] = decide(rule, answer, options.fitted?.rules[ruleId], { uncalibrated: options.uncalibrated || asked.uncalibrated }).decision;
            }
          }
          return decisions;
        },
      },
    );
    if (!result.ok) {
      const status = result.status === undefined ? '' : ` ${result.status}`;
      warnings.push(`${batch.path}: jev ${result.error}${status} (${result.detail}); skipped ${Object.keys(batch.questions).join(', ')}`);
      return;
    }
    if (result.cached) {
      cached += 1;
    }
    inputTokens += result.usage.inputTokens;
    for (const rule of batch.rules) {
      const answer = result.answers[rule.id];
      if (answer === undefined) {
        warnings.push(`${batch.path}: jev returned no answer for ${rule.id}`);
        continue;
      }
      let outcome;
      try {
        outcome = decide(rule, answer, options.fitted?.rules[rule.id], { uncalibrated: options.uncalibrated || result.uncalibrated });
      } catch (error) {
        warnings.push(`${batch.path}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      if (outcome.decision === 'pass') {
        continue;
      }
      const finding: SemanticFinding = {
        ruleId: rule.id,
        severity: rule.severity,
        path: batch.path,
        line: batch.startLine,
        evidence: evidenceFor(answer, outcome.decision),
        fix: rule.fix,
        class: 'semantic',
        decision: outcome.decision,
        calibrated: outcome.calibrated,
        value: outcome.value,
      };
      if (outcome.confidence !== undefined) {
        finding.confidence = outcome.confidence;
      }
      findings.push(finding);
    }
  });

  return { findings, warnings, applied: plan.applied, requests: batches.length, cached, inputTokens };
}
