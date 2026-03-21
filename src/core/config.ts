// Environment config loader with validation
import type { AppConfig, LogLevel, RiskLimits } from './types.js';

const DEFAULT_RISK_LIMITS: RiskLimits = {
  maxPositionSize: '10000',
  maxDrawdown: 0.20,
  maxOpenPositions: 10,
  stopLossPercent: 0.10,
  maxLeverage: 2,
};

function getEnv(key: string, fallback?: string): string {
  const val = process.env[key] ?? fallback;
  if (val === undefined) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function getEnvOptional(key: string): string | undefined {
  return process.env[key];
}

/** Load and validate app config from environment variables */
export function loadConfig(): AppConfig {
  return {
    env: (getEnv('NODE_ENV', 'development') as AppConfig['env']),
    logLevel: (getEnv('LOG_LEVEL', 'info') as LogLevel),
    dbPath: getEnv('DB_PATH', './data/algo-trade.db'),
    riskLimits: {
      maxPositionSize: getEnv('MAX_POSITION_SIZE', DEFAULT_RISK_LIMITS.maxPositionSize),
      maxDrawdown: parseFloat(getEnv('MAX_DRAWDOWN', String(DEFAULT_RISK_LIMITS.maxDrawdown))),
      maxOpenPositions: parseInt(getEnv('MAX_OPEN_POSITIONS', String(DEFAULT_RISK_LIMITS.maxOpenPositions))),
      stopLossPercent: parseFloat(getEnv('STOP_LOSS_PERCENT', String(DEFAULT_RISK_LIMITS.stopLossPercent))),
      maxLeverage: parseFloat(getEnv('MAX_LEVERAGE', String(DEFAULT_RISK_LIMITS.maxLeverage))),
    },
    strategies: [], // Loaded from strategy config files at runtime
    exchanges: {
      ...(getEnvOptional('BINANCE_API_KEY') ? {
        binance: {
          apiKey: getEnv('BINANCE_API_KEY'),
          apiSecret: getEnv('BINANCE_API_SECRET'),
        },
      } : {}),
      ...(getEnvOptional('BYBIT_API_KEY') ? {
        bybit: {
          apiKey: getEnv('BYBIT_API_KEY'),
          apiSecret: getEnv('BYBIT_API_SECRET'),
        },
      } : {}),
      ...(getEnvOptional('OKX_API_KEY') ? {
        okx: {
          apiKey: getEnv('OKX_API_KEY'),
          apiSecret: getEnv('OKX_API_SECRET'),
          passphrase: getEnv('OKX_PASSPHRASE'),
        },
      } : {}),
    },
    polymarket: {
      clobUrl: getEnv('POLYMARKET_CLOB_URL', 'https://clob.polymarket.com'),
      chainId: parseInt(getEnv('POLYMARKET_CHAIN_ID', '137')),
      rpcUrl: getEnv('POLYGON_RPC_URL', 'https://polygon-rpc.com'),
    },
  };
}

/** Validate config has minimum requirements to operate */
export function validateConfig(config: AppConfig): string[] {
  const errors: string[] = [];
  if (config.riskLimits.maxDrawdown <= 0 || config.riskLimits.maxDrawdown > 1) {
    errors.push('MAX_DRAWDOWN must be between 0 and 1');
  }
  if (config.riskLimits.maxLeverage < 1) {
    errors.push('MAX_LEVERAGE must be >= 1');
  }
  if (Object.keys(config.exchanges).length === 0 && !getEnvOptional('POLYMARKET_PRIVATE_KEY')) {
    errors.push('At least one exchange or Polymarket private key must be configured');
  }
  return errors;
}
