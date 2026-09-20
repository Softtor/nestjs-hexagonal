import '../helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { loadComposedRulebook } from '../../lib/compose.ts';
import { join } from 'node:path';
import { composeSliceContext, CONTEXT_TOKEN_BUDGET, handler, layersForAgent } from '../../hooks/subagent-start.ts';
import { context, DOMAIN_AGENT, makeProject, PLUGIN_ROOT, readLog, runHook } from './helpers.ts';

interface ContextJson {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

function isContextJson(value: unknown): value is ContextJson {
  return typeof value === 'object' && value !== null && 'hookSpecificOutput' in value;
}

const composed = loadComposedRulebook(join(PLUGIN_ROOT, 'rulebooks', 'project.example.rulebook.yaml'), join(PLUGIN_ROOT, 'rulebooks'));

describe('subagent-start hook', () => {
  it('maps agents to the layers they write', () => {
    expect(layersForAgent('nestjs-hexagonal:domain-agent')).toEqual(['domain']);
    expect(layersForAgent('nestjs-hexagonal:application-agent')).toEqual(['application']);
    expect(layersForAgent('nestjs-hexagonal:listener-agent')).toEqual(['infrastructure', 'presentation']);
    expect(layersForAgent('nestjs-hexagonal:architecture-reviewer')).toEqual(['domain', 'application', 'infrastructure', 'presentation']);
  });

  it('composes the slice with ids, titles, severity and the fix of FAIL rules under the token budget', () => {
    const slice = composeSliceContext('p', '0.1.0', DOMAIN_AGENT, composed.rules);
    expect(slice.ruleIds).toContain('hex/domain-no-nest-decorators');
    expect(slice.ruleIds).toContain('softtor/no-emoji');
    expect(slice.ruleIds).not.toContain('hex/controller-thin');
    expect(slice.ruleIds).not.toContain('hex/tests-coverage');
    expect(slice.text).toContain('hex/domain-no-nest-decorators (static, FAIL)');
    expect(slice.text).toContain('fix: Remove the import and the decorator');
    expect(slice.text).toContain('If the SubagentStop hook blocks the stop');
    expect(Math.ceil(slice.text.length / 4)).toBeLessThanOrEqual(CONTEXT_TOKEN_BUDGET);
    const warnLine = slice.text.split('\n').find((line) => line.includes('hex/entity-not-anemic'));
    expect(warnLine).toBeDefined();
    expect(warnLine).not.toContain('fix:');
  });

  it('truncates the list instead of exceeding the budget', () => {
    const many = Array.from({ length: 80 }, (_, index) => ({ ...composed.rules[0], id: `hex/rule-${index}`, title: 'A long title '.repeat(10), fix: 'A long fix '.repeat(20) }));
    const slice = composeSliceContext('p', '0.1.0', DOMAIN_AGENT, many);
    expect(Math.ceil(slice.text.length / 4)).toBeLessThanOrEqual(CONTEXT_TOKEN_BUDGET);
    expect(slice.text).toContain('more rule(s) omitted');
    expect(slice.ruleIds.length).toBeLessThan(80);
    expect(slice.ruleIds.every((id) => slice.text.includes(`- ${id} (`))).toBe(true);
    expect(slice.ruleIds).toEqual(many.filter((entry) => slice.text.includes(`- ${entry.id} (`)).map((entry) => entry.id));
  });

  it('stays silent for agents outside the plugin and for projects without a rulebook', async () => {
    const project = makeProject();
    const other = await runHook('subagent-start', handler, { hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a', agent_type: 'Explore', cwd: project.dir }, context(project));
    expect(other.stdout).toBe('');
    const bare = makeProject({ rulebook: false });
    const noRulebook = await runHook('subagent-start', handler, { hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a', agent_type: DOMAIN_AGENT, cwd: bare.dir }, context(bare));
    expect(noRulebook.stdout).toBe('');
    expect(noRulebook.code).toBe(0);
  });

  it('injects the slice as additionalContext, records the session start and logs the decision', async () => {
    const project = makeProject({ git: true });
    const run = await runHook('subagent-start', handler, { hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'agent-1', agent_type: DOMAIN_AGENT, cwd: project.dir }, context(project));
    expect(run.code).toBe(0);
    if (!isContextJson(run.json)) {
      throw new Error(`unexpected output ${run.stdout}`);
    }
    expect(run.json.hookSpecificOutput.hookEventName).toBe('SubagentStart');
    expect(run.json.hookSpecificOutput.additionalContext).toContain('hex/domain-no-nest-decorators');
    const session = project.store.read('s', 'agent-1');
    expect(session?.agentType).toBe(DOMAIN_AGENT);
    expect(session?.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(session?.blocks).toBe(0);
    const [entry] = readLog(project);
    expect(entry).toMatchObject({ hook: 'subagent-start', event: 'SubagentStart', agentType: DOMAIN_AGENT, decision: 'context' });
  });

  it('keeps the touched paths but resets the block counter when the event fires again on resume', async () => {
    const project = makeProject();
    const input = { hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'agent-1', agent_type: DOMAIN_AGENT, cwd: project.dir };
    await runHook('subagent-start', handler, input, context(project));
    project.store.update('s', 'agent-1', (session) => ({ ...session, blocks: 2, touchedPaths: ['src/a.ts'] }));
    await runHook('subagent-start', handler, input, context(project));
    expect(project.store.read('s', 'agent-1')).toMatchObject({ blocks: 0, touchedPaths: ['src/a.ts'] });
    await runHook('subagent-start', handler, { ...input, agent_type: 'nestjs-hexagonal:application-agent' }, context(project));
    expect(project.store.read('s', 'agent-1')).toMatchObject({ blocks: 0, touchedPaths: [], agentType: 'nestjs-hexagonal:application-agent' });
  });
});
