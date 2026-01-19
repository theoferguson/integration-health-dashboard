import type { HealthOverview } from '../types';

export interface ErrorStats {
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
}

interface DashboardProps {
  health: HealthOverview;
  errorStats?: ErrorStats;
}

export function Dashboard({ health, errorStats }: DashboardProps) {
  return (
    <div className="space-y-4">
      {/* Integration Health */}
      <div className="grid grid-cols-4 gap-4">
        <StatCard
          label="Total Integrations"
          value={health.totalIntegrations}
          color="gray"
        />
        <StatCard
          label="Healthy"
          value={health.healthy}
          color="green"
          icon="✓"
        />
        <StatCard
          label="Degraded"
          value={health.degraded}
          color="yellow"
          icon="⚠"
        />
        <StatCard label="Down" value={health.down} color="red" icon="✕" />
      </div>

      {/* Error Resolution Stats */}
      {errorStats && errorStats.total > 0 && (
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Total Errors"
            value={errorStats.total}
            color="gray"
            subtitle="in recent events"
          />
          <StatCard
            label="Open"
            value={errorStats.open}
            color="red"
            icon="○"
            subtitle="needs attention"
          />
          <StatCard
            label="Acknowledged"
            value={errorStats.acknowledged}
            color="yellow"
            icon="●"
            subtitle="being worked on"
          />
          <StatCard
            label="Resolved"
            value={errorStats.resolved}
            color="green"
            icon="✓"
            subtitle={errorStats.total > 0 ? `${Math.round((errorStats.resolved / errorStats.total) * 100)}% resolution rate` : ''}
          />
        </div>
      )}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: number;
  color: 'gray' | 'green' | 'yellow' | 'red';
  icon?: string;
  subtitle?: string;
}

const colorClasses = {
  gray: 'bg-gray-100 border-gray-200',
  green: 'bg-green-100 border-green-200',
  yellow: 'bg-yellow-100 border-yellow-200',
  red: 'bg-red-100 border-red-200',
};

const textColors = {
  gray: 'text-gray-800',
  green: 'text-green-800',
  yellow: 'text-yellow-800',
  red: 'text-red-800',
};

function StatCard({ label, value, color, icon, subtitle }: StatCardProps) {
  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">{label}</span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <div className={`text-3xl font-bold mt-1 ${textColors[color]}`}>
        {value}
      </div>
      {subtitle && (
        <div className="text-xs text-gray-500 mt-1">{subtitle}</div>
      )}
    </div>
  );
}
