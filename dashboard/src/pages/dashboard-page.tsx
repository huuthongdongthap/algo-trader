/**
 * Main dashboard page: Week 5-6 UI Polish + Beta Launch.
 * Features: Real-time WebSocket updates, skeleton loaders, responsive grid.
 * Mobile-first design with Tailwind breakpoints.
 */
import { useState, useEffect } from 'react';
import { useTradingStore } from '../stores/trading-store';
import { useWebSocketPriceFeed } from '../hooks/use-websocket-price-feed';
import { useRealtimeUpdates } from '../hooks/use-realtime-updates';
import { useSignals } from '../hooks/use-signals';
import { usePnlAnalytics } from '../hooks/use-pnl-analytics';
import { useAdminControls } from '../hooks/use-admin-controls';
import { useHealthStatus } from '../hooks/use-health-status';

// Phase 3 Components
import { StatsRow } from '../components/stats-row';
import { SignalsPanel } from '../components/signals-panel';
import { PnLAnalyticsChart } from '../components/pnl-analytics-chart';
import { AdminControls } from '../components/admin-controls';

// Week 5-6 Components
import {
  DashboardSkeleton,
  StatsRowSkeleton,
  PnlChartSkeleton,
  AdminControlsSkeleton,
  SignalsPanelSkeleton,
  EquityCurveSkeleton,
  PriceTickerSkeleton,
  SpreadGridSkeleton,
  TradeHistorySkeleton,
  PositionsTableSkeleton,
} from '../components/skeleton-loaders';

// Legacy Components (Phase 1/2)
import { PriceTickerStrip } from '../components/price-ticker-strip';
import { PositionsTableSortable } from '../components/positions-table-sortable';
import { SpreadOpportunitiesCardGrid } from '../components/spread-opportunities-card-grid';
import { EquityCurveChart } from '../components/equity-curve-pnl-chart';
import { CacheStatus } from '../components/cache-status';
import { StrategyStatusPanel } from '../components/strategy-status-panel';
import { TradeHistoryFeed } from '../components/trade-history-feed';

function useNow(): string {
  const [now, setNow] = useState(() => new Date().toLocaleTimeString('en-US', { hour12: false }));
  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toLocaleTimeString('en-US', { hour12: false })), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

