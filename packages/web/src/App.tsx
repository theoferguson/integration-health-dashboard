/**
 * Integration Health Dashboard
 * Main application component
 */

import { useState, useCallback, useMemo } from 'react';
import { Dashboard, IntegrationCard, EventStream, EventsView, ErrorTriage, ProjectsPanel, MonitorsPanel } from './components';
import { useHealthData, useAuth } from './hooks';
import { passwordAuthRequest } from './api/client';
import type { IntegrationEvent } from './types';

type TabType = 'integrations' | 'events' | 'monitors' | 'projects';

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

  // Per-integration metric series (oldest→newest) from recent events' metrics,
  // for trend sparklines on each card. Events arrive newest-first, so reverse.
  // Shape: { [integration]: { [metricName]: number[] } }.
  const metricsByIntegration = useMemo(() => {
    const map: Record<string, Record<string, number[]>> = {};
    for (const ev of [...events].reverse()) {
      if (!ev.metrics) continue;
      const perMetric = (map[ev.integration] ??= {});
      for (const [key, value] of Object.entries(ev.metrics)) {
        if (typeof value === 'number') (perMetric[key] ??= []).push(value);
      }
    }
    return map;
  }, [events]);

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
                <SignInButtons />
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
              active={activeTab === 'monitors'}
              onClick={() => setActiveTab('monitors')}
            >
              Monitors
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
              <div className="mt-3 flex flex-wrap gap-2">
                <SignInButtons />
              </div>
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
                    <IntegrationCard
                      key={integration.id}
                      integration={integration}
                      metrics={metricsByIntegration[integration.id]}
                    />
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

        {activeTab === 'monitors' && (
          <MonitorsPanel loggedIn={auth?.loggedIn ?? false} isAdmin={role === 'admin'} />
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

// Social sign-in buttons. Each links to the provider's generic OAuth entry point
// (/api/auth/login/<provider>); the API redirects on from there.
const SIGN_IN_PROVIDERS: { id: string; label: string }[] = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'facebook', label: 'Continue with Facebook' },
  { id: 'github', label: 'Continue with GitHub' },
];

function SignInButtons() {
  return (
    <>
      <EmailAuthForm />
      {SIGN_IN_PROVIDERS.map((p) => (
        <a
          key={p.id}
          href={`/api/auth/login/${p.id}`}
          className="px-3 sm:px-4 py-2 text-xs sm:text-sm text-white bg-gray-900 rounded-lg hover:bg-gray-800 whitespace-nowrap"
        >
          {p.label}
        </a>
      ))}
    </>
  );
}

/**
 * Email + password sign-in, as a native <details> disclosure so the open/closed
 * state needs no React state or click-outside handling. On success the whole app
 * reloads - auth, org, role and health all have to refetch anyway.
 *
 * No "forgot password" link: there's no mailer yet, so a reset flow can't exist.
 * The OAuth buttons beside this are the recovery path.
 */
function EmailAuthForm() {
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await passwordAuthRequest(mode, email, password);
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setBusy(false);
    }
  };

  return (
    <details className="relative">
      <summary className="list-none cursor-pointer px-3 sm:px-4 py-2 text-xs sm:text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 whitespace-nowrap">
        Email
      </summary>
      <form
        onSubmit={submit}
        className="absolute right-0 z-20 mt-2 w-72 p-4 bg-white border border-gray-200 rounded-lg shadow-lg text-left"
      >
        <div className="flex gap-1 mb-3">
          {(['login', 'signup'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m);
                setError(null);
              }}
              className={`flex-1 py-1.5 text-xs font-medium rounded ${
                mode === m ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <label className="block text-xs text-gray-500 mb-1" htmlFor="auth-email">
          Email
        </label>
        <input
          id="auth-email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full mb-3 px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        <label className="block text-xs text-gray-500 mb-1" htmlFor="auth-password">
          Password
        </label>
        <input
          id="auth-password"
          type="password"
          required
          minLength={8}
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <p className="mt-1 text-[11px] text-gray-400">At least 8 characters.</p>

        {error && (
          <p role="alert" className="mt-2 text-xs text-red-600">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full mt-3 py-2 text-sm text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50"
        >
          {busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
      </form>
    </details>
  );
}

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
