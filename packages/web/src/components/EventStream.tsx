import type { IntegrationEvent } from '../types';

interface EventStreamProps {
  events: IntegrationEvent[];
  onEventClick: (event: IntegrationEvent) => void;
}

const integrationLabels: Record<string, string> = {
  procore: 'Procore',
  gusto: 'Gusto',
  quickbooks: 'QuickBooks',
  stripe_issuing: 'Stripe',
  certified_payroll: 'Cert Payroll',
};

export function EventStream({ events, onEventClick }: EventStreamProps) {
  if (events.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <p>No events yet.</p>
        <p className="text-sm mt-2">
          Run the simulator to generate integration events.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((event) => (
        <div
          key={event.id}
          onClick={() => onEventClick(event)}
          className={`p-3 rounded border cursor-pointer transition-all hover:shadow-sm ${
            event.status === 'failure'
              ? 'bg-red-50 border-red-200 hover:bg-red-100'
              : 'bg-white border-gray-200 hover:bg-gray-50'
          }`}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full ${
                  event.status === 'failure' ? 'bg-red-500' : 'bg-green-500'
                }`}
              />
              <span className="font-medium text-sm">
                {integrationLabels[event.integration] || event.integration}
              </span>
              <span className="text-gray-400">·</span>
              <span className="text-sm text-gray-600">{event.eventType}</span>
            </div>
            <span className="text-xs text-gray-400">
              {formatTime(new Date(event.timestamp))}
            </span>
          </div>

          {event.status === 'failure' && event.error && (
            <div className="mt-2 text-sm text-red-700 truncate">
              {event.error.message}
            </div>
          )}

          {event.classification && (
            <div className="mt-2 flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded ${
                  severityColors[event.classification.severity]
                }`}
              >
                {event.classification.severity}
              </span>
              <span className="text-xs text-gray-500">
                {event.classification.category.replace('_', ' ')}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

const severityColors: Record<string, string> = {
  low: 'bg-blue-100 text-blue-700',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  critical: 'bg-red-100 text-red-700',
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
