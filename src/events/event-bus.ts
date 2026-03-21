// Typed pub/sub event bus built on Node.js EventEmitter
// Provides type-safe emit/subscribe via SystemEventMap generics
import { EventEmitter } from 'node:events';
import type { SystemEventMap, SystemEventName, SystemEventHandler } from './event-types.js';

/**
 * Type-safe wrapper around Node.js EventEmitter.
 * All emit/on/once/off calls are constrained to SystemEventMap keys and payloads.
 */
export class EventBus extends EventEmitter {
  /**
   * Emit a system event with a typed payload.
   * Overrides EventEmitter.emit to enforce SystemEventMap constraints.
   */
  emit<K extends SystemEventName>(event: K, data: SystemEventMap[K]): boolean {
    return super.emit(event, data);
  }

  /**
   * Subscribe to a system event. Handler is called on every emission.
   */
  on<K extends SystemEventName>(event: K, handler: SystemEventHandler<K>): this {
    return super.on(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Subscribe to a system event once. Handler is removed after first call.
   */
  once<K extends SystemEventName>(event: K, handler: SystemEventHandler<K>): this {
    return super.once(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Unsubscribe a specific handler from a system event.
   */
  off<K extends SystemEventName>(event: K, handler: SystemEventHandler<K>): this {
    return super.off(event, handler as (...args: unknown[]) => void);
  }

  /**
   * Returns the number of listeners registered for a given event.
   */
  getListenerCount(event: SystemEventName): number {
    return this.listenerCount(event);
  }

  /**
   * Remove all listeners for a specific event, or all events if omitted.
   */
  removeAllListeners(event?: SystemEventName): this {
    return super.removeAllListeners(event);
  }
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let _instance: EventBus | undefined;

/**
 * Returns the process-wide singleton EventBus instance.
 * Creates it on first call.
 */
export function getEventBus(): EventBus {
  if (!_instance) {
    _instance = new EventBus();
    // Increase max listeners to accommodate many concurrent subscribers
    _instance.setMaxListeners(50);
  }
  return _instance;
}

/**
 * Replace (or clear) the singleton — useful in tests.
 */
export function resetEventBus(instance?: EventBus): void {
  _instance = instance;
}
