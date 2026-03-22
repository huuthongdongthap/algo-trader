import { describe, it, expect, vi } from 'vitest';
import { BUILT_IN_JOBS, registerBuiltInJobs } from '../../src/scheduler/job-registry.js';
import type { JobScheduler } from '../../src/scheduler/job-scheduler.js';

describe('BUILT_IN_JOBS', () => {
  it('should have at least 3 jobs', () => {
    expect(BUILT_IN_JOBS.length).toBeGreaterThanOrEqual(3);
  });

  it('should have unique names', () => {
    const names = BUILT_IN_JOBS.map(j => j.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('should all have handlers', () => {
    for (const job of BUILT_IN_JOBS) {
      expect(typeof job.handler).toBe('function');
    }
  });

  it('should include expected jobs', () => {
    const names = BUILT_IN_JOBS.map(j => j.name);
    expect(names).toContain('healthCheck');
    expect(names).toContain('dailyPnlReport');
    expect(names).toContain('marketScan');
  });

  it('should have interval strings', () => {
    for (const job of BUILT_IN_JOBS) {
      expect(typeof job.interval).toBe('string');
      expect(job.interval.length).toBeGreaterThan(0);
    }
  });
});

describe('registerBuiltInJobs', () => {
  it('should register all enabled jobs with scheduler', () => {
    const scheduler = { schedule: vi.fn() } as unknown as JobScheduler;
    registerBuiltInJobs(scheduler);
    const enabled = BUILT_IN_JOBS.filter(j => j.enabled).length;
    expect(scheduler.schedule).toHaveBeenCalledTimes(enabled);
  });

  it('should pass name, interval, handler to scheduler', () => {
    const scheduler = { schedule: vi.fn() } as unknown as JobScheduler;
    registerBuiltInJobs(scheduler);
    const firstEnabled = BUILT_IN_JOBS.find(j => j.enabled)!;
    expect(scheduler.schedule).toHaveBeenCalledWith(
      firstEnabled.name,
      firstEnabled.interval,
      firstEnabled.handler,
    );
  });

  it('should skip disabled jobs', () => {
    // Temporarily disable a job
    const original = BUILT_IN_JOBS[0].enabled;
    BUILT_IN_JOBS[0].enabled = false;
    const scheduler = { schedule: vi.fn() } as unknown as JobScheduler;
    registerBuiltInJobs(scheduler);
    const enabledCount = BUILT_IN_JOBS.filter(j => j.enabled).length;
    expect(scheduler.schedule).toHaveBeenCalledTimes(enabledCount);
    BUILT_IN_JOBS[0].enabled = original; // restore
  });
});
