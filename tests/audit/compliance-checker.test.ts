import { describe, it, expect } from 'vitest';
import {
  ComplianceChecker,
  maxTradeSizeRule,
  sanctionedAssetsRule,
  dailyLimitRule,
  leverageLimitRule,
  type TradeCandidate,
} from '../../src/audit/compliance-checker.js';

function makeTrade(overrides: Partial<TradeCandidate> = {}): TradeCandidate {
  return {
    marketId: 'BTC-USDC',
    side: 'buy',
    size: '1',
    price: '50000',
    ...overrides,
  };
}

describe('ComplianceChecker', () => {
  it('should approve trade with no rules', () => {
    const cc = new ComplianceChecker();
    const result = cc.validateTrade(makeTrade());
    expect(result.approved).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should enforce maxTradeSize rule', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(maxTradeSizeRule(10));
    expect(cc.validateTrade(makeTrade({ size: '5' })).approved).toBe(true);
    expect(cc.validateTrade(makeTrade({ size: '15' })).approved).toBe(false);
  });

  it('should enforce sanctionedAssets rule', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(sanctionedAssetsRule(['SCAM-TOKEN', 'RUG-PULL']));
    expect(cc.validateTrade(makeTrade({ marketId: 'BTC-USDC' })).approved).toBe(true);
    expect(cc.validateTrade(makeTrade({ marketId: 'SCAM-TOKEN' })).approved).toBe(false);
  });

  it('should enforce dailyLimit rule', () => {
    const cc = new ComplianceChecker();
    let dailyTotal = 40000;
    cc.registerRule(dailyLimitRule(100000, () => dailyTotal));
    // 1 * 50000 = 50000 notional; 40000 + 50000 = 90000 < 100000
    expect(cc.validateTrade(makeTrade()).approved).toBe(true);

    dailyTotal = 60000;
    // 60000 + 50000 = 110000 > 100000
    expect(cc.validateTrade(makeTrade()).approved).toBe(false);
  });

  it('should enforce leverageLimit rule', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(leverageLimitRule(5));
    expect(cc.validateTrade(makeTrade({ leverage: 3 })).approved).toBe(true);
    expect(cc.validateTrade(makeTrade({ leverage: 10 })).approved).toBe(false);
  });

  it('should default leverage to 1 when not specified', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(leverageLimitRule(5));
    expect(cc.validateTrade(makeTrade()).approved).toBe(true);
  });

  it('should collect multiple violations', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(maxTradeSizeRule(0.5));
    cc.registerRule(sanctionedAssetsRule(['BTC-USDC']));
    const result = cc.validateTrade(makeTrade());
    expect(result.approved).toBe(false);
    expect(result.violations).toHaveLength(2);
    expect(result.rulesChecked).toHaveLength(2);
  });

  it('should remove rule by name', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(maxTradeSizeRule(0.5));
    cc.removeRule('maxTradeSize');
    expect(cc.validateTrade(makeTrade()).approved).toBe(true);
  });

  it('should replace duplicate rule name', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(maxTradeSizeRule(0.5));
    cc.registerRule(maxTradeSizeRule(100)); // replace with lenient
    expect(cc.validateTrade(makeTrade()).approved).toBe(true);
  });

  it('should track compliance stats', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(maxTradeSizeRule(0.5));
    cc.validateTrade(makeTrade()); // violation
    cc.validateTrade(makeTrade({ size: '0.1' })); // pass
    const report = cc.getComplianceReport();
    expect(report.totalChecks).toBe(2);
    expect(report.totalViolations).toBe(1);
    expect(report.violationsByRule['maxTradeSize']).toBe(1);
  });

  it('should reset stats', () => {
    const cc = new ComplianceChecker();
    cc.registerRule(maxTradeSizeRule(0.5));
    cc.validateTrade(makeTrade());
    cc.resetStats();
    expect(cc.getComplianceReport().totalChecks).toBe(0);
  });

  it('should handle throwing rule gracefully', () => {
    const cc = new ComplianceChecker();
    cc.registerRule({
      name: 'broken',
      check: () => { throw new Error('boom'); },
    });
    const result = cc.validateTrade(makeTrade());
    expect(result.approved).toBe(false);
    expect(result.violations[0]).toContain('broken');
  });
});
