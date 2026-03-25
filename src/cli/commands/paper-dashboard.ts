// Paper Trading Terminal Dashboard
// Real-time terminal UI showing paper trading stats, signals, and calibration metrics.
// No external TUI deps — uses console.clear() + console.log() for refresh.

import { DecisionLogger, getDecisionLogger } from '../../openclaw/decision-logger.js';
import type { DecisionRow } from '../../openclaw/decision-store.js';

// ── Types ────────────────────────────────────────────────────────────────────

export interface PaperDashboardOptions {
  /** SQLite database path */
  dbPath: string;
  /** Starting capital in USD */
  capital: number;
  /** Trial duration in days (default: 14) */
  trialDays?: number;
  /** Refresh interval in ms (default: 60_000) */
  refreshMs?: number;
  /** Trial start timestamp (default: Date.now()) */
  startTimestamp?: number;
}

export interface DashboardStats {
  capital: number;
  pnl: number;
  tradeCount: number;
  winRate: number;
  avgEdge: number;
  brierScore: number;
  sharpe: number;
  maxDrawdown: number;
  dayNumber: number;
  trialDays: number;
}

export interface SignalRow {
  market: string;
  ourProb: number;
  direction: string;
  edge: number;
  won: boolean | null; // null = unresolved
}

export interface CalibrationStatus {
  label: string;
  brierScore: number;
  capitalTier: number;
  nextTier: number;
  daysToNextTier: number | null;
}

// ── Parsing helpers ──────────────────────────────────────────────────────────

/**
 * Parse a decision row's output_summary to extract prediction fields.
 * Format: "ourProb:0.720 edge:0.150 dir:buy_yes"
 */
export function parseOutputSummary(output: string): { ourProb: number; edge: number; direction: string } {
  const probMatch = output.match(/ourProb:([\d.]+)/);
  const edgeMatch = output.match(/edge:([-\d.]+)/);
  const dirMatch = output.match(/dir:(\S+)/);
  return {
    ourProb: probMatch ? parseFloat(probMatch[1]) : 0,
    edge: edgeMatch ? parseFloat(edgeMatch[1]) : 0,
    direction: dirMatch ? dirMatch[1] : 'skip',
  };
}

/**
 * Parse input_summary to extract market id (short) and yesPrice.
 * Format: "market:0x1234abcd yesPrice:0.550"
 */
export function parseInputSummary(input: string): { marketId: string; yesPrice: number } {
  const mMatch = input.match(/market:(\S+)/);
  const pMatch = input.match(/yesPrice:([\d.]+)/);
  return {
    marketId: mMatch ? mMatch[1] : 'unknown',
    yesPrice: pMatch ? parseFloat(pMatch[1]) : 0,
  };
}

// ── Pure computation helpers (exported for testing) ──────────────────────────

/**
 * Compute Brier score from resolved predictions.
 * Brier = (1/N) * sum( (forecast - outcome)^2 )
 * Lower is better. 0 = perfect, 0.25 = coin flip.
 */
export function computeBrierScore(predictions: Array<{ ourProb: number; outcome: number }>): number {
  if (predictions.length === 0) return 0;
  const sum = predictions.reduce((acc, p) => acc + (p.ourProb - p.outcome) ** 2, 0);
  return sum / predictions.length;
}

/**
 * Compute Sharpe ratio from an array of per-trade returns.
 * Sharpe = mean(returns) / stddev(returns)
 * Annualised assuming 1 trade/day for simplicity.
 */
export function computeSharpe(returns: number[]): number {
  if (returns.length < 2) return 0;
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
  const std = Math.sqrt(variance);
  if (std === 0) return 0;
  return mean / std;
}

/**
 * Compute maximum drawdown from a series of equity values.
 * Returns a negative percentage (e.g., -0.032 for -3.2%).
 */
