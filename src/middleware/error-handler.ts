/**
 * Error Handler Middleware
 * Global error handling for API requests
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export const errorHandler = (
  err: ApiError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';

  logger.error('[API Error]', {
    name: err.name,
    message: err.message,
    code,
    statusCode,
    stack: err.stack,
  });

  res.status(statusCode).json({
    error: {
      message: err.message || 'Internal server error',
      code,
    },
  });
};

/**
 * Create an operational API error
 */
export function createApiError(message: string, statusCode: number = 500, code?: string): ApiError {
  const error: ApiError = new Error(message);
  error.statusCode = statusCode;
  error.code = code || 'OPERATIONAL_ERROR';
  return error;
}

/**
 * Async handler wrapper to catch errors
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<void>
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
