import { describe, expect, it } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');
const PACKAGE_RUNNER_DOC = 'skills/using-nestjs-hexagonal/SKILL.md';

function markdownFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...markdownFiles(full));
    } else if (entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out;
}

function packageRunnerSection(content: string): string {
  const start = content.indexOf('## Package runner');
  if (start < 0) {
    throw new Error(`${PACKAGE_RUNNER_DOC} has no "## Package runner" section`);
  }
  const rest = content.slice(start + 1);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
}

interface HookMatcher {
  hooks: { SubagentStop: Array<{ matcher: string }> };
}

function isHookMatcher(value: unknown): value is HookMatcher {
  return typeof value === 'object' && value !== null && 'hooks' in value;
}

function pipelineAgents(): string[] {
  const parsed: unknown = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'hooks', 'hooks.json'), 'utf8'));
  if (!isHookMatcher(parsed)) {
    throw new Error('hooks.json has no hooks');
  }
  const matcher = parsed.hooks.SubagentStop[0]?.matcher ?? '';
  const group = /\((.*)\)/.exec(matcher)?.[1] ?? '';
  return group.split('|').filter((name) => name.length > 0);
}

describe('skills and agents do not hardcode a package manager', () => {
  it('mentions pnpm only inside the package runner section of using-nestjs-hexagonal', () => {
    const offenders: string[] = [];
    for (const file of [...markdownFiles(join(PLUGIN_ROOT, 'skills')), ...markdownFiles(join(PLUGIN_ROOT, 'agents'))]) {
      const relativePath = file.slice(PLUGIN_ROOT.length + 1);
      let content = readFileSync(file, 'utf8');
      if (relativePath === PACKAGE_RUNNER_DOC) {
        content = content.replace(packageRunnerSection(content), '');
      }
      if (/\bpnpm\b/.test(content)) {
        offenders.push(relativePath);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('documents the lockfile detection table once', () => {
    const section = packageRunnerSection(readFileSync(join(PLUGIN_ROOT, PACKAGE_RUNNER_DOC), 'utf8'));
    for (const lockfile of ['bun.lock', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock']) {
      expect(section).toContain(lockfile);
    }
    expect(section).toContain('${user_config.package_runner}');
  });
});

describe('pipeline agents are rulebook-driven', () => {
  const agents = pipelineAgents();

  it('derives the six pipeline agents from the SubagentStop matcher', () => {
    expect(agents).toEqual(['domain-agent', 'application-agent', 'infrastructure-agent', 'presentation-agent', 'broadcasting-agent', 'listener-agent']);
  });

  for (const agent of agents) {
    it(`${agent} explains the SubagentStop block and runs the checker before finishing`, () => {
      const content = readFileSync(join(PLUGIN_ROOT, 'agents', `${agent}.md`), 'utf8');
      expect(content).toContain('## When the SubagentStop hook blocks');
      expect(content).toContain('SubagentStart');
      expect(content).toContain('nestjs-hexagonal-check --files');
      expect(content).toContain('--classes static --strict');
      expect(content).not.toContain('## First Step');
    });
  }

  it('architecture-reviewer consumes the checker JSON and keeps its three sections', () => {
    const content = readFileSync(join(PLUGIN_ROOT, 'agents', 'architecture-reviewer.md'), 'utf8');
    expect(content).toContain('--format json --classes static,semantic --explain');
    expect(content).toContain('## Section 1');
    expect(content).toContain('## Section 2');
    expect(content).toContain('## Section 3');
    expect(content).toContain('uncertain');
  });
});
