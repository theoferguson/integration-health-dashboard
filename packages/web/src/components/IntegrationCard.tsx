import type { Integration } from '../types';
import { Sparkline } from './Sparkline';

interface IntegrationCardProps {
  integration: Integration;
  onClick?: () => void;
  /** Recent refresh latencies (ms), oldest→newest, for a trend sparkline. */
  latencies?: number[];
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

export function IntegrationCard({ integration, onClick, latencies }: IntegrationCardProps) {
  const timeAgo = integration.lastSync
    ? formatTimeAgo(new Date(integration.lastSync))
    : 'Never';
  const latestLatency = latencies && latencies.length > 0 ? latencies[latencies.length - 1] : null;

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
          <div className="font-medium">{integration.successRate}%</div>
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

      {latestLatency !== null && (
        <div className="mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-current border-opacity-20 flex items-end justify-between">
          <div>
            <div className="opacity-60 text-xs">Latency</div>
            <div className="font-medium text-xs sm:text-sm">{Math.round(latestLatency)} ms</div>
          </div>
          {latencies && <Sparkline values={latencies} />}
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

function formatTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
