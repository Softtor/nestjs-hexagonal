// Spawned by session-store.spec.ts: increments the block counter of one agent N times.
import { createSessionStore } from '../../lib/session-store.ts';

const [dataDir, sessionId, agentId, count] = process.argv.slice(2);
if (dataDir === undefined || sessionId === undefined || agentId === undefined || count === undefined) {
  throw new Error('usage: session-store-worker <dataDir> <sessionId> <agentId> <count>');
}
const store = createSessionStore({ dataDir, random: () => 1 });
for (let i = 0; i < Number(count); i += 1) {
  store.update(sessionId, agentId, (session) => ({ ...session, blocks: session.blocks + 1 }));
}
