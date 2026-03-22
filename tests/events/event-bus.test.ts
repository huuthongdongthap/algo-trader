import { describe, it, expect, afterEach } from 'vitest';
import { EventBus, getEventBus, resetEventBus } from '../../src/events/event-bus.js';

describe('EventBus', () => {
  afterEach(() => {
    resetEventBus();
  });

  it('should emit and receive typed events', () => {
    const bus = new EventBus();
    let received = false;
    bus.on('system.startup', (data) => {
      expect(data.version).toBe('1.0.0');
      received = true;
    });
    bus.emit('system.startup', { version: '1.0.0', timestamp: Date.now() });
    expect(received).toBe(true);
  });

  it('should support once listener', () => {
    const bus = new EventBus();
    let count = 0;
    bus.once('alert.triggered', () => { count++; });
    bus.emit('alert.triggered', { rule: 'test', message: 'alert' });
    bus.emit('alert.triggered', { rule: 'test', message: 'alert' });
    expect(count).toBe(1);
  });

  it('should unsubscribe with off', () => {
    const bus = new EventBus();
    let count = 0;
    const handler = () => { count++; };
    bus.on('system.shutdown', handler);
    bus.emit('system.shutdown', { reason: 'test' });
    bus.off('system.shutdown', handler);
    bus.emit('system.shutdown', { reason: 'test2' });
    expect(count).toBe(1);
  });

  it('should report listener count', () => {
    const bus = new EventBus();
    bus.on('trade.executed', () => {});
    bus.on('trade.executed', () => {});
    expect(bus.getListenerCount('trade.executed')).toBe(2);
  });

  it('should remove all listeners', () => {
    const bus = new EventBus();
    bus.on('trade.executed', () => {});
    bus.on('trade.failed', () => {});
    bus.removeAllListeners('trade.executed');
    expect(bus.getListenerCount('trade.executed')).toBe(0);
    expect(bus.getListenerCount('trade.failed')).toBe(1);
  });

  it('should provide singleton via getEventBus', () => {
    const a = getEventBus();
    const b = getEventBus();
    expect(a).toBe(b);
  });

  it('should reset singleton', () => {
    const a = getEventBus();
    resetEventBus();
    const b = getEventBus();
    expect(a).not.toBe(b);
  });
});
