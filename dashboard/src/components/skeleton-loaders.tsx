/**
 * Skeleton Loaders for async data states.
 * Dark theme matching dashboard design system.
 * Pulse animation for loading feedback.
 */

/**
 * Dashboard Stats Row Skeleton
 */
export function StatsRowSkeleton() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {[...Array(4)].map((_, i) => (
        <div
          key={i}
          className="bg-bg-card border border-bg-border rounded-lg p-4 space-y-3"
        >
          <div className="h-3 w-20 bg-bg-border rounded animate-pulse" />
          <div className="h-8 w-full bg-bg-border rounded animate-pulse" />
          <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/**
 * P&L Analytics Chart Skeleton
 */
export function PnlChartSkeleton() {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4 space-y-4">
      <div className="flex justify-between items-center">
        <div className="h-4 w-32 bg-bg-border rounded animate-pulse" />
        <div className="h-6 w-24 bg-bg-border rounded animate-pulse" />
      </div>
      <div className="h-48 w-full bg-bg-border rounded animate-pulse" />
      <div className="flex gap-4">
        <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
        <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
        <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
      </div>
    </div>
  );
}

/**
 * Admin Controls Skeleton
 */
export function AdminControlsSkeleton() {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4 space-y-4">
      <div className="h-4 w-28 bg-bg-border rounded animate-pulse" />
      <div className="flex gap-3">
        <div className="h-10 w-24 bg-bg-border rounded animate-pulse" />
        <div className="h-10 w-24 bg-bg-border rounded animate-pulse" />
      </div>
      <div className="h-20 w-full bg-bg-border rounded animate-pulse" />
    </div>
  );
}

/**
 * Signals Panel Skeleton
 */
export function SignalsPanelSkeleton() {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4 space-y-3">
      <div className="flex justify-between items-center">
        <div className="h-4 w-40 bg-bg-border rounded animate-pulse" />
        <div className="h-6 w-16 bg-bg-border rounded animate-pulse" />
      </div>
      {[...Array(5)].map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 p-3 bg-bg border border-bg-border rounded"
        >
          <div className="h-3 w-24 bg-bg-border rounded animate-pulse" />
          <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
          <div className="flex-1 h-3 w-full bg-bg-border rounded animate-pulse" />
          <div className="h-8 w-20 bg-bg-border rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/**
 * Positions Table Skeleton
 */
export function PositionsTableSkeleton() {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-bg-border">
        <div className="h-4 w-24 bg-bg-border rounded animate-pulse" />
      </div>
      <div className="divide-y divide-bg-border">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="grid grid-cols-5 gap-4 p-3">
            <div className="h-3 w-full bg-bg-border rounded animate-pulse" />
            <div className="h-3 w-full bg-bg-border rounded animate-pulse" />
            <div className="h-3 w-full bg-bg-border rounded animate-pulse" />
            <div className="h-3 w-full bg-bg-border rounded animate-pulse" />
            <div className="h-3 w-full bg-bg-border rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Spread Opportunities Grid Skeleton
 */
export function SpreadGridSkeleton() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[...Array(6)].map((_, i) => (
        <div
          key={i}
          className="bg-bg-card border border-bg-border rounded-lg p-4 space-y-3"
        >
          <div className="flex justify-between">
            <div className="h-3 w-24 bg-bg-border rounded animate-pulse" />
            <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
          </div>
          <div className="h-4 w-32 bg-bg-border rounded animate-pulse" />
          <div className="flex gap-2">
            <div className="h-6 w-16 bg-bg-border rounded animate-pulse" />
            <div className="h-6 w-16 bg-bg-border rounded animate-pulse" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Trade History Feed Skeleton
 */
export function TradeHistorySkeleton() {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg overflow-hidden">
      <div className="p-4 border-b border-bg-border">
        <div className="h-4 w-32 bg-bg-border rounded animate-pulse" />
      </div>
      <div className="divide-y divide-bg-border">
        {[...Array(5)].map((_, i) => (
          <div
            key={i}
            className="flex items-center gap-4 p-3"
          >
            <div className="h-3 w-20 bg-bg-border rounded animate-pulse" />
            <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
            <div className="flex-1 h-3 w-full bg-bg-border rounded animate-pulse" />
            <div className="h-3 w-24 bg-bg-border rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Strategy Status Panel Skeleton
 */
export function StrategyStatusSkeleton() {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4 space-y-3">
      <div className="h-4 w-28 bg-bg-border rounded animate-pulse" />
      {[...Array(3)].map((_, i) => (
        <div
          key={i}
          className="flex items-center justify-between p-3 bg-bg border border-bg-border rounded"
        >
          <div className="flex items-center gap-3">
            <div className="h-3 w-24 bg-bg-border rounded animate-pulse" />
            <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
          </div>
          <div className="h-6 w-20 bg-bg-border rounded animate-pulse" />
        </div>
      ))}
    </div>
  );
}

/**
 * Price Ticker Strip Skeleton
 */
export function PriceTickerSkeleton() {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4">
      <div className="flex gap-8 overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="flex-shrink-0 space-y-2">
            <div className="h-3 w-16 bg-bg-border rounded animate-pulse" />
            <div className="h-5 w-24 bg-bg-border rounded animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Equity Curve Chart Skeleton
 */
export function EquityCurveSkeleton() {
  return (
    <div className="bg-bg-card border border-bg-border rounded-lg p-4 space-y-4">
      <div className="h-4 w-32 bg-bg-border rounded animate-pulse" />
      <div className="h-40 w-full bg-bg-border rounded animate-pulse" />
    </div>
  );
}

/**
 * Full Dashboard Skeleton - wraps all sections
 */
export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      {/* Top bar */}
      <div className="flex justify-between items-center">
        <div className="space-y-2">
          <div className="h-6 w-32 bg-bg-border rounded animate-pulse" />
          <div className="h-3 w-48 bg-bg-border rounded animate-pulse" />
        </div>
        <div className="h-8 w-24 bg-bg-border rounded animate-pulse" />
      </div>

      {/* Stats row */}
      <StatsRowSkeleton />

      {/* Strategies */}
      <StrategyStatusSkeleton />

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <PnlChartSkeleton />
        <AdminControlsSkeleton />
      </div>

      {/* Signals */}
      <SignalsPanelSkeleton />

      {/* Equity curve */}
      <EquityCurveSkeleton />

      {/* Price ticker */}
      <PriceTickerSkeleton />

      {/* Spread opportunities */}
      <SpreadGridSkeleton />

      {/* Trade history */}
      <TradeHistorySkeleton />

      {/* Positions */}
      <PositionsTableSkeleton />
    </div>
  );
}

/**
 * Page loader wrapper component
 */
export function PageLoader({ children, loading }: { children: React.ReactNode; loading: boolean }) {
  if (!loading) return <>{children}</>;

  return (
    <div className="animate-pulse">
      <DashboardSkeleton />
    </div>
  );
}
