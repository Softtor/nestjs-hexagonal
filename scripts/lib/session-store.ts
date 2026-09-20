import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';

const UnresolvedFindingSchema = z.object({
  path: z.string(),
  ruleId: z.string(),
  severity: z.enum(['FAIL', 'WARN']),
  line: z.number().int().positive().optional(),
  evidence: z.string(),
  fix: z.string(),
});

export const AgentSessionSchema = z.object({
  agentType: z.string(),
  startedAt: z.string(),
  headSha: z.string().nullable(),
  touchedPaths: z.array(z.string()),
  blocks: z.number().int().nonnegative(),
  advisoryBytes: z.number().int().nonnegative(),
  unresolved: z.array(UnresolvedFindingSchema),
});

export type AgentSession = z.infer<typeof AgentSessionSchema>;
export type UnresolvedFinding = z.infer<typeof UnresolvedFindingSchema>;

export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const GC_PROBABILITY = 1 / 20;
const GC_THRESHOLD = 200;
const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 5;

export interface SessionStoreOptions {
  dataDir: string;
  now?: () => number;
  random?: () => number;
  ttlMs?: number;
  gcThreshold?: number;
}

export interface SessionStore {
  read(sessionId: string, agentId: string): AgentSession | null;
  update(sessionId: string, agentId: string, mutate: (session: AgentSession) => AgentSession): AgentSession;
  filePath(sessionId: string, agentId: string): string;
  collectGarbage(): number;
}

export function emptySession(agentType: string, startedAt: string, headSha: string | null): AgentSession {
  return { agentType, startedAt, headSha, touchedPaths: [], blocks: 0, advisoryBytes: 0, unresolved: [] };
}

/** Data directory id of a marketplace install: `<plugin>@<marketplace>` with `@` replaced by `-` (plugins-reference.md, "Persistent data directory"). */
export const MARKETPLACE_DATA_ID = 'nestjs-hexagonal-softtor-nestjs-hexagonal';

/**
 * `$CLAUDE_PLUGIN_DATA` (exported to hook processes), else the marketplace
 * install's data directory when it exists (a terminal running `export-logs`
 * does not receive the variable), else a per-user temp directory (plugin
 * loaded in place).
 */
export function resolveDataDir(env: Record<string, string | undefined>): string {
  const fromEnv = env.CLAUDE_PLUGIN_DATA;
  if (fromEnv !== undefined && fromEnv !== '') {
    return fromEnv;
  }
  const home = env.HOME !== undefined && env.HOME !== '' ? env.HOME : homedir();
  const marketplace = join(home, '.claude', 'plugins', 'data', MARKETPLACE_DATA_ID);
  if (existsSync(marketplace)) {
    return marketplace;
  }
  return join(tmpdir(), 'nestjs-hexagonal-data');
}

export function sanitizeId(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned === '' ? '_' : cleaned.slice(0, 120);
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function acquireLock(lockPath: string, now: () => number): void {
  const deadline = now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      closeSync(openSync(lockPath, 'wx'));
      return;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) {
        throw error;
      }
      try {
        if (now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS) {
          unlinkSync(lockPath);
          continue;
        }
      } catch {
        continue;
      }
      if (now() > deadline) {
        throw new Error(`session store lock ${lockPath} is held for more than ${LOCK_WAIT_MS} ms`);
      }
      sleepSync(LOCK_POLL_MS);
    }
  }
}

function releaseLock(lockPath: string): void {
  try {
    unlinkSync(lockPath);
  } catch {
    void 0;
  }
}

function readSessionFile(path: string): AgentSession | null {
  if (!existsSync(path)) {
    return null;
  }
  try {
    const parsed = AgentSessionSchema.safeParse(JSON.parse(readFileSync(path, 'utf8')));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function writeAtomically(path: string, text: string): void {
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, path);
  } catch {
    renameSync(tmp, path);
  }
}

export function createSessionStore(options: SessionStoreOptions): SessionStore {
  const now = options.now ?? Date.now;
  const random = options.random ?? Math.random;
  const ttlMs = options.ttlMs ?? SESSION_TTL_MS;
  const gcThreshold = options.gcThreshold ?? GC_THRESHOLD;
  const sessionsDir = join(options.dataDir, 'sessions');

  const filePath = (sessionId: string, agentId: string): string => join(sessionsDir, sanitizeId(sessionId), `${sanitizeId(agentId)}.json`);

  const collectGarbage = (): number => {
    if (!existsSync(sessionsDir)) {
      return 0;
    }
    let removed = 0;
    for (const entry of readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) {
        continue;
      }
      const dir = join(sessionsDir, entry.name);
      try {
        if (now() - statSync(dir).mtimeMs > ttlMs) {
          rmSync(dir, { recursive: true, force: true });
          removed += 1;
        }
      } catch {
        void 0;
      }
    }
    return removed;
  };

  const maybeCollect = (): void => {
    let count = 0;
    try {
      count = readdirSync(sessionsDir).length;
    } catch {
      return;
    }
    if (random() < GC_PROBABILITY || count > gcThreshold) {
      collectGarbage();
    }
  };

  return {
    filePath,
    collectGarbage,
    read: (sessionId, agentId) => readSessionFile(filePath(sessionId, agentId)),
    update: (sessionId, agentId, mutate) => {
      const path = filePath(sessionId, agentId);
      mkdirSync(join(sessionsDir, sanitizeId(sessionId)), { recursive: true });
      const lockPath = `${path}.lock`;
      acquireLock(lockPath, now);
      try {
        const current = readSessionFile(path) ?? emptySession('unknown', new Date(now()).toISOString(), null);
        const next = AgentSessionSchema.parse(mutate(current));
        writeAtomically(path, JSON.stringify(next));
        maybeCollect();
        return next;
      } finally {
        releaseLock(lockPath);
      }
    },
  };
}
