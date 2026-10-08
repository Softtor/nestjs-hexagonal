import { describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { AGENT_MODELS, validatePlugin } from '../validate-frontmatter.ts';

const PLUGIN_ROOT = resolve(import.meta.dir, '../..');

function write(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'hex-fm-'));
  write(root, 'agents/domain-agent.md', '---\nname: domain-agent\ndescription: Domain agent\nmodel: claude-opus-5-5\ntools:\n  - Read\n---\nLoad `nestjs-hexagonal:domain`. See [checklist](../skills/domain/references/checklist.md).\n');
  write(root, 'skills/domain/SKILL.md', '---\nname: domain\ndescription: Domain skill\n---\nDispatch `nestjs-hexagonal:domain-agent`.\n```\nnestjs-hexagonal:<layer> is a placeholder\n```\n');
  write(root, 'skills/domain/references/checklist.md', '# Checklist\n[skill](../SKILL.md) [site](https://example.com) [anchor](#top) [mail](mailto:a@b.c)\n');
  write(root, 'README.md', '# Readme\n[CLAUDE](CLAUDE.md) [skill](skills/domain/SKILL.md#domain-layer)\n');
  write(root, 'CLAUDE.md', '# Claude\nRoute to `nestjs-hexagonal:domain` and `nestjs-hexagonal:domain-agent`.\n');
  return root;
}

function messages(root: string): string[] {
  return validatePlugin(root).map((issue) => `${issue.file}: ${issue.message}`);
}

describe('validatePlugin', () => {
  it('accepts a well-formed plugin', () => {
    expect(messages(fixture())).toEqual([]);
  });

  it('accepts the real plugin', () => {
    expect(messages(PLUGIN_ROOT)).toEqual([]);
  });

  it('lists the allowed agent models', () => {
    expect(AGENT_MODELS).toEqual(['claude-opus-5-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'haiku']);
  });

  it('rejects an agent without name, description, an allowed model or tools', () => {
    const root = fixture();
    write(root, 'agents/broken.md', '---\ndescription: x\nmodel: claude-3-opus\ntools: Read\n---\nbody\n');
    const found = messages(root);
    expect(found).toContain('agents/broken.md: missing required field "name"');
    expect(found).toContain(`agents/broken.md: model "claude-3-opus" is not one of ${AGENT_MODELS.join(', ')}`);
    expect(found).toContain('agents/broken.md: "tools" must be a non-empty list');
    write(root, 'agents/nomodel.md', '---\nname: nomodel\ndescription: x\ntools:\n  - Read\n---\n');
    expect(messages(root)).toContain('agents/nomodel.md: missing required field "model"');
    write(root, 'agents/nofm.md', '# no frontmatter\n');
    expect(messages(root)).toContain('agents/nofm.md: no YAML frontmatter');
    write(root, 'skills/colon/SKILL.md', '---\nname: colon\ndescription: Supports three patterns: plain (A)\n---\n');
    expect(messages(root).some((message) => message.startsWith('skills/colon/SKILL.md: frontmatter is not valid YAML'))).toBe(true);
  });

  it('rejects a skill whose name does not match its directory', () => {
    const root = fixture();
    write(root, 'skills/review/SKILL.md', '---\nname: reviewer\ndescription: x\n---\n');
    expect(messages(root)).toContain('skills/review/SKILL.md: name "reviewer" does not match directory "review"');
    write(root, 'skills/empty/SKILL.md', '---\nname: empty\n---\n');
    expect(messages(root)).toContain('skills/empty/SKILL.md: missing required field "description"');
  });

  it('rejects a reference to an agent or skill that does not exist', () => {
    const root = fixture();
    write(root, 'skills/domain/SKILL.md', '---\nname: domain\ndescription: x\n---\nDispatch `nestjs-hexagonal:ghost-agent` after `nestjs-hexagonal:domain`.\n');
    expect(messages(root)).toContain('skills/domain/SKILL.md: "nestjs-hexagonal:ghost-agent" is neither a skill nor an agent');
    write(root, 'README.md', 'See `nestjs-hexagonal:nope`.\n');
    expect(messages(root)).toContain('README.md: "nestjs-hexagonal:nope" is neither a skill nor an agent');
  });

  it('rejects a relative link that does not resolve, outside fenced code', () => {
    const root = fixture();
    write(root, 'README.md', '[missing](docs/missing.md#x)\n```\n[ignored](nothing/here.md)\n```\n');
    const found = messages(root);
    expect(found).toContain('README.md: link "docs/missing.md#x" does not resolve');
    expect(found.some((message) => message.includes('nothing/here.md'))).toBe(false);
    write(root, 'agents/domain-agent.md', '---\nname: domain-agent\ndescription: x\nmodel: haiku\ntools:\n  - Read\n---\n[gone](../skills/gone.md)\n');
    expect(messages(root)).toContain('agents/domain-agent.md: link "../skills/gone.md" does not resolve');
  });
});
