import { useState, useEffect, useCallback } from 'react';
import {
  fetchMonitors,
  createMonitorRequest,
  updateMonitorRequest,
  deleteMonitorRequest,
  fetchMonitorSeries,
  type MonitorSeriesResponse,
} from '../api/client';
import type { MonitorSummary, MonitorMatchSpec, MonitorPredicate, PredicateOp } from '../types';
import { MonitorGraph } from './MonitorGraph';

const OPS: PredicateOp[] = ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains', 'exists'];
const FIELD_SUGGESTIONS = [
  'severity',
  'environment',
  'metrics.latencyMs',
  'metrics.itemCount',
  'tags.region',
  'payload.tempF',
  'error.code',
];

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const WINDOWS = [
  { label: '24h', window: DAY, bucket: HOUR },
  { label: '7d', window: 7 * DAY, bucket: 6 * HOUR },
  { label: '30d', window: 30 * DAY, bucket: DAY },
];

/** One-line human summary of a match spec for the list view. */
function describeSpec(spec: MonitorMatchSpec): string {
  const parts: string[] = [];
  if (spec.integration) parts.push(spec.integration);
  if (spec.eventType) parts.push(`type=${spec.eventType}`);
  if (spec.status) parts.push(spec.status);
  for (const p of spec.predicates ?? []) {
    parts.push(p.op === 'exists' ? `${p.field} exists` : `${p.field} ${p.op} ${p.value}`);
  }
  return parts.length ? parts.join(' · ') : 'all events';
}

interface MonitorsPanelProps {
  loggedIn: boolean;
  isAdmin: boolean;
}

