// In-memory ring buffer tracking job execution history (last 1000 runs)
import { logger } from '../core/logger.js';

export interface JobRun {
  jobName: string;
  startedAt: Date;
  completedAt: Date;
  durationMs: number;
  success: boolean;
  error?: string;
}

export interface JobStats {
  jobName: string;
  totalRuns: number;
  successCount: number;
  failureCount: number;
  successRate: number;   // 0–1
  avgDurationMs: number;
  lastRun: Date | null;
  lastSuccess: Date | null;
  lastFailure: Date | null;
}

const RING_CAPACITY = 1000;

export class JobHistory {
  /** Ring buffer — oldest entry overwritten when capacity exceeded */
  private buffer: JobRun[] = [];
  private head = 0;      // next write index
  private count = 0;     // total items stored (capped at RING_CAPACITY)

  /** Add a run record. Overwrites oldest entry when buffer is full. */
  recordRun(run: JobRun): void {
    if (this.buffer.length < RING_CAPACITY) {
      this.buffer.push(run);
    } else {
      this.buffer[this.head] = run;
    }
    this.head = (this.head + 1) % RING_CAPACITY;
    this.count = Math.min(this.count + 1, RING_CAPACITY);
    logger.debug('Run recorded', 'JobHistory', {
      job: run.jobName,
      success: run.success,
      durationMs: run.durationMs,
    });
  }

  /**
   * Return runs in chronological order (oldest first).
   * @param jobName  Optional filter by job name.
   * @param limit    Max results returned (default: all).
   */
  getHistory(jobName?: string, limit?: number): JobRun[] {
    // Reconstruct chronological order from ring buffer
    const ordered = this._orderedRuns();
    const filtered = jobName ? ordered.filter(r => r.jobName === jobName) : ordered;
    return limit !== undefined ? filtered.slice(-limit) : filtered;
  }

  /** Compute stats for a specific job (or all jobs if name omitted). */
  getStats(jobName: string): JobStats {
    const runs = this._orderedRuns().filter(r => r.jobName === jobName);

    const successRuns = runs.filter(r => r.success);
    const failureRuns = runs.filter(r => !r.success);
    const avgDurationMs = runs.length
      ? runs.reduce((sum, r) => sum + r.durationMs, 0) / runs.length
      : 0;

    return {
      jobName,
      totalRuns: runs.length,
      successCount: successRuns.length,
      failureCount: failureRuns.length,
      successRate: runs.length ? successRuns.length / runs.length : 0,
      avgDurationMs: Math.round(avgDurationMs),
      lastRun: runs.length ? runs[runs.length - 1].startedAt : null,
      lastSuccess: successRuns.length ? successRuns[successRuns.length - 1].startedAt : null,
      lastFailure: failureRuns.length ? failureRuns[failureRuns.length - 1].startedAt : null,
    };
  }

  /** Total runs stored (capped at ring capacity). */
  get size(): number {
    return this.count;
  }

  /** Clear all history. */
  clear(): void {
    this.buffer = [];
    this.head = 0;
    this.count = 0;
  }

  // ── private ──────────────────────────────────────────────────────────────

  /** Reconstruct chronological order from the ring buffer. */
  private _orderedRuns(): JobRun[] {
    if (this.buffer.length < RING_CAPACITY) return [...this.buffer];
    // buffer is full: head points to oldest entry
    return [
      ...this.buffer.slice(this.head),
      ...this.buffer.slice(0, this.head),
    ];
  }
}
