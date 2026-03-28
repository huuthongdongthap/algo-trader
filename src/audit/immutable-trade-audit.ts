/**
 * Immutable Trade Audit Log
 * Append-only log with SHA-256 hash chain for tamper detection.
 * Every trade decision, circuit breaker event, and drawdown tier change is logged.
 */

import { createHash } from 'crypto';
import { logger } from '../utils/logger';

export type TradeAuditEventType =
  | 'trade_decision'
  | 'trade_executed'
  | 'trade_rejected'
  | 'circuit_breaker'
  | 'drawdown_tier_change'
  | 'kelly_sizing'
  | 'twap_chunk'
  | 'wallet_trade'
  | 'manual_override';

export interface TradeAuditEntry {
  id: string;
  sequenceNumber: number;
  timestamp: string;
  eventType: TradeAuditEventType;
  walletLabel?: string;
  marketId?: string;
  signal?: string;
  kellySize?: number;
  actualSize?: number;
  price?: number;
  side?: 'buy' | 'sell';
  reason: string;
  metadata?: Record<string, unknown>;
  /** SHA-256 hash of this entry (includes previous hash for chain) */
  hash: string;
  /** Hash of the previous entry (genesis entry has '0') */
  previousHash: string;
}

export interface AuditTrailQuery {
  walletLabel?: string;
  eventType?: TradeAuditEventType;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

export class ImmutableTradeAudit {
  private entries: TradeAuditEntry[] = [];
  private sequenceCounter: number = 0;

  /** Append a new entry to the immutable log */
  append(
    eventType: TradeAuditEventType,
    reason: string,
    data?: Partial<Pick<TradeAuditEntry, 'walletLabel' | 'marketId' | 'signal' | 'kellySize' | 'actualSize' | 'price' | 'side' | 'metadata'>>
  ): TradeAuditEntry {
    const previousHash = this.entries.length > 0
      ? this.entries[this.entries.length - 1].hash
      : '0';

    this.sequenceCounter++;

    const entry: Omit<TradeAuditEntry, 'hash'> & { hash?: string } = {
      id: `audit_${this.sequenceCounter}_${Date.now()}`,
      sequenceNumber: this.sequenceCounter,
      timestamp: new Date().toISOString(),
      eventType,
      reason,
      previousHash,
      ...data,
      hash: '', // placeholder
    };

    // Compute SHA-256 hash including previous hash (chain integrity)
    entry.hash = this.computeHash(entry as TradeAuditEntry);
    const finalEntry = entry as TradeAuditEntry;

    this.entries.push(finalEntry);

    logger.info(`[TradeAudit] #${finalEntry.sequenceNumber} ${eventType}: ${reason}`);
    return finalEntry;
  }

  /** Log a trade decision */
  logTradeDecision(
    marketId: string, side: 'buy' | 'sell', signal: string,
    kellySize: number, actualSize: number, walletLabel: string, reason: string
  ): TradeAuditEntry {
    return this.append('trade_decision', reason, {
      marketId, side, signal, kellySize, actualSize, walletLabel,
    });
  }

  /** Log a circuit breaker event */
  logCircuitBreaker(reason: string, metadata?: Record<string, unknown>): TradeAuditEntry {
    return this.append('circuit_breaker', reason, { metadata });
  }

  /** Log a drawdown tier change */
  logDrawdownTierChange(
    tier: string, drawdownPercent: number, portfolioValue: number
  ): TradeAuditEntry {
    return this.append('drawdown_tier_change', `Tier changed to ${tier}`, {
      metadata: { tier, drawdownPercent, portfolioValue },
    });
  }

  /** Query the audit trail with filters (returns deep copies) */
  getAuditTrail(query?: AuditTrailQuery): TradeAuditEntry[] {
    let results = this.entries.map(e => ({ ...e }));

    if (query?.walletLabel) {
      results = results.filter(e => e.walletLabel === query.walletLabel);
    }
    if (query?.eventType) {
      results = results.filter(e => e.eventType === query.eventType);
    }
    if (query?.startDate) {
      results = results.filter(e => e.timestamp >= query.startDate!);
    }
    if (query?.endDate) {
      results = results.filter(e => e.timestamp <= query.endDate!);
    }
    if (query?.limit) {
      results = results.slice(-query.limit);
    }

    return results;
  }

  /** Verify the integrity of the entire hash chain */
  verifyChainIntegrity(): { valid: boolean; brokenAt?: number; reason?: string } {
    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      // Check previous hash linkage
      if (i === 0) {
        if (entry.previousHash !== '0') {
          return { valid: false, brokenAt: i, reason: 'Genesis entry previousHash != 0' };
        }
      } else {
        if (entry.previousHash !== this.entries[i - 1].hash) {
          return { valid: false, brokenAt: i, reason: `previousHash mismatch at sequence ${entry.sequenceNumber}` };
        }
      }

      // Recompute and verify hash
      const expectedHash = this.computeHash(entry);
      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: i, reason: `Hash mismatch at sequence ${entry.sequenceNumber}` };
      }
    }

    return { valid: true };
  }

  /** Get total entry count */
  getEntryCount(): number {
    return this.entries.length;
  }

  /** Get the latest entry */
  getLatestEntry(): TradeAuditEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  /** Compute SHA-256 hash for an entry (includes previousHash for chaining) */
  private computeHash(entry: TradeAuditEntry): string {
    const payload = JSON.stringify({
      id: entry.id,
      sequenceNumber: entry.sequenceNumber,
      timestamp: entry.timestamp,
      eventType: entry.eventType,
      walletLabel: entry.walletLabel,
      marketId: entry.marketId,
      signal: entry.signal,
      kellySize: entry.kellySize,
      actualSize: entry.actualSize,
      price: entry.price,
      side: entry.side,
      reason: entry.reason,
      metadata: entry.metadata,
      previousHash: entry.previousHash,
    });

    return createHash('sha256').update(payload).digest('hex');
  }
}
