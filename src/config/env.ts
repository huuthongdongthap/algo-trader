/**
 * Environment Configuration
 * Centralized config for environment variables
 */

import { logger } from '../utils/logger';

export const config = {
  // Audit Log Configuration
  AUDIT_LOG_ENABLED: process.env.AUDIT_LOG_ENABLED || 'true',
  AUDIT_RETENTION_DAYS: process.env.AUDIT_RETENTION_DAYS || '90',
  AUDIT_BATCH_SIZE: process.env.AUDIT_BATCH_SIZE || '100',

  // License Configuration
  LICENSE_KEY_PREFIX: process.env.LICENSE_KEY_PREFIX || 'raas',
  LICENSE_ACTIVATION_SECRET: process.env.LICENSE_ACTIVATION_SECRET || '',
  LICENSE_ENCRYPTION_KEY: process.env.LICENSE_ENCRYPTION_KEY || '',

  // Usage Metering
  USAGE_METERING_ENABLED: process.env.USAGE_METERING_ENABLED || 'true',
  OVERAGE_ENABLED: process.env.OVERAGE_ENABLED || 'true',
  OVERAGE_PRICE_PER_CALL: process.env.OVERAGE_PRICE_PER_CALL || '0.01',

  // Dunning Configuration
  DUNNING_ENABLED: process.env.DUNNING_ENABLED || 'true',
  DUNNING_GRACE_PERIOD_DAYS: process.env.DUNNING_GRACE_PERIOD_DAYS || '7',

  // NOWPayments Configuration (USDT TRC20)
  NOWPAYMENTS_API_KEY: process.env.NOWPAYMENTS_API_KEY || '',
  NOWPAYMENTS_IPN_SECRET: process.env.NOWPAYMENTS_IPN_SECRET || '',

  // Email Configuration (SendGrid)
  SENDGRID_API_KEY: process.env.SENDGRID_API_KEY || '',
  SENDGRID_FROM_EMAIL: process.env.SENDGRID_FROM_EMAIL || '',
  SENDGRID_FROM_NAME: process.env.SENDGRID_FROM_NAME || 'Algo Trader',

  // SMS Configuration (Twilio)
  TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID || '',
  TWILIO_AUTH_TOKEN: process.env.TWILIO_AUTH_TOKEN || '',
  TWILIO_PHONE_NUMBER: process.env.TWILIO_PHONE_NUMBER || '',

  // Telegram Configuration
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN || '',

  // Redis Configuration
  REDIS_HOST: process.env.REDIS_HOST || 'localhost',
  REDIS_PORT: process.env.REDIS_PORT || '6379',
  REDIS_PASSWORD: process.env.REDIS_PASSWORD || '',
};

/**
 * Required environment variables for notification services
 * Fail fast on missing keys at startup
 */
const REQUIRED_NOTIFICATION_VARS = [
  'SENDGRID_API_KEY',
  'SENDGRID_FROM_EMAIL',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'TWILIO_PHONE_NUMBER',
  'TELEGRAM_BOT_TOKEN',
] as const;

/**
 * Optional environment variables (won't fail startup if missing)
 */
const OPTIONAL_VARS = [
  'NOWPAYMENTS_API_KEY',
  'NOWPAYMENTS_IPN_SECRET',
  'REDIS_HOST',
  'REDIS_PORT',
  'REDIS_PASSWORD',
  'LICENSE_ACTIVATION_SECRET',
  'LICENSE_ENCRYPTION_KEY',
] as const;

/**
 * Validate required environment variables at startup
 * Throws error if any required notification vars are missing
 */
export function validateEnvVars(): void {
  const missingVars: string[] = [];

  for (const vars of REQUIRED_NOTIFICATION_VARS) {
    if (!process.env[vars]) {
      missingVars.push(vars);
    }
  }

  if (missingVars.length > 0) {
    const errorMessage = [
      'FATAL: Missing required notification environment variables:',
      ...missingVars.map(v => `  - ${v}`),
      '',
      'These variables are required for threshold alert notifications.',
      'Set them in your .env file or environment before starting the server.',
      '',
      'Example .env:',
      '  SENDGRID_API_KEY=sg.xxxxx',
      '  SENDGRID_FROM_EMAIL=alerts@example.com',
      '  TWILIO_ACCOUNT_SID=ACxxxx',
      '  TWILIO_AUTH_TOKEN=your_auth_token',
      '  TWILIO_PHONE_NUMBER=+1234567890',
      '  TELEGRAM_BOT_TOKEN=xxxxx:xxxxx',
    ].join('\n');

    logger.error(errorMessage);
    throw new Error(`Missing required env vars: ${missingVars.join(', ')}`);
  }

  logger.info('[Config] All required notification environment variables present');
}

/**
 * Log configuration status (without exposing sensitive values)
 */
export function logConfigStatus(): void {
  const status = {
    sendgrid: config.SENDGRID_API_KEY ? 'configured' : 'MISSING',
    twilio: config.TWILIO_ACCOUNT_SID ? 'configured' : 'MISSING',
    telegram: config.TELEGRAM_BOT_TOKEN ? 'configured' : 'MISSING',
    nowpayments: config.NOWPAYMENTS_API_KEY ? 'configured' : 'MISSING',
    redis: `${config.REDIS_HOST}:${config.REDIS_PORT}`,
  };

  logger.info('[Config] Status:', { status });
}
