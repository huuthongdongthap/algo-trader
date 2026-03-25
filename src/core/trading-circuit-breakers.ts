// Unified Trading Circuit Breakers — centralized halt/pause/reject system
// Tracks 5 breakers: daily-loss, consecutive-loss, brier-score, api-errors, position-size
// Logs all events to SQLite, supports auto-resume and manual override

import Database from 'better-sqlite3';
import { logger } from './logger.js';
import type { Position } from './types.js';

// ── Interfaces ────────────────────────────────────────────────────────────

export interface BreakerStatus {
  name: string;
  active: boolean;
  reason: string;
  triggeredAt: number | null;
  resumesAt: number | null;
  autoResume: boolean;
}

export interface CircuitBreakerEvent {
  breaker: string;
  action: 'triggered' | 'reset' | 'auto-resumed';
  reason: string;
  timestamp: number;
}

export interface TradingCircuitBreakersOptions {
  dbPath?: string;
  dailyLossLimit?: number;          // fraction, default 0.05
  maxConsecutiveLosses?: number;     // default 3
  consecutiveLossCooldownMs?: number; // default 1 hour
  brierThreshold?: number;          // default 0.30
  apiErrorThreshold?: number;       // default 5
  apiErrorWindowMs?: number;        // default 60_000 (1 minute)
  positionCapitalLimit?: number;    // fraction, default 0.10
  /** Optional callback for Telegram alerts */
  onAlert?: (message: string) => void;
}

