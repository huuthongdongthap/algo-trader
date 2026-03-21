// Environment-specific deployment configuration — local / staging / production
import type { LogLevel } from '../core/types.js';

export type DeployEnvironment = 'local' | 'staging' | 'production';

export interface DeployConfig {
  env: DeployEnvironment;
  logLevel: LogLevel;
  /** API server port */
  apiPort: number;
  dashboardPort: number;
  webhookPort: number;
  /** Maximum total capital across all instances (USD string) */
  maxTotalCapital: string;
  /** Maximum capital per single strategy instance (USD string) */
  maxInstanceCapital: string;
  /** Send Telegram alerts on trade events and errors */
  telegramAlertsEnabled: boolean;
  /** Health check interval in milliseconds */
  healthCheckIntervalMs: number;
  /** Consecutive failures before auto-restart */
  restartThreshold: number;
}

const LOCAL_CONFIG: DeployConfig = {
  env: 'local',
  logLevel: 'debug',
  apiPort: 3000,
  dashboardPort: 3001,
  webhookPort: 3002,
  maxTotalCapital: '1000',
  maxInstanceCapital: '500',
  telegramAlertsEnabled: false,
  healthCheckIntervalMs: 60_000,
  restartThreshold: 5,
};

const STAGING_CONFIG: DeployConfig = {
  env: 'staging',
  logLevel: 'debug',
  apiPort: 3000,
  dashboardPort: 3001,
  webhookPort: 3002,
  // Reduced capital limits to protect against staging mistakes
  maxTotalCapital: '5000',
  maxInstanceCapital: '1000',
  telegramAlertsEnabled: false,
  healthCheckIntervalMs: 30_000,
  restartThreshold: 3,
};

const PRODUCTION_CONFIG: DeployConfig = {
  env: 'production',
  logLevel: 'error',
  apiPort: parseInt(process.env['API_PORT'] ?? '3000'),
  dashboardPort: parseInt(process.env['DASHBOARD_PORT'] ?? '3001'),
  webhookPort: parseInt(process.env['WEBHOOK_PORT'] ?? '3002'),
  maxTotalCapital: process.env['MAX_TOTAL_CAPITAL'] ?? '50000',
  maxInstanceCapital: process.env['MAX_INSTANCE_CAPITAL'] ?? '10000',
  telegramAlertsEnabled: true,
  healthCheckIntervalMs: 15_000,
  restartThreshold: 3,
};

const CONFIGS: Record<DeployEnvironment, DeployConfig> = {
  local: LOCAL_CONFIG,
  staging: STAGING_CONFIG,
  production: PRODUCTION_CONFIG,
};

/** Return environment-specific deployment configuration */
export function getDeployConfig(env: DeployEnvironment): DeployConfig {
  return { ...CONFIGS[env] };
}

/** Validate all required production environment variables are present.
 *  Returns list of missing variable names; empty array means config is valid. */
export function validateDeployConfig(env: DeployEnvironment): string[] {
  if (env !== 'production') return [];

  const required: string[] = [
    'NODE_ENV',
    'DB_PATH',
    'MAX_DRAWDOWN',
    'MAX_POSITION_SIZE',
  ];

  // At least one exchange or Polymarket key must exist
  const hasExchange =
    process.env['BINANCE_API_KEY'] ??
    process.env['BYBIT_API_KEY'] ??
    process.env['OKX_API_KEY'] ??
    process.env['POLYMARKET_PRIVATE_KEY'];

  const missing = required.filter((key) => !process.env[key]);

  if (!hasExchange) {
    missing.push('BINANCE_API_KEY | BYBIT_API_KEY | OKX_API_KEY | POLYMARKET_PRIVATE_KEY (at least one)');
  }

  if (process.env['TELEGRAM_BOT_TOKEN'] && !process.env['TELEGRAM_CHAT_ID']) {
    missing.push('TELEGRAM_CHAT_ID (required when TELEGRAM_BOT_TOKEN is set)');
  }

  return missing;
}
