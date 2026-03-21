// System health monitoring — tracks per-component status and uptime
import { logger } from '../core/logger.js';

export interface ComponentHealth {
  name: string;
  healthy: boolean;
  lastReportedAt: number;
  latencyMs: number | null;
  /** Number of consecutive failures */
  failureCount: number;
}

export interface HealthReport {
  overall: boolean;
  uptimeMs: number;
  components: ComponentHealth[];
  checkedAt: string;
}

export class HealthChecker {
  private readonly components = new Map<string, ComponentHealth>();
  private readonly startedAt: number;

  constructor() {
    this.startedAt = Date.now();
  }

  /** Add a component to the health monitor (starts as healthy=false until first report) */
  registerComponent(name: string): void {
    if (this.components.has(name)) {
      logger.warn(`Component already registered: ${name}`, 'HealthChecker');
      return;
    }
    this.components.set(name, {
      name,
      healthy: false,
      lastReportedAt: 0,
      latencyMs: null,
      failureCount: 0,
    });
    logger.debug(`Component registered: ${name}`, 'HealthChecker');
  }

  /** Update health status for a component */
  reportHealth(name: string, healthy: boolean, latencyMs?: number): void {
    const existing = this.components.get(name);
    if (!existing) {
      logger.warn(`Reporting health for unknown component: ${name}`, 'HealthChecker');
      return;
    }

    const failureCount = healthy ? 0 : existing.failureCount + 1;

    this.components.set(name, {
      ...existing,
      healthy,
      lastReportedAt: Date.now(),
      latencyMs: latencyMs ?? null,
      failureCount,
    });

    if (!healthy) {
      logger.warn(`Component unhealthy: ${name}`, 'HealthChecker', {
        failureCount,
        latencyMs: latencyMs ?? null,
      });
    } else {
      logger.debug(`Component healthy: ${name}`, 'HealthChecker', { latencyMs: latencyMs ?? null });
    }
  }

  /** Returns snapshot of all component statuses + uptime */
  getHealthReport(): HealthReport {
    const components = Array.from(this.components.values());
    return {
      overall: this.isHealthy(),
      uptimeMs: Date.now() - this.startedAt,
      components,
      checkedAt: new Date().toISOString(),
    };
  }

  /** True only if ALL registered components are healthy */
  isHealthy(): boolean {
    if (this.components.size === 0) return true;
    for (const c of this.components.values()) {
      if (!c.healthy) return false;
    }
    return true;
  }

  /** List names of components currently reporting unhealthy */
  getUnhealthyComponents(): string[] {
    return Array.from(this.components.values())
      .filter((c) => !c.healthy)
      .map((c) => c.name);
  }
}
