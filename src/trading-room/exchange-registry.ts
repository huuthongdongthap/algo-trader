// ExchangeRegistry: multi-exchange connection management for the AGI Trading Room
// Tracks health, latency, and lifecycle of all connected exchange clients

import { ExchangeClient, type SupportedExchange } from '../cex/exchange-client.js';
import type { ExchangeCredentials } from '../core/types.js';
import { logger } from '../core/logger.js';

/** Per-exchange metadata and health state */
export interface ExchangeEntry {
  name: SupportedExchange;
  client: ExchangeClient;
  healthy: boolean;
  lastCheck: number;
  latencyMs: number;
}

/**
 * ExchangeRegistry: manages multiple CEX connections.
 * Each entry holds one ExchangeClient instance + live health metrics.
 */
export class ExchangeRegistry {
  private entries: Map<SupportedExchange, ExchangeEntry> = new Map();

  /**
   * Register and connect an exchange.
   * Creates a fresh ExchangeClient, connects the named exchange.
   */
  register(name: SupportedExchange, creds: ExchangeCredentials): void {
    if (this.entries.has(name)) {
      logger.warn(`Exchange already registered: ${name}`, 'ExchangeRegistry');
      return;
    }
    const client = new ExchangeClient();
    client.connect(name, creds);
    this.entries.set(name, {
      name,
      client,
      healthy: true, // assume healthy until first check
      lastCheck: Date.now(),
      latencyMs: 0,
    });
    logger.info(`Exchange registered: ${name}`, 'ExchangeRegistry');
  }

  /** Get the ExchangeClient for a named exchange (throws if unknown) */
  getExchange(name: SupportedExchange): ExchangeClient {
    const entry = this.entries.get(name);
    if (!entry) throw new Error(`Exchange not registered: ${name}`);
    return entry.client;
  }

  /** Return all entries currently marked healthy */
  getHealthy(): ExchangeEntry[] {
    return [...this.entries.values()].filter(e => e.healthy);
  }

  /** Return all registered entries */
  getAll(): ExchangeEntry[] {
    return [...this.entries.values()];
  }

  /**
   * Health-check all registered exchanges by fetching balances.
   * Updates healthy flag and latencyMs for each entry.
   */
  async healthCheck(): Promise<void> {
    const checks = [...this.entries.values()].map(async entry => {
      const t0 = Date.now();
      try {
        // fetchBalance is a lightweight authenticated call — good liveness probe
        await entry.client.getBalance(entry.name);
        entry.latencyMs = Date.now() - t0;
        entry.healthy = true;
        entry.lastCheck = Date.now();
        logger.debug(`Health OK: ${entry.name} (${entry.latencyMs}ms)`, 'ExchangeRegistry');
      } catch (err) {
        entry.healthy = false;
        entry.lastCheck = Date.now();
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(`Health FAIL: ${entry.name} — ${msg}`, 'ExchangeRegistry');
      }
    });
    await Promise.allSettled(checks);
  }

  /** Disconnect all exchanges and clear the registry */
  async disconnectAll(): Promise<void> {
    for (const entry of this.entries.values()) {
      await entry.client.disconnectAll();
    }
    this.entries.clear();
    logger.info('All exchanges disconnected', 'ExchangeRegistry');
  }

  /** Summary snapshot for status reporting */
  getSummary(): Array<{ name: string; healthy: boolean; latencyMs: number; lastCheck: number }> {
    return [...this.entries.values()].map(e => ({
      name: e.name,
      healthy: e.healthy,
      latencyMs: e.latencyMs,
      lastCheck: e.lastCheck,
    }));
  }
}
