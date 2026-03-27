/**
 * Hook for admin controls (halt/resume trading, circuit breaker status)
 * Uses optimistic updates for better UX
 */
import { useState, useEffect, useCallback } from 'react';
import type { AdminStatus, HaltRequest, AdminMessage } from '../types/api';
import { apiClient } from '../lib/api-client';

interface UseAdminControlsResult {
  status: AdminStatus | null;
  halt: (reason: string) => Promise<boolean>;
  resume: () => Promise<boolean>;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useAdminControls(): UseAdminControlsResult {
  const [status, setStatus] = useState<AdminStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await apiClient.get<AdminStatus>('/admin/status');
      if (data) {
        setStatus(data);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch admin status');
    }
  }, []);

  const halt = useCallback(async (reason: string): Promise<boolean> => {
    setLoading(true);
    setError(null);

    // Optimistic update
    const previousStatus = status;
    setStatus(prev => prev ? {
      ...prev,
      trading: false,
      circuitBreaker: { state: 'OPEN', reason }
    } : null);

    try {
      const body: HaltRequest = { reason };
      await apiClient.post<AdminMessage>('/admin/halt', body);
      return true;
    } catch (err) {
      // Rollback on error
      setStatus(previousStatus);
      setError(err instanceof Error ? err.message : 'Failed to halt trading');
      return false;
    } finally {
      setLoading(false);
    }
  }, [status]);

  const resume = useCallback(async (): Promise<boolean> => {
    setLoading(true);
    setError(null);

    // Optimistic update
    const previousStatus = status;
    setStatus(prev => prev ? {
      ...prev,
      trading: true,
      circuitBreaker: { state: 'CLOSED' }
    } : null);

    try {
      await apiClient.post<AdminMessage>('/admin/resume');
      return true;
    } catch (err) {
      // Rollback on error
      setStatus(previousStatus);
      setError(err instanceof Error ? err.message : 'Failed to resume trading');
      return false;
    } finally {
      setLoading(false);
    }
  }, [status]);

  const refresh = useCallback(async () => {
    await fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { status, halt, resume, loading, error, refresh };
}
