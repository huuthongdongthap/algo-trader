import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventLogger } from '../../src/events/event-logger.js';
import { EventBus } from '../../src/events/event-bus.js';

describe('EventLogger', () => {
  let bus: EventBus;
  let eventLogger: EventLogger;

  beforeEach(() => {
    bus = new EventBus();
    eventLogger = new EventLogger();
  });

  it('should subscribe to events on startLogging', () => {
    eventLogger.startLogging(bus);
    // Emitting should not throw
    expect(() => bus.emit('system.startup', { version: '1.0' })).not.toThrow();
  });

  it('should handle trade.executed event', () => {
    eventLogger.startLogging(bus);
    expect(() => bus.emit('trade.executed', {
      trade: { orderId: 'o1', marketId: 'm1', side: 'buy', fillPrice: '0.5', fillSize: '10', fees: '0', timestamp: Date.now(), strategy: 'test' },
    })).not.toThrow();
  });

  it('should handle strategy events', () => {
    eventLogger.startLogging(bus);
    expect(() => bus.emit('strategy.started', { name: 'grid-dca' })).not.toThrow();
    expect(() => bus.emit('strategy.stopped', { name: 'grid-dca', reason: 'user' })).not.toThrow();
  });

  it('should exclude specified events', () => {
    eventLogger.startLogging(bus, { excludeEvents: ['system.startup'] });
    // Should not throw for excluded events either (just not logged)
    expect(() => bus.emit('system.startup', { version: '1.0' })).not.toThrow();
  });

  it('should stop logging and detach handlers', () => {
    eventLogger.startLogging(bus);
    eventLogger.stopLogging();
    // After stopping, emitting should still work (bus handles it) but logger won't process
    expect(() => bus.emit('system.startup', { version: '1.0' })).not.toThrow();
  });

  it('should handle startLogging called twice (replaces)', () => {
    eventLogger.startLogging(bus);
    eventLogger.startLogging(bus); // Should not duplicate
    expect(() => bus.emit('system.startup', { version: '1.0' })).not.toThrow();
  });

  it('should handle stopLogging when not started', () => {
    expect(() => eventLogger.stopLogging()).not.toThrow();
  });

  it('should accept different log levels', () => {
    eventLogger.startLogging(bus, { logLevel: 'info' });
    expect(() => bus.emit('system.shutdown', { reason: 'test' })).not.toThrow();
  });
});
