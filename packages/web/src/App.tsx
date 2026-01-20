/**
 * Integration Health Dashboard
 * Main application component
 */

import { useState, useCallback } from 'react';
import {
  Dashboard,
  IntegrationCard,
  EventStream,
  EventsView,
  ErrorTriage,
  DataSyncDashboard,
} from './components';
import { useHealthData, useSyncData, useSimulation } from './hooks';
import type { IntegrationEvent } from './types';

type TabType = 'integrations' | 'events' | 'sync';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('integrations');
  const [filter, setFilter] = useState<'all' | 'failures'>('all');
  const [selectedEvent, setSelectedEvent] = useState<IntegrationEvent | null>(null);

  // Custom hooks for data management
  const {
    health,
    integrations,
    events,
    errorStats,
    isLoading,
    error: healthError,
    refresh: refreshHealth,
    updateEvent,
  } = useHealthData({ filter });

  const {
    syncOverview,
    refresh: refreshSync,
    refreshKey: syncRefreshKey,
    incrementRefreshKey: incrementSyncRefreshKey,
  } = useSyncData(activeTab === 'sync');

  const { isSimulating, error: simError, runSimulation } = useSimulation();

  const error = healthError || simError;

  // Handle event updates from triage modal
  const handleEventUpdated = useCallback((updatedEvent: IntegrationEvent) => {
    updateEvent(updatedEvent);
    setSelectedEvent(updatedEvent);
  }, [updateEvent]);

  // Handle simulation with refresh callbacks
  const handleRunSimulation = useCallback(async () => {
    await runSimulation({
      onComplete: refreshHealth,
      onSyncComplete: async () => {
        if (activeTab === 'sync') {
          await refreshSync();
          incrementSyncRefreshKey();
        }
      },
    });
  }, [runSimulation, refreshHealth, refreshSync, incrementSyncRefreshKey, activeTab]);

  // Handle refresh button click
  const handleRefresh = useCallback(() => {
    if (activeTab === 'integrations') {
      refreshHealth();
    } else {
      refreshSync();
      incrementSyncRefreshKey();
    }
  }, [activeTab, refreshHealth, refreshSync, incrementSyncRefreshKey]);

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
                onClick={handleRunSimulation}
                disabled={isSimulating}
                className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSimulating ? 'Simulating...' : 'Run Demo'}
              </button>
              <button
                onClick={handleRefresh}
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
            <TabButton
              active={activeTab === 'integrations'}
              onClick={() => setActiveTab('integrations')}
            >
              Integrations
            </TabButton>
            <TabButton
              active={activeTab === 'sync'}
              onClick={() => setActiveTab('sync')}
              badge={syncOverview && (syncOverview.failingInstances > 0 || syncOverview.staleInstances > 0)
                ? {
                    count: syncOverview.failingInstances + syncOverview.staleInstances,
                    variant: syncOverview.failingInstances > 0 ? 'error' : 'warning',
                  }
                : undefined
              }
            >
              Data Sync
            </TabButton>
            <TabButton
              active={activeTab === 'events'}
              onClick={() => setActiveTab('events')}
            >
              All Events
            </TabButton>
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
                  <FilterButton
                    active={filter === 'all'}
                    onClick={() => setFilter('all')}
                    variant="default"
                  >
                    All
                  </FilterButton>
                  <FilterButton
                    active={filter === 'failures'}
                    onClick={() => setFilter('failures')}
                    variant="error"
                  >
                    Failures Only
                  </FilterButton>
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
            onRefresh={refreshSync}
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

// ============ Helper Components ============

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  badge?: { count: number; variant: 'error' | 'warning' };
}

function TabButton({ active, onClick, children, badge }: TabButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium rounded-t-lg border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-blue-600 text-blue-600 bg-blue-50'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
    >
      {children}
      {badge && (
        <span
          className={`ml-1 sm:ml-2 px-1.5 py-0.5 text-xs rounded-full ${
            badge.variant === 'error'
              ? 'bg-red-100 text-red-600'
              : 'bg-yellow-100 text-yellow-600'
          }`}
        >
          {badge.count}
        </span>
      )}
    </button>
  );
}

interface FilterButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  variant: 'default' | 'error';
}

function FilterButton({ active, onClick, children, variant }: FilterButtonProps) {
  const activeClass = variant === 'error' ? 'bg-red-600 text-white' : 'bg-gray-900 text-white';
  const inactiveClass = 'bg-gray-100 text-gray-600 hover:bg-gray-200';

  return (
    <button
      onClick={onClick}
      className={`px-2 sm:px-3 py-1 text-xs sm:text-sm rounded-lg ${active ? activeClass : inactiveClass}`}
    >
      {children}
    </button>
  );
}

export default App;
