/**
 * Integration Health Dashboard
 * Main application component
 */

import { useState, useCallback } from 'react';
import { Dashboard, IntegrationCard, EventStream, EventsView, ErrorTriage, ProjectsPanel } from './components';
import { useHealthData, useAuth } from './hooks';
import type { IntegrationEvent } from './types';

type TabType = 'integrations' | 'events' | 'projects';

function App() {
  const [activeTab, setActiveTab] = useState<TabType>('integrations');
  const [filter, setFilter] = useState<'all' | 'failures'>('all');
  const [selectedEvent, setSelectedEvent] = useState<IntegrationEvent | null>(null);
  const { auth, org, role, signOut, refresh: refreshAuth } = useAuth();

  // Custom hooks for data management
  const {
    health,
    integrations,
    events,
    errorStats,
    isLoading,
    error,
    refresh: refreshHealth,
    updateEvent,
  } = useHealthData({ filter });

  // Handle event updates from triage modal
  const handleEventUpdated = useCallback((updatedEvent: IntegrationEvent) => {
    updateEvent(updatedEvent);
    setSelectedEvent(updatedEvent);
  }, [updateEvent]);

  // Joining/switching org changes which events are visible - refetch health data
  // too, not just auth/org, so the dashboard doesn't show the old org's data.
  const handleOrgChange = useCallback(() => {
    refreshAuth();
    refreshHealth();
  }, [refreshAuth, refreshHealth]);

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
                Monitor integration health across any project reporting in
              </p>
            </div>
            <div className="flex items-center gap-2 sm:gap-3 flex-wrap sm:flex-nowrap">
              <button
                onClick={() => refreshHealth()}
                className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Refresh
              </button>
              {auth?.loggedIn ? (
                <button
                  onClick={signOut}
                  className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  {org ? `${org.name} · ` : ''}Signed in as {auth.login} · Sign out
                </button>
              ) : (
                <a
                  href="/api/auth/login"
                  className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                >
                  Sign in with GitHub
                </a>
              )}
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
              active={activeTab === 'events'}
              onClick={() => setActiveTab('events')}
            >
              All Events
            </TabButton>
            <TabButton
              active={activeTab === 'projects'}
              onClick={() => setActiveTab('projects')}
            >
              Projects
            </TabButton>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6">
        {error && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg text-amber-800">
            {error}
            {error.includes('API server') && (
              <p className="text-sm mt-1">
                Make sure the API is running: <code>npm run dev:api</code>
              </p>
            )}
            {!auth?.loggedIn && (
              <p className="mt-3">
                <a
                  href="/api/auth/login"
                  className="inline-block px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800"
                >
                  Sign in with GitHub
                </a>
              </p>
            )}
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
              {integrations.length === 0 ? (
                <div className="text-center py-8 text-gray-500 bg-white rounded-lg border border-gray-200">
                  No integrations have reported in yet.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                  {integrations.map((integration) => (
                    <IntegrationCard key={integration.id} integration={integration} />
                  ))}
                </div>
              )}
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

        {activeTab === 'projects' && (
          <ProjectsPanel
            loggedIn={auth?.loggedIn ?? false}
            role={role}
            org={org}
            onOrgChange={handleOrgChange}
          />
        )}
      </main>

      {/* Event detail / triage modal - opens for any event; triage tools show only for failures */}
      {selectedEvent && (
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
            Demonstrating full-stack TypeScript and AI-assisted error classification
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
}

function TabButton({ active, onClick, children }: TabButtonProps) {
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
