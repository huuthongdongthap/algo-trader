/**
 * Sentry error tracking initialization
 * Configures Sentry SDK for error monitoring and performance tracing
 */

import * as Sentry from '@sentry/node';

export function initSentry(): void {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return; // Skip if no DSN configured

  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}

/**
 * Capture an exception manually (for non-Express error boundaries)
 */
export function captureError(error: Error, context?: Record<string, unknown>): void {
  Sentry.captureException(error, { extra: context });
}
