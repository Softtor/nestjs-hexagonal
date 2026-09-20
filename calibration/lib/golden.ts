import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { z } from 'zod';
import { normalizePath } from '../../scripts/lib/scope.ts';
import type { SourceFile } from '../../scripts/lib/static-engine.ts';

export const CaseSchema = z.object({
  expected: z.enum(['violation', 'ok']),
  note: z.string().min(1),
});

export type Expected = z.infer<typeof CaseSchema>['expected'];

export interface GoldenCase {
  ruleId: string;
  caseId: string;
  label: 'good' | 'bad';
  expected: Expected;
  note: string;
  file: SourceFile;
}

function walkFiles(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

export function loadGoldenCases(goldenRoot: string, ruleId: string, pluginRoot: string): GoldenCase[] {
  const cases: GoldenCase[] = [];
  for (const label of ['good', 'bad'] as const) {
    const dir = join(goldenRoot, ruleId, label);
    if (!existsSync(dir)) {
      continue;
    }
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const caseDir = join(dir, entry.name);
      const casePath = join(caseDir, 'case.json');
      if (!existsSync(casePath)) {
        throw new Error(`${caseDir}: missing case.json`);
      }
      const parsed = CaseSchema.safeParse(JSON.parse(readFileSync(casePath, 'utf8')));
      if (!parsed.success) {
        throw new Error(`${casePath}: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
      }
      const files: string[] = [];
      walkFiles(caseDir, files);
      const sources = files.filter((file) => file.endsWith('.ts'));
      if (sources.length !== 1) {
        throw new Error(`${caseDir}: expected exactly one .ts file, found ${sources.length}`);
      }
      const source = sources[0] ?? '';
      const expectedLabel: Expected = label === 'bad' ? 'violation' : 'ok';
      if (parsed.data.expected !== expectedLabel) {
        throw new Error(`${casePath}: expected '${expectedLabel}' under ${label}/, found '${parsed.data.expected}'`);
      }
      cases.push({
        ruleId,
        caseId: entry.name,
        label,
        expected: parsed.data.expected,
        note: parsed.data.note,
        file: { path: normalizePath(relative(pluginRoot, source)), content: readFileSync(source, 'utf8') },
      });
    }
  }
  return cases.sort((a, b) => a.label.localeCompare(b.label) || a.caseId.localeCompare(b.caseId));
}
