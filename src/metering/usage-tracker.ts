// Usage tracking module for algo-trade RaaS billing metering
// Tracks API calls per user with sliding window and automatic cleanup

const CLEANUP_INTERVAL_MS = 60_000; // run cleanup every minute
const MAX_RECORD_AGE_MS = 24 * 60 * 60 * 1_000; // 24 hours

export interface UsageRecord {
  userId: string;
  endpoint: string;
  timestamp: number;
  responseTimeMs: number;
}

export class UsageTracker {
  /** Primary store: userId → ordered list of records */
  private readonly records = new Map<string, UsageRecord[]>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    // Automatically purge old records to prevent unbounded memory growth
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  /**
   * Log a single API call for a user.
   */
  recordCall(userId: string, endpoint: string, responseTimeMs: number): void {
    const record: UsageRecord = {
      userId,
      endpoint,
      timestamp: Date.now(),
      responseTimeMs,
    };

    const bucket = this.records.get(userId);
    if (bucket) {
      bucket.push(record);
    } else {
      this.records.set(userId, [record]);
    }
  }

  /**
   * Total number of API calls made by a user within the last `periodMs` ms.
   */
  getUsage(userId: string, periodMs: number): number {
    return this.getRecordsInWindow(userId, periodMs).length;
  }

  /**
   * Breakdown of call counts per endpoint for a user within the last `periodMs` ms.
   */
  getEndpointBreakdown(userId: string, periodMs: number = MAX_RECORD_AGE_MS): Record<string, number> {
    const recent = this.getRecordsInWindow(userId, periodMs);
    const breakdown: Record<string, number> = {};
    for (const r of recent) {
      breakdown[r.endpoint] = (breakdown[r.endpoint] ?? 0) + 1;
    }
    return breakdown;
  }

  /**
   * List of unique userIds that have made at least one call within `periodMs` ms.
   */
  getActiveUsers(periodMs: number): string[] {
    const cutoff = Date.now() - periodMs;
    const active: string[] = [];
    for (const [userId, bucket] of this.records) {
      if (bucket.some((r) => r.timestamp >= cutoff)) {
        active.push(userId);
      }
    }
    return active;
  }

  /**
   * Return raw records for a user within the sliding window.
   */
  getUserRecords(userId: string, periodMs: number = MAX_RECORD_AGE_MS): UsageRecord[] {
    return this.getRecordsInWindow(userId, periodMs);
  }

  /**
   * All known userIds (including inactive ones still in memory).
   */
  getAllUserIds(): string[] {
    return Array.from(this.records.keys());
  }

  /**
   * Stop the background cleanup timer (call during graceful shutdown).
   */
  destroy(): void {
    if (this.cleanupTimer !== null) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getRecordsInWindow(userId: string, periodMs: number): UsageRecord[] {
    const bucket = this.records.get(userId);
    if (!bucket) return [];
    const cutoff = Date.now() - periodMs;
    return bucket.filter((r) => r.timestamp >= cutoff);
  }

  /** Remove records older than 24 h; delete empty user buckets. */
  private cleanup(): void {
    const cutoff = Date.now() - MAX_RECORD_AGE_MS;
    for (const [userId, bucket] of this.records) {
      const trimmed = bucket.filter((r) => r.timestamp >= cutoff);
      if (trimmed.length === 0) {
        this.records.delete(userId);
      } else {
        this.records.set(userId, trimmed);
      }
    }
  }
}
