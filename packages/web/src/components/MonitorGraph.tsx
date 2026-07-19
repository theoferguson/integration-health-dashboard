import type { MonitorSeriesPoint } from '../types';

interface MonitorGraphProps {
  series: MonitorSeriesPoint[];
  windowMs: number;
  bucketMs: number;
}

/** Bar chart of matching-event counts over time. Series omits empty buckets; we densify. */
export function MonitorGraph({ series, windowMs, bucketMs }: MonitorGraphProps) {
  const now = Date.now();
  const start = Math.floor((now - windowMs) / bucketMs) * bucketMs;
  const counts = new Map(series.map((p) => [p.bucket, p.count]));
  const buckets: { t: number; count: number }[] = [];
  for (let t = start; t <= now; t += bucketMs) buckets.push({ t, count: counts.get(t) ?? 0 });

  const max = Math.max(1, ...buckets.map((b) => b.count));
  const total = buckets.reduce((s, b) => s + b.count, 0);

  if (total === 0) {
    return (
      <div className="text-xs text-gray-400 py-8 text-center bg-gray-50 rounded-lg">
        No matching events in this window.
      </div>
    );
  }

  const fmt = (t: number) =>
    new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' });

  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1">
        <span>{total} matching event{total !== 1 ? 's' : ''}</span>
        <span>peak {max}/bucket</span>
      </div>
      <div className="flex items-end gap-px h-24 bg-gray-50 rounded-lg p-2">
        {buckets.map((b, i) => (
          <div
            key={i}
            className="flex-1 bg-blue-500/70 hover:bg-blue-600 rounded-sm min-h-[1px] transition-colors"
            style={{ height: `${(b.count / max) * 100}%` }}
            title={`${fmt(b.t)} — ${b.count} event${b.count !== 1 ? 's' : ''}`}
          />
        ))}
      </div>
      <div className="flex justify-between text-[10px] text-gray-400 mt-1">
        <span>{fmt(buckets[0].t)}</span>
        <span>{fmt(buckets[buckets.length - 1].t)}</span>
      </div>
    </div>
  );
}
