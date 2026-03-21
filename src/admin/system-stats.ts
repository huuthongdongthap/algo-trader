// System metrics aggregation for admin panel
// Collects uptime, memory, CPU, user counts, trade stats, and strategy info
import type { TradingEngine } from '../engine/engine.js';
import type { UserStore } from '../users/user-store.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ResourceUsage {
  /** RSS memory in MB */
  memoryRssMb: number;
  /** Heap used in MB */
  heapUsedMb: number;
  /** Heap total in MB */
  heapTotalMb: number;
  /** User CPU time in milliseconds */
  cpuUserMs: number;
  /** System CPU time in milliseconds */
  cpuSystemMs: number;
}

export interface SystemStats {
  uptime: string;
  uptimeMs: number;
  version: string;
  nodeVersion: string;
  memoryUsage: ResourceUsage;
  totalUsers: number;
  activeUsers: number;
  totalTrades: number;
  /** Sum of all fees from trade log as proxy for revenue */
  totalRevenue: string;
  activeStrategies: number;
  engineRunning: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SERVER_START = Date.now();

/** Format milliseconds into human-readable uptime string: Xd Xh Xm Xs */
export function formatUptime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(' ');
}

/** Collect process memory and CPU metrics */
export function getResourceUsage(): ResourceUsage {
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();

  return {
    memoryRssMb: parseFloat((mem.rss / 1_048_576).toFixed(2)),
    heapUsedMb: parseFloat((mem.heapUsed / 1_048_576).toFixed(2)),
    heapTotalMb: parseFloat((mem.heapTotal / 1_048_576).toFixed(2)),
    // cpuUsage returns microseconds — convert to ms
    cpuUserMs: parseFloat((cpu.user / 1000).toFixed(2)),
    cpuSystemMs: parseFloat((cpu.system / 1000).toFixed(2)),
  };
}

// ─── Main aggregator ─────────────────────────────────────────────────────────

/**
 * Collect all system metrics from engine and user store.
 * Called by GET /admin/system endpoint.
 */
export function getSystemStats(engine: TradingEngine, userStore: UserStore): SystemStats {
  const uptimeMs = Date.now() - SERVER_START;
  const trades = engine.getExecutor().getTradeLog();

  // Aggregate fees as revenue proxy
  let totalRevenue = 0;
  for (const t of trades) {
    totalRevenue += parseFloat(t.fees);
  }

  const allUsers = userStore.listActiveUsers();
  const activeStrategies = engine
    .getRunner()
    .getAllStatus()
    .filter(s => s.state === 'running').length;

  // Read package.json version at runtime via env or fallback
  const version = process.env['npm_package_version'] ?? '0.0.0';

  return {
    uptime: formatUptime(uptimeMs),
    uptimeMs,
    version,
    nodeVersion: process.version,
    memoryUsage: getResourceUsage(),
    totalUsers: allUsers.length,
    activeUsers: allUsers.filter(u => u.active).length,
    totalTrades: trades.length,
    totalRevenue: totalRevenue.toFixed(6),
    activeStrategies,
    engineRunning: engine.isRunning(),
  };
}
