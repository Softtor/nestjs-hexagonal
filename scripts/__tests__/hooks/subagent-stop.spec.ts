import '../helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { emptySession } from '../../lib/session-store.ts';
import { findAgentSession, handler as agentPostToolUse } from '../../hooks/agent-post-tool-use.ts';
import { handler, MAX_BLOCKS, touchedFiles } from '../../hooks/subagent-stop.ts';
import { APPLICATION_AGENT, context, DOMAIN_AGENT, jevFetch, makeProject, NEST_SERVICE, PLAIN_SERVICE, readLog, runHook, writeProjectFile, type Project } from './helpers.ts';

interface BlockJson {
  decision: string;
  reason: string;
}

interface SystemMessageJson {
  systemMessage: string;
}

function isBlockJson(value: unknown): value is BlockJson {
  return typeof value === 'object' && value !== null && 'decision' in value && 'reason' in value;
}

function isSystemMessageJson(value: unknown): value is SystemMessageJson {
  return typeof value === 'object' && value !== null && 'systemMessage' in value;
}

function stopInput(project: Project, agentId = 'agent-1', agentType = DOMAIN_AGENT, stopHookActive = false): Record<string, unknown> {
  return { hook_event_name: 'SubagentStop', session_id: 's', cwd: project.dir, agent_id: agentId, agent_type: agentType, stop_hook_active: stopHookActive, last_assistant_message: 'done' };
}

function startSession(project: Project, agentId: string, agentType: string, headSha: string | null, touched: string[] = []): void {
  project.store.update('s', agentId, () => ({ ...emptySession(agentType, new Date().toISOString(), headSha), touchedPaths: touched }));
}

function headOf(project: Project): string {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: project.dir, encoding: 'utf8' }).trim();
}

const BAD_PATH = 'src/orders/domain/order.service.ts';

describe('subagent-stop hook', () => {
  it('enumerates touched files as the union of the store and git changes since the agent start', () => {
    const project = makeProject({ git: true });
    writeProjectFile(project, 'src/before.ts', 'export const a = 1;\n');
    execFileSync('git', ['add', '.'], { cwd: project.dir });
    execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'before'], { cwd: project.dir });
    const head = headOf(project);
    writeProjectFile(project, 'src/before.ts', 'export const a = 2;\n');
    writeProjectFile(project, 'src/untracked.ts', 'export const b = 1;\n');
    writeProjectFile(project, 'src/from-store.ts', 'export const c = 1;\n');
    const session = { ...emptySession(DOMAIN_AGENT, 'now', head), touchedPaths: ['src/from-store.ts', 'src/deleted.ts'] };
    expect(touchedFiles(session, project.dir)).toEqual(['src/before.ts', 'src/from-store.ts', 'src/untracked.ts']);
    const noGit = makeProject();
    writeProjectFile(noGit, 'src/only-store.ts', 'export const d = 1;\n');
    expect(touchedFiles({ ...emptySession(DOMAIN_AGENT, 'now', null), touchedPaths: ['src/only-store.ts'] }, noGit.dir)).toEqual(['src/only-store.ts']);
  });

  it('is silent for non-plugin agents, without a rulebook, and when the touched files pass', async () => {
    const project = makeProject();
    expect((await runHook('subagent-stop', handler, stopInput(project, 'x', 'Explore'), context(project))).stdout).toBe('');
    const bare = makeProject({ rulebook: false });
    expect((await runHook('subagent-stop', handler, stopInput(bare), context(bare))).stdout).toBe('');
    writeProjectFile(project, BAD_PATH, PLAIN_SERVICE);
    startSession(project, 'agent-1', DOMAIN_AGENT, null, [BAD_PATH]);
    const clean = await runHook('subagent-stop', handler, stopInput(project), context(project));
    expect(clean.stdout).toBe('');
    expect(clean.code).toBe(0);
    expect(project.store.read('s', 'agent-1')?.unresolved).toEqual([]);
  });

  it('blocks twice on a static FAIL, then releases with a systemMessage on the third stop', async () => {
    const project = makeProject({ git: true });
    startSession(project, 'agent-1', DOMAIN_AGENT, headOf(project));
    writeProjectFile(project, BAD_PATH, NEST_SERVICE);

    const first = await runHook('subagent-stop', handler, stopInput(project), context(project));
    if (!isBlockJson(first.json)) {
      throw new Error(`unexpected output ${first.stdout}`);
    }
    expect(first.json.decision).toBe('block');
    expect(first.json.reason).toContain(`${BAD_PATH}:1`);
    expect(first.json.reason).toContain('hex/domain-no-nest-decorators (FAIL)');
    expect(first.json.reason).toContain('fix:');
    expect(project.store.read('s', 'agent-1')?.blocks).toBe(1);
    expect(project.store.read('s', 'agent-1')?.unresolved.map((finding) => finding.ruleId)).toEqual(['hex/domain-no-nest-decorators']);

    const second = await runHook('subagent-stop', handler, stopInput(project, 'agent-1', DOMAIN_AGENT, true), context(project));
    expect(isBlockJson(second.json) && second.json.decision).toBe('block');
    expect(project.store.read('s', 'agent-1')?.blocks).toBe(MAX_BLOCKS);

    const third = await runHook('subagent-stop', handler, stopInput(project, 'agent-1', DOMAIN_AGENT, true), context(project));
    if (!isSystemMessageJson(third.json)) {
      throw new Error(`unexpected output ${third.stdout}`);
    }
    expect(third.json.systemMessage).toBe(`nestjs-hexagonal: 2 blocks reached, releasing ${DOMAIN_AGENT} with unresolved FAILs: hex/domain-no-nest-decorators ${BAD_PATH}:1`);
    expect(third.stdout).not.toContain('"decision"');
    expect(project.store.read('s', 'agent-1')?.blocks).toBe(MAX_BLOCKS);
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['block', 'block', 'release']);
  });

  it('lists only files the agent touched, even when another file in the project also fails', async () => {
    const project = makeProject();
    writeProjectFile(project, 'src/other/domain/other.service.ts', NEST_SERVICE);
    writeProjectFile(project, BAD_PATH, NEST_SERVICE);
    startSession(project, 'agent-1', DOMAIN_AGENT, null, [BAD_PATH]);
    const run = await runHook('subagent-stop', handler, stopInput(project), context(project));
    if (!isBlockJson(run.json)) {
      throw new Error(`unexpected output ${run.stdout}`);
    }
    expect(run.json.reason).toContain(BAD_PATH);
    expect(run.json.reason).not.toContain('other.service.ts');
  });

  it('appends semantic advisory lines to the reason when a key is present, never blocking on them', async () => {
    const project = makeProject();
    const handlerPath = 'src/orders/application/create-order.handler.ts';
    writeProjectFile(project, handlerPath, 'export class CreateOrderHandler {\n  async execute(): Promise<void> {\n    await Promise.resolve();\n  }\n}\n');
    startSession(project, 'agent-2', APPLICATION_AGENT, null, [handlerPath]);
    const advise = jevFetch(0.9);
    const clean = await runHook('subagent-stop', handler, stopInput(project, 'agent-2', APPLICATION_AGENT), context(project, { TYPESAFE_API_KEY: 'sk-env' }, advise.fetchImpl));
    expect(clean.stdout).toBe('');
    expect(advise.calls).toEqual([]);

    writeProjectFile(project, BAD_PATH, NEST_SERVICE);
    startSession(project, 'agent-2', APPLICATION_AGENT, null, [handlerPath, BAD_PATH]);
    const blocking = await runHook('subagent-stop', handler, stopInput(project, 'agent-2', APPLICATION_AGENT), context(project, { TYPESAFE_API_KEY: 'sk-env' }, advise.fetchImpl));
    if (!isBlockJson(blocking.json)) {
      throw new Error(`unexpected output ${blocking.stdout}`);
    }
    expect(advise.calls.length).toBeGreaterThan(0);
    expect(blocking.json.reason).toContain('advisory (semantic, not blocking)');
    expect(blocking.json.reason).toContain('semantic ask hex/handler-no-business-rules');
    expect(blocking.json.reason).not.toContain('sk-env');
    expect(readLog(project).at(-1)?.semantic).toMatchObject({ findings: 1 });
  });
});

