// Multi-strategy instance coordinator — manages isolated trading instance groups
import type { StrategyName } from '../core/types.js';

export interface InstanceConfig {
  id: string;
  /** Strategy names assigned to this instance */
  strategies: StrategyName[];
  /** HTTP port offset from base (base=3000, so instance 1 → 3010) */
  port: number;
  /** Capital allocated to this instance in USD (decimal string) */
  capitalAllocation: string;
}

export interface InstanceStatus {
  id: string;
  config: InstanceConfig;
  state: 'running' | 'stopped' | 'error';
  startedAt: number | null;
  /** Realized P&L for this instance since start (decimal string) */
  realizedPnl: string;
  /** Unrealized P&L across open positions (decimal string) */
  unrealizedPnl: string;
  lastHealthCheck: number | null;
}

interface ManagedInstance {
  config: InstanceConfig;
  status: InstanceStatus;
  /** Optional cleanup callback provided at creation */
  shutdownFn?: () => Promise<void>;
}

/** Coordinates multiple isolated trading instances (one per strategy group) */
export class InstanceManager {
  private readonly instances = new Map<string, ManagedInstance>();

  /** Register and start tracking a new isolated strategy instance */
  createInstance(config: InstanceConfig): InstanceStatus {
    if (this.instances.has(config.id)) {
      throw new Error(`Instance '${config.id}' already exists`);
    }

    const status: InstanceStatus = {
      id: config.id,
      config,
      state: 'running',
      startedAt: Date.now(),
      realizedPnl: '0',
      unrealizedPnl: '0',
      lastHealthCheck: null,
    };

    this.instances.set(config.id, { config, status });
    return status;
  }

  /** Retrieve current health and P&L snapshot for an instance */
  getInstanceStatus(id: string): InstanceStatus {
    const managed = this.instances.get(id);
    if (!managed) throw new Error(`Instance '${id}' not found`);
    // Refresh lastHealthCheck timestamp on each query
    managed.status.lastHealthCheck = Date.now();
    return { ...managed.status };
  }

  /** Return status snapshot for all registered instances */
  listInstances(): InstanceStatus[] {
    return Array.from(this.instances.values()).map((m) => ({ ...m.status }));
  }

  /** Update P&L figures from the strategy engine for an instance */
  updatePnl(id: string, realizedPnl: string, unrealizedPnl: string): void {
    const managed = this.instances.get(id);
    if (!managed) throw new Error(`Instance '${id}' not found`);
    managed.status.realizedPnl = realizedPnl;
    managed.status.unrealizedPnl = unrealizedPnl;
  }

  /** Register a shutdown callback for graceful teardown */
  registerShutdownHandler(id: string, fn: () => Promise<void>): void {
    const managed = this.instances.get(id);
    if (!managed) throw new Error(`Instance '${id}' not found`);
    managed.shutdownFn = fn;
  }

  /** Gracefully shut down an instance and remove it from the registry */
  async removeInstance(id: string): Promise<void> {
    const managed = this.instances.get(id);
    if (!managed) throw new Error(`Instance '${id}' not found`);

    managed.status.state = 'stopped';

    if (managed.shutdownFn) {
      try {
        await managed.shutdownFn();
      } catch (err) {
        managed.status.state = 'error';
        throw err;
      }
    }

    this.instances.delete(id);
  }

  /** Total number of registered instances */
  get count(): number {
    return this.instances.size;
  }
}
