import './loadEnv.js';
import { createApp } from './app.js';
import { purgeOldEvents } from './services/eventStore.js';

const app = createApp();
const PORT = process.env.PORT || 3001;

// Retention: drop events older than EVENT_RETENTION_DAYS (default 60) so the
// events table doesn't grow without bound. Min 1 day to never nuke the table.
const RETENTION_DAYS = Math.max(1, Number(process.env.EVENT_RETENTION_DAYS) || 60);
const DAY_MS = 24 * 60 * 60 * 1000;

function sweepOldEvents(): void {
  try {
    const removed = purgeOldEvents(RETENTION_DAYS);
    if (removed > 0) console.log(`[retention] purged ${removed} events older than ${RETENTION_DAYS}d`);
  } catch (err) {
    console.error('[retention] sweep failed:', err);
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Integration Health Dashboard API running on port ${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api`);
  if (process.env.NODE_ENV !== 'production') {
    console.log(`   Frontend: http://localhost:5173 (run 'npm run dev:web' separately)`);
  }
  sweepOldEvents(); // once on boot
  setInterval(sweepOldEvents, DAY_MS).unref(); // then daily; unref so it never holds the process open
});