export function DashboardPage() {
  // Legacy WebSocket for trading data (Phase 1/2)
  useWebSocketPriceFeed();

  // Week 5-6: Unified realtime updates hook
  const { connected: wsConnected, latency, error: wsError, reconnectCount } = useRealtimeUpdates();

  // Phase 3 API hooks with loading states
  const { signals, loading: signalsLoading, error: signalsError, refresh: refreshSignals } = useSignals(0, 50);
  const { metrics, loading: pnlLoading, error: pnlError } = usePnlAnalytics();
  const { status: adminStatus, halt, resume, loading: adminLoading, error: adminError, refresh: refreshAdmin } = useAdminControls();
  useHealthStatus();

  // Trading store data (Phase 1/2)
  const positions = useTradingStore((s: any) => s.positions);
  const spreads = useTradingStore((s: any) => s.spreads);
  const strategies = useTradingStore((s: any) => s.strategies);
  const trades = useTradingStore((s: any) => s.trades);
  const botStatus = useTradingStore((s: any) => s.botStatus);

  const lastUpdate = useNow();

  // Overall loading state - show skeleton on initial load
  const isInitialLoading = pnlLoading || signalsLoading || adminLoading;

  // Derived metrics
  const openCount = positions.filter((p: any) => p.status === 'open').length;
  const activeStrategies = strategies?.filter((s: any) => s.enabled).length ?? 0;

  // Show full skeleton on initial load
  if (isInitialLoading) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6 font-mono">
      {/* Top bar - responsive layout */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-white text-lg sm:text-xl font-bold tracking-tight">Dashboard</h2>
          <p className="text-muted text-xs mt-0.5">
            Algo Trader v5.6 • {wsConnected ? 'Connected' : 'Disconnected'}
            {latency.avgLatency > 0 && ` • ${latency.avgLatency}ms latency`}
          </p>
          {wsError && <p className="text-loss text-xs mt-1">{wsError}</p>}
          {reconnectCount > 0 && (
            <p className="text-muted text-[10px] mt-0.5">Reconnected {reconnectCount}x</p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          <CacheStatus />
          <span className="text-muted text-xs hidden sm:inline">
            Updated {lastUpdate}
          </span>
          <div
            className={`
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs font-semibold
              min-h-[36px] touch-manipulation
              ${wsConnected
                ? 'border-profit/40 bg-profit/10 text-profit'
                : 'border-loss/40 bg-loss/10 text-loss'
              }
            `}
          >
            <span
              className={`w-1.5 h-1.5 rounded-full ${wsConnected ? 'bg-profit animate-pulse' : 'bg-loss'}`}
            />
            <span className="hidden sm:inline">{wsConnected ? 'Live' : 'Offline'}</span>
          </div>
        </div>
      </div>

      {/* Stats Row - responsive grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {pnlLoading ? (
          <StatsRowSkeleton />
        ) : (
          <StatsRow
            totalEquity={metrics?.totalPnl}
            openPositions={openCount}
            todayPnl={metrics?.dailyPnl}
            activeStrategies={activeStrategies}
            metrics={metrics}
          />
        )}
      </div>

      {/* Strategy status - full width */}
      <section>
        <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-accent rounded-full inline-block" />
          Strategies
        </h3>
        <StrategyStatusPanel strategies={strategies} botStatus={botStatus} />
      </section>

      {/* Main Grid - responsive: 1 col mobile, 2 cols tablet+ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* P&L Analytics */}
        <section>
          <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
            <span className="w-1 h-4 bg-accent rounded-full inline-block" />
            P&L Analytics
          </h3>
          {pnlLoading ? (
            <PnlChartSkeleton />
          ) : (
            <PnLAnalyticsChart metrics={metrics} loading={pnlLoading} error={pnlError} />
          )}
        </section>

        {/* Admin Controls */}
        <section>
          <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
            <span className="w-1 h-4 bg-accent rounded-full inline-block" />
            Admin Controls
          </h3>
          {adminLoading ? (
            <AdminControlsSkeleton />
          ) : (
            <AdminControls
              status={adminStatus}
              halt={halt}
              resume={resume}
              loading={adminLoading}
              error={adminError}
              onRefresh={refreshAdmin}
            />
          )}
        </section>
      </div>

      {/* Signals Panel - full width */}
      <section>
        <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-profit rounded-full inline-block" />
          Arbitrage Signals
          {signals.length > 0 && (
            <span className="text-[10px] text-muted bg-bg-border px-1.5 py-0.5 rounded">
              {signals.length}
            </span>
          )}
        </h3>
        {signalsLoading ? (
          <SignalsPanelSkeleton />
        ) : (
          <SignalsPanel
            signals={signals}
            loading={signalsLoading}
            error={signalsError}
            onRefresh={refreshSignals}
          />
        )}
      </section>

      {/* Equity curve - full width */}
      <section>
        <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-accent rounded-full inline-block" />
          Equity Curve
        </h3>
        <div className="bg-bg-card border border-bg-border rounded-lg p-3 sm:p-4">
          {pnlLoading ? <EquityCurveSkeleton /> : <EquityCurveChart positions={positions} />}
        </div>
      </section>

      {/* Price ticker strip - responsive horizontal scroll on mobile */}
      <section>
        <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-accent rounded-full inline-block" />
          Live Prices
        </h3>
        <div className="bg-bg-card border border-bg-border rounded-lg overflow-x-auto">
          {pnlLoading ? <PriceTickerSkeleton /> : <PriceTickerStrip />}
        </div>
      </section>

      {/* Spread opportunities - responsive grid */}
      <section>
        <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-profit rounded-full inline-block" />
          Spread Opportunities
          {spreads.length > 0 && (
            <span className="text-[10px] text-muted bg-bg-border px-1.5 py-0.5 rounded">
              {spreads.length}
            </span>
          )}
        </h3>
        {pnlLoading ? (
          <SpreadGridSkeleton />
        ) : (
          <SpreadOpportunitiesCardGrid spreads={spreads} />
        )}
      </section>

      {/* Trade history feed - responsive table */}
      <section>
        <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-warning rounded-full inline-block" />
          Trade History
          {trades.length > 0 && (
            <span className="text-[10px] text-muted bg-bg-border px-1.5 py-0.5 rounded">
              {trades.length}
            </span>
          )}
        </h3>
        <div className="bg-bg-card border border-bg-border rounded-lg overflow-hidden">
          {pnlLoading ? <TradeHistorySkeleton /> : <TradeHistoryFeed trades={trades} />}
        </div>
      </section>

      {/* Positions table - responsive with horizontal scroll */}
      <section>
        <h3 className="text-white text-sm font-semibold mb-2 flex items-center gap-2">
          <span className="w-1 h-4 bg-muted rounded-full inline-block" />
          Positions
          {positions.length > 0 && (
            <span className="text-[10px] text-muted bg-bg-border px-1.5 py-0.5 rounded">
              {positions.length}
            </span>
          )}
        </h3>
        <div className="bg-bg-card border border-bg-border rounded-lg overflow-x-auto">
          {pnlLoading ? <PositionsTableSkeleton /> : <PositionsTableSortable positions={positions} />}
        </div>
      </section>
    </div>
  );
}
