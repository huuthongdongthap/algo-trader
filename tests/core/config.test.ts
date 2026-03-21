import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadConfig, validateConfig } from '../../src/core/config.js';
import type { AppConfig } from '../../src/core/types.js';

describe('loadConfig', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Save original env
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original env
    process.env = originalEnv;
  });

  it('should load config with minimal required env vars', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'info';
    process.env.DB_PATH = './test.db';
    process.env.POLYMARKET_CLOB_URL = 'https://clob.polymarket.com';
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const config = loadConfig();

    expect(config.env).toBe('development');
    expect(config.logLevel).toBe('info');
    expect(config.dbPath).toBe('./test.db');
  });

  it('should use default values when env vars not provided', () => {
    // Clear relevant env vars
    delete process.env.NODE_ENV;
    delete process.env.LOG_LEVEL;
    delete process.env.DB_PATH;
    delete process.env.MAX_POSITION_SIZE;
    delete process.env.MAX_DRAWDOWN;
    delete process.env.MAX_OPEN_POSITIONS;
    delete process.env.STOP_LOSS_PERCENT;
    delete process.env.MAX_LEVERAGE;
    delete process.env.POLYMARKET_CLOB_URL;
    delete process.env.POLYGON_RPC_URL;
    delete process.env.POLYMARKET_CHAIN_ID;

    const config = loadConfig();

    expect(config.env).toBe('development'); // Default
    expect(config.logLevel).toBe('info'); // Default
    expect(config.dbPath).toBe('./data/algo-trade.db'); // Default
    expect(config.riskLimits.maxPositionSize).toBe('10000'); // Default
    expect(config.riskLimits.maxDrawdown).toBe(0.2); // Default
    expect(config.riskLimits.maxOpenPositions).toBe(10); // Default
    expect(config.polymarket.chainId).toBe(137); // Default (Polygon)
  });

  it('should load risk limits from env vars', () => {
    process.env.MAX_POSITION_SIZE = '50000';
    process.env.MAX_DRAWDOWN = '0.15';
    process.env.MAX_OPEN_POSITIONS = '20';
    process.env.STOP_LOSS_PERCENT = '0.05';
    process.env.MAX_LEVERAGE = '5';

    const config = loadConfig();

    expect(config.riskLimits.maxPositionSize).toBe('50000');
    expect(config.riskLimits.maxDrawdown).toBe(0.15);
    expect(config.riskLimits.maxOpenPositions).toBe(20);
    expect(config.riskLimits.stopLossPercent).toBe(0.05);
    expect(config.riskLimits.maxLeverage).toBe(5);
  });

  it('should load binance credentials when available', () => {
    process.env.BINANCE_API_KEY = 'test-key';
    process.env.BINANCE_API_SECRET = 'test-secret';

    const config = loadConfig();

    expect(config.exchanges.binance).toBeDefined();
    expect(config.exchanges.binance.apiKey).toBe('test-key');
    expect(config.exchanges.binance.apiSecret).toBe('test-secret');
  });

  it('should load bybit credentials when available', () => {
    process.env.BYBIT_API_KEY = 'test-key';
    process.env.BYBIT_API_SECRET = 'test-secret';

    const config = loadConfig();

    expect(config.exchanges.bybit).toBeDefined();
    expect(config.exchanges.bybit.apiKey).toBe('test-key');
  });

  it('should load okx credentials with passphrase', () => {
    process.env.OKX_API_KEY = 'test-key';
    process.env.OKX_API_SECRET = 'test-secret';
    process.env.OKX_PASSPHRASE = 'test-passphrase';

    const config = loadConfig();

    expect(config.exchanges.okx).toBeDefined();
    expect(config.exchanges.okx.apiKey).toBe('test-key');
    expect(config.exchanges.okx.passphrase).toBe('test-passphrase');
  });

  it('should skip exchange config if credentials not provided', () => {
    delete process.env.BINANCE_API_KEY;
    delete process.env.BYBIT_API_KEY;
    delete process.env.OKX_API_KEY;

    const config = loadConfig();

    expect(config.exchanges.binance).toBeUndefined();
    expect(config.exchanges.bybit).toBeUndefined();
    expect(config.exchanges.okx).toBeUndefined();
  });

  it('should load polymarket config', () => {
    process.env.POLYMARKET_CLOB_URL = 'https://custom-clob.com';
    process.env.POLYMARKET_CHAIN_ID = '1'; // Mainnet
    process.env.POLYGON_RPC_URL = 'https://custom-rpc.com';

    const config = loadConfig();

    expect(config.polymarket.clobUrl).toBe('https://custom-clob.com');
    expect(config.polymarket.chainId).toBe(1);
    expect(config.polymarket.rpcUrl).toBe('https://custom-rpc.com');
  });

  it('should handle production environment', () => {
    process.env.NODE_ENV = 'production';

    const config = loadConfig();

    expect(config.env).toBe('production');
  });

  it('should handle staging environment', () => {
    process.env.NODE_ENV = 'staging';

    const config = loadConfig();

    expect(config.env).toBe('staging');
  });

  it('should initialize with empty strategies array', () => {
    const config = loadConfig();

    expect(config.strategies).toEqual([]);
    expect(Array.isArray(config.strategies)).toBe(true);
  });

  it('should have correct config structure', () => {
    const config = loadConfig();

    expect(config).toHaveProperty('env');
    expect(config).toHaveProperty('logLevel');
    expect(config).toHaveProperty('dbPath');
    expect(config).toHaveProperty('riskLimits');
    expect(config).toHaveProperty('strategies');
    expect(config).toHaveProperty('exchanges');
    expect(config).toHaveProperty('polymarket');
  });
});

