/**
 * Monitor match engine
 * Translates a MonitorMatchSpec into a SQL WHERE fragment over the `events`
 * table. Field paths and json keys are whitelisted / bound as parameters, so an
 * admin-authored spec can never inject SQL.
 */

import type { MonitorMatchSpec, MonitorPredicate, PredicateOp } from '../types/index.js';

// Top-level event columns a predicate may target (field name -> SQL column).
const TOP_LEVEL: Record<string, string> = {
  status: 'status',
  environment: 'environment',
  integration: 'integration',
  eventType: 'event_type',
  severity: 'severity',
};
// JSON columns a `<namespace>.<key>` field may index into.
const JSON_COLUMNS = new Set(['metrics', 'tags', 'payload', 'error']);

const NUMERIC_OPS = new Set<PredicateOp>(['gt', 'gte', 'lt', 'lte']);
const NUMERIC_SQL: Record<string, string> = { gt: '>', gte: '>=', lt: '<', lte: '<=' };
const ALL_OPS = new Set<PredicateOp>(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists']);

// severity is ordinal for comparison ops: low < medium < high < critical.
const SEVERITY_ORDER = ['low', 'medium', 'high', 'critical'];
const SEVERITY_CASE = `CASE severity ${SEVERITY_ORDER.map((s, i) => `WHEN '${s}' THEN ${i}`).join(
  ' '
)} ELSE -1 END`;

/** Resolve a field path to a SQL expression, binding json paths as parameters. */
function fieldExpr(field: string): { sql: string; params: unknown[] } {
  if (field in TOP_LEVEL) return { sql: TOP_LEVEL[field], params: [] };

  const dot = field.indexOf('.');
  const ns = dot === -1 ? '' : field.slice(0, dot);
  const key = dot === -1 ? '' : field.slice(dot + 1);
  if (!JSON_COLUMNS.has(ns) || !key) throw new Error(`Unknown field: ${field}`);
  // json path is bound, not interpolated -> injection-safe.
  return { sql: `json_extract(${ns}, ?)`, params: [`$.${key}`] };
}

function predicateSql(pred: MonitorPredicate): { sql: string; params: unknown[] } {
  const { field, op, value } = pred;
  if (!ALL_OPS.has(op)) throw new Error(`Unknown op: ${op}`);
  const f = fieldExpr(field);

  if (op === 'exists') return { sql: `${f.sql} IS NOT NULL`, params: f.params };

  if (value === undefined || value === null) throw new Error(`op '${op}' requires a value`);

  // severity comparison uses the enum ordinal, not lexical order.
  if (field === 'severity' && NUMERIC_OPS.has(op)) {
    const idx = SEVERITY_ORDER.indexOf(String(value));
    if (idx === -1) throw new Error(`severity must be one of ${SEVERITY_ORDER.join(', ')}`);
    return { sql: `${SEVERITY_CASE} ${NUMERIC_SQL[op]} ?`, params: [idx] };
  }

  if (NUMERIC_OPS.has(op)) {
    const num = Number(value);
    if (!Number.isFinite(num)) throw new Error(`op '${op}' requires a numeric value`);
    return { sql: `CAST(${f.sql} AS REAL) ${NUMERIC_SQL[op]} ?`, params: [...f.params, num] };
  }

  if (op === 'contains') return { sql: `${f.sql} LIKE ?`, params: [...f.params, `%${value}%`] };

  // eq / ne, compared as text.
  return { sql: `${f.sql} ${op === 'eq' ? '=' : '!='} ?`, params: [...f.params, value] };
}

/**
 * Build the WHERE body (without the `WHERE` keyword) and params for a match spec.
 * Returns `1=1` for an empty spec (matches every event). Throws on an invalid
 * field/op/value - callers at the trust boundary should validate first.
 */
export function buildMatchClause(spec: MonitorMatchSpec): { clause: string; params: unknown[] } {
  const conds: string[] = [];
  const params: unknown[] = [];

  if (spec.integration) {
    conds.push('integration = ?');
    params.push(spec.integration);
  }
  if (spec.eventType) {
    conds.push('event_type = ?');
    params.push(spec.eventType);
  }
  if (spec.status) {
    conds.push('status = ?');
    params.push(spec.status);
  }
  for (const pred of spec.predicates ?? []) {
    const { sql, params: p } = predicateSql(pred);
    conds.push(sql);
    params.push(...p);
  }

  return { clause: conds.length ? conds.join(' AND ') : '1=1', params };
}

/**
 * Structural + semantic validation of an untrusted match spec (create/update
 * boundary). Attempts to compile it so bad field/op/value are caught here.
 */
export function validateMatchSpec(
  raw: unknown
): { ok: true; spec: MonitorMatchSpec } | { ok: false; message: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, message: 'matchSpec must be an object' };
  }
  const r = raw as Record<string, unknown>;
  const spec: MonitorMatchSpec = {};

  for (const k of ['integration', 'eventType'] as const) {
    if (r[k] !== undefined) {
      if (typeof r[k] !== 'string') return { ok: false, message: `${k} must be a string` };
      spec[k] = r[k] as string;
    }
  }
  if (r.status !== undefined) {
    if (r.status !== 'success' && r.status !== 'failure' && r.status !== 'pending') {
      return { ok: false, message: 'status must be success, failure, or pending' };
    }
    spec.status = r.status;
  }
  if (r.predicates !== undefined) {
    if (!Array.isArray(r.predicates)) return { ok: false, message: 'predicates must be an array' };
    const preds: MonitorPredicate[] = [];
    for (const p of r.predicates) {
      if (typeof p !== 'object' || p === null) {
        return { ok: false, message: 'each predicate must be an object' };
      }
      const pp = p as Record<string, unknown>;
      if (typeof pp.field !== 'string' || !pp.field) {
        return { ok: false, message: 'predicate.field is required' };
      }
      if (typeof pp.op !== 'string') return { ok: false, message: 'predicate.op is required' };
      const pred: MonitorPredicate = { field: pp.field, op: pp.op as PredicateOp };
      if (pp.value !== undefined) {
        if (typeof pp.value !== 'string' && typeof pp.value !== 'number') {
          return { ok: false, message: 'predicate.value must be a string or number' };
        }
        pred.value = pp.value;
      }
      preds.push(pred);
    }
    spec.predicates = preds;
  }

  try {
    buildMatchClause(spec);
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  return { ok: true, spec };
}
