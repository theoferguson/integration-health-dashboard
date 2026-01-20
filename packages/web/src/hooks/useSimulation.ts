/**
 * useSimulation Hook
 * Manages simulation state and execution
 */

import { useState, useCallback } from 'react';
import { generateSyncData } from '../api/client';

const API_BASE = '/api';

export interface UseSimulationResult {
  isSimulating: boolean;
  error: string | null;
  runSimulation: (callbacks?: SimulationCallbacks) => Promise<void>;
}

export interface SimulationCallbacks {
  onComplete?: () => Promise<void>;
  onSyncComplete?: () => Promise<void>;
}

export function useSimulation(): UseSimulationResult {
  const [isSimulating, setIsSimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runSimulation = useCallback(async (callbacks?: SimulationCallbacks) => {
    setIsSimulating(true);
    setError(null);

    try {
      // Run event simulation with reset
      await fetch(`${API_BASE}/simulate?reset=true`, { method: 'POST' });

      // Generate sync data
      await generateSyncData(5, true);

      // Call completion callbacks
      if (callbacks?.onComplete) {
        await callbacks.onComplete();
      }
      if (callbacks?.onSyncComplete) {
        await callbacks.onSyncComplete();
      }
    } catch {
      setError('Failed to run simulation');
    } finally {
      setIsSimulating(false);
    }
  }, []);

  return {
    isSimulating,
    error,
    runSimulation,
  };
}
