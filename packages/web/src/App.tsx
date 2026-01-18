import { useEffect, useState, useCallback } from 'react';
import { Dashboard, IntegrationCard, EventStream, ErrorTriage } from './components';
import { fetchHealth, fetchEvents } from './api/client';
import type { Integration, IntegrationEvent, HealthOverview } from './types';

const API_BASE = '/api';

function App() {
  const [health, setHealth] = useState<HealthOverview | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<IntegrationEvent | null>(null);
  const [filter, setFilter] = useState<'all' | 'failures'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [healthData, eventsData] = await Promise.all([
        fetchHealth(),
        fetchEvents({
          status: filter === 'failures' ? 'failure' : undefined,
          limit: 50,
        }),
      ]);

      setHealth(healthData.health);
      setIntegrations(healthData.integrations);
      setEvents(eventsData);
      setError(null);
    } catch (err) {
      setError('Failed to load data. Is the API server running?');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    loadData();
    // Refresh every 5 seconds
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleEventClassified = (updatedEvent: IntegrationEvent) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e))
    );
    setSelectedEvent(updatedEvent);
  };

  const runSimulation = async () => {
    setIsSimulating(true);
    try {
      await fetch(`${API_BASE}/simulate?reset=true`, { method: 'POST' });
      await loadData();
    } catch (err) {
      setError('Failed to run simulation');
    } finally {
      setIsSimulating(false);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                Integration Health Dashboard
              </h1>
              <p className="text-sm text-gray-500">
                Monitor and triage third-party integration issues
              </p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={runSimulation}
                disabled={isSimulating}
                className="px-4 py-2 text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSimulating ? 'Simulating...' : 'Run Demo'}
              </button>
              <button
                onClick={loadData}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Refresh
              </button>
              <a
                href="https://github.com/theoferguson/integration-health-dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-800"
              >
                View Source
              </a>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
            {error}
            <p className="text-sm mt-1">
              Make sure the API is running: <code>npm run dev:api</code>
            </p>
          </div>
        )}

        {/* Health Overview */}
        {health && (
          <section className="mb-8">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">
              System Health
            </h2>
            <Dashboard health={health} />
          </section>
        )}

        {/* Integrations Grid */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Integrations
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {integrations.map((integration) => (
              <IntegrationCard
                key={integration.id}
                integration={integration}
              />
            ))}
          </div>
        </section>

        {/* Event Stream */}
        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">
              Recent Events
            </h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setFilter('all')}
                className={`px-3 py-1 text-sm rounded-lg ${
                  filter === 'all'
                    ? 'bg-gray-900 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                All
              </button>
              <button
                onClick={() => setFilter('failures')}
                className={`px-3 py-1 text-sm rounded-lg ${
                  filter === 'failures'
                    ? 'bg-red-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                Failures Only
              </button>
            </div>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <EventStream events={events} onEventClick={setSelectedEvent} />
          </div>
        </section>
      </main>

      {/* Error Triage Modal */}
      {selectedEvent && selectedEvent.status === 'failure' && (
        <ErrorTriage
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onClassified={handleEventClassified}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12 py-6">
        <div className="max-w-7xl mx-auto px-4 text-center text-sm text-gray-500">
          <p>
            Built by Theo Ferguson · AI-native integration monitoring for
            construction software
          </p>
          <p className="mt-1">
            Demonstrating full-stack TypeScript, AI-assisted error classification,
            and domain-aware design
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
