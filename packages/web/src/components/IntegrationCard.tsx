import type { Integration } from '../types';

interface IntegrationCardProps {
  integration: Integration;
  onClick?: () => void;
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

export function IntegrationCard({ integration, onClick }: IntegrationCardProps) {
  const timeAgo = integration.lastSync
    ? formatTimeAgo(new Date(integration.lastSync))
    : 'Never';

  return (
    <div
      onClick={onClick}
      className={`p-4 rounded-lg border cursor-pointer transition-all hover:shadow-md ${
        statusColors[integration.status]
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <h3 className="font-semibold text-lg">{integration.name}</h3>
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${statusDots[integration.status]}`}
          />
          <span className="text-sm capitalize">{integration.status}</span>
        </div>
      </div>

      <p className="text-sm opacity-75 mb-3">{integration.description}</p>

      <div className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <div className="opacity-60">Success Rate</div>
          <div className="font-medium">{integration.successRate}%</div>
        </div>
        <div>
          <div className="opacity-60">Events (24h)</div>
          <div className="font-medium">{integration.eventsLast24h}</div>
        </div>
        <div>
          <div className="opacity-60">Last Sync</div>
          <div className="font-medium">{timeAgo}</div>
        </div>
      </div>

      {integration.errorsLast24h > 0 && (
        <div className="mt-3 pt-3 border-t border-current border-opacity-20">
          <span className="text-sm font-medium">
            {integration.errorsLast24h} error{integration.errorsLast24h !== 1 ? 's' : ''} in last 24h
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
