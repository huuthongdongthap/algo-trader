/**
 * Hook for fetching arbitrage signals from /api/signals
 * Polls every 5 seconds for fresh data
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Signal, SignalsResponse } from '../types/api';
import { apiClient } from '../lib/api-client';

interface UseSignalsResult {
  signals: Signal[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useSignals(minSpread = 0, limit = 50): UseSignalsResult {
  const [signals, setSignals] = useState<Signal[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const fetchSignals = useCallback(async () => {
    try {
      const query = new URLSearchParams({
        minSpread: minSpread.toString(),
        limit: limit.toString(),
      });

      const response = await apiClient.get<SignalsResponse>(`/signals?${query}`);

      if (response && mountedRef.current) {
        setSignals(response.data ?? []);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err instanceof Error ? err.message : 'Failed to fetch signals');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, [minSpread, limit]);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchSignals();
  }, [fetchSignals]);

  useEffect(() => {
    mountedRef.current = true;
    fetchSignals();

    // Poll every 5 seconds
    const intervalId = setInterval(fetchSignals, 5000);

    return () => {
      mountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [fetchSignals]);

  return { signals, loading, error, refresh };
}
