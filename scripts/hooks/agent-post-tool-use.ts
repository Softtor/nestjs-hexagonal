import type { AgentSession, SessionStore } from '../lib/session-store.ts';
import { PREFIX, formatStaticFinding, isPluginAgent, sessionStore, skip, uniqueRuleIds, type HookHandler } from './lib/hook-common.ts';
import { agentToolResponse, contextOutput } from './lib/hook-io.ts';
import { runHookMain } from './lib/runner.ts';

/**
 * The Agent tool reports the run as `agentId`; SubagentStart/Stop receive
 * `agent_id`. The docs show both bare and `agent-` prefixed ids, so the
 * lookup tries the exact id and both spellings.
 */
export function findAgentSession(store: SessionStore, sessionId: string, agentId: string): AgentSession | null {
  const candidates = agentId.startsWith('agent-') ? [agentId, agentId.slice('agent-'.length)] : [agentId, `agent-${agentId}`];
  for (const candidate of candidates) {
    const session = store.read(sessionId, candidate);
    if (session !== null) {
      return session;
    }
  }
  return null;
}

export const handler: HookHandler = async (input, context) => {
  const response = agentToolResponse(input);
  if (response === null || response.agentId === undefined || response.status !== 'completed') {
    return skip();
  }
  const session = findAgentSession(sessionStore(context), input.session_id, response.agentId);
  if (session === null || !isPluginAgent(session.agentType)) {
    return skip();
  }
  const fails = session.unresolved.filter((finding) => finding.severity === 'FAIL');
  if (fails.length === 0) {
    return { output: null, decision: 'silent' };
  }
  const text = [
    `${PREFIX} ${session.agentType} finished with ${fails.length} unresolved static FAIL finding(s); they need a fix before this work is complete:`,
    ...fails.map(formatStaticFinding),
  ].join('\n');
  return { output: contextOutput('PostToolUse', text), decision: 'context', ruleIds: uniqueRuleIds(fails) };
};

await runHookMain('agent-post-tool-use', handler, import.meta.url);
