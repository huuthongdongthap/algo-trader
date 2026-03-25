import { describe, it, expect } from 'vitest';
import { generateShareCard, buildShareCardData, type ShareCardData } from '../../src/growth/pnl-share-card-generator.js';

const basePnl = {
  timestamp: Date.now(),
  equity: '5000',
  peakEquity: '5500',
  drawdown: 0.09,
  realizedPnl: '320.50',
  unrealizedPnl: '45.00',
  tradeCount: 28,
  winCount: 19,
};

describe('buildShareCardData', () => {
  it('should compute win rate from tradeCount and winCount', () => {
    const data = buildShareCardData(basePnl, { sharpeRatio: 1.8, tier: 2, brierScore: 0.18, period: 'weekly' });
    expect(data.winRate).toBeCloseTo(67.86, 1);
    expect(data.tradeCount).toBe(28);
    expect(data.period).toBe('weekly');
  });

  it('should handle zero trades without NaN', () => {
    const data = buildShareCardData(
      { ...basePnl, tradeCount: 0, winCount: 0 },
      { sharpeRatio: 0, tier: 1, brierScore: null, period: 'daily' },
    );
    expect(data.winRate).toBe(0);
  });

  it('should pass through extras correctly', () => {
    const data = buildShareCardData(basePnl, { sharpeRatio: 2.1, tier: 3, brierScore: 0.15, period: 'monthly' });
    expect(data.sharpeRatio).toBe(2.1);
    expect(data.tier).toBe(3);
    expect(data.brierScore).toBe(0.15);
  });
});

describe('generateShareCard', () => {
  const data: ShareCardData = {
    equity: '5000',
    realizedPnl: '320.50',
    winRate: 67.9,
    tradeCount: 28,
    sharpeRatio: 1.8,
    maxDrawdown: 9.0,
    period: 'weekly',
    tier: 2,
    brierScore: 0.18,
  };

  it('should generate text card with all fields', () => {
    const card = generateShareCard(data);
    expect(card.text).toContain('CashClaw');
    expect(card.text).toContain('This Week');
    expect(card.text).toContain('+$320.50');
    expect(card.text).toContain('67.9%');
    expect(card.text).toContain('28 trades');
    expect(card.text).toContain('Sharpe: 1.80');
    expect(card.text).toContain('Brier: 0.180');
    expect(card.text).toContain('Tier 2');
  });

  it('should generate HTML card with styling', () => {
    const card = generateShareCard(data);
    expect(card.html).toContain('CashClaw');
    expect(card.html).toContain('320.50');
    expect(card.html).toContain('#2ecc71'); // green for profit
    expect(card.html).toContain('cashclaw.cc');
  });

  it('should use red color for negative P&L', () => {
    const lossData = { ...data, realizedPnl: '-150.00' };
    const card = generateShareCard(lossData);
    expect(card.html).toContain('#e74c3c');
    expect(card.text).toContain('$-150.00');
  });

  it('should omit Brier line when null', () => {
    const noBrier = { ...data, brierScore: null };
    const card = generateShareCard(noBrier);
    expect(card.text).not.toContain('Brier');
    expect(card.html).not.toContain('Brier');
  });

  it('should include hashtags with Profit tag for positive P&L', () => {
    const card = generateShareCard(data);
    expect(card.hashtags).toContain('CashClaw');
    expect(card.hashtags).toContain('Polymarket');
    expect(card.hashtags).toContain('Profit');
  });

  it('should not include Profit hashtag for negative P&L', () => {
    const card = generateShareCard({ ...data, realizedPnl: '-50' });
    expect(card.hashtags).not.toContain('Profit');
  });

  it('should show correct period labels', () => {
    expect(generateShareCard({ ...data, period: 'daily' }).text).toContain('Today');
    expect(generateShareCard({ ...data, period: 'weekly' }).text).toContain('This Week');
    expect(generateShareCard({ ...data, period: 'monthly' }).text).toContain('This Month');
  });
});