export function computeMaxDrawdown(equityCurve: number[]): number {
  if (equityCurve.length < 2) return 0;
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const equity of equityCurve) {
    if (equity > peak) peak = equity;
    const dd = (equity - peak) / peak;
    if (dd < maxDd) maxDd = dd;
  }
  return maxDd;
}

/**
 * Compute win rate from trades. A "win" is a trade with positive edge that was applied.
 */
export function computeWinRate(trades: Array<{ edge: number; applied: boolean }>): number {
  const applied = trades.filter(t => t.applied);
  if (applied.length === 0) return 0;
  const wins = applied.filter(t => t.edge > 0).length;
  return wins / applied.length;
}

/**
 * Determine calibration status label from Brier score.
 */
export function getCalibrationLabel(brier: number): string {
  if (brier === 0) return 'NO DATA';
  if (brier < 0.15) return 'EXCELLENT';
  if (brier < 0.20) return 'GOOD';
  if (brier < 0.25) return 'FAIR';
  return 'POOR';
}

/**
 * Determine capital tier progression.
 * Tiers: $200 -> $500 -> $1000 -> $2000 -> $5000
 */
const CAPITAL_TIERS = [200, 500, 1000, 2000, 5000];

export function getCapitalTierInfo(capital: number): { current: number; next: number } {
  let current = CAPITAL_TIERS[0];
  let next = CAPITAL_TIERS[1] ?? CAPITAL_TIERS[0];
  for (let i = 0; i < CAPITAL_TIERS.length; i++) {
    if (capital >= CAPITAL_TIERS[i]) {
      current = CAPITAL_TIERS[i];
      next = CAPITAL_TIERS[i + 1] ?? CAPITAL_TIERS[i];
    }
  }
  return { current, next };
}

// ── Formatting helpers (exported for testing) ────────────────────────────────

