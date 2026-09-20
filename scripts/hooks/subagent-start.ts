import { gitHead } from '../lib/project-files.ts';
import type { Rule } from '../lib/rulebook.schema.ts';
import { emptySession } from '../lib/session-store.ts';
import { PREFIX, isPluginAgent, loadRulebook, projectDir, sessionStore, skip, type HookHandler } from './lib/hook-common.ts';
import { contextOutput } from './lib/hook-io.ts';
import { runHookMain } from './lib/runner.ts';

export const CONTEXT_TOKEN_BUDGET = 1_500;
const ALL_LAYERS = ['domain', 'application', 'infrastructure', 'presentation'];

/** Rulebook layers an agent works in; agents outside the create-subdomain pipeline get every layer. */
export function layersForAgent(agentType: string): string[] {
  const name = agentType.slice(agentType.indexOf(':') + 1);
  switch (name) {
    case 'domain-agent':
      return ['domain'];
    case 'application-agent':
      return ['application'];
    case 'infrastructure-agent':
    case 'presentation-agent':
    case 'broadcasting-agent':
    case 'listener-agent':
      return ['infrastructure', 'presentation'];
    default:
      return ALL_LAYERS;
  }
}

function estimateTextTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function ruleLine(rule: Rule): string {
  const fix = rule.severity === 'FAIL' ? ` fix: ${rule.fix}` : '';
  return `- ${rule.id} (${rule.class}, ${rule.severity}): ${rule.title}.${fix}`;
}

export function composeSliceContext(rulebookId: string, rulebookVersion: string, agentType: string, rules: Rule[]): { text: string; ruleIds: string[] } {
  const layers = layersForAgent(agentType);
  const selected = rules.filter((rule) => rule.class !== 'runtime' && (rule.layer === 'any' || layers.includes(rule.layer)));
  const ordered = [...selected.filter((rule) => rule.severity === 'FAIL'), ...selected.filter((rule) => rule.severity === 'WARN')];
  const header = [
    `${PREFIX} This project opted in to the rulebook ${rulebookId} ${rulebookVersion}. The rules below apply to the ${layers.join(' and ')} layer(s) this agent writes.`,
    'A static FAIL denies the Write or Edit that introduces it and blocks the Stop of this agent until the listed files are fixed; WARN and semantic rules are advisory.',
  ];
  const footer = 'If the SubagentStop hook blocks the stop, fix the files listed in its reason and finish again.';
  const lines: string[] = [];
  let omitted = 0;
  for (const rule of ordered) {
    const candidate = [...header, ...lines, ruleLine(rule), footer].join('\n');
    if (estimateTextTokens(candidate) > CONTEXT_TOKEN_BUDGET) {
      omitted += 1;
      continue;
    }
    lines.push(ruleLine(rule));
  }
  if (omitted > 0) {
    lines.push(`- (${omitted} more rule(s) omitted for length; run nestjs-hexagonal-check --explain for the full list)`);
  }
  return { text: [...header, ...lines, footer].join('\n'), ruleIds: ordered.slice(0, lines.length - (omitted > 0 ? 1 : 0)).map((rule) => rule.id) };
}

export const handler: HookHandler = async (input, context) => {
  if (!isPluginAgent(input.agent_type)) {
    return skip();
  }
  const loaded = loadRulebook(input, context);
  if (!loaded.ok) {
    return { ...skip(), stderr: `${PREFIX} subagent-start: ${loaded.reason}` };
  }
  const agentType = input.agent_type;
  if (input.agent_id !== undefined) {
    const now = context.now ?? Date.now;
    const project = projectDir(input, context);
    const fresh = emptySession(agentType, new Date(now()).toISOString(), gitHead(project));
    // The event also fires on resume: keep the counters and paths of a running agent.
    sessionStore(context).update(input.session_id, input.agent_id, (current) => (current.agentType === agentType ? { ...current, headSha: current.headSha ?? fresh.headSha } : fresh));
  }
  const { text, ruleIds } = composeSliceContext(loaded.composed.rulebook.id, loaded.composed.rulebook.version, agentType, loaded.composed.rules);
  return { output: contextOutput('SubagentStart', text), decision: 'context', ruleIds };
};

await runHookMain('subagent-start', handler, import.meta.url);
