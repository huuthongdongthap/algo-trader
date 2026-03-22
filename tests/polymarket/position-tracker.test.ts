import { describe, it, expect, beforeEach } from 'vitest';
import { PositionTracker } from '../../src/polymarket/position-tracker.js';

describe('PositionTracker', () => {
  let tracker: PositionTracker;

  beforeEach(() => {
    tracker = new PositionTracker();
  });

  it('should start with no positions', () => {
    expect(tracker.getAllPositions()).toHaveLength(0);
    expect(tracker.getPosition('MKT-1')).toBeUndefined();
  });

  it('should open a new position on first fill', () => {
    tracker.applyFill('MKT-1', 'buy', 0.65, 100);
    const pos = tracker.getPosition('MKT-1');
    expect(pos).toBeDefined();
    expect(pos!.side).toBe('buy');
    expect(pos!.avgEntryPrice).toBe(0.65);
    expect(pos!.totalSize).toBe(100);
    expect(pos!.realizedPnl).toBe(0);
  });

  it('should compute weighted average on scale-in', () => {
    tracker.applyFill('MKT-1', 'buy', 0.60, 100);
    tracker.applyFill('MKT-1', 'buy', 0.80, 100);
    const pos = tracker.getPosition('MKT-1')!;
    expect(pos.avgEntryPrice).toBeCloseTo(0.70);
    expect(pos.totalSize).toBe(200);
  });

  it('should compute unrealized PnL for buy position', () => {
    tracker.applyFill('MKT-1', 'buy', 0.50, 100);
    const pnl = tracker.computePnl('MKT-1', 0.70);
    expect(pnl).not.toBeNull();
    expect(pnl!.unrealizedPnl).toBeCloseTo(20); // (0.70 - 0.50) * 100
    expect(pnl!.realizedPnl).toBe(0);
    expect(pnl!.totalPnl).toBeCloseTo(20);
  });

  it('should compute negative unrealized PnL for sell position going up', () => {
    tracker.applyFill('MKT-1', 'sell', 0.50, 100);
    const pnl = tracker.computePnl('MKT-1', 0.70);
    expect(pnl).not.toBeNull();
    // sell direction = -1: -1 * (0.70 - 0.50) * 100 = -20
    expect(pnl!.unrealizedPnl).toBeCloseTo(-20);
  });

  it('should return null PnL for unknown market', () => {
    expect(tracker.computePnl('UNKNOWN', 1.0)).toBeNull();
  });

  it('should partially close a position and track realized PnL', () => {
    tracker.applyFill('MKT-1', 'buy', 0.50, 100);
    const realized = tracker.close('MKT-1', 0.80, 40);
    // buy direction: (0.80 - 0.50) * 40 = 12
    expect(realized).toBeCloseTo(12);
    const pos = tracker.getPosition('MKT-1')!;
    expect(pos.totalSize).toBe(60);
    expect(pos.realizedPnl).toBeCloseTo(12);
  });

  it('should fully close a position and remove it', () => {
    tracker.applyFill('MKT-1', 'buy', 0.50, 100);
    tracker.close('MKT-1', 0.70);
    expect(tracker.getPosition('MKT-1')).toBeUndefined();
    expect(tracker.getAllPositions()).toHaveLength(0);
  });

  it('should return 0 when closing unknown market', () => {
    expect(tracker.close('UNKNOWN', 1.0)).toBe(0);
  });

  it('should handle opposite side fill as close', () => {
    tracker.applyFill('MKT-1', 'buy', 0.50, 100);
    tracker.applyFill('MKT-1', 'sell', 0.70, 50); // partial close
    const pos = tracker.getPosition('MKT-1');
    expect(pos).toBeDefined();
    expect(pos!.totalSize).toBe(50);
    expect(pos!.realizedPnl).toBeCloseTo(10); // (0.70-0.50)*50
  });

  it('should ignore zero-size fills', () => {
    tracker.applyFill('MKT-1', 'buy', 0.50, 0);
    expect(tracker.getAllPositions()).toHaveLength(0);
  });

  it('should track multiple markets independently', () => {
    tracker.applyFill('MKT-A', 'buy', 0.40, 50);
    tracker.applyFill('MKT-B', 'sell', 0.80, 200);
    expect(tracker.getAllPositions()).toHaveLength(2);
    expect(tracker.getPosition('MKT-A')!.side).toBe('buy');
    expect(tracker.getPosition('MKT-B')!.side).toBe('sell');
  });
});
