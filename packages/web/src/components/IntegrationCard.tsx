import type { Integration } from '../types';
import { Sparkline } from './Sparkline';

interface IntegrationCardProps {
  integration: Integration;
  onClick?: () => void;
  /** Recent metric series (oldest→newest) keyed by metric name, for trend sparklines. */
  metrics?: Record<string, number[]>;
}

// Friendly labels for the metrics integrations emit; unknown keys fall back to
// a camelCase split (e.g. "someMetric" -> "Some metric").
const METRIC_LABELS: Record<string, string> = {
  latencyMs: 'Latency',
  itemCount: 'Items',
  tempF: 'Temp °F',
  alertCount: 'Alerts',
  totalAmount: 'Total',
  maxContribution: 'Max contrib.',
  topStoriesCount: 'Top stories',
  mostViewedCount: 'Most viewed',
  newEntries: 'New entries',
  topWeeksOnList: 'Top weeks',
};

function metricLabel(key: string): string {
  if (METRIC_LABELS[key]) return METRIC_LABELS[key];
  const spaced = key.replace(/([A-Z])/g, ' $1').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function formatMetric(key: string, v: number): string {
  if (key.endsWith('Ms')) return `${Math.round(v)} ms`;
  if (/amount|contribution/i.test(key)) return `$${Math.round(v).toLocaleString()}`;
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1);
}

const statusColors = {
  healthy: 'bg-green-100 text-green-800 border-green-200',
  degraded: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  down: 'bg-red-100 text-red-800 border-red-200',
};

const statusDots = {
  healthy: 'bg-green-500',
  degraded: 'bg-yellow-500',
  down: 'bg-red-500',
};

export function IntegrationCard({ integration, onClick, metrics }: IntegrationCardProps) {
  const timeAgo = integration.lastSync
    ? formatTimeAgo(new Date(integration.lastSync))
    : 'Never';
  // Metrics with at least one value, latencyMs pinned first for continuity, rest alphabetical.
  const metricEntries = Object.entries(metrics ?? {})
    .filter(([, values]) => values.length > 0)
    .sort(([a], [b]) => (a === 'latencyMs' ? -1 : b === 'latencyMs' ? 1 : a.localeCompare(b)));

  return (
    <div
      onClick={onClick}
      className={`p-3 sm:p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
        statusColors[integration.status]
      }`}
    >
      <div className="flex items-center justify-between mb-1.5 sm:mb-2">
        <h3 className="font-semibold text-base sm:text-lg">{integration.id}</h3>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <span
            className={`w-2 h-2 rounded-full ${statusDots[integration.status]}`}
          />
          <span className="text-xs sm:text-sm capitalize">{integration.status}</span>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-1.5 sm:gap-2 text-xs sm:text-sm">
        <div>
          <div className="opacity-60">Success</div>
          <div className="font-medium">
            {integration.successRate === null ? '—' : `${integration.successRate}%`}
          </div>
        </div>
        <div>
          <div className="opacity-60">Events</div>
          <div className="font-medium">{integration.eventsLast24h}</div>
        </div>
        <div>
          <div className="opacity-60">Last Sync</div>
          <div className="font-medium">{timeAgo}</div>
        </div>
      </div>

      {metricEntries.length > 0 && (
        <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-current border-opacity-20 space-y-1.5">
          {metricEntries.map(([key, values]) => (
            <div key={key} className="flex items-end justify-between gap-2">
              <div className="min-w-0">
                <div className="opacity-60 text-xs truncate">{metricLabel(key)}</div>
                <div className="font-medium text-xs sm:text-sm">
                  {formatMetric(key, values[values.length - 1])}
                </div>
              </div>
              <Sparkline values={values} />
            </div>
          ))}
        </div>
      )}

      {integration.stale && (
        <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-current border-opacity-20">
          <span className="text-xs sm:text-sm font-medium">
            Not reporting
            {integration.expectedIntervalMs !== null &&
              ` — normally every ${formatDuration(integration.expectedIntervalMs)}`}
          </span>
        </div>
      )}

      {integration.errorsLast24h > 0 && (
        <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-current border-opacity-20">
          <span className="text-xs sm:text-sm font-medium">
            {integration.errorsLast24h} error{integration.errorsLast24h !== 1 ? 's' : ''} in 24h
          </span>
        </div>
      )}
    </div>
  );
}

/** Coarse duration for the cadence hint - "2m", "1h", "1d". */
function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m`;
  const hours = Math.round(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
