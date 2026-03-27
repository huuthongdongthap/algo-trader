/**
 * Logger utility - Winston-based structured logger
 * Replaces console.* calls for structured, leveled logging
 */

import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: process.env.NODE_ENV === 'production'
    ? winston.format.json()
    : winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      ),
  transports: [
    new winston.transports.Console(),
    // File transport for log retention (30 days, 10MB rotation)
    ...(process.env.NODE_ENV === 'production' ? [
      new winston.transports.File({ filename: 'logs/error.log', level: 'error', maxsize: 10_000_000, maxFiles: 30 }),
      new winston.transports.File({ filename: 'logs/combined.log', maxsize: 10_000_000, maxFiles: 30 }),
    ] : []),
  ],
});

export { logger };
export default logger;
