import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse } from 'yaml';

export const AGENT_MODELS = ['claude-opus-5', 'claude-sonnet-5', 'claude-haiku-4-5', 'haiku'] as const;
const PLUGIN_PREFIX = 'nestjs-hexagonal:';
const ROOT_DOCS = ['README.md', 'CLAUDE.md', 'CONTRIBUTING.md', 'ROADMAP.md', 'CHANGELOG.md'];

export interface FrontmatterIssue {
  file: string;
  message: string;
}

type Frontmatter = Record<string, unknown>;

export class FrontmatterParseError extends Error {}

function readFrontmatter(path: string, file: string, issues: FrontmatterIssue[]): Frontmatter | null {
  try {
    const fm = parseFrontmatter(readFileSync(path, 'utf8'));
    if (fm === null) {
      issues.push({ file, message: 'no YAML frontmatter' });
    }
    return fm;
  } catch (error) {
    issues.push({ file, message: `frontmatter is not valid YAML: ${error instanceof Error ? error.message : String(error)}` });
    return null;
  }
}

function isRecord(value: unknown): value is Frontmatter {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseFrontmatter(content: string): Frontmatter | null {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
  if (match === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = parse(match[1] ?? '');
  } catch (error) {
    throw new FrontmatterParseError(error instanceof Error ? error.message.split('\n')[0] ?? 'invalid YAML' : 'invalid YAML');
  }
  return isRecord(parsed) ? parsed : null;
}

function stripFencedCode(content: string): string {
  return content.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, '');
}

function markdownFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...markdownFiles(full));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full);
    }
  }
  return out.sort();
}

function requireString(fm: Frontmatter, field: string, file: string, issues: FrontmatterIssue[]): string | null {
  const value = fm[field];
  if (typeof value !== 'string' || value.trim() === '') {
    issues.push({ file, message: `missing required field "${field}"` });
    return null;
  }
  return value;
}

function isAllowedModel(value: string): value is (typeof AGENT_MODELS)[number] {
  return AGENT_MODELS.some((model) => model === value);
}

function checkAgent(root: string, path: string, issues: FrontmatterIssue[]): string | null {
  const file = relative(root, path);
  const fm = readFrontmatter(path, file, issues);
  if (fm === null) {
    return null;
  }
  const name = requireString(fm, 'name', file, issues);
  requireString(fm, 'description', file, issues);
  const model = requireString(fm, 'model', file, issues);
  if (model !== null && !isAllowedModel(model)) {
    issues.push({ file, message: `model "${model}" is not one of ${AGENT_MODELS.join(', ')}` });
  }
  const tools = fm.tools;
  if (!Array.isArray(tools) || tools.length === 0 || !tools.every((tool) => typeof tool === 'string')) {
    issues.push({ file, message: '"tools" must be a non-empty list' });
  }
  return name;
}

function checkSkill(root: string, path: string, issues: FrontmatterIssue[]): string | null {
  const file = relative(root, path);
  const fm = readFrontmatter(path, file, issues);
  if (fm === null) {
    return null;
  }
  const name = requireString(fm, 'name', file, issues);
  requireString(fm, 'description', file, issues);
  const directory = basename(dirname(path));
  if (name !== null && name !== directory) {
    issues.push({ file, message: `name "${name}" does not match directory "${directory}"` });
  }
  return name;
}

const REFERENCE_PATTERN = /nestjs-hexagonal:([a-z][a-z0-9-]*)/g;
const LINK_PATTERN = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function checkReferences(root: string, path: string, known: Set<string>, issues: FrontmatterIssue[]): void {
  const file = relative(root, path);
  const content = readFileSync(path, 'utf8');
  const seen = new Set<string>();
  for (const match of content.matchAll(REFERENCE_PATTERN)) {
    const id = match[1] ?? '';
    if (known.has(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    issues.push({ file, message: `"${PLUGIN_PREFIX}${id}" is neither a skill nor an agent` });
  }
}

function checkLinks(root: string, path: string, issues: FrontmatterIssue[]): void {
  const file = relative(root, path);
  const content = stripFencedCode(readFileSync(path, 'utf8'));
  for (const match of content.matchAll(LINK_PATTERN)) {
    const target = match[1] ?? '';
    if (target.startsWith('#') || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
      continue;
    }
    const withoutAnchor = target.replace(/#.*$/, '');
    if (withoutAnchor === '' || existsSync(resolve(dirname(path), withoutAnchor))) {
      continue;
    }
    issues.push({ file, message: `link "${target}" does not resolve` });
  }
}

export function validatePlugin(root: string): FrontmatterIssue[] {
  const issues: FrontmatterIssue[] = [];
  const known = new Set<string>();
  const agentFiles = markdownFiles(join(root, 'agents'));
  for (const path of agentFiles) {
    const name = checkAgent(root, path, issues);
    if (name !== null) {
      known.add(name);
    }
  }
  const skillFiles = markdownFiles(join(root, 'skills')).filter((path) => basename(path) === 'SKILL.md');
  for (const path of skillFiles) {
    const name = checkSkill(root, path, issues);
    if (name !== null) {
      known.add(name);
    }
  }
  const docs = [...agentFiles, ...markdownFiles(join(root, 'skills')), ...ROOT_DOCS.map((name) => join(root, name)).filter((path) => existsSync(path) && statSync(path).isFile())];
  for (const path of docs) {
    checkReferences(root, path, known, issues);
    checkLinks(root, path, issues);
  }
  return issues.sort((a, b) => a.file.localeCompare(b.file) || a.message.localeCompare(b.message));
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  return import.meta.url === pathToFileURL(isAbsolute(entry) ? entry : resolve(entry)).href;
}

if (isMainModule()) {
  const root = process.argv[2] === undefined ? dirname(dirname(fileURLToPath(import.meta.url))) : resolve(process.argv[2]);
  const issues = validatePlugin(root);
  for (const issue of issues) {
    process.stderr.write(`${issue.file}: ${issue.message}\n`);
  }
  process.stdout.write(issues.length === 0 ? `frontmatter, references and links are valid under ${root}\n` : `${issues.length} issue(s)\n`);
  process.exitCode = issues.length === 0 ? 0 : 1;
}
