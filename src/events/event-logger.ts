// Event logger: subscribes to all system events and logs them for debugging
// Formats log lines as: [timestamp] event.name — summary (no large payloads)
import { logger } from '../core/logger.js';
import type { EventBus } from './event-bus.js';
import { type SystemEventName, type SystemEventMap } from './event-types.js';

export interface EventLoggerOptions {
  /** Minimum log level for event entries (default: 'debug') */
  logLevel?: 'debug' | 'info' | 'warn' | 'error';
  /** Event names to skip entirely */
  excludeEvents?: SystemEventName[];
  /** Reserved for future file-sink support */
  logToFile?: boolean;
}

// All known event names — kept in sync with SystemEventMap keys
const ALL_EVENTS: SystemEventName[] = [
  'trade.executed',
  'trade.failed',
  'strategy.started',
  'strategy.stopped',
  'strategy.error',
  'user.registered',
  'user.subscribed',
  'alert.triggered',
  'system.startup',
  'system.shutdown',
  'pnl.snapshot',
];

/**
 * Produce a short human-readable summary of an event payload.
 * Avoids logging large nested objects verbatim.
 */
function summarise<K extends SystemEventName>(
  event: K,
  data: SystemEventMap[K],
): string {
  const d = data as Record<string, unknown>;
  switch (event) {
    case 'trade.executed': {
      const t = d['trade'] as Record<string, unknown>;
      return `orderId=${t['orderId']} market=${t['marketId']} side=${t['side']} price=${t['fillPrice']}`;
    }
    case 'trade.failed':
      return `error="${d['error']}"`;
    case 'strategy.started':
      return `name=${d['name']}`;
    case 'strategy.stopped':
      return `name=${d['name']} reason="${d['reason']}"`;
    case 'strategy.error':
      return `name=${d['name']} error="${d['error']}"`;
    case 'user.registered':
      return `userId=${d['userId']} email=${d['email']}`;
    case 'user.subscribed':
      return `userId=${d['userId']} tier=${d['tier']}`;
    case 'alert.triggered':
      return `rule=${d['rule']} message="${d['message']}"`;
    case 'system.startup':
      return `version=${d['version']}`;
    case 'system.shutdown':
      return `reason="${d['reason']}"`;
    case 'pnl.snapshot': {
      const s = d['snapshot'] as Record<string, unknown>;
      return `equity=${s['equity']} drawdown=${s['drawdown']} trades=${s['tradeCount']}`;
    }
    default:
      return '';
  }
}

/**
 * Subscribes to all (or a subset of) system events and logs each one.
 * Call startLogging() to activate; stopLogging() to detach handlers.
 */
export class EventLogger {
  private bus: EventBus | null = null;
  private options: Required<EventLoggerOptions> = {
    logLevel: 'debug',
    excludeEvents: [],
    logToFile: false,
  };

  // Store bound handlers so we can remove them later
  private readonly handlers = new Map<
    SystemEventName,
    (data: SystemEventMap[SystemEventName]) => void
  >();

  /**
   * Attach to an EventBus and begin logging all non-excluded events.
   */
  startLogging(bus: EventBus, options: EventLoggerOptions = {}): void {
    if (this.bus) this.stopLogging();

    this.bus = bus;
    this.options = {
      logLevel: options.logLevel ?? 'debug',
      excludeEvents: options.excludeEvents ?? [],
      logToFile: options.logToFile ?? false,
    };

    const active = ALL_EVENTS.filter(
      (e) => !this.options.excludeEvents.includes(e),
    );

    for (const event of active) {
      const handler = (data: SystemEventMap[typeof event]) => {
        const summary = summarise(event, data);
        const msg = summary ? `${event} — ${summary}` : event;
        logger[this.options.logLevel](msg, 'EventLogger');
      };

      // Cast needed because the map stores a union handler
      this.handlers.set(
        event,
        handler as (data: SystemEventMap[SystemEventName]) => void,
      );
      bus.on(event, handler);
    }
  }

  /** Detach all event handlers from the bus. */
  stopLogging(): void {
    if (!this.bus) return;
    for (const [event, handler] of this.handlers) {
      this.bus.off(
        event,
        handler as (data: SystemEventMap[typeof event]) => void,
      );
    }
    this.handlers.clear();
    this.bus = null;
  }
}