describe('validateConfig', () => {
  const createValidConfig = (overrides?: Partial<AppConfig>): AppConfig => {
    const baseConfig: AppConfig = {
      env: 'development',
      logLevel: 'info',
      dbPath: './test.db',
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 0.2,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 2,
      },
      strategies: [],
      exchanges: {
        binance: {
          apiKey: 'test-key',
          apiSecret: 'test-secret',
        },
      },
      polymarket: {
        clobUrl: 'https://clob.polymarket.com',
        chainId: 137,
        rpcUrl: 'https://polygon-rpc.com',
      },
    };
    return { ...baseConfig, ...overrides };
  };

  it('should return empty errors for valid config', () => {
    const config = createValidConfig();
    const errors = validateConfig(config);
    expect(errors).toEqual([]);
  });

  it('should error when maxDrawdown is 0 or negative', () => {
    const config = createValidConfig({
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 0,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 2,
      },
    });
    const errors = validateConfig(config);
    expect(errors).toContain('MAX_DRAWDOWN must be between 0 and 1');
  });

  it('should error when maxDrawdown is greater than 1', () => {
    const config = createValidConfig({
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 1.5,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 2,
      },
    });
    const errors = validateConfig(config);
    expect(errors).toContain('MAX_DRAWDOWN must be between 0 and 1');
  });

  it('should error when maxLeverage is less than 1', () => {
    const config = createValidConfig({
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 0.2,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 0.5,
      },
    });
    const errors = validateConfig(config);
    expect(errors).toContain('MAX_LEVERAGE must be >= 1');
  });

  it('should error when no exchanges and no polymarket key', () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.POLYMARKET_PRIVATE_KEY;

    const config = createValidConfig({
      exchanges: {},
    });
    const errors = validateConfig(config);
    expect(errors).toContain('At least one exchange or Polymarket private key must be configured');

    process.env = originalEnv;
  });

  it('should allow no exchanges when POLYMARKET_PRIVATE_KEY is set', () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    process.env.POLYMARKET_PRIVATE_KEY = 'test-private-key';

    const config = createValidConfig({
      exchanges: {},
    });
    const errors = validateConfig(config);
    expect(errors).not.toContain('At least one exchange or Polymarket private key must be configured');

    process.env = originalEnv;
  });

  it('should accept valid maxDrawdown at boundary (0.01)', () => {
    const config = createValidConfig({
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 0.01,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 2,
      },
    });
    const errors = validateConfig(config);
    expect(errors.filter(e => e.includes('MAX_DRAWDOWN'))).toEqual([]);
  });

  it('should accept valid maxDrawdown at boundary (0.99)', () => {
    const config = createValidConfig({
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 0.99,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 2,
      },
    });
    const errors = validateConfig(config);
    expect(errors.filter(e => e.includes('MAX_DRAWDOWN'))).toEqual([]);
  });

  it('should accept valid maxLeverage at boundary (1)', () => {
    const config = createValidConfig({
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 0.2,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 1,
      },
    });
    const errors = validateConfig(config);
    expect(errors.filter(e => e.includes('MAX_LEVERAGE'))).toEqual([]);
  });

  it('should allow high maxLeverage', () => {
    const config = createValidConfig({
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 0.2,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 100,
      },
    });
    const errors = validateConfig(config);
    expect(errors.filter(e => e.includes('MAX_LEVERAGE'))).toEqual([]);
  });

  it('should collect multiple errors', () => {
    const originalEnv = process.env;
    process.env = { ...originalEnv };
    delete process.env.POLYMARKET_PRIVATE_KEY;

    const config = createValidConfig({
      riskLimits: {
        maxPositionSize: '10000',
        maxDrawdown: 1.5,
        maxOpenPositions: 10,
        stopLossPercent: 0.1,
        maxLeverage: 0.5,
      },
      exchanges: {},
    });
    const errors = validateConfig(config);

    expect(errors.length).toBeGreaterThanOrEqual(2);
    expect(errors.some(e => e.includes('MAX_DRAWDOWN'))).toBe(true);
    expect(errors.some(e => e.includes('MAX_LEVERAGE'))).toBe(true);

    process.env = originalEnv;
  });
});