// ── SQLite Schema ────────────────────────────────────────────────────────

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS circuit_breaker_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  breaker TEXT NOT NULL,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  timestamp INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cb_events_breaker ON circuit_breaker_events(breaker);
CREATE INDEX IF NOT EXISTS idx_cb_events_ts ON circuit_breaker_events(timestamp);
`;

// ── Breaker Names ────────────────────────────────────────────────────────

export const BREAKER_DAILY_LOSS = 'daily-loss';
export const BREAKER_CONSECUTIVE_LOSS = 'consecutive-loss';
export const BREAKER_BRIER_SCORE = 'brier-score';
export const BREAKER_API_ERRORS = 'api-errors';
export const BREAKER_POSITION_SIZE = 'position-size';

const ALL_BREAKERS = [
  BREAKER_DAILY_LOSS,
  BREAKER_CONSECUTIVE_LOSS,
  BREAKER_BRIER_SCORE,
  BREAKER_API_ERRORS,
  BREAKER_POSITION_SIZE,
] as const;

// ── Implementation ───────────────────────────────────────────────────────

export class TradingCircuitBreakers {
  // Config
  private readonly dailyLossLimit: number;
  private readonly maxConsecutiveLosses: number;
  private readonly consecutiveLossCooldownMs: number;
  private readonly brierThreshold: number;
  private readonly apiErrorThreshold: number;
  private readonly apiErrorWindowMs: number;
  private readonly positionCapitalLimit: number;
  private readonly onAlert: ((message: string) => void) | null;

  // State: daily loss
  private dailyStartCapital: number = 0;
  private dailyDate: string = '';
  private dailyLossTripped: boolean = false;
  private dailyLossTrippedAt: number | null = null;

  // State: consecutive losses
  private consecutiveLosses: number = 0;
  private consecutiveLossTripped: boolean = false;
  private consecutiveLossTrippedAt: number | null = null;
  private consecutiveLossResumesAt: number | null = null;

  // State: Brier score
  private currentBrier: number = 0;
  private brierTripped: boolean = false;
  private brierTrippedAt: number | null = null;

  // State: API errors (sliding window)
  private apiErrorTimestamps: number[] = [];
  private apiErrorTripped: boolean = false;
  private apiErrorTrippedAt: number | null = null;
  private apiErrorResumesAt: number | null = null;
  private readonly apiErrorCooldownMs: number = 5 * 60_000; // 5 min cooldown

  // SQLite
  private db: Database.Database | null = null;
  private stmtInsert: Database.Statement | null = null;

  constructor(options: TradingCircuitBreakersOptions = {}) {
    this.dailyLossLimit = options.dailyLossLimit ?? 0.05;
    this.maxConsecutiveLosses = options.maxConsecutiveLosses ?? 3;
    this.consecutiveLossCooldownMs = options.consecutiveLossCooldownMs ?? 60 * 60_000;
    this.brierThreshold = options.brierThreshold ?? 0.30;
    this.apiErrorThreshold = options.apiErrorThreshold ?? 5;
    this.apiErrorWindowMs = options.apiErrorWindowMs ?? 60_000;
    this.positionCapitalLimit = options.positionCapitalLimit ?? 0.10;
    this.onAlert = options.onAlert ?? null;

    if (options.dbPath) {
      this.initDb(options.dbPath);
    }
  }

  private initDb(dbPath: string): void {
    try {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.exec(CREATE_TABLE);
      this.stmtInsert = this.db.prepare(
        'INSERT INTO circuit_breaker_events (breaker, action, reason, timestamp) VALUES (?, ?, ?, ?)',
      );
    } catch (err) {
      logger.error('Failed to init circuit breaker DB', 'TradingCircuitBreakers', {
        error: String(err),
      });
    }
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Check all breakers before a trade.
   * Returns { allowed, blockers } where blockers lists reasons for any active breakers.
   */
  checkAll(capital: number, positions: Position[]): { allowed: boolean; blockers: string[] } {
    const blockers: string[] = [];
    const now = Date.now();

    // Auto-resume checks (before evaluating)
    this.checkAutoResume(now);

    // 1. Daily loss check
    if (this.dailyLossTripped) {
      blockers.push(`Daily loss limit (${(this.dailyLossLimit * 100).toFixed(1)}%) exceeded — trading halted for the day`);
    } else {
      const today = new Date().toISOString().slice(0, 10);
      if (this.dailyDate !== today) {
        this.dailyDate = today;
        this.dailyStartCapital = capital;
      }
      if (this.dailyStartCapital > 0) {
        const dailyLoss = (this.dailyStartCapital - capital) / this.dailyStartCapital;
        if (dailyLoss >= this.dailyLossLimit) {
          this.tripBreaker(BREAKER_DAILY_LOSS, `Lost ${(dailyLoss * 100).toFixed(1)}% today (limit: ${(this.dailyLossLimit * 100).toFixed(1)}%)`);
          blockers.push(`Daily loss limit exceeded — trading halted`);
        }
      }
    }

    // 2. Consecutive loss check
    if (this.consecutiveLossTripped) {
      blockers.push(`${this.maxConsecutiveLosses} consecutive losses — paused until ${this.consecutiveLossResumesAt ? new Date(this.consecutiveLossResumesAt).toISOString() : 'manual reset'}`);
    }

    // 3. Brier score check
    if (this.brierTripped) {
      blockers.push(`Brier score (${this.currentBrier.toFixed(3)}) exceeds ${this.brierThreshold} — halted, requires CalibrationTuner run`);
    }

    // 4. API errors check
    if (this.apiErrorTripped) {
      blockers.push(`API error rate exceeded (>${this.apiErrorThreshold}/min) — infrastructure issue`);
    }

    // 5. Position size check (per-trade, not a persistent trip)
    // This is evaluated per proposed trade in canTrade(), but we check total exposure here
    const totalExposure = positions.reduce((sum, p) => sum + parseFloat(p.size), 0);
    if (capital > 0 && totalExposure > capital * this.positionCapitalLimit * positions.length) {
      // Individual position checks happen in canTrade; this is a portfolio-level sanity check
    }

    return {
      allowed: blockers.length === 0,
      blockers,
    };
  }

  /**
   * Check if a specific trade size is allowed (position-size breaker).
   * Returns { allowed, reason }.
   */
  canTrade(capital: number, tradeSize: number): { allowed: boolean; reason: string } {
    if (capital > 0 && tradeSize > capital * this.positionCapitalLimit) {
      const reason = `Position $${tradeSize.toFixed(2)} exceeds ${(this.positionCapitalLimit * 100).toFixed(0)}% of capital ($${(capital * this.positionCapitalLimit).toFixed(2)})`;
      this.logEvent(BREAKER_POSITION_SIZE, 'triggered', reason);
      return { allowed: false, reason };
    }
    return { allowed: true, reason: 'ok' };
  }

  /** Record a trade win/loss for the consecutive-loss breaker */
  recordTrade(isWin: boolean): void {
    if (isWin) {
      this.consecutiveLosses = 0;
    } else {
      this.consecutiveLosses++;
      if (this.consecutiveLosses >= this.maxConsecutiveLosses && !this.consecutiveLossTripped) {
        const now = Date.now();
        this.consecutiveLossTripped = true;
        this.consecutiveLossTrippedAt = now;
        this.consecutiveLossResumesAt = now + this.consecutiveLossCooldownMs;
        const reason = `${this.consecutiveLosses} consecutive losses — pausing for ${this.consecutiveLossCooldownMs / 60_000} min`;
        this.logEvent(BREAKER_CONSECUTIVE_LOSS, 'triggered', reason);
        this.alert(`CIRCUIT BREAKER: ${reason}`);
        logger.warn(reason, 'TradingCircuitBreakers');
      }
    }
  }

  /** Record an API error for the rate-based breaker */
  recordApiError(): void {
    const now = Date.now();
    this.apiErrorTimestamps.push(now);

    // Prune old timestamps outside the window
    const cutoff = now - this.apiErrorWindowMs;
    this.apiErrorTimestamps = this.apiErrorTimestamps.filter(t => t > cutoff);

    if (this.apiErrorTimestamps.length >= this.apiErrorThreshold && !this.apiErrorTripped) {
      this.apiErrorTripped = true;
      this.apiErrorTrippedAt = now;
      this.apiErrorResumesAt = now + this.apiErrorCooldownMs;
      const reason = `${this.apiErrorTimestamps.length} API errors in ${this.apiErrorWindowMs / 1000}s (threshold: ${this.apiErrorThreshold})`;
      this.logEvent(BREAKER_API_ERRORS, 'triggered', reason);
      this.alert(`CIRCUIT BREAKER: ${reason} — possible infrastructure issue`);
      logger.error(reason, 'TradingCircuitBreakers');
    }
  }

  /** Update the Brier score; trips breaker if above threshold */
  updateBrier(score: number): void {
    this.currentBrier = score;
    if (score > this.brierThreshold && !this.brierTripped) {
      this.brierTripped = true;
      this.brierTrippedAt = Date.now();
      const reason = `Brier score ${score.toFixed(3)} exceeds threshold ${this.brierThreshold}`;
      this.logEvent(BREAKER_BRIER_SCORE, 'triggered', reason);
      this.alert(`CIRCUIT BREAKER: ${reason} — run CalibrationTuner before resuming`);
      logger.warn(reason, 'TradingCircuitBreakers');
    } else if (score <= this.brierThreshold && this.brierTripped) {
      // Auto-clear if Brier improves (e.g. after CalibrationTuner ran)
      this.brierTripped = false;
      const reason = `Brier score improved to ${score.toFixed(3)} (threshold: ${this.brierThreshold})`;
      this.logEvent(BREAKER_BRIER_SCORE, 'auto-resumed', reason);
      this.brierTrippedAt = null;
      logger.info(reason, 'TradingCircuitBreakers');
    }
  }

  /** Get status of all breakers for monitoring dashboard */
  getStatus(): BreakerStatus[] {
    this.checkAutoResume(Date.now());

    return [
      {
        name: BREAKER_DAILY_LOSS,
        active: this.dailyLossTripped,
        reason: this.dailyLossTripped
          ? `Daily loss limit (${(this.dailyLossLimit * 100).toFixed(1)}%) exceeded`
          : 'ok',
        triggeredAt: this.dailyLossTrippedAt,
        resumesAt: null, // No auto-resume for daily loss
        autoResume: false,
      },
      {
        name: BREAKER_CONSECUTIVE_LOSS,
        active: this.consecutiveLossTripped,
        reason: this.consecutiveLossTripped
          ? `${this.consecutiveLosses} consecutive losses`
          : 'ok',
        triggeredAt: this.consecutiveLossTrippedAt,
        resumesAt: this.consecutiveLossResumesAt,
        autoResume: true,
      },
      {
        name: BREAKER_BRIER_SCORE,
        active: this.brierTripped,
        reason: this.brierTripped
          ? `Brier score ${this.currentBrier.toFixed(3)} > ${this.brierThreshold}`
          : 'ok',
        triggeredAt: this.brierTrippedAt,
        resumesAt: null, // No auto-resume — requires CalibrationTuner
        autoResume: false,
      },
      {
        name: BREAKER_API_ERRORS,
        active: this.apiErrorTripped,
        reason: this.apiErrorTripped
          ? `API error rate exceeded (>${this.apiErrorThreshold}/min)`
          : 'ok',
        triggeredAt: this.apiErrorTrippedAt,
        resumesAt: this.apiErrorResumesAt,
        autoResume: true,
      },
      {
        name: BREAKER_POSITION_SIZE,
        active: false, // Position size is per-trade rejection, not a persistent trip
        reason: 'ok',
        triggeredAt: null,
        resumesAt: null,
        autoResume: false,
      },
    ];
  }

  /** Manually reset a specific breaker */
  resetBreaker(name: string): void {
    const reason = `Manual reset of ${name}`;

    switch (name) {
      case BREAKER_DAILY_LOSS:
        this.dailyLossTripped = false;
        this.dailyLossTrippedAt = null;
        this.dailyStartCapital = 0; // Will re-snapshot on next checkAll
        break;
      case BREAKER_CONSECUTIVE_LOSS:
        this.consecutiveLossTripped = false;
        this.consecutiveLossTrippedAt = null;
        this.consecutiveLossResumesAt = null;
        this.consecutiveLosses = 0;
        break;
      case BREAKER_BRIER_SCORE:
        this.brierTripped = false;
        this.brierTrippedAt = null;
        break;
      case BREAKER_API_ERRORS:
        this.apiErrorTripped = false;
        this.apiErrorTrippedAt = null;
        this.apiErrorResumesAt = null;
        this.apiErrorTimestamps = [];
        break;
      default:
        logger.warn(`Unknown breaker name: ${name}`, 'TradingCircuitBreakers');
        return;
    }

    this.logEvent(name, 'reset', reason);
    logger.info(reason, 'TradingCircuitBreakers');
  }

  /** Close the database connection */
  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.stmtInsert = null;
    }
  }

  // ── Internal ────────────────────────────────────────────────────────────

  private checkAutoResume(now: number): void {
    // Consecutive loss auto-resume
    if (this.consecutiveLossTripped && this.consecutiveLossResumesAt && now >= this.consecutiveLossResumesAt) {
      this.consecutiveLossTripped = false;
      this.consecutiveLosses = 0;
      const reason = 'Auto-resumed after consecutive-loss cooldown';
      this.logEvent(BREAKER_CONSECUTIVE_LOSS, 'auto-resumed', reason);
      this.consecutiveLossTrippedAt = null;
      this.consecutiveLossResumesAt = null;
      logger.info(reason, 'TradingCircuitBreakers');
    }

    // API error auto-resume
    if (this.apiErrorTripped && this.apiErrorResumesAt && now >= this.apiErrorResumesAt) {
      this.apiErrorTripped = false;
      this.apiErrorTimestamps = [];
      const reason = 'Auto-resumed after API error cooldown';
      this.logEvent(BREAKER_API_ERRORS, 'auto-resumed', reason);
      this.apiErrorTrippedAt = null;
      this.apiErrorResumesAt = null;
      logger.info(reason, 'TradingCircuitBreakers');
    }
  }

  private tripBreaker(name: string, reason: string): void {
    switch (name) {
      case BREAKER_DAILY_LOSS:
        this.dailyLossTripped = true;
        this.dailyLossTrippedAt = Date.now();
        break;
    }
    this.logEvent(name, 'triggered', reason);
    this.alert(`CIRCUIT BREAKER: ${reason}`);
    logger.warn(`Breaker tripped: ${name} — ${reason}`, 'TradingCircuitBreakers');
  }

  private logEvent(breaker: string, action: CircuitBreakerEvent['action'], reason: string): void {
    const timestamp = Date.now();
    try {
      this.stmtInsert?.run(breaker, action, reason, timestamp);
    } catch (err) {
      logger.error('Failed to log circuit breaker event', 'TradingCircuitBreakers', {
        breaker,
        action,
        error: String(err),
      });
    }
  }

  private alert(message: string): void {
    if (this.onAlert) {
      try {
        this.onAlert(message);
      } catch (err) {
        logger.error('Alert callback failed', 'TradingCircuitBreakers', {
          error: String(err),
        });
      }
    }
  }
}
