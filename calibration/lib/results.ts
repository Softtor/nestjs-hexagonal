import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';

export const ResultRecordSchema = z.object({
  pin: z.string().min(1),
  model: z.string().min(1),
  ruleId: z.string().min(1),
  caseId: z.string().min(1),
  expected: z.enum(['violation', 'ok']),
  primitive: z.enum(['noul', 'choice', 'score']),
  value: z.number().min(0).max(1),
  answer: z.union([z.number(), z.string()]),
  confidence: z.number().min(0).max(1).optional(),
  latencyMs: z.number().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  cached: z.boolean(),
  error: z.string().optional(),
});

export type ResultRecord = z.infer<typeof ResultRecordSchema>;

export function resultPath(outDir: string, ruleId: string): string {
  return join(outDir, `${ruleId}.jsonl`);
}

export function writeResults(outDir: string, ruleId: string, records: ResultRecord[]): string {
  const path = resultPath(outDir, ruleId);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, records.map((record) => JSON.stringify(record)).join('\n') + (records.length > 0 ? '\n' : ''));
  return path;
}

export function readResults(path: string): ResultRecord[] {
  const records: ResultRecord[] = [];
  const lines = readFileSync(path, 'utf8').split('\n');
  lines.forEach((line, index) => {
    if (line.trim() === '') {
      return;
    }
    const parsed = ResultRecordSchema.safeParse(JSON.parse(line));
    if (!parsed.success) {
      throw new Error(`${path}:${index + 1}: ${parsed.error.issues.map((issue) => `${issue.path.map(String).join('.')}: ${issue.message}`).join('; ')}`);
    }
    records.push(parsed.data);
  });
  return records;
}

export function listResultFiles(outDir: string): string[] {
  if (!existsSync(outDir)) {
    return [];
  }
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name !== 'client-log.jsonl') {
        out.push(full);
      }
    }
  };
  walk(outDir);
  return out.sort();
}

export function readAllResults(outDir: string): Map<string, ResultRecord[]> {
  const byRule = new Map<string, ResultRecord[]>();
  for (const file of listResultFiles(outDir)) {
    for (const record of readResults(file)) {
      const list = byRule.get(record.ruleId) ?? [];
      list.push(record);
      byRule.set(record.ruleId, list);
    }
  }
  return byRule;
}
