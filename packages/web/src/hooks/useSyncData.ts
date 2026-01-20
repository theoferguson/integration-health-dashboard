/**
 * useSyncData Hook
 * Manages fetching and state for sync overview data
 */

import { useState, useCallback, useEffect } from 'react';
import type { SyncSystemOverview } from '../types';
import { fetchSyncOverview } from '../api/client';

export interface UseSyncDataResult {
  syncOverview: SyncSystemOverview | null;
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  refreshKey: number;
  incrementRefreshKey: () => void;
}

export function useSyncData(shouldLoad: boolean = false): UseSyncDataResult {
  const [syncOverview, setSyncOverview] = useState<SyncSystemOverview | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  const loadSyncOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await fetchSyncOverview();
      setSyncOverview(data.overview);
      setError(null);
    } catch {
      // No sync data yet - that's ok
      setSyncOverview(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const incrementRefreshKey = useCallback(() => {
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    if (shouldLoad) {
      loadSyncOverview();
    }
  }, [shouldLoad, loadSyncOverview]);

  return {
    syncOverview,
    isLoading,
    error,
    refresh: loadSyncOverview,
    refreshKey,
    incrementRefreshKey,
  };
}
