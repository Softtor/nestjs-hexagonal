import '../helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { PLUGIN_ROOT } from './helpers.ts';

const HandlerSchema = z.object({
  type: z.literal('command'),
  command: z.literal('sh'),
  args: z.tuple([z.literal('${CLAUDE_PLUGIN_ROOT}/scripts/run.sh'), z.literal('--hook'), z.enum(['subagent-start', 'pre-tool-use', 'post-tool-use', 'subagent-stop', 'agent-post-tool-use'])]),
  timeout: z.number().int().positive().max(60),
  statusMessage: z.string().optional(),
});

const HooksJsonSchema = z.object({
  hooks: z.record(z.enum(['SubagentStart', 'PreToolUse', 'PostToolUse', 'SubagentStop']), z.array(z.object({ matcher: z.string(), hooks: z.array(HandlerSchema).min(1) }))),
});

describe('hooks/hooks.json', () => {
  const parsed = HooksJsonSchema.parse(JSON.parse(readFileSync(join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8')));

  it('routes every handler through run.sh with a known hook name and a timeout in seconds', () => {
    const names = Object.values(parsed.hooks).flatMap((groups) => groups.flatMap((group) => group.hooks.map((handler) => handler.args[2])));
    expect(names.sort()).toEqual(['agent-post-tool-use', 'post-tool-use', 'pre-tool-use', 'subagent-start', 'subagent-stop']);
  });

  it('matches only the plugin agents on SubagentStart and the six pipeline agents on SubagentStop', () => {
    const start = new RegExp(parsed.hooks.SubagentStart?.[0]?.matcher ?? '');
    expect(start.test('nestjs-hexagonal:domain-agent')).toBe(true);
    expect(start.test('nestjs-hexagonal:architecture-reviewer')).toBe(true);
    expect(start.test('Explore')).toBe(false);
    const stop = new RegExp(parsed.hooks.SubagentStop?.[0]?.matcher ?? '');
    for (const agent of ['domain-agent', 'application-agent', 'infrastructure-agent', 'presentation-agent', 'broadcasting-agent', 'listener-agent']) {
      expect(stop.test(`nestjs-hexagonal:${agent}`)).toBe(true);
    }
    expect(stop.test('nestjs-hexagonal:architecture-reviewer')).toBe(false);
    expect(stop.test('other:nestjs-hexagonal:domain-agent')).toBe(false);
  });

  it('matches Write and Edit exactly on the tool events, plus Agent on PostToolUse', () => {
    expect(parsed.hooks.PreToolUse?.map((group) => group.matcher)).toEqual(['Write|Edit']);
    expect(parsed.hooks.PostToolUse?.map((group) => group.matcher)).toEqual(['Write|Edit', 'Agent']);
  });

  it('is shipped by the package', () => {
    const pkg: unknown = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'package.json'), 'utf8'));
    const files = typeof pkg === 'object' && pkg !== null && 'files' in pkg && Array.isArray(pkg.files) ? pkg.files : [];
    expect(files).toContain('hooks');
    expect(files).toContain('scripts/hooks');
  });

  it('declares the key as optional sensitive user config and installs disabled', () => {
    const plugin: unknown = JSON.parse(readFileSync(join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
    const shape = z.object({ defaultEnabled: z.literal(false), userConfig: z.object({ TYPESAFE_API_KEY: z.object({ type: z.literal('string'), sensitive: z.literal(true), required: z.literal(false), title: z.string(), description: z.string() }) }) });
    expect(shape.safeParse(plugin).success).toBe(true);
  });
});
