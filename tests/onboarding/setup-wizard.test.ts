// Tests for setup-wizard.ts — onboarding flow, input validation, API key generation
// Note: runSetupWizard uses readline which requires mocking stdin/stdout
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync } from 'node:fs';

// Mock readline and fs before importing wizard
vi.mock('node:fs', () => ({
  existsSync: vi.fn(() => false),
}));

// readline mock — simulate sequential answers via an answer queue
const mockClose = vi.fn();
let answerQueue: string[] = [];

vi.mock('node:readline', () => ({
  createInterface: vi.fn(() => ({
    close: mockClose,
    question: vi.fn((q: string, cb: (a: string) => void) => {
      cb(answerQueue.shift() ?? '');
    }),
  })),
}));

vi.mock('../../src/core/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { runSetupWizard } from '../../src/onboarding/setup-wizard.js';

describe('runSetupWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    answerQueue = [];
    vi.mocked(existsSync).mockReturnValue(false);
  });

  /**
   * Push answers for each wizard prompt in order:
   * environment, exchanges, [exchange creds], maxPosition, maxDrawdown,
   * maxOpenPositions, stopLoss, maxLeverage, notificationChannel
   */
  function queueAnswers(answers: string[]) {
    answerQueue = [...answers];
  }

  it('should complete setup with minimal binance configuration', async () => {
    queueAnswers([
      'production',    // environment
      'binance',       // exchanges
      'my-api-key',   // binance api key
      'my-api-secret', // binance api secret
      '5000',          // max position size
      '15',            // max drawdown
      '5',             // max open positions
      '8',             // stop loss
      '3',             // max leverage
      'none',          // notification channel
    ]);

    const result = await runSetupWizard('/tmp/.env-test');
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('production');
    expect(result!.exchanges.binance).toBeDefined();
    expect(result!.exchanges.binance!.apiKey).toBe('my-api-key');
    expect(result!.exchanges.binance!.apiSecret).toBe('my-api-secret');
  });

  it('should auto-generate platformApiKey and webhookSecret', async () => {
    queueAnswers([
      '',       // environment (default: development)
      '',       // exchanges (default: polymarket)
      '0xabc',  // polymarket private key
      '',       // max position (default)
      '',       // max drawdown (default)
      '',       // max open positions (default)
      '',       // stop loss (default)
      '',       // max leverage (default)
      '',       // notification channel (default: none)
    ]);

    const result = await runSetupWizard('/tmp/.env-test-2');
    expect(result).not.toBeNull();
    expect(result!.platformApiKey).toMatch(/^[0-9a-f]{32}$/);
    expect(result!.webhookSecret).toMatch(/^[0-9a-f]{32}$/);
    expect(result!.environment).toBe('development');
  });

  it('should use defaults for invalid environment input', async () => {
    queueAnswers([
      'invalidenv',  // invalid — should fallback to 'development'
      '',            // exchanges default
      '0xprivkey',   // polymarket key
      '', '', '', '', '',
      '',
    ]);

    const result = await runSetupWizard('/tmp/.env-test-3');
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('development');
  });

  it('should return null when .env exists and user declines overwrite', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    queueAnswers(['n']); // decline overwrite

    const result = await runSetupWizard('/tmp/.existing-env');
    expect(result).toBeNull();
  });

  it('should proceed when .env exists and user confirms overwrite', async () => {
    vi.mocked(existsSync).mockReturnValue(true);
    queueAnswers([
      'y',        // overwrite
      'staging',  // environment
      'bybit',    // exchange
      'bk',       // bybit key
      'bs',       // bybit secret
      '', '', '', '', '',
      '',
    ]);

    const result = await runSetupWizard('/tmp/.existing-env-2');
    expect(result).not.toBeNull();
    expect(result!.environment).toBe('staging');
    expect(result!.exchanges.bybit).toBeDefined();
  });

  it('should collect notification token when telegram selected', async () => {
    queueAnswers([
      '',         // environment
      '',         // exchanges (polymarket)
      '0xkey',    // polymarket key
      '', '', '', '', '',
      'telegram',            // notification channel
      'bot-token-1234',      // telegram bot token
    ]);

    const result = await runSetupWizard('/tmp/.env-test-tg');
    expect(result).not.toBeNull();
    expect(result!.notificationChannel).toBe('telegram');
    expect(result!.notificationToken).toBe('bot-token-1234');
  });

  it('should configure okx with passphrase', async () => {
    queueAnswers([
      '',
      'okx',
      'okx-key',
      'okx-secret',
      'okx-pass',
      '', '', '', '', '',
      '',
    ]);

    const result = await runSetupWizard('/tmp/.env-okx');
    expect(result).not.toBeNull();
    expect(result!.exchanges.okx).toBeDefined();
    expect(result!.exchanges.okx!.passphrase).toBe('okx-pass');
  });

  it('should parse risk limits correctly', async () => {
    queueAnswers([
      '',           // environment
      '',           // exchanges
      '0xprivkey',  // polymarket key
      '20000',      // max position
      '25',         // max drawdown (25%)
      '8',          // max open positions
      '5',          // stop loss (5%)
      '4',          // max leverage
      '',           // notification channel
    ]);

    const result = await runSetupWizard('/tmp/.env-risk');
    expect(result).not.toBeNull();
    expect(result!.riskLimits.maxPositionSize).toBe('20000');
    expect(result!.riskLimits.maxDrawdown).toBeCloseTo(0.25);
    expect(result!.riskLimits.maxOpenPositions).toBe(8);
    expect(result!.riskLimits.stopLossPercent).toBeCloseTo(0.05);
    expect(result!.riskLimits.maxLeverage).toBe(4);
  });
});
