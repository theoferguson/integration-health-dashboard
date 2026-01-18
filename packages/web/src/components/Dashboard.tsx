import type { HealthOverview } from '../types';

interface DashboardProps {
  health: HealthOverview;
}

export function Dashboard({ health }: DashboardProps) {
  return (
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
  );
}

interface StatCardProps {
  label: string;
  value: number;
  color: 'gray' | 'green' | 'yellow' | 'red';
  icon?: string;
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

function StatCard({ label, value, color, icon }: StatCardProps) {
  return (
    <div className={`p-4 rounded-lg border ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-600">{label}</span>
        {icon && <span className="text-lg">{icon}</span>}
      </div>
      <div className={`text-3xl font-bold mt-1 ${textColors[color]}`}>
        {value}
      </div>
    </div>
  );
}
