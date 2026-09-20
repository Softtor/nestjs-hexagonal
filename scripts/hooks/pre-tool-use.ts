import { existsSync, readFileSync } from 'node:fs';
import type { Rule } from '../lib/rulebook.schema.ts';
import { runStaticRules, type Finding } from '../lib/static-engine.ts';
import {
  PREFIX,
  formatStaticFinding,
  isPluginAgent,
  loadRulebook,
  projectDir,
  relativeProjectPath,
  rulesInScope,
  skip,
  staticRules,
  uniqueRuleIds,
  type HookHandler,
} from './lib/hook-common.ts';
import { denyOutput, fileToolInput, preToolUseContextOutput, type FileToolInput } from './lib/hook-io.ts';
import { runHookMain } from './lib/runner.ts';

export const DENY_REASON_MAX_FINDINGS = 3;

/** The file content the tool call would produce, or null when it cannot be computed (the tool itself will fail). */
export function resultingContent(tool: FileToolInput, absolutePath: string): string | null {
  if (tool.tool === 'Write') {
    return tool.input.content;
  }
  if (!existsSync(absolutePath)) {
    return null;
  }
  const current = readFileSync(absolutePath, 'utf8');
  const { old_string: oldString, new_string: newString, replace_all: replaceAll } = tool.input;
  if (oldString === '' || !current.includes(oldString)) {
    return null;
  }
  if (replaceAll) {
    return current.split(oldString).join(newString);
  }
  const index = current.indexOf(oldString);
  return `${current.slice(0, index)}${newString}${current.slice(index + oldString.length)}`;
}

function findingKey(finding: Finding): string {
  return `${finding.ruleId}\u0000${finding.evidence}`;
}

/** Findings of the resulting content that the current file does not already have. */
export function regressions(rules: Rule[], path: string, current: string | null, next: string): Finding[] {
  const after = runStaticRules(rules, [{ path, content: next }]).findings;
  if (current === null) {
    return after;
  }
  const before = new Set(runStaticRules(rules, [{ path, content: current }]).findings.map(findingKey));
  return after.filter((finding) => !before.has(findingKey(finding)));
}

export function denyReason(fails: Finding[]): string {
  const shown = fails.slice(0, DENY_REASON_MAX_FINDINGS).map(formatStaticFinding);
  const more = fails.length > DENY_REASON_MAX_FINDINGS ? [`${PREFIX} ${fails.length - DENY_REASON_MAX_FINDINGS} more FAIL finding(s) in the same file`] : [];
  return [`${PREFIX} this write would introduce ${fails.length} static FAIL finding(s); the file was not written:`, ...shown, ...more].join('\n');
}

export const handler: HookHandler = async (input, context) => {
  if (!isPluginAgent(input.agent_type)) {
    return skip();
  }
  const tool = fileToolInput(input);
  if (tool === null) {
    return skip();
  }
  const project = projectDir(input, context);
  const path = relativeProjectPath(project, tool.input.file_path);
  if (path === null) {
    return skip();
  }
  const loaded = loadRulebook(input, context);
  if (!loaded.ok) {
    return { ...skip(), stderr: `${PREFIX} pre-tool-use: ${loaded.reason}` };
  }
  const rules = rulesInScope(staticRules(loaded.composed.rules, { external: false }), path);
  if (rules.length === 0) {
    return { ...skip(), path };
  }
  const content = resultingContent(tool, tool.input.file_path);
  if (content === null) {
    return { ...skip(), path };
  }
  const current = existsSync(tool.input.file_path) ? readFileSync(tool.input.file_path, 'utf8') : null;
  const bodies = [content, ...(current === null ? [] : [current]), tool.tool === 'Write' ? tool.input.content : tool.input.new_string];
  const findings = regressions(rules, path, current, content);
  const fails = findings.filter((finding) => finding.severity === 'FAIL');
  if (fails.length > 0) {
    return { output: denyOutput(denyReason(fails)), decision: 'deny', ruleIds: uniqueRuleIds(fails), path, bodies };
  }
  if (findings.length > 0) {
    const text = [`${PREFIX} ${findings.length} advisory WARN finding(s) in ${path}:`, ...findings.map(formatStaticFinding)].join('\n');
    return { output: preToolUseContextOutput(text), decision: 'context', ruleIds: uniqueRuleIds(findings), path, bodies };
  }
  return { output: null, decision: 'silent', path, bodies };
};

await runHookMain('pre-tool-use', handler, import.meta.url);
