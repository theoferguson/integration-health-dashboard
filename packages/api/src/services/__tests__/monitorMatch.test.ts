import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../../db/connection.js';
import { createEvent } from '../eventStore.js';
import { buildMatchClause, validateMatchSpec } from '../monitorMatch.js';
import type { MonitorMatchSpec } from '../../types/index.js';

/** Count events matching a spec, exercising the exact SQL buildMatchClause emits. */
function count(spec: MonitorMatchSpec): number {
  const { clause, params } = buildMatchClause(spec);
  const row = db
    .prepare(`SELECT COUNT(*) as c FROM events WHERE (${clause})`)
    .get(...params) as { c: number };
  return row.c;
}

describe('monitor match engine', () => {
  beforeAll(() => {
    db.prepare('DELETE FROM events').run();
    createEvent({
      integration: 'weather',
      eventType: 'refresh',
      status: 'success',
      payload: { tempF: 95 },
      metrics: { tempF: 95 },
      tags: { region: 'us-east' },
      severity: 'low',
    });
    createEvent({
      integration: 'weather',
      eventType: 'refresh',
      status: 'success',
      payload: {},
      metrics: { tempF: 60 },
      severity: 'high',
    });
    createEvent({
      integration: 'nyt-news',
      eventType: 'refresh',
      status: 'failure',
      payload: {},
      error: { message: 'boom', code: 'E_RATE_LIMIT' },
      severity: 'critical',
    });
  });

  it('matches everything for an empty spec', () => {
    expect(count({})).toBe(3);
  });

  it('filters by top-level fields', () => {
    expect(count({ integration: 'weather' })).toBe(2);
    expect(count({ status: 'failure' })).toBe(1);
  });

  it('numeric predicate on a metric', () => {
    expect(count({ predicates: [{ field: 'metrics.tempF', op: 'gt', value: 90 }] })).toBe(1);
    expect(count({ predicates: [{ field: 'metrics.tempF', op: 'lte', value: 90 }] })).toBe(1);
  });

  it('severity compares by ordinal, not lexically', () => {
    // low < medium < high < critical, so >= high matches high + critical.
    expect(count({ predicates: [{ field: 'severity', op: 'gte', value: 'high' }] })).toBe(2);
  });

  it('tag equality and error substring', () => {
    expect(count({ predicates: [{ field: 'tags.region', op: 'eq', value: 'us-east' }] })).toBe(1);
    expect(count({ predicates: [{ field: 'error.code', op: 'contains', value: 'RATE' }] })).toBe(1);
  });

  it('exists checks presence', () => {
    expect(count({ predicates: [{ field: 'tags.region', op: 'exists' }] })).toBe(1);
  });

  it('ANDs all conditions', () => {
    expect(
      count({
        integration: 'weather',
        predicates: [{ field: 'metrics.tempF', op: 'gt', value: 90 }],
      })
    ).toBe(1);
  });

  it('rejects unknown fields and ops at the validation boundary', () => {
    expect(validateMatchSpec({ predicates: [{ field: 'nope', op: 'eq', value: 1 }] }).ok).toBe(false);
    expect(validateMatchSpec({ predicates: [{ field: 'status', op: 'bogus' }] }).ok).toBe(false);
    expect(validateMatchSpec({ status: 'weird' }).ok).toBe(false);
    expect(validateMatchSpec({ integration: 'weather' }).ok).toBe(true);
  });
});
