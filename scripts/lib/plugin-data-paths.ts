import { join } from 'node:path';

/** Cache, Jev log and circuit-breaker paths under `$CLAUDE_PLUGIN_DATA`; empty when the variable is absent. */
export function pluginDataPaths(env: Record<string, string | undefined>): { cacheDir?: string; logPath?: string; breakerPath?: string } {
  const dataDir = env.CLAUDE_PLUGIN_DATA;
  if (dataDir === undefined || dataDir === '') {
    return {};
  }
  return { cacheDir: join(dataDir, 'cache'), logPath: join(dataDir, 'jev.jsonl'), breakerPath: join(dataDir, 'breaker.json') };
}
