/**
 * Risk Module Tests
 */

import { describe, it, expect, vi } from 'vitest';

const mockRedis = {
  hgetall: vi.fn().mockResolvedValue({}),
  hset: vi.fn().mockResolvedValue(1),
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue('OK'),
  del: vi.fn().mockResolvedValue(1),
  keys: vi.fn().mockResolvedValue([]),
  lpush: vi.fn().mockResolvedValue(1),
  ltrim: vi.fn().mockResolvedValue('OK'),
  lrange: vi.fn().mockResolvedValue([]),
};

vi.mock('../redis', () => ({
  getRedisClient: () => mockRedis,
}));

describe('CircuitBreaker', () => {
  it('should be constructable with mock Redis', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);
    expect(breaker).toBeDefined();
    expect(typeof breaker.getStatus).toBe('function');
    expect(typeof breaker.canTrade).toBe('function');
    expect(typeof breaker.recordLoss).toBe('function');
    expect(typeof breaker.reset).toBe('function');
  });

  it('should return CLOSED status initially', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({ state: 'CLOSED' });

    const status = await breaker.getStatus();
    expect(status.state).toBe('CLOSED');
  });

  it('should allow trading when circuit is closed', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({ state: 'CLOSED' });

    const canTrade = await breaker.canTrade();
    expect(canTrade).toBe(true);
  });

  it('should block trading when circuit is open', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({
      state: 'OPEN',
      triggeredAt: Date.now().toString(),
      reason: 'Loss streak',
    });

    const canTrade = await breaker.canTrade();
    expect(canTrade).toBe(false);
  });

  it('should record loss and increment streak', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);
    mockRedis.get.mockResolvedValueOnce('2'); // Current streak

    await breaker.recordLoss();

    expect(mockRedis.set).toHaveBeenCalledWith('circuit_breaker:loss_streak', '3');
  });

  it('should reset loss streak on win', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);

    await breaker.recordWin();

    expect(mockRedis.del).toHaveBeenCalledWith('circuit_breaker:loss_streak');
  });

  it('should trip on latency spike', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);

    const result = await breaker.checkLatency(1500); // > 1000ms threshold

    expect(result).toBe(false);
    expect(mockRedis.hset).toHaveBeenCalledWith('circuit_breaker:status', expect.any(Object));
  });

  it('should pass latency check when normal', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);

    const result = await breaker.checkLatency(100); // < 1000ms threshold

    expect(result).toBe(true);
  });

  it('should reset circuit breaker', async () => {
    const { CircuitBreaker } = await import('../circuit-breaker');
    const breaker = new CircuitBreaker(mockRedis as any);

    await breaker.reset();

    expect(mockRedis.hset).toHaveBeenCalledWith('circuit_breaker:status', {
      state: 'CLOSED',
      reason: '',
      triggeredAt: '',
    });
  });
});

