import { useEffect, useState, useCallback } from 'react';
import {
  Dashboard,
  IntegrationCard,
  EventStream,
  EventsView,
  ErrorTriage,
  DataSyncDashboard,
} from './components';
import {
  fetchHealth,
  fetchEvents,
  fetchSyncOverview,
  generateSyncData,
} from './api/client';
import type { Integration, IntegrationEvent, HealthOverview, SyncSystemOverview } from './types';
import type { ErrorStats } from './components/Dashboard';

const API_BASE = '/api';

type TabType = 'integrations' | 'events' | 'sync';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('integrations');
  const [health, setHealth] = useState<HealthOverview | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<IntegrationEvent | null>(null);
  const [filter, setFilter] = useState<'all' | 'failures'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Sync state
  const [syncOverview, setSyncOverview] = useState<SyncSystemOverview | null>(null);
  const [syncRefreshKey, setSyncRefreshKey] = useState(0);

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
    } catch {
      setError('Failed to load data. Is the API server running?');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  const loadSyncOverview = useCallback(async () => {
    try {
      const data = await fetchSyncOverview();
      setSyncOverview(data.overview);
    } catch {
      // No sync data yet - that's ok
      setSyncOverview(null);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Refresh every 5 seconds
    const interval = setInterval(loadData, 5000);
    return () => clearInterval(interval);
  }, [loadData]);

  useEffect(() => {
    if (activeTab === 'sync') {
      loadSyncOverview();
    }
  }, [activeTab, loadSyncOverview]);

  const handleEventUpdated = (updatedEvent: IntegrationEvent) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e))
    );
    setSelectedEvent(updatedEvent);
  };

  // Calculate error stats from events
  const errorStats: ErrorStats = events.reduce(
    (stats, event) => {
      if (event.status === 'failure') {
        stats.total++;
        const resolutionStatus = event.resolution?.status || 'open';
        if (resolutionStatus === 'open') stats.open++;
        else if (resolutionStatus === 'acknowledged') stats.acknowledged++;
        else if (resolutionStatus === 'resolved') stats.resolved++;
      }
      return stats;
    },
    { total: 0, open: 0, acknowledged: 0, resolved: 0 }
  );

  const runSimulation = async () => {
    setIsSimulating(true);
    try {
      await fetch(`${API_BASE}/simulate?reset=true`, { method: 'POST' });
      await generateSyncData(5, true);
      await loadData();
      if (activeTab === 'sync') {
        await loadSyncOverview();
        setSyncRefreshKey((k) => k + 1);
      }
    } catch {
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
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                Integration Health Dashboard
              </h1>
              <p className="text-xs sm:text-sm text-gray-500">
                Monitor integrations and track data sync status
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
              <button
                onClick={runSimulation}
                disabled={isSimulating}
                className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSimulating ? 'Simulating...' : 'Run Demo'}
              </button>
              <button
                onClick={activeTab === 'integrations' ? loadData : () => { loadSyncOverview(); setSyncRefreshKey((k) => k + 1); }}
                className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Refresh
              </button>
              <a
                href="https://github.com/theoferguson/integration-health-dashboard"
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-800"
              >
                Source
              </a>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-4 -mb-px overflow-x-auto">
            <button
              onClick={() => setActiveTab('integrations')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${activeTab === 'integrations'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Integrations
            </button>
            <button
              onClick={() => setActiveTab('sync')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${activeTab === 'sync'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              Data Sync
              {syncOverview && (syncOverview.failingInstances > 0 || syncOverview.staleInstances > 0) && (
                <span
                  className={`ml-1 sm:ml-2 px-1.5 py-0.5 text-xs rounded-full ${syncOverview.failingInstances > 0
                    ? 'bg-red-100 text-red-600'
                    : 'bg-yellow-100 text-yellow-600'
                    }`}
                >
                  {syncOverview.failingInstances + syncOverview.staleInstances}
                </span>
              )}
            </button>
            <button
              onClick={() => setActiveTab('events')}
              className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${activeTab === 'events'
                ? 'border-blue-600 text-blue-600 bg-blue-50'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                }`}
            >
              All Events
            </button>
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

        {activeTab === 'integrations' && (
          <>
            {/* Health Overview */}
            {health && (
              <section className="mb-6 sm:mb-8">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">System Health</h2>
                <Dashboard health={health} errorStats={errorStats} />
              </section>
            )}

            {/* Integrations Grid */}
            <section className="mb-8">
              <h2 className="text-base sm:text-lg font-semibold text-gray-900 mb-3 sm:mb-4">Integrations</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                {integrations.map((integration) => (
                  <IntegrationCard key={integration.id} integration={integration} />
                ))}
              </div>
            </section>

            {/* Event Stream */}
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 sm:gap-0 mb-3 sm:mb-4">
                <h2 className="text-base sm:text-lg font-semibold text-gray-900">Recent Events</h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setFilter('all')}
                    className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-lg ${filter === 'all'
                      ? 'bg-gray-900 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    All
                  </button>
                  <button
                    onClick={() => setFilter('failures')}
                    className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-lg ${filter === 'failures'
                      ? 'bg-red-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                  >
                    Failures Only
                  </button>
                </div>
              </div>
              <div className="bg-white rounded-lg border border-gray-200 p-3 sm:p-4">
                <EventStream events={events} onEventClick={setSelectedEvent} />
              </div>
            </section>
          </>
        )}

        {activeTab === 'events' && (
          <EventsView onEventClick={setSelectedEvent} />
        )}

        {activeTab === 'sync' && (
          <DataSyncDashboard
            key={syncRefreshKey}
            onRefresh={() => { loadSyncOverview(); }}
          />
        )}
      </main>

      {/* Error Triage Modal */}
      {selectedEvent && selectedEvent.status === 'failure' && (
        <ErrorTriage
          event={selectedEvent}
          onClose={() => setSelectedEvent(null)}
          onUpdated={handleEventUpdated}
        />
      )}

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-8 sm:mt-12 py-4 sm:py-6">
        <div className="max-w-7xl mx-auto px-4 text-center text-xs sm:text-sm text-gray-500">
          <p>
            Built by Theo Ferguson · AI-native integration monitoring
          </p>
          <p className="mt-1 hidden sm:block">
            Demonstrating full-stack TypeScript, AI-assisted error classification, data sync
            monitoring, and domain-aware design
          </p>
        </div>
      </footer>
    </div>
  );
}

export default App;
