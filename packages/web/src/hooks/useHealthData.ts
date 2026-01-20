/**
 * useHealthData Hook
 * Manages fetching and state for health and event data
 */

import { useState, useCallback, useEffect } from 'react';
import type { Integration, IntegrationEvent, HealthOverview } from '../types';
import { TIMING } from '../types';
import { fetchHealth, fetchEvents } from '../api/client';

export interface ErrorStats {
  total: number;
  open: number;
  acknowledged: number;
  resolved: number;
}

export interface UseHealthDataOptions {
  filter?: 'all' | 'failures';
  autoRefresh?: boolean;
  refreshInterval?: number;
}

export interface UseHealthDataResult {
  health: HealthOverview | null;
  integrations: Integration[];
  events: IntegrationEvent[];
  errorStats: ErrorStats;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  updateEvent: (updatedEvent: IntegrationEvent) => void;
}

function calculateErrorStats(events: IntegrationEvent[]): ErrorStats {
  return events.reduce(
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
}

export function useHealthData(options: UseHealthDataOptions = {}): UseHealthDataResult {
  const {
    filter = 'all',
    autoRefresh = true,
    refreshInterval = TIMING.POLLING_INTERVAL_MS,
  } = options;

  const [health, setHealth] = useState<HealthOverview | null>(null);
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [events, setEvents] = useState<IntegrationEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
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
    } catch {
      setError('Failed to load data. Is the API server running?');
    } finally {
      setIsLoading(false);
    }
  }, [filter]);

  const updateEvent = useCallback((updatedEvent: IntegrationEvent) => {
    setEvents((prev) =>
      prev.map((e) => (e.id === updatedEvent.id ? updatedEvent : e))
    );
  }, []);

  // Initial load and polling
  useEffect(() => {
    loadData();

    if (autoRefresh) {
      const interval = setInterval(loadData, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [loadData, autoRefresh, refreshInterval]);

  // Calculate error stats (memoized via dependency)
  const errorStats = calculateErrorStats(events);

  return {
    health,
    integrations,
    events,
    errorStats,
    isLoading,
    error,
    refresh: loadData,
    updateEvent,
  };
}