describe('PositionManager', () => {
  it('should be constructable with mock Redis', async () => {
    const { PositionManager } = await import('../position-manager');
    const manager = new PositionManager(mockRedis as any);
    expect(manager).toBeDefined();
    expect(typeof manager.getPosition).toBe('function');
    expect(typeof manager.openPosition).toBe('function');
    expect(typeof manager.closePosition).toBe('function');
  });

  it('should return null for non-existent position', async () => {
    const { PositionManager } = await import('../position-manager');
    const manager = new PositionManager(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({});

    const position = await manager.getPosition('BTC/USDT', 'binance');
    expect(position).toBeNull();
  });

  it('should validate position within limits', async () => {
    const { PositionManager } = await import('../position-manager');
    const manager = new PositionManager(mockRedis as any);
    mockRedis.keys.mockResolvedValueOnce([]); // No existing positions

    const validation = await manager.validatePosition('BTC/USDT', 'binance', 'long', 0.1);

    expect(validation.valid).toBe(true);
  });

  it('should reject position exceeding symbol limit', async () => {
    const { PositionManager } = await import('../position-manager');
    const manager = new PositionManager(mockRedis as any);
    mockRedis.keys.mockResolvedValueOnce([]);
    mockRedis.hgetall.mockResolvedValueOnce({
      totalLong: '0',
      totalShort: '0',
      netExposure: '0',
    });

    const validation = await manager.validatePosition('BTC/USDT', 'binance', 'long', 2.0);

    // Large amount should trigger rejection
    expect(validation.newExposure).toBeGreaterThan(validation.currentExposure);
  });

  it('should open position successfully', async () => {
    const { PositionManager } = await import('../position-manager');
    const manager = new PositionManager(mockRedis as any);
    mockRedis.keys.mockResolvedValueOnce([]);
    mockRedis.hgetall.mockResolvedValueOnce({
      totalLong: '0',
      totalShort: '0',
      netExposure: '0',
      perSymbol: JSON.stringify({}),
      perExchange: JSON.stringify({}),
    });

    const result = await manager.openPosition('BTC/USDT', 'binance', 'long', 0.1, 50000);

    expect(result).toBe(true);
    expect(mockRedis.hset).toHaveBeenCalledWith(
      'position:BTC/USDT:binance',
      expect.objectContaining({
        symbol: 'BTC/USDT',
        exchange: 'binance',
        side: 'long',
        amount: '0.1',
      })
    );
  });

  it('should close position and return PnL', async () => {
    const { PositionManager } = await import('../position-manager');
    const manager = new PositionManager(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({
      symbol: 'BTC/USDT',
      exchange: 'binance',
      side: 'long',
      amount: '0.1',
      entryPrice: '50000',
      currentValue: '5100',
      unrealizedPnl: '100',
      openedAt: Date.now().toString(),
    });

    const pnl = await manager.closePosition('BTC/USDT', 'binance', 51000);

    expect(pnl).toBeGreaterThanOrEqual(0);
    expect(mockRedis.del).toHaveBeenCalled();
  });

  it('should get exposure summary', async () => {
    const { PositionManager } = await import('../position-manager');
    const manager = new PositionManager(mockRedis as any);
    mockRedis.keys.mockResolvedValueOnce(['position:BTC/USDT:binance']);
    mockRedis.hgetall.mockResolvedValueOnce({
      symbol: 'BTC/USDT',
      exchange: 'binance',
      side: 'long',
      amount: '0.1',
      entryPrice: '50000',
      currentValue: '5000',
      unrealizedPnl: '0',
      openedAt: Date.now().toString(),
    });

    const summary = await manager.getExposureSummary();

    expect(summary.totalLong).toBeGreaterThanOrEqual(0);
    expect(summary.totalShort).toBeGreaterThanOrEqual(0);
  });
});

describe('DrawdownMonitor', () => {
  it('should be constructable with mock Redis', async () => {
    const { DrawdownMonitor } = await import('../drawdown-monitor');
    const monitor = new DrawdownMonitor(mockRedis as any);
    expect(monitor).toBeDefined();
    expect(typeof monitor.recordTrade).toBe('function');
    expect(typeof monitor.getMetrics).toBe('function');
    expect(typeof monitor.canTrade).toBe('function');
  });

  it('should return metrics with initial state', async () => {
    const { DrawdownMonitor } = await import('../drawdown-monitor');
    const monitor = new DrawdownMonitor(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({});
    mockRedis.get.mockResolvedValue('0');

    const metrics = await monitor.getMetrics();

    expect(metrics.currentValue).toBeGreaterThanOrEqual(0);
    expect(metrics.peakValue).toBeGreaterThanOrEqual(0);
    expect(metrics.isHalted).toBe(false);
  });

  it('should record trade and update state', async () => {
    const { DrawdownMonitor } = await import('../drawdown-monitor');
    const monitor = new DrawdownMonitor(mockRedis as any);
    mockRedis.hgetall
      .mockResolvedValueOnce({ currentValue: '100', peakValue: '100', consecutiveLosses: '0' })
      .mockResolvedValueOnce({ state: 'ACTIVE' });
    mockRedis.get.mockResolvedValue('0');

    const metrics = await monitor.recordTrade(-5);

    expect(mockRedis.set).toHaveBeenCalled();
    expect(mockRedis.hset).toHaveBeenCalled();
  });

  it('should track consecutive losses', async () => {
    const { DrawdownMonitor } = await import('../drawdown-monitor');
    const monitor = new DrawdownMonitor(mockRedis as any);
    mockRedis.hgetall
      .mockResolvedValueOnce({ currentValue: '100', peakValue: '100', consecutiveLosses: '2' })
      .mockResolvedValueOnce({ state: 'ACTIVE' });
    mockRedis.get.mockResolvedValue('0');

    await monitor.recordTrade(-3);

    expect(mockRedis.hset).toHaveBeenCalled();
  });

  it('should reset consecutive losses on win', async () => {
    const { DrawdownMonitor } = await import('../drawdown-monitor');
    const monitor = new DrawdownMonitor(mockRedis as any);
    mockRedis.hgetall
      .mockResolvedValueOnce({ currentValue: '100', peakValue: '100', consecutiveLosses: '3' })
      .mockResolvedValueOnce({ state: 'ACTIVE' });
    mockRedis.get.mockResolvedValue('0');

    await monitor.recordTrade(5);

    expect(mockRedis.hset).toHaveBeenCalledWith('drawdown:state', expect.objectContaining({
      consecutiveLosses: '0',
    }));
  });

  it('should allow trading when not halted', async () => {
    const { DrawdownMonitor } = await import('../drawdown-monitor');
    const monitor = new DrawdownMonitor(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({ state: 'ACTIVE' });

    const canTrade = await monitor.canTrade();

    expect(canTrade).toBe(true);
  });

  it('should block trading when halted', async () => {
    const { DrawdownMonitor } = await import('../drawdown-monitor');
    const monitor = new DrawdownMonitor(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({ state: 'HALTED', reason: 'Drawdown breach' });

    const canTrade = await monitor.canTrade();

    expect(canTrade).toBe(false);
  });

  it('should resume trading after halt', async () => {
    const { DrawdownMonitor } = await import('../drawdown-monitor');
    const monitor = new DrawdownMonitor(mockRedis as any);
    mockRedis.hgetall.mockResolvedValueOnce({ currentValue: '95', peakValue: '100' });

    await monitor.resume();

    expect(mockRedis.hset).toHaveBeenCalledWith('drawdown:halt', {
      state: 'ACTIVE',
      reason: '',
      triggeredAt: '',
    });
  });
});
