/**
 * Hook for fetching health status from /api/health
 * Used for system status monitoring
 */
import { useState, useEffect, useCallback } from 'react';
import type { HealthStatus, MetricsStatus } from '../types/api';
import { apiClient } from '../lib/api-client';

interface UseHealthStatusResult {
  health: HealthStatus | null;
  metrics: MetricsStatus | null;
  healthy: boolean;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useHealthStatus(): UseHealthStatusResult {
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [metrics, setMetrics] = useState<MetricsStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    try {
      const [healthData, metricsData] = await Promise.all([
        apiClient.get<HealthStatus>('/health'),
        apiClient.get<MetricsStatus>('/health/metrics'),
      ]);

      if (healthData) setHealth(healthData);
      if (metricsData) setMetrics(metricsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch health status');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    await fetchHealth();
  }, [fetchHealth]);

  useEffect(() => {
    fetchHealth();
  }, [fetchHealth]);

  return {
    health,
    metrics,
    healthy: health?.status === 'healthy',
    loading,
    error,
    refresh,
  };
}
