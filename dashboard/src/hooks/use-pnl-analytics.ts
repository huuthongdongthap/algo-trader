/**
 * Hook for fetching P&L analytics from /api/pnl
 * Returns performance metrics and daily summaries
 */
import { useState, useEffect, useCallback } from 'react';
import type { PerformanceMetrics, PnLSummary } from '../types/api';
import { apiClient } from '../lib/api-client';

interface UsePnlAnalyticsResult {
  metrics: PerformanceMetrics | null;
  dailySummary: PnLSummary | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function usePnlAnalytics(): UsePnlAnalyticsResult {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [dailySummary, setDailySummary] = useState<PnLSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPnlData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Fetch performance metrics
      const metricsData = await apiClient.get<PerformanceMetrics>('/pnl');
      if (metricsData) {
        setMetrics(metricsData);
      }

      // Fetch daily summary
      const today = new Date().toISOString().split('T')[0];
      const dailyData = await apiClient.get<PnLSummary>(`/pnl/daily?date=${today}`);
      if (dailyData) {
        setDailySummary(dailyData);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch P&L data');
    } finally {
      setLoading(false);
    }
  }, []);

  const refresh = useCallback(async () => {
    await fetchPnlData();
  }, [fetchPnlData]);

  useEffect(() => {
    fetchPnlData();
  }, [fetchPnlData]);

  return { metrics, dailySummary, loading, error, refresh };
}