describe('agent-post-tool-use hook', () => {
  function agentInput(project: Project, response: Record<string, unknown>): Record<string, unknown> {
    return { hook_event_name: 'PostToolUse', session_id: 's', cwd: project.dir, tool_name: 'Agent', tool_input: { prompt: 'p', description: 'd', subagent_type: DOMAIN_AGENT }, tool_response: response };
  }

  it('looks the session up by the bare id and by the agent- prefixed spelling', () => {
    const project = makeProject();
    startSession(project, 'agent-1', DOMAIN_AGENT, null);
    startSession(project, '2', DOMAIN_AGENT, null);
    expect(findAgentSession(project.store, 's', '1')?.agentType).toBe(DOMAIN_AGENT);
    expect(findAgentSession(project.store, 's', 'agent-1')?.agentType).toBe(DOMAIN_AGENT);
    expect(findAgentSession(project.store, 's', 'agent-2')?.agentType).toBe(DOMAIN_AGENT);
    expect(findAgentSession(project.store, 's', '3')).toBeNull();
  });

  it('returns the unresolved FAIL list of a completed plugin agent and nothing otherwise', async () => {
    const project = makeProject();
    writeProjectFile(project, BAD_PATH, NEST_SERVICE);
    startSession(project, 'agent-1', DOMAIN_AGENT, null, [BAD_PATH]);
    project.store.update('s', 'agent-1', (session) => ({ ...session, blocks: MAX_BLOCKS }));
    await runHook('subagent-stop', handler, stopInput(project), context(project));

    const completed = await runHook('agent-post-tool-use', agentPostToolUse, agentInput(project, { status: 'completed', agentId: 'agent-1', content: [{ type: 'text', text: 'done' }] }), context(project));
    expect(completed.stdout).toContain('"hookEventName":"PostToolUse"');
    expect(completed.stdout).toContain('1 unresolved static FAIL finding(s)');
    expect(completed.stdout).toContain('hex/domain-no-nest-decorators (FAIL)');

    const launched = await runHook('agent-post-tool-use', agentPostToolUse, agentInput(project, { status: 'async_launched', agentId: 'agent-1' }), context(project));
    expect(launched.stdout).toBe('');
    const unknown = await runHook('agent-post-tool-use', agentPostToolUse, agentInput(project, { status: 'completed', agentId: 'nobody' }), context(project));
    expect(unknown.stdout).toBe('');

    startSession(project, 'explore-1', 'Explore', null);
    project.store.update('s', 'explore-1', (session) => ({ ...session, unresolved: [{ path: BAD_PATH, ruleId: 'hex/x', severity: 'FAIL', evidence: 'e', fix: 'f' }] }));
    const foreign = await runHook('agent-post-tool-use', agentPostToolUse, agentInput(project, { status: 'completed', agentId: 'explore-1' }), context(project));
    expect(foreign.stdout).toBe('');

    project.store.update('s', 'agent-1', (session) => ({ ...session, unresolved: [] }));
    const resolved = await runHook('agent-post-tool-use', agentPostToolUse, agentInput(project, { status: 'completed', agentId: 'agent-1' }), context(project));
    expect(resolved.stdout).toBe('');
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['release', 'context', 'skip', 'skip', 'skip', 'silent']);
  });
});
