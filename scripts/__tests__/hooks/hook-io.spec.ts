import '../helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { BODY_LEAK_MIN_LENGTH, contextOutput, denyOutput, fileToolInput, findLeak, forbiddenOutput, parseHookInput, secretsFromEnv } from '../../hooks/lib/hook-io.ts';
import { handler as preToolUse } from '../../hooks/pre-tool-use.ts';
import { handler as subagentStart } from '../../hooks/subagent-start.ts';
import { context, DOMAIN_AGENT, makeProject, NEST_SERVICE, readLog, runHook } from './helpers.ts';
import { join } from 'node:path';

const SECRET = 'sk-typesafe-0123456789abcdef';

describe('hook input parsing', () => {
  it('accepts the documented fields and keeps unknown ones', () => {
    const parsed = parseHookInput(JSON.stringify({ hook_event_name: 'PreToolUse', session_id: 's', cwd: '/p', tool_name: 'Write', tool_input: { file_path: '/p/a.ts', content: 'x' }, tool_use_id: 't', agent_id: 'a', agent_type: 'Explore', stop_hook_active: false, last_assistant_message: 'done', permission_mode: 'default', effort: { level: 'high' } }));
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    expect(parsed.input.tool_name).toBe('Write');
    expect(parsed.input.stop_hook_active).toBe(false);
    expect(parsed.input.permission_mode).toBe('default');
    const tool = fileToolInput(parsed.input);
    expect(tool?.tool).toBe('Write');
  });

  it('rejects empty, non-JSON and contract-violating stdin', () => {
    expect(parseHookInput('').ok).toBe(false);
    expect(parseHookInput('not json').ok).toBe(false);
    expect(parseHookInput('{"session_id":"s"}').ok).toBe(false);
    expect(parseHookInput('{"hook_event_name":"X","stop_hook_active":"yes"}').ok).toBe(false);
  });

  it('parses Edit input with replace_all defaulting to false and ignores other tools', () => {
    const edit = parseHookInput(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/a.ts', old_string: 'a', new_string: 'b' } }));
    const tool = edit.ok ? fileToolInput(edit.input) : null;
    expect(tool?.tool === 'Edit' && tool.input.replace_all).toBe(false);
    const bash = parseHookInput(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } }));
    expect(bash.ok ? fileToolInput(bash.input) : 'x').toBeNull();
    const malformed = parseHookInput(JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Write', tool_input: { content: 'x' } }));
    expect(malformed.ok ? fileToolInput(malformed.input) : 'x').toBeNull();
  });
});

describe('output shapes', () => {
  it('builds the documented JSON per event', () => {
    expect(denyOutput('r')).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'r' } });
    expect(contextOutput('PostToolUse', 'c')).toEqual({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: 'c' } });
  });
});

describe('leak guard', () => {
  it('collects the key from both environment variables and skips empty values', () => {
    expect(secretsFromEnv({ TYPESAFE_API_KEY: 'a', CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: 'b' })).toEqual(['b', 'a']);
    expect(secretsFromEnv({ TYPESAFE_API_KEY: '' })).toEqual([]);
  });

  it('flags a secret anywhere in the text and a raw body only above the evidence cap', () => {
    const forbidden = forbiddenOutput({ TYPESAFE_API_KEY: SECRET }, ['short body', 'x'.repeat(BODY_LEAK_MIN_LENGTH)]);
    expect(forbidden.bodies).toHaveLength(1);
    expect(findLeak(`reason ${SECRET}`, forbidden)).toBe('secret');
    expect(findLeak(`evidence: short body`, forbidden)).toBeNull();
    expect(findLeak(`code: ${'x'.repeat(BODY_LEAK_MIN_LENGTH)}`, forbidden)).toBe('body');
    expect(findLeak('clean', forbidden)).toBeNull();
  });

  it('never lets the key placed in the environment reach stdout, stderr or the JSONL log', async () => {
    const project = makeProject();
    const ctx = context(project, { TYPESAFE_API_KEY: SECRET, CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: `${SECRET}-option` });
    const start = await runHook('subagent-start', subagentStart, { hook_event_name: 'SubagentStart', session_id: 's', agent_id: 'a', agent_type: DOMAIN_AGENT, cwd: project.dir }, ctx);
    const deny = await runHook(
      'pre-tool-use',
      preToolUse,
      { hook_event_name: 'PreToolUse', session_id: 's', agent_id: 'a', agent_type: DOMAIN_AGENT, cwd: project.dir, tool_name: 'Write', tool_input: { file_path: join(project.dir, 'src/orders/domain/order.service.ts'), content: NEST_SERVICE } },
      ctx,
    );
    const everything = [start.stdout, start.stderr, deny.stdout, deny.stderr, JSON.stringify(readLog(project))].join('\n');
    expect(everything).not.toContain(SECRET);
    expect(deny.stdout).toContain('"permissionDecision":"deny"');
  });

  it('suppresses an output that would carry the secret and logs the suppression', async () => {
    const project = makeProject();
    const ctx = context(project, { TYPESAFE_API_KEY: SECRET });
    const leaking = await runHook('leaky', async () => ({ output: contextOutput('PostToolUse', `key is ${SECRET}`), decision: 'context' }), { hook_event_name: 'PostToolUse', session_id: 's' }, ctx);
    expect(leaking.code).toBe(0);
    expect(leaking.stdout).toBe('');
    expect(leaking.stderr).toContain('output suppressed');
    expect(leaking.stderr).not.toContain(SECRET);
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['error']);
  });

  it('suppresses an output that would echo a raw file body', async () => {
    const project = makeProject();
    const body = 'export const x = 1;\n'.repeat(20);
    const leaking = await runHook('leaky', async () => ({ output: contextOutput('PostToolUse', body), decision: 'context', bodies: [body] }), { hook_event_name: 'PostToolUse', session_id: 's' }, context(project));
    expect(leaking.stdout).toBe('');
    expect(leaking.stderr).toContain('raw file body');
  });

  it('fails open when the handler throws and when stdin is unusable', async () => {
    const project = makeProject();
    const thrown = await runHook('broken', async () => {
      throw new Error('boom');
    }, { hook_event_name: 'PostToolUse', session_id: 's' }, context(project));
    expect(thrown.code).toBe(0);
    expect(thrown.stdout).toBe('');
    expect(thrown.stderr).toContain('boom');
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['error']);

    const out: string[] = [];
    const { executeHook } = await import('../../hooks/lib/runner.ts');
    const code = await executeHook('broken', async () => ({ output: null, decision: 'skip' }), 'garbage', context(project), { stdout: (text) => void out.push(text), stderr: () => void 0 });
    expect(code).toBe(0);
    expect(out).toEqual([]);
  });
});
