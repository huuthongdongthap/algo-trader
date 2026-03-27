/**
 * Error Handler Middleware
 * Global error handling for API routes
 */

import { Request, Response, NextFunction } from 'express';
import { logger } from '../../utils/logger';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

/**
 * Global error handler
 */
export function errorHandler(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const statusCode = err.statusCode || 500;
  const code = err.code || 'INTERNAL_ERROR';

  logger.error(`[ApiError] ${code}: ${err.message}`);

  res.status(statusCode).json({
    error: {
      code,
      message: err.message || 'Internal server error',
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    },
  });
}

/**
 * Create API error with status code
 */
export function createError(message: string, statusCode: number, code?: string): ApiError {
  const error: ApiError = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

/**
 * Not found error
 */
export function notFound(resource: string): ApiError {
  return createError(`${resource} not found`, 404, 'NOT_FOUND');
}

/**
 * Bad request error
 */
export function badRequest(message: string): ApiError {
  return createError(message, 400, 'BAD_REQUEST');
}

/**
 * Unauthorized error
 */
export function unauthorized(message: string = 'Unauthorized'): ApiError {
  return createError(message, 401, 'UNAUTHORIZED');
}