export function MonitorsPanel({ loggedIn, isAdmin }: MonitorsPanelProps) {
  const [monitors, setMonitors] = useState<MonitorSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      setMonitors(await fetchMonitors());
      setError(null);
    } catch {
      setError('Failed to load monitors');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) load();
  }, [loggedIn, load]);

  if (!loggedIn) {
    return (
      <div className="text-center py-12 bg-white rounded-lg border border-gray-200">
        <p className="text-gray-600 mb-4">Sign in to create and view monitors.</p>
        <a
          href="/api/auth/login"
          className="inline-block px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800"
        >
          Sign in with GitHub
        </a>
      </div>
    );
  }

  const handleToggle = async (m: MonitorSummary) => {
    try {
      await updateMonitorRequest(m.id, { enabled: !m.enabled });
      await load();
    } catch {
      setError('Failed to update monitor');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteMonitorRequest(id);
      if (expanded === id) setExpanded(null);
      await load();
    } catch {
      setError('Failed to delete monitor');
    }
  };

  return (
    <div className="space-y-6">
      {isAdmin ? (
        <CreateMonitorForm onCreated={load} onError={setError} />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 p-4 text-sm text-gray-500">
          You have viewer access. Only admins can create or edit monitors.
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700 text-sm">{error}</div>
      )}

      <div className="space-y-3">
        {isLoading ? (
          <div className="p-8 text-center text-gray-400 text-sm bg-white rounded-lg border border-gray-200">
            Loading…
          </div>
        ) : monitors.length === 0 ? (
          <div className="p-8 text-center text-gray-500 text-sm bg-white rounded-lg border border-gray-200">
            No monitors yet.{isAdmin ? ' Create one above.' : ''}
          </div>
        ) : (
          monitors.map((m) => (
            <MonitorRow
              key={m.id}
              monitor={m}
              isAdmin={isAdmin}
              expanded={expanded === m.id}
              onToggleExpand={() => setExpanded(expanded === m.id ? null : m.id)}
              onToggleEnabled={() => handleToggle(m)}
              onDelete={() => handleDelete(m.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ============ Monitor row (summary + expandable graph) ============

interface MonitorRowProps {
  monitor: MonitorSummary;
  isAdmin: boolean;
  expanded: boolean;
  onToggleExpand: () => void;
  onToggleEnabled: () => void;
  onDelete: () => void;
}

function MonitorRow({ monitor, isAdmin, expanded, onToggleExpand, onToggleEnabled, onDelete }: MonitorRowProps) {
  const [win, setWin] = useState(WINDOWS[1]);
  const [data, setData] = useState<MonitorSeriesResponse | null>(null);
  const [loadingGraph, setLoadingGraph] = useState(false);

  useEffect(() => {
    if (!expanded) return;
    let cancelled = false;
    setLoadingGraph(true);
    fetchMonitorSeries(monitor.id, { window: win.window, bucket: win.bucket })
      .then((d) => !cancelled && setData(d))
      .catch(() => !cancelled && setData(null))
      .finally(() => !cancelled && setLoadingGraph(false));
    return () => {
      cancelled = true;
    };
  }, [expanded, monitor.id, win]);

  return (
    <div className="bg-white rounded-lg border border-gray-200">
      <div className="flex items-center justify-between p-3 sm:p-4 gap-2">
        <button onClick={onToggleExpand} className="flex-1 text-left min-w-0">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${monitor.enabled ? 'bg-green-500' : 'bg-gray-300'}`} />
            <span className="font-medium text-gray-900 truncate">{monitor.name}</span>
            {monitor.matchesLast24h > 0 && (
              <span className="px-2 py-0.5 text-xs rounded-full bg-blue-50 text-blue-700 whitespace-nowrap">
                {monitor.matchesLast24h} in 24h
              </span>
            )}
          </div>
          <div className="text-xs text-gray-500 mt-0.5 truncate">{describeSpec(monitor.matchSpec)}</div>
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          {isAdmin && (
            <>
              <button
                onClick={onToggleEnabled}
                className="px-2.5 py-1 text-xs font-medium text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                {monitor.enabled ? 'Disable' : 'Enable'}
              </button>
              <button
                onClick={onDelete}
                className="px-2.5 py-1 text-xs text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
              >
                Delete
              </button>
            </>
          )}
          <button onClick={onToggleExpand} className="px-2 py-1 text-xs text-gray-400 hover:text-gray-600">
            {expanded ? '▲' : '▼'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 p-3 sm:p-4">
          <div className="flex gap-1 mb-3">
            {WINDOWS.map((w) => (
              <button
                key={w.label}
                onClick={() => setWin(w)}
                className={`px-2 py-1 text-xs rounded-lg ${
                  win.label === w.label ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {w.label}
              </button>
            ))}
          </div>
          {loadingGraph || !data ? (
            <div className="text-xs text-gray-400 py-8 text-center">Loading graph…</div>
          ) : (
            <MonitorGraph series={data.series} windowMs={data.windowMs} bucketMs={data.bucketMs} />
          )}
        </div>
      )}
    </div>
  );
}

// ============ Create form ============

interface CreateMonitorFormProps {
  onCreated: () => void;
  onError: (msg: string) => void;
}

function CreateMonitorForm({ onCreated, onError }: CreateMonitorFormProps) {
  const [name, setName] = useState('');
  const [integration, setIntegration] = useState('');
  const [eventType, setEventType] = useState('');
  const [status, setStatus] = useState('');
  const [predicates, setPredicates] = useState<MonitorPredicate[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const buildSpec = (): MonitorMatchSpec => {
    const spec: MonitorMatchSpec = {};
    if (integration.trim()) spec.integration = integration.trim();
    if (eventType.trim()) spec.eventType = eventType.trim();
    if (status) spec.status = status as MonitorMatchSpec['status'];
    const preds = predicates
      .filter((p) => p.field.trim())
      .map((p) => {
        const pred: MonitorPredicate = { field: p.field.trim(), op: p.op };
        // exists takes no value; coerce numeric-looking values so gt/lt compare as numbers.
        if (p.op !== 'exists') {
          const v = String(p.value ?? '').trim();
          pred.value = v !== '' && !Number.isNaN(Number(v)) ? Number(v) : v;
        }
        return pred;
      });
    if (preds.length) spec.predicates = preds;
    return spec;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      await createMonitorRequest(name.trim(), buildSpec());
      setName('');
      setIntegration('');
      setEventType('');
      setStatus('');
      setPredicates([]);
      onCreated();
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Failed to create monitor');
    } finally {
      setSubmitting(false);
    }
  };

  const updatePred = (i: number, patch: Partial<MonitorPredicate>) =>
    setPredicates((ps) => ps.map((p, idx) => (idx === i ? { ...p, ...patch } : p)));

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h2 className="text-base font-semibold text-gray-900">Create a monitor</h2>

      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Monitor name (e.g. Weather over 90°F)"
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <input
          type="text"
          value={integration}
          onChange={(e) => setIntegration(e.target.value)}
          placeholder="integration (any)"
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <input
          type="text"
          value={eventType}
          onChange={(e) => setEventType(e.target.value)}
          placeholder="event type (any)"
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">any status</option>
          <option value="success">success</option>
          <option value="failure">failure</option>
          <option value="pending">pending</option>
        </select>
      </div>

      {/* Predicate rows */}
      <div className="space-y-2">
        {predicates.map((p, i) => (
          <div key={i} className="flex gap-2 items-center">
            <input
              list="monitor-field-suggestions"
              value={p.field}
              onChange={(e) => updatePred(i, { field: e.target.value })}
              placeholder="field"
              className="flex-1 px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <select
              value={p.op}
              onChange={(e) => updatePred(i, { op: e.target.value as PredicateOp })}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {OPS.map((op) => (
                <option key={op} value={op}>
                  {op}
                </option>
              ))}
            </select>
            <input
              value={p.op === 'exists' ? '' : String(p.value ?? '')}
              onChange={(e) => updatePred(i, { value: e.target.value })}
              placeholder="value"
              disabled={p.op === 'exists'}
              className="w-24 px-2 py-1.5 border border-gray-300 rounded-lg text-sm disabled:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setPredicates((ps) => ps.filter((_, idx) => idx !== i))}
              className="px-2 py-1 text-gray-400 hover:text-red-600"
            >
              ✕
            </button>
          </div>
        ))}
        <datalist id="monitor-field-suggestions">
          {FIELD_SUGGESTIONS.map((f) => (
            <option key={f} value={f} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => setPredicates((ps) => [...ps, { field: '', op: 'eq', value: '' }])}
          className="text-xs text-blue-600 hover:text-blue-700"
        >
          + Add condition
        </button>
      </div>

      <button
        type="submit"
        disabled={submitting || !name.trim()}
        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? 'Creating…' : 'Create monitor'}
      </button>
    </form>
  );
}
