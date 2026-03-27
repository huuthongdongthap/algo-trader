/**
 * Settlement Listener
 * Monitors Polymarket binary markets approaching resolution.
 * Polls the Polymarket API and emits 'settlement' events when markets resolve.
 * Uses EventEmitter pattern for decoupled downstream processing.
 */

import { EventEmitter } from 'events';

/** Outcome of a resolved binary market */
export interface SettlementEvent {
  conditionId: string;
  question: string;
  outcome: 'YES' | 'NO';
  settledAt: number;
  /** USD payout per share (typically 1.00 for winner, 0.00 for loser) */
  payoutPerShare: number;
}

export interface SettlementListenerConfig {
  /** How often to poll for resolution in milliseconds */
  pollIntervalMs: number;
  /** Maximum number of markets to watch simultaneously */
  maxMarketsToWatch: number;
  /** Polymarket API base URL */
  apiBaseUrl?: string;
}

const DEFAULT_API = 'https://clob.polymarket.com';

/** Internal watch entry */
interface WatchEntry {
  conditionId: string;
  question: string;
  addedAt: number;
}

export class SettlementListener extends EventEmitter {
  private config: SettlementListenerConfig;
  private watched = new Map<string, WatchEntry>();
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private readonly apiBase: string;

  constructor(config: SettlementListenerConfig) {
    super();
    this.config = config;
    this.apiBase = config.apiBaseUrl ?? DEFAULT_API;
  }

  /**
   * Start watching a market for settlement.
   * Silently ignores if already watching or watch limit reached.
   */
  watchMarket(conditionId: string, question = ''): void {
    if (this.watched.has(conditionId)) return;
    if (this.watched.size >= this.config.maxMarketsToWatch) {
      this.emit('error', new Error(`Watch limit (${this.config.maxMarketsToWatch}) reached`));
      return;
    }
    this.watched.set(conditionId, { conditionId, question, addedAt: Date.now() });
    if (!this.pollTimer) this.startPolling();
  }

  /** Stop watching a specific market */
  unwatchMarket(conditionId: string): void {
    this.watched.delete(conditionId);
    if (this.watched.size === 0) this.stopPolling();
  }

  /**
   * Manually trigger a settlement check cycle.
   * Returns any newly resolved markets found in this cycle.
   */
  async checkSettlement(): Promise<SettlementEvent[]> {
    if (this.watched.size === 0) return [];

    const conditionIds = Array.from(this.watched.keys());
    const events: SettlementEvent[] = [];

    await Promise.allSettled(
      conditionIds.map(async (id) => {
        const event = await this.fetchResolution(id);
        if (event) {
          events.push(event);
          this.watched.delete(id);
          this.emit('settlement', event);
        }
      })
    );

    if (this.watched.size === 0) this.stopPolling();
    return events;
  }

  /** Stop polling and remove all watched markets */
  destroy(): void {
    this.stopPolling();
    this.watched.clear();
    this.removeAllListeners();
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      this.checkSettlement().catch((err) => this.emit('error', err));
    }, this.config.pollIntervalMs);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  /**
   * Fetch resolution status from Polymarket CLOB API.
   * Returns null if market is still open/unresolved.
   */
  private async fetchResolution(conditionId: string): Promise<SettlementEvent | null> {
    const entry = this.watched.get(conditionId);
    if (!entry) return null;

    const response = await fetch(`${this.apiBase}/markets/${conditionId}`);
    if (!response.ok) return null;

    const data = await response.json() as PolymarketMarketResponse;
    if (!data.closed || data.winner == null) return null;

    const outcome = data.winner.toUpperCase() as 'YES' | 'NO';
    return {
      conditionId,
      question: entry.question || data.question || conditionId,
      outcome,
      settledAt: data.end_date_iso ? new Date(data.end_date_iso).getTime() : Date.now(),
      payoutPerShare: outcome === 'YES' ? 1.0 : 0.0,
    };
  }
}

/** Minimal Polymarket API market response shape */
interface PolymarketMarketResponse {
  condition_id: string;
  question?: string;
  closed: boolean;
  winner?: string;
  end_date_iso?: string;
}
