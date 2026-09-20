import '../helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { join } from 'node:path';
import { handler, resultingContent } from '../../hooks/pre-tool-use.ts';
import { context, DOMAIN_AGENT, makeProject, NEST_SERVICE, PLAIN_SERVICE, readLog, runHook, writeProjectFile } from './helpers.ts';

interface PreToolUseJson {
  hookSpecificOutput: { hookEventName: string; permissionDecision?: string; permissionDecisionReason?: string; additionalContext?: string };
}

function isPreToolUseJson(value: unknown): value is PreToolUseJson {
  return typeof value === 'object' && value !== null && 'hookSpecificOutput' in value;
}

function writeInput(project: { dir: string }, relativePath: string, content: string, agentType: string | null = DOMAIN_AGENT): Record<string, unknown> {
  return {
    hook_event_name: 'PreToolUse',
    session_id: 's',
    cwd: project.dir,
    ...(agentType === null ? {} : { agent_id: 'a', agent_type: agentType }),
    tool_name: 'Write',
    tool_input: { file_path: join(project.dir, relativePath), content },
  };
}

describe('pre-tool-use hook', () => {
  it('computes the content an Edit would produce', () => {
    const project = makeProject();
    const path = writeProjectFile(project, 'src/a.ts', 'a b a');
    expect(resultingContent({ tool: 'Edit', input: { file_path: path, old_string: 'a', new_string: 'c', replace_all: false } }, path)).toBe('c b a');
    expect(resultingContent({ tool: 'Edit', input: { file_path: path, old_string: 'a', new_string: '$&', replace_all: true } }, path)).toBe('$& b $&');
    expect(resultingContent({ tool: 'Edit', input: { file_path: path, old_string: 'zzz', new_string: 'c', replace_all: false } }, path)).toBeNull();
    expect(resultingContent({ tool: 'Edit', input: { file_path: join(project.dir, 'missing.ts'), old_string: 'a', new_string: 'c', replace_all: false } }, join(project.dir, 'missing.ts'))).toBeNull();
  });

  it('stays silent for a non-plugin agent, the main thread, a path outside the project and a path outside every rule scope', async () => {
    const project = makeProject();
    const other = await runHook('pre-tool-use', handler, writeInput(project, 'src/orders/domain/order.service.ts', NEST_SERVICE, 'Explore'), context(project));
    expect(other.stdout).toBe('');
    const main = await runHook('pre-tool-use', handler, writeInput(project, 'src/orders/domain/order.service.ts', NEST_SERVICE, null), context(project));
    expect(main.stdout).toBe('');
    const outside = await runHook('pre-tool-use', handler, { ...writeInput(project, 'x.ts', NEST_SERVICE), tool_input: { file_path: '/elsewhere/src/orders/domain/order.service.ts', content: NEST_SERVICE } }, context(project));
    expect(outside.stdout).toBe('');
    const unscoped = await runHook('pre-tool-use', handler, writeInput(project, 'src/orders/README.md', NEST_SERVICE), context(project));
    expect(unscoped.stdout).toBe('');
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['skip', 'skip', 'skip', 'skip']);
  });

  it('denies a Write that puts @Injectable into the domain, naming the rule and the fix', async () => {
    const project = makeProject();
    const run = await runHook('pre-tool-use', handler, writeInput(project, 'src/orders/domain/order.service.ts', NEST_SERVICE), context(project, { TYPESAFE_API_KEY: 'sk-present' }));
    expect(run.code).toBe(0);
    if (!isPreToolUseJson(run.json)) {
      throw new Error(`unexpected output ${run.stdout}`);
    }
    expect(run.json.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(run.json.hookSpecificOutput.permissionDecision).toBe('deny');
    expect(run.json.hookSpecificOutput.permissionDecisionReason).toContain('hex/domain-no-nest-decorators (FAIL)');
    expect(run.json.hookSpecificOutput.permissionDecisionReason).toContain('fix:');
    expect(run.json.hookSpecificOutput.permissionDecisionReason).not.toContain('sk-present');
    expect(run.json.hookSpecificOutput.permissionDecisionReason).not.toContain('semantic');
    const [entry] = readLog(project);
    expect(entry).toMatchObject({ decision: 'deny', ruleIds: ['hex/domain-no-nest-decorators'], path: 'src/orders/domain/order.service.ts', tool: 'Write' });
  });

  it('lists at most three findings in the deny reason', async () => {
    const project = makeProject();
    const content = ["import { Injectable } from '@nestjs/common';", "import { Inject } from '@nestjs/common';", "import { PrismaService } from '../infrastructure/prisma.service';", "import { Controller } from '@nestjs/common';", 'export class OrderService {}'].join('\n');
    const run = await runHook('pre-tool-use', handler, writeInput(project, 'src/orders/domain/order.service.ts', content), context(project));
    if (!isPreToolUseJson(run.json)) {
      throw new Error(`unexpected output ${run.stdout}`);
    }
    const reason = run.json.hookSpecificOutput.permissionDecisionReason ?? '';
    expect(reason.split('\n').filter((line) => line.includes('(FAIL)'))).toHaveLength(3);
    expect(reason).toContain('more FAIL finding(s)');
  });

  it('does not deny an Edit whose replacement removes the violation, and adds no permission decision', async () => {
    const project = makeProject();
    const path = writeProjectFile(project, 'src/orders/domain/order.service.ts', NEST_SERVICE);
    const input = {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      cwd: project.dir,
      agent_id: 'a',
      agent_type: DOMAIN_AGENT,
      tool_name: 'Edit',
      tool_input: { file_path: path, old_string: "import { Injectable } from '@nestjs/common';\n\n@Injectable()\n", new_string: '' },
    };
    const run = await runHook('pre-tool-use', handler, input, context(project));
    expect(run.code).toBe(0);
    expect(run.stdout).toBe('');
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['silent']);

    const stillBroken = await runHook('pre-tool-use', handler, { ...input, tool_input: { file_path: path, old_string: 'run(): void {}', new_string: 'run(): void { return; }' } }, context(project));
    expect(stillBroken.stdout).toBe('');
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['silent', 'silent']);
  });

  it('denies only the FAILs a write introduces, not the ones the file already has', async () => {
    const project = makeProject();
    const path = writeProjectFile(project, 'src/orders/domain/order.service.ts', NEST_SERVICE);
    const input = {
      hook_event_name: 'PreToolUse',
      session_id: 's',
      cwd: project.dir,
      agent_id: 'a',
      agent_type: DOMAIN_AGENT,
      tool_name: 'Edit',
      tool_input: { file_path: path, old_string: 'export class OrderService {', new_string: "import { PrismaService } from '../infrastructure/prisma.service';\nexport class OrderService {" },
    };
    const run = await runHook('pre-tool-use', handler, input, context(project));
    if (!isPreToolUseJson(run.json)) {
      throw new Error(`unexpected output ${run.stdout}`);
    }
    expect(run.json.hookSpecificOutput.permissionDecision).toBe('deny');
    const reason = run.json.hookSpecificOutput.permissionDecisionReason ?? '';
    expect(reason).toContain('introduce 1 static FAIL');
    expect(reason).toContain('prisma.service');
    expect(reason).not.toContain("'@nestjs/common'");
  });

  it('returns a WARN as additionalContext without a permission decision', async () => {
    const project = makeProject();
    const handlerSource = `export class CreateOrderHandler {\n  async execute(): Promise<void> {\n${'    await Promise.resolve();\n'.repeat(40)}  }\n}\n`;
    const run = await runHook('pre-tool-use', handler, writeInput(project, 'src/orders/application/create-order.handler.ts', handlerSource), context(project));
    if (!isPreToolUseJson(run.json)) {
      throw new Error(`unexpected output ${run.stdout}`);
    }
    expect(run.json.hookSpecificOutput.permissionDecision).toBeUndefined();
    expect(run.json.hookSpecificOutput.additionalContext).toContain('hex/handler-max-lines (WARN)');
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['context']);
  });

  it('is silent on a clean write', async () => {
    const project = makeProject();
    const run = await runHook('pre-tool-use', handler, writeInput(project, 'src/orders/domain/order.service.ts', PLAIN_SERVICE), context(project));
    expect(run.stdout).toBe('');
    expect(readLog(project).map((entry) => entry.decision)).toEqual(['silent']);
  });
});
