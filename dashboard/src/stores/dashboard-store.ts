/**
 * Dashboard-specific Zustand store for Phase 3 UI state
 * Separate from trading-store to avoid conflicts
 */
import { create } from 'zustand';
import type { Signal, PerformanceMetrics, AdminStatus, HealthStatus } from '../types/api';

interface DashboardState {
  // Signals
  signals: Signal[];
  lastSignalsUpdate: number | null;

  // P&L
  metrics: PerformanceMetrics | null;
  lastMetricsUpdate: number | null;

  // Admin
  adminStatus: AdminStatus | null;
  lastAdminUpdate: number | null;

  // Health
  health: HealthStatus | null;

  // UI State
  refreshInterval: number;
  autoRefresh: boolean;

  // Actions
  setSignals: (signals: Signal[]) => void;
  setMetrics: (metrics: PerformanceMetrics | null) => void;
  setAdminStatus: (status: AdminStatus | null) => void;
  setHealth: (health: HealthStatus | null) => void;
  setRefreshInterval: (ms: number) => void;
  toggleAutoRefresh: () => void;
}

const DEFAULT_REFRESH_INTERVAL = 5000; // 5 seconds

export const useDashboardStore = create<DashboardState>()((set) => ({
  // Initial state
  signals: [],
  lastSignalsUpdate: null,
  metrics: null,
  lastMetricsUpdate: null,
  adminStatus: null,
  lastAdminUpdate: null,
  health: null,
  refreshInterval: DEFAULT_REFRESH_INTERVAL,
  autoRefresh: true,

  // Actions
  setSignals: (signals) =>
    set({
      signals,
      lastSignalsUpdate: Date.now(),
    }),

  setMetrics: (metrics) =>
    set({
      metrics,
      lastMetricsUpdate: Date.now(),
    }),

  setAdminStatus: (adminStatus) =>
    set({
      adminStatus,
      lastAdminUpdate: Date.now(),
    }),

  setHealth: (health) => set({ health }),

  setRefreshInterval: (refreshInterval) => set({ refreshInterval }),

  toggleAutoRefresh: () =>
    set((state) => ({ autoRefresh: !state.autoRefresh })),
}));
