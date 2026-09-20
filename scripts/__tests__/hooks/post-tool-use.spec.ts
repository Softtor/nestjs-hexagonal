import '../helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import type { FetchLike } from '../../lib/jev-client.ts';
import { ADVISORY_BYTE_CAP, handler, MAIN_THREAD_AGENT_ID } from '../../hooks/post-tool-use.ts';
import { APPLICATION_AGENT, context, DOMAIN_AGENT, jevFetch, makeProject, NEST_SERVICE, PLAIN_SERVICE, readLog, runHook, writeProjectFile } from './helpers.ts';

interface ContextJson {
  hookSpecificOutput: { hookEventName: string; additionalContext: string };
}

function isContextJson(value: unknown): value is ContextJson {
  return typeof value === 'object' && value !== null && 'hookSpecificOutput' in value;
}

function postInput(project: { dir: string }, relativePath: string, content: string, agent: { id: string; type: string } | null): Record<string, unknown> {
  return {
    hook_event_name: 'PostToolUse',
    session_id: 's',
    cwd: project.dir,
    ...(agent === null ? {} : { agent_id: agent.id, agent_type: agent.type }),
    tool_name: 'Write',
    tool_input: { file_path: join(project.dir, relativePath), content },
    tool_response: { filePath: join(project.dir, relativePath), type: 'create' },
  };
}

const HANDLER_PATH = 'src/orders/application/create-order.handler.ts';
const HANDLER_SOURCE = 'export class CreateOrderHandler {\n  async execute(): Promise<void> {\n    await Promise.resolve();\n  }\n}\n';

