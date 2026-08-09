import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../db/connection.js';
import { createEvent } from '../eventStore.js';
import { createProject } from '../projectStore.js';
import { getMonitorSeries } from '../monitorStore.js';

const HOUR = 60 * 60 * 1000;
const ORG_ID = 'org-series-test';

/**
 * Bucket keys must land on bucket boundaries, because the graph densifies the
 * sparse series by generating aligned keys and looking each one up exactly.
 *
 * The bug this covers: `(timestamp / ?) * ?` looked like integer division, but
 * better-sqlite3 binds a JS number as REAL, so it was float division that
 * returned each event's own timestamp unchanged. Nothing aggregated, no key
 * matched, and every monitor graph rendered "no matching events" while the
 * 24h count beside it - a plain COUNT with no bucket math - said otherwise.
 */
describe('getMonitorSeries', () => {
  beforeAll(() => {
    db.prepare('DELETE FROM events').run();
    db.prepare('INSERT OR IGNORE INTO orgs (id, name, invite_code, created_at) VALUES (?, ?, ?, ?)').run(
      ORG_ID,
      'series-test-org',
      `invite-${ORG_ID}`,
      Date.now()
    );
    const project = createProject('series-test', ORG_ID);

    // Three events inside one hour, one in a different hour.
    const base = Date.UTC(2026, 7, 9, 6, 0, 0);
    const offsets = [0, 5 * 60_000, 47 * 60_000, HOUR + 12 * 60_000];
    for (const offset of offsets) {
      const event = createEvent({
        projectId: project.id,
        integration: 'nyc-civic-finance',
        eventType: 'refresh',
        status: 'success',
        payload: {},
      });
      db.prepare('UPDATE events SET timestamp = ? WHERE id = ?').run(base + offset, event.id);
    }
  });

  it('aligns buckets to boundaries and aggregates events within one', () => {
    // Window reaching back past the seeded timestamps.
    const windowMs = Date.now() - Date.UTC(2026, 7, 9, 0, 0, 0);
    const series = getMonitorSeries(ORG_ID, { integration: 'nyc-civic-finance' }, windowMs, HOUR);

    expect(series).toHaveLength(2); // two distinct hours, not four events
    for (const point of series) {
      expect(point.bucket % HOUR).toBe(0);
    }
    expect(series[0].count).toBe(3);
    expect(series[1].count).toBe(1);
    expect(series[1].bucket - series[0].bucket).toBe(HOUR);
  });

  it('produces keys the graph can look up by generating aligned buckets', () => {
    const windowMs = Date.now() - Date.UTC(2026, 7, 9, 0, 0, 0);
    const series = getMonitorSeries(ORG_ID, { integration: 'nyc-civic-finance' }, windowMs, HOUR);

    // Exactly what MonitorGraph does: walk aligned buckets, look each one up.
    const counts = new Map(series.map((p) => [p.bucket, p.count]));
    const now = Date.now();
    const start = Math.floor((now - windowMs) / HOUR) * HOUR;
    let total = 0;
    for (let t = start; t <= now; t += HOUR) total += counts.get(t) ?? 0;

    expect(total).toBe(4); // every seeded event found a home
  });
});