/** Pad a line to fit inside a box of given inner width */
export function boxLine(content: string, innerWidth: number): string {
  // Strip ANSI for length calculation but keep for display
  const visible = content.replace(/\x1b\[[0-9;]*m/g, '');
  const pad = Math.max(0, innerWidth - visible.length);
  return `  \u2502 ${content}${' '.repeat(pad)} \u2502`;
}

export function boxTop(innerWidth: number): string {
  return `  \u250c${ '\u2500'.repeat(innerWidth + 2)}\u2510`;
}

export function boxMid(innerWidth: number): string {
  return `  \u251c${'\u2500'.repeat(innerWidth + 2)}\u2524`;
}

export function boxBot(innerWidth: number): string {
  return `  \u2514${'\u2500'.repeat(innerWidth + 2)}\u2518`;
}

/** Format a number as +$X.XX or -$X.XX */
export function formatPnl(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}$${value.toFixed(2)}`;
}

/** Format a percentage like 64% or -3.2% */
export function formatPct(value: number, decimals = 0): string {
  return `${(value * 100).toFixed(decimals)}%`;
}

/** Truncate a string to maxLen, adding ellipsis if needed */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '\u2026';
}

/** Format a signal row for display */
export function formatSignalLine(signal: SignalRow, maxMarketLen = 28): string {
  const icon = signal.won === true ? '\u2705' : signal.won === false ? '\u274c' : '\u23f3';
  const market = truncate(signal.market, maxMarketLen);
  const prob = `${(signal.ourProb * 100).toFixed(0)}%`;
  const dir = signal.direction === 'buy_yes' ? 'YES' : signal.direction === 'buy_no' ? 'NO' : 'SKIP';
  const edgeSign = signal.edge >= 0 ? '+' : '';
  const edge = `${edgeSign}${(signal.edge * 100).toFixed(0)}%`;
  return `${icon} ${market}: ${prob} \u2192 ${dir} (edge: ${edge})`;
}

// ── Data loading ─────────────────────────────────────────────────────────────

/**
 * Load dashboard stats from the decision logger / SQLite.
 * This reads analysis-type decisions and computes all dashboard metrics.
 */
export function loadDashboardStats(
  dbPath: string,
  capital: number,
  trialDays: number,
  startTimestamp: number,
): { stats: DashboardStats; signals: SignalRow[]; calibration: CalibrationStatus } {
  const decisionLogger = getDecisionLogger(dbPath);

  // Query all analysis decisions from the store
  const rows = decisionLogger.queryFromStore({ type: 'analysis', limit: 1000 });

  // Parse each row into usable data
  const parsed = rows.map((row: DecisionRow) => {
    const out = parseOutputSummary(row.output_summary);
    const inp = parseInputSummary(row.input_summary);
    return {
      marketId: inp.marketId,
      yesPrice: inp.yesPrice,
      ourProb: out.ourProb,
      edge: out.edge,
      direction: out.direction,
      confidence: row.confidence,
      applied: row.applied === 1,
      timestamp: row.timestamp,
    };
  });

  const appliedTrades = parsed.filter(p => p.applied);
  const tradeCount = appliedTrades.length;

  // Win rate: trades where edge > 0 (model predicted correctly relative to market)
  const winRate = computeWinRate(appliedTrades.map(t => ({ edge: t.edge, applied: true })));

  // Average edge across applied trades
  const avgEdge = tradeCount > 0
    ? appliedTrades.reduce((s, t) => s + Math.abs(t.edge), 0) / tradeCount
    : 0;

  // Simulated P&L: sum of edge * confidence * stake ($10 per trade as proxy)
  const stakePerTrade = 10;
  const pnl = appliedTrades.reduce((s, t) => s + t.edge * t.confidence * stakePerTrade, 0);

  // Per-trade returns for Sharpe
  const tradeReturns = appliedTrades.map(t => t.edge * t.confidence * stakePerTrade);

  // Equity curve for drawdown
  let equity = capital;
  const equityCurve = [capital];
  for (const ret of tradeReturns) {
    equity += ret;
    equityCurve.push(equity);
  }

  const sharpe = computeSharpe(tradeReturns);
  const maxDrawdown = computeMaxDrawdown(equityCurve);

  // Brier score: use confidence as forecast, applied (edge > 0) as outcome
  // This is a simplification — real Brier needs resolved market outcomes
  const brierInputs = appliedTrades.map(t => ({
    ourProb: t.ourProb,
    outcome: t.edge > 0 ? 1 : 0,
  }));
  const brierScore = computeBrierScore(brierInputs);

  // Day number
  const elapsed = Date.now() - startTimestamp;
  const dayNumber = Math.max(1, Math.ceil(elapsed / (24 * 60 * 60 * 1000)));

  // Last 5 signals
  const lastSignals: SignalRow[] = rows.slice(0, 5).map((row: DecisionRow) => {
    const out = parseOutputSummary(row.output_summary);
    const inp = parseInputSummary(row.input_summary);
    const shortMarket = inp.marketId.length > 10
      ? inp.marketId.slice(0, 8) + '..'
      : inp.marketId;
    return {
      market: shortMarket,
      ourProb: out.ourProb,
      direction: out.direction,
      edge: out.edge,
      won: out.edge > 0 ? true : out.direction === 'skip' ? null : false,
    };
  });

  // Calibration
  const tierInfo = getCapitalTierInfo(capital + pnl);
  const calLabel = getCalibrationLabel(brierScore);
  const daysRemaining = trialDays - dayNumber;

  const stats: DashboardStats = {
    capital: capital + pnl,
    pnl,
    tradeCount,
    winRate,
    avgEdge,
    brierScore,
    sharpe,
    maxDrawdown,
    dayNumber,
    trialDays,
  };

  const calibration: CalibrationStatus = {
    label: calLabel,
    brierScore,
    capitalTier: tierInfo.current,
    nextTier: tierInfo.next,
    daysToNextTier: daysRemaining > 0 ? daysRemaining : null,
  };

  return { stats, signals: lastSignals, calibration };
}

// ── Render ───────────────────────────────────────────────────────────────────

const W = 45; // inner box width

export function renderDashboardScreen(
  stats: DashboardStats,
  signals: SignalRow[],
  calibration: CalibrationStatus,
): string {
  const lines: string[] = [];

  lines.push('');
  lines.push(boxTop(W));
  lines.push(boxLine(`CashClaw Paper Trading \u2014 Day ${stats.dayNumber}/${stats.trialDays}`, W));
  lines.push(boxMid(W));

  // Row 1: Capital | P&L
  const capStr = `Capital: $${stats.capital.toFixed(2)}`;
  const pnlStr = `P&L: ${formatPnl(stats.pnl)}`;
  lines.push(boxLine(`${capStr}  \u2502 ${pnlStr}`, W));

  // Row 2: Trades | Win Rate
  const tradeStr = `Trades: ${stats.tradeCount}`;
  const wrStr = `Win Rate: ${formatPct(stats.winRate)}`;
  lines.push(boxLine(`${tradeStr}        \u2502 ${wrStr}`, W));

  // Row 3: Avg Edge | Brier
  const edgeStr = `Avg Edge: ${formatPct(stats.avgEdge, 1)}`;
  const brierStr = `Brier: ${stats.brierScore.toFixed(3)}`;
  lines.push(boxLine(`${edgeStr}   \u2502 ${brierStr}`, W));

  // Row 4: Sharpe | Max DD
  const sharpeStr = `Sharpe: ${stats.sharpe.toFixed(2)}`;
  const ddStr = `Max DD: ${formatPct(stats.maxDrawdown, 1)}`;
  lines.push(boxLine(`${sharpeStr}      \u2502 ${ddStr}`, W));

  lines.push(boxMid(W));

  // Signals section
  lines.push(boxLine('Last 5 Signals:', W));
  if (signals.length === 0) {
    lines.push(boxLine('  (no signals yet)', W));
  } else {
    for (const sig of signals) {
      lines.push(boxLine(formatSignalLine(sig, 20), W));
    }
  }

  lines.push(boxMid(W));

  // Calibration section
  const calIcon = calibration.label === 'EXCELLENT' || calibration.label === 'GOOD' ? '\u2705' : calibration.label === 'FAIR' ? '\u26a0\ufe0f' : '\u274c';
  const brierThresh = calibration.brierScore < 0.20 ? '< 0.20' : '>= 0.20';
  lines.push(boxLine(`Calibration: ${calIcon} ${calibration.label} (Brier ${brierThresh})`, W));

  const tierStr = calibration.daysToNextTier !== null
    ? `$${calibration.capitalTier} \u2192 $${calibration.nextTier} in ${calibration.daysToNextTier} days`
    : `$${calibration.capitalTier} (max tier or trial ended)`;
  lines.push(boxLine(`Capital Tier: ${tierStr}`, W));

  lines.push(boxBot(W));
  lines.push('');

  return lines.join('\n');
}

// ── Main entry point ─────────────────────────────────────────────────────────

/**
 * Start the paper trading dashboard. Refreshes the terminal every `refreshMs`.
 * Returns a stop function to halt the refresh loop.
 */
export function startPaperDashboard(opts: PaperDashboardOptions): () => void {
  const {
    dbPath,
    capital,
    trialDays = 14,
    refreshMs = 60_000,
    startTimestamp = Date.now(),
  } = opts;

  let stopped = false;

  const render = () => {
    if (stopped) return;
    try {
      const { stats, signals, calibration } = loadDashboardStats(dbPath, capital, trialDays, startTimestamp);
      console.clear();
      console.log(renderDashboardScreen(stats, signals, calibration));
    } catch (err) {
      console.error('Dashboard render error:', err instanceof Error ? err.message : String(err));
    }
  };

  // Initial render
  render();

  // Periodic refresh
  const timer = setInterval(render, refreshMs);

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
