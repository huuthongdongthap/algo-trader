// Process health monitor with auto-restart — tracks memory usage and consecutive failures
export interface ProcessHealth {
  name: string;
  healthy: boolean;
  consecutiveFailures: number;
  lastCheckAt: number | null;
  /** Resident set size in MB at last check */
  memoryMb: number;
  /** Total health checks performed */
  checkCount: number;
}

interface MonitoredProcess {
  health: ProcessHealth;
  healthCheckFn: () => Promise<boolean>;
  /** Called when consecutive failures exceed threshold */
  restartFn?: () => Promise<void>;
}

export interface HealthReport {
  timestamp: number;
  processes: ProcessHealth[];
  /** Overall system memory usage in MB */
  systemMemoryMb: number;
  allHealthy: boolean;
}

/** Tracks process health metrics and triggers restarts on repeated failures */
export class ProcessMonitor {
  private readonly processes = new Map<string, MonitoredProcess>();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  /** Number of consecutive failures before restart is triggered */
  private readonly restartThreshold: number;

  constructor(restartThreshold = 3) {
    this.restartThreshold = restartThreshold;
  }

  /** Add a process to the monitor registry */
  registerProcess(
    name: string,
    healthCheckFn: () => Promise<boolean>,
    restartFn?: () => Promise<void>,
  ): void {
    if (this.processes.has(name)) {
      throw new Error(`Process '${name}' already registered`);
    }

    this.processes.set(name, {
      healthCheckFn,
      restartFn,
      health: {
        name,
        healthy: true,
        consecutiveFailures: 0,
        lastCheckAt: null,
        memoryMb: 0,
        checkCount: 0,
      },
    });
  }

  /** Begin periodic health checks; returns a stop function */
  startMonitoring(intervalMs = 30_000): () => void {
    if (this.intervalHandle !== null) {
      throw new Error('Monitoring already running');
    }

    this.intervalHandle = setInterval(() => {
      void this.runAllChecks();
    }, intervalMs);

    // Run an immediate first pass
    void this.runAllChecks();

    return () => this.stopMonitoring();
  }

  stopMonitoring(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /** Return snapshot of all process health states */
  getHealthReport(): HealthReport {
    const processes = Array.from(this.processes.values()).map((p) => ({ ...p.health }));
    const mem = process.memoryUsage();
    return {
      timestamp: Date.now(),
      processes,
      systemMemoryMb: Math.round(mem.rss / 1024 / 1024),
      allHealthy: processes.every((p) => p.healthy),
    };
  }

  /** Run health check for a single process and handle restart logic */
  private async checkProcess(entry: MonitoredProcess): Promise<void> {
    const mem = process.memoryUsage();
    entry.health.memoryMb = Math.round(mem.rss / 1024 / 1024);
    entry.health.lastCheckAt = Date.now();
    entry.health.checkCount += 1;

    try {
      const ok = await entry.healthCheckFn();
      if (ok) {
        entry.health.healthy = true;
        entry.health.consecutiveFailures = 0;
      } else {
        this.recordFailure(entry);
      }
    } catch {
      this.recordFailure(entry);
    }
  }

  private recordFailure(entry: MonitoredProcess): void {
    entry.health.healthy = false;
    entry.health.consecutiveFailures += 1;

    if (
      entry.health.consecutiveFailures >= this.restartThreshold &&
      entry.restartFn
    ) {
      void entry.restartFn().catch(() => {
        // Restart errors are intentionally swallowed to keep monitor alive
      });
    }
  }

  private async runAllChecks(): Promise<void> {
    await Promise.allSettled(
      Array.from(this.processes.values()).map((p) => this.checkProcess(p)),
    );
  }
}
