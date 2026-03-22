import { describe, it, expect, afterEach } from 'vitest';
import { JobScheduler, parseInterval } from '../../src/scheduler/job-scheduler.js';

describe('parseInterval', () => {
  it('should parse minute intervals', () => {
    expect(parseInterval('every 1m')).toBe(60_000);
    expect(parseInterval('every 5min')).toBe(300_000);
    expect(parseInterval('every 30 minutes')).toBe(1_800_000);
  });

  it('should parse hour intervals', () => {
    expect(parseInterval('every 1h')).toBe(3_600_000);
    expect(parseInterval('every 4 hours')).toBe(14_400_000);
  });

  it('should parse day intervals', () => {
    expect(parseInterval('every 1d')).toBe(86_400_000);
    expect(parseInterval('every 2 days')).toBe(172_800_000);
  });

  it('should parse daily at HH:MM as 24h', () => {
    expect(parseInterval('daily at 09:00')).toBe(86_400_000);
  });

  it('should throw for unrecognized expressions', () => {
    expect(() => parseInterval('every fortnight')).toThrow();
    expect(() => parseInterval('sometime')).toThrow();
  });
});

describe('JobScheduler', () => {
  let scheduler: JobScheduler;

  afterEach(() => {
    scheduler?.stop();
  });

  it('should register and list jobs', () => {
    scheduler = new JobScheduler();
    scheduler.schedule('job-a', 'every 1m', async () => {});
    scheduler.schedule('job-b', 'every 5m', async () => {});
    expect(scheduler.listJobs()).toContain('job-a');
    expect(scheduler.listJobs()).toContain('job-b');
  });

  it('should not register duplicate job names', () => {
    scheduler = new JobScheduler();
    scheduler.schedule('dup', 'every 1m', async () => {});
    scheduler.schedule('dup', 'every 5m', async () => {});
    expect(scheduler.listJobs().filter(j => j === 'dup').length).toBe(1);
  });

  it('should skip jobs with invalid interval', () => {
    scheduler = new JobScheduler();
    scheduler.schedule('bad-job', 'invalid', async () => {});
    expect(scheduler.listJobs()).not.toContain('bad-job');
  });

  it('should run job immediately with runNow', async () => {
    scheduler = new JobScheduler();
    let ran = false;
    scheduler.schedule('manual', 'every 1h', async () => { ran = true; });
    await scheduler.runNow('manual');
    expect(ran).toBe(true);
  });

  it('should throw for runNow on unknown job', async () => {
    scheduler = new JobScheduler();
    await expect(scheduler.runNow('nonexistent')).rejects.toThrow('Unknown job');
  });

  it('should record successful run in history', async () => {
    scheduler = new JobScheduler();
    scheduler.schedule('tracked', 'every 1h', async () => {});
    await scheduler.runNow('tracked');
    const history = scheduler.getHistory();
    const runs = history.getHistory('tracked');
    expect(runs.length).toBe(1);
    expect(runs[0].success).toBe(true);
  });

  it('should record failed run in history', async () => {
    scheduler = new JobScheduler();
    scheduler.schedule('failing', 'every 1h', async () => { throw new Error('boom'); });
    await scheduler.runNow('failing');
    const runs = scheduler.getHistory().getHistory('failing');
    expect(runs.length).toBe(1);
    expect(runs[0].success).toBe(false);
    expect(runs[0].error).toBe('boom');
  });

  it('should start and stop scheduler', () => {
    scheduler = new JobScheduler();
    scheduler.schedule('periodic', 'every 1m', async () => {});
    scheduler.start();
    // Starting twice is safe (idempotent)
    scheduler.start();
    scheduler.stop();
  });

  it('should auto-start job if scheduled after start()', async () => {
    scheduler = new JobScheduler();
    scheduler.start();
    let called = false;
    scheduler.schedule('late-add', 'every 1m', async () => { called = true; });
    // Job should be registered and timer set
    expect(scheduler.listJobs()).toContain('late-add');
    await scheduler.runNow('late-add');
    expect(called).toBe(true);
  });
});
