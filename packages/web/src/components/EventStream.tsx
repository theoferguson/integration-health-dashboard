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
          className={`p-2 sm:p-3 rounded border cursor-pointer transition-all hover:shadow-sm ${
            event.status === 'failure'
              ? 'bg-red-50 border-red-200 hover:bg-red-100'
              : 'bg-white border-gray-200 hover:bg-gray-50'
          }`}
        >
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 sm:gap-2">
            <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
              <span
                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                  event.status === 'failure' ? 'bg-red-500' : 'bg-green-500'
                }`}
              />
              <span className="font-medium text-xs sm:text-sm">
                {integrationLabels[event.integration] || event.integration}
              </span>
              <span className="text-gray-400 hidden sm:inline">·</span>
              <span className="text-xs sm:text-sm text-gray-600">{event.eventType}</span>
            </div>
            <span className="text-xs text-gray-400 ml-3.5 sm:ml-0">
              {formatTime(new Date(event.timestamp))}
            </span>
          </div>

          {event.status === 'failure' && event.error && (
            <div className="mt-1.5 sm:mt-2 text-xs sm:text-sm text-red-700 truncate">
              {event.error.message}
            </div>
          )}

          {(event.classification || event.resolution) && (
            <div className="mt-1.5 sm:mt-2 flex items-center gap-1.5 sm:gap-2 flex-wrap">
              {event.classification && (
                <>
                  <span
                    className={`text-xs px-1.5 sm:px-2 py-0.5 rounded ${
                      severityColors[event.classification.severity]
                    }`}
                  >
                    {event.classification.severity}
                  </span>
                  <span className="text-xs text-gray-500 hidden sm:inline">
                    {event.classification.category.replace('_', ' ')}
                  </span>
                </>
              )}
              {event.resolution && (
                <span
                  className={`text-xs px-1.5 sm:px-2 py-0.5 rounded ${
                    resolutionColors[event.resolution.status]
                  }`}
                >
                  {event.resolution.status === 'resolved' ? '✓ Resolved' :
                   event.resolution.status === 'acknowledged' ? '● Ack' : '○ Open'}
                </span>
              )}
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

const resolutionColors: Record<string, string> = {
  open: 'bg-red-100 text-red-700',
  acknowledged: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
};

function formatTime(date: Date): string {
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}