describe('post-tool-use hook', () => {
  it('records the touched path for any agent and stays silent on a clean file', async () => {
    const project = makeProject();
    const path = 'src/orders/domain/order.service.ts';
    writeProjectFile(project, path, PLAIN_SERVICE);
    const main = await runHook('post-tool-use', handler, postInput(project, path, PLAIN_SERVICE, null), context(project));
    expect(main.stdout).toBe('');
    expect(project.store.read('s', MAIN_THREAD_AGENT_ID)?.touchedPaths).toEqual([path]);
    const other = await runHook('post-tool-use', handler, postInput(project, path, PLAIN_SERVICE, { id: 'x', type: 'Explore' }), context(project));
    expect(other.stdout).toBe('');
    expect(project.store.read('s', 'x')?.touchedPaths).toEqual([path]);
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['silent', 'silent']);
  });

  it('skips paths outside the project and files without a scoped rule (still recording the path)', async () => {
    const project = makeProject();
    const outside = await runHook('post-tool-use', handler, { ...postInput(project, 'x.ts', 'x', null), tool_input: { file_path: '/elsewhere/x.ts', content: 'x' } }, context(project));
    expect(outside.stdout).toBe('');
    writeProjectFile(project, 'docs/readme.md', 'hi');
    const unscoped = await runHook('post-tool-use', handler, postInput(project, 'docs/readme.md', 'hi', { id: 'a', type: DOMAIN_AGENT }), context(project));
    expect(unscoped.stdout).toBe('');
    expect(project.store.read('s', 'a')?.touchedPaths).toEqual(['docs/readme.md']);
  });

  it('returns static findings as additionalContext for any agent, without a semantic call when no key is set', async () => {
    const project = makeProject();
    const path = 'src/orders/domain/order.service.ts';
    writeProjectFile(project, path, NEST_SERVICE);
    const run = await runHook('post-tool-use', handler, postInput(project, path, NEST_SERVICE, { id: 'x', type: 'Explore' }), context(project));
    if (!isContextJson(run.json)) {
      throw new Error(`unexpected output ${run.stdout}`);
    }
    expect(run.json.hookSpecificOutput.hookEventName).toBe('PostToolUse');
    expect(run.json.hookSpecificOutput.additionalContext).toContain('hex/domain-no-nest-decorators (FAIL)');
    expect(run.json.hookSpecificOutput.additionalContext).not.toContain('semantic');
    const [entry] = readLog(project);
    expect(entry).toMatchObject({ decision: 'context', ruleIds: ['hex/domain-no-nest-decorators'] });
    expect(entry.semantic).toBeUndefined();
  });

  it('asks Jev only for a plugin agent with a key and reports advise as advisory text', async () => {
    const project = makeProject();
    writeProjectFile(project, HANDLER_PATH, HANDLER_SOURCE);
    const jev = jevFetch(0.9);
    const key = { CLAUDE_PLUGIN_OPTION_TYPESAFE_API_KEY: 'sk-option-key' };
    const run = await runHook('post-tool-use', handler, postInput(project, HANDLER_PATH, HANDLER_SOURCE, { id: 'a', type: APPLICATION_AGENT }), context(project, key, jev.fetchImpl));
    if (!isContextJson(run.json)) {
      throw new Error(`unexpected output ${run.stdout}`);
    }
    expect(jev.calls.length).toBeGreaterThan(0);
    expect(run.json.hookSpecificOutput.additionalContext).toContain('semantic ask hex/handler-no-business-rules');
    expect(run.json.hookSpecificOutput.additionalContext).not.toContain('sk-option-key');
    const [entry] = readLog(project);
    expect(entry.semantic).toMatchObject({ findings: 1 });

    const noAgent = jevFetch(0.9);
    const main = await runHook('post-tool-use', handler, postInput(project, HANDLER_PATH, HANDLER_SOURCE, null), context(project, key, noAgent.fetchImpl));
    expect(noAgent.calls).toEqual([]);
    expect(main.stdout).toBe('');
    const foreign = jevFetch(0.9);
    await runHook('post-tool-use', handler, postInput(project, HANDLER_PATH, HANDLER_SOURCE, { id: 'b', type: 'Explore' }), context(project, key, foreign.fetchImpl));
    expect(foreign.calls).toEqual([]);
  });

  it('reduces an uncertain or uncalibrated answer to one short line', async () => {
    const project = makeProject();
    writeProjectFile(project, HANDLER_PATH, HANDLER_SOURCE);
    const uncertain = await runHook('post-tool-use', handler, postInput(project, HANDLER_PATH, HANDLER_SOURCE, { id: 'a', type: APPLICATION_AGENT }), context(project, { TYPESAFE_API_KEY: 'sk-env' }, jevFetch(0.5).fetchImpl));
    if (!isContextJson(uncertain.json)) {
      throw new Error(`unexpected output ${uncertain.stdout}`);
    }
    expect(uncertain.json.hookSpecificOutput.additionalContext).toContain('semantic abstained on 1 rule answer(s) (hex/handler-no-business-rules)');
    expect(readLog(project)[0]?.semantic).toMatchObject({ uncertain: 1 });
    const otherSource = HANDLER_SOURCE.replace('CreateOrderHandler', 'CancelOrderHandler');
    writeProjectFile(project, HANDLER_PATH, otherSource);
    const stale = await runHook('post-tool-use', handler, postInput(project, HANDLER_PATH, otherSource, { id: 'b', type: APPLICATION_AGENT }), context(project, { TYPESAFE_API_KEY: 'sk-env' }, jevFetch(0.9, 'jev-9.0.0').fetchImpl));
    if (!isContextJson(stale.json)) {
      throw new Error(`unexpected output ${stale.stdout}`);
    }
    expect(stale.json.hookSpecificOutput.additionalContext).toContain('semantic abstained');
    expect(readLog(project)[1]?.semantic).toMatchObject({ uncalibrated: 1 });
  });

  it('fails open when Jev is unreachable', async () => {
    const project = makeProject();
    writeProjectFile(project, HANDLER_PATH, HANDLER_SOURCE);
    const failing = async (): Promise<Response> => {
      throw new Error('connection refused');
    };
    const run = await runHook('post-tool-use', handler, postInput(project, HANDLER_PATH, HANDLER_SOURCE, { id: 'a', type: APPLICATION_AGENT }), context(project, { TYPESAFE_API_KEY: 'sk-env' }, failing));
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(readLog(project)[0]?.semantic).toMatchObject({ undecided: 2, findings: 0 });
  });

  it('gives up on Jev at the deadline and stays silent', async () => {
    const project = makeProject();
    writeProjectFile(project, HANDLER_PATH, HANDLER_SOURCE);
    const hanging: FetchLike = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const started = Date.now();
    const run = await runHook('post-tool-use', handler, postInput(project, HANDLER_PATH, HANDLER_SOURCE, { id: 'a', type: APPLICATION_AGENT }), { ...context(project, { TYPESAFE_API_KEY: 'sk-env' }, hanging), semanticDeadlineMs: 300 });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(readLog(project)[0]?.semantic).toMatchObject({ findings: 0 });
  });

  it('emits only a one-line notice once the advisory cap of the agent is reached', async () => {
    const project = makeProject();
    const path = 'src/orders/domain/order.service.ts';
    writeProjectFile(project, path, NEST_SERVICE);
    const agent = { id: 'a', type: DOMAIN_AGENT };
    const first = await runHook('post-tool-use', handler, postInput(project, path, NEST_SERVICE, agent), context(project));
    expect(first.stdout).toContain('hex/domain-no-nest-decorators');
    const bytes = project.store.read('s', 'a')?.advisoryBytes ?? 0;
    expect(bytes).toBeGreaterThan(0);
    project.store.update('s', 'a', (session) => ({ ...session, advisoryBytes: ADVISORY_BYTE_CAP }));
    const capped = await runHook('post-tool-use', handler, postInput(project, path, NEST_SERVICE, agent), context(project));
    if (!isContextJson(capped.json)) {
      throw new Error(`unexpected output ${capped.stdout}`);
    }
    expect(capped.json.hookSpecificOutput.additionalContext).toContain('advisory cap reached');
    expect(capped.json.hookSpecificOutput.additionalContext).not.toContain('(FAIL)');
    expect(project.store.read('s', 'a')?.advisoryBytes).toBe(ADVISORY_BYTE_CAP);
  });
});
