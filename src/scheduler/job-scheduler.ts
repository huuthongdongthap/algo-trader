// Cron-like job scheduler using setInterval, no external deps
import { logger } from '../core/logger.js';
import { JobHistory } from './job-history.js';

/** Parse human-readable interval to milliseconds.
 *  Supported: 'every 1m', 'every 30m', 'every 1h', 'every 4h', 'every 1d',
 *             'daily at HH:MM' (schedules next occurrence, then repeats 24h)
 */
export function parseInterval(expr: string): number {
  const trimmed = expr.trim().toLowerCase();

  // 'every Nm' | 'every Nh' | 'every Nd'
  const everyMatch = trimmed.match(/^every\s+(\d+(?:\.\d+)?)\s*(m|min|minutes?|h|hours?|d|days?)$/);
  if (everyMatch) {
    const value = parseFloat(everyMatch[1]);
    const unit = everyMatch[2];
    if (unit.startsWith('m')) return value * 60_000;
    if (unit.startsWith('h')) return value * 3_600_000;
    if (unit.startsWith('d')) return value * 86_400_000;
  }

  // 'daily at HH:MM' — returns ms until next occurrence (then treated as 24h repeat)
  const dailyMatch = trimmed.match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/);
  if (dailyMatch) {
    return 86_400_000; // caller computes first delay separately
  }

  throw new Error(`Unrecognised interval expression: "${expr}"`);
}

/** Compute ms until the next 'daily at HH:MM' occurrence */
function msUntilDailyAt(hh: number, mm: number): number {
  const now = new Date();
  const target = new Date(now);
  target.setHours(hh, mm, 0, 0);
  if (target <= now) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

export type JobFn = () => Promise<void> | void;

interface ScheduledJob {
  name: string;
  interval: string;
  fn: JobFn;
  timer: ReturnType<typeof setInterval> | ReturnType<typeof setTimeout> | null;
  /** Resolved period in ms (0 = daily-at, use firstTimer) */
  periodMs: number;
}

export class JobScheduler {
  private jobs = new Map<string, ScheduledJob>();
  private running = false;
  private history: JobHistory;

  constructor(history?: JobHistory) {
    this.history = history ?? new JobHistory();
  }

  getHistory(): JobHistory {
    return this.history;
  }

  /** Register a recurring job. Safe to call before or after start(). */
  schedule(name: string, interval: string, fn: JobFn): void {
    if (this.jobs.has(name)) {
      logger.warn(`Job already registered, skipping`, 'JobScheduler', { name });
      return;
    }

    let periodMs: number;
    try {
      periodMs = parseInterval(interval);
    } catch (err) {
      logger.error(`Failed to parse interval for job`, 'JobScheduler', { name, interval, err: String(err) });
      return;
    }

    const job: ScheduledJob = { name, interval, fn, timer: null, periodMs };
    this.jobs.set(name, job);

    if (this.running) this._startJob(job);
    logger.debug(`Job registered`, 'JobScheduler', { name, interval });
  }

  /** Begin scheduling loop for all registered jobs. */
  start(): void {
    if (this.running) return;
    this.running = true;
    for (const job of this.jobs.values()) this._startJob(job);
    logger.info(`Scheduler started with ${this.jobs.size} jobs`, 'JobScheduler');
  }

  /** Cancel all timers. */
  stop(): void {
    this.running = false;
    for (const job of this.jobs.values()) {
      if (job.timer !== null) {
        clearInterval(job.timer as ReturnType<typeof setInterval>);
        clearTimeout(job.timer as ReturnType<typeof setTimeout>);
        job.timer = null;
      }
    }
    logger.info('Scheduler stopped', 'JobScheduler');
  }

  /** Execute a job immediately (outside normal schedule). */
  async runNow(name: string): Promise<void> {
    const job = this.jobs.get(name);
    if (!job) throw new Error(`Unknown job: ${name}`);
    await this._execute(job);
  }

  /** List all registered job names. */
  listJobs(): string[] {
    return [...this.jobs.keys()];
  }

  // ── private ─────────────────────────────────────────────────────────────

  private _startJob(job: ScheduledJob): void {
    const dailyMatch = job.interval.trim().toLowerCase().match(/^daily\s+at\s+(\d{1,2}):(\d{2})$/);

    if (dailyMatch) {
      const hh = parseInt(dailyMatch[1], 10);
      const mm = parseInt(dailyMatch[2], 10);
      const firstDelay = msUntilDailyAt(hh, mm);

      job.timer = setTimeout(() => {
        void this._execute(job);
        // After first fire, repeat every 24h
        job.timer = setInterval(() => void this._execute(job), 86_400_000);
      }, firstDelay);
    } else {
      job.timer = setInterval(() => void this._execute(job), job.periodMs);
    }
  }

  private async _execute(job: ScheduledJob): Promise<void> {
    const startedAt = new Date();
    logger.debug(`Running job`, 'JobScheduler', { name: job.name });
    try {
      await job.fn();
      const completedAt = new Date();
      this.history.recordRun({
        jobName: job.name,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        success: true,
      });
      logger.debug(`Job completed`, 'JobScheduler', { name: job.name });
    } catch (err) {
      const completedAt = new Date();
      const error = err instanceof Error ? err.message : String(err);
      this.history.recordRun({
        jobName: job.name,
        startedAt,
        completedAt,
        durationMs: completedAt.getTime() - startedAt.getTime(),
        success: false,
        error,
      });
      logger.error(`Job failed`, 'JobScheduler', { name: job.name, error });
    }
  }
}
