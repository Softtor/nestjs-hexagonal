import './helpers/no-network.ts';
import { describe, expect, it } from 'bun:test';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSessionStore, emptySession, MARKETPLACE_DATA_ID, resolveDataDir, sanitizeId, SESSION_TTL_MS } from '../lib/session-store.ts';

const WORKER = join(import.meta.dir, 'helpers', 'session-store-worker.ts');

function runWorker(dataDir: string, sessionId: string, agentId: string, count: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn('bun', [WORKER, dataDir, sessionId, agentId, String(count)], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}: ${stderr}`));
      } else {
        resolve(code);
      }
    });
  });
}

describe('session store', () => {
  it('creates the session on first update and reads it back', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hex-store-'));
    const store = createSessionStore({ dataDir, random: () => 1 });
    expect(store.read('s1', 'a1')).toBeNull();
    const written = store.update('s1', 'a1', () => ({ ...emptySession('nestjs-hexagonal:domain-agent', '2026-09-20T00:00:00Z', null), touchedPaths: ['src/a.ts'] }));
    expect(written.touchedPaths).toEqual(['src/a.ts']);
    expect(store.read('s1', 'a1')?.agentType).toBe('nestjs-hexagonal:domain-agent');
    expect(store.filePath('s1', 'a1')).toBe(join(dataDir, 'sessions', 's1', 'a1.json'));
    expect(readdirSync(join(dataDir, 'sessions', 's1'))).toEqual(['a1.json']);
  });

  it('sanitizes ids so a session id cannot escape the sessions directory', () => {
    expect(sanitizeId('../../etc')).toBe('______etc');
    expect(sanitizeId('agent-abc123')).toBe('agent-abc123');
    expect(sanitizeId('')).toBe('_');
    const dataDir = mkdtempSync(join(tmpdir(), 'hex-store-'));
    const store = createSessionStore({ dataDir, random: () => 1 });
    store.update('../../escape', 'a/../b', (session) => session);
    expect(existsSync(join(dataDir, 'sessions', '______escape', 'a____b.json'))).toBe(true);
  });

  it('does not lose writes when two processes increment the same counter', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hex-store-'));
    const store = createSessionStore({ dataDir, random: () => 1 });
    store.update('s', 'a', () => emptySession('nestjs-hexagonal:domain-agent', '2026-09-20T00:00:00Z', null));
    await Promise.all([runWorker(dataDir, 's', 'a', 40), runWorker(dataDir, 's', 'a', 40)]);
    expect(store.read('s', 'a')?.blocks).toBe(80);
    expect(readdirSync(join(dataDir, 'sessions', 's')).filter((name) => name.endsWith('.tmp') || name.endsWith('.lock'))).toEqual([]);
  });

  it('recovers from a stale lock left by a crashed process', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hex-store-'));
    mkdirSync(join(dataDir, 'sessions', 's'), { recursive: true });
    const lock = join(dataDir, 'sessions', 's', 'a.json.lock');
    writeFileSync(lock, '');
    const old = new Date(Date.now() - 60_000);
    utimesSync(lock, old, old);
    const store = createSessionStore({ dataDir, random: () => 1 });
    const written = store.update('s', 'a', (session) => ({ ...session, blocks: 1 }));
    expect(written.blocks).toBe(1);
    expect(existsSync(lock)).toBe(false);
  });

  it('collects sessions older than the TTL only on the sampled writes or above the threshold', () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'hex-store-'));
    let clock = Date.now();
    let sample = 1;
    const store = createSessionStore({ dataDir, now: () => clock, random: () => sample, gcThreshold: 3 });
    store.update('old', 'a', (session) => session);
    const oldDir = join(dataDir, 'sessions', 'old');
    const past = new Date(clock - SESSION_TTL_MS - 1000);
    utimesSync(oldDir, past, past);

    store.update('fresh-1', 'a', (session) => session);
    expect(existsSync(oldDir)).toBe(true);

    sample = 0;
    store.update('fresh-2', 'a', (session) => session);
    expect(existsSync(oldDir)).toBe(false);

    store.update('old-2', 'a', (session) => session);
    utimesSync(join(dataDir, 'sessions', 'old-2'), past, past);
    sample = 1;
    store.update('fresh-3', 'a', (session) => session);
    store.update('fresh-4', 'a', (session) => session);
    expect(existsSync(join(dataDir, 'sessions', 'old-2'))).toBe(false);
    clock += 1;
    expect(store.collectGarbage()).toBe(0);
  });

  it('falls back to the marketplace data directory, then to a temp directory, when CLAUDE_PLUGIN_DATA is not set', () => {
    const home = mkdtempSync(join(tmpdir(), 'hex-home-'));
    expect(resolveDataDir({ CLAUDE_PLUGIN_DATA: '/data/x', HOME: home })).toBe('/data/x');
    expect(resolveDataDir({ HOME: home })).toBe(join(tmpdir(), 'nestjs-hexagonal-data'));
    expect(resolveDataDir({ CLAUDE_PLUGIN_DATA: '', HOME: home })).toBe(join(tmpdir(), 'nestjs-hexagonal-data'));
    const marketplace = join(home, '.claude', 'plugins', 'data', MARKETPLACE_DATA_ID);
    mkdirSync(marketplace, { recursive: true });
    expect(resolveDataDir({ HOME: home })).toBe(marketplace);
  });
});
