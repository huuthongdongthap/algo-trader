/**
 * API Server
 * REST + WebSocket gateway for trading operations
 */

import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import * as Sentry from '@sentry/node';
import { Server } from 'http';
import { logger } from '../utils/logger';

import { tradesRouter } from './routes/trades';
import { pnlRouter } from './routes/pnl';
import { signalsRouter } from './routes/signals';
import { adminRouter } from './routes/admin';
import { healthRouter } from './routes/health';
import { revenueRouter } from './routes/revenue';
import { metricsMiddleware, getMetrics } from '../middleware/prometheus-metrics';
import { errorHandler } from '../middleware/error-handler';

export interface ApiConfig {
  port: number;
  corsOrigin: string | string[];
  rateLimitWindowMs: number;
  rateLimitMax: number;
}

export class ApiServer {
  private app: express.Application;
  private config: ApiConfig;
  private server?: Server;

  constructor(config?: Partial<ApiConfig>) {
    this.app = express();
    this.config = {
      port: parseInt(process.env.API_PORT || '3000'),
      corsOrigin: process.env.CORS_ORIGIN || 'https://cashclaw.cc',
      rateLimitWindowMs: 60000, // 1 minute
      rateLimitMax: 100, // 100 requests per minute
      ...config,
    };

    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Setup middleware
   */
  private setupMiddleware(): void {
    // Security — strict helmet config
    this.app.use(helmet({
      hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
      frameguard: { action: 'deny' },
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", 'wss:', 'ws:', 'https:'],
          frameAncestors: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      permittedCrossDomainPolicies: false,
    }));
    this.app.use(cors({ origin: this.config.corsOrigin }));

    // Body parsing
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // Prometheus metrics middleware (track all requests)
    this.app.use(metricsMiddleware);

    // Rate limiting
    const limiter = rateLimit({
      windowMs: this.config.rateLimitWindowMs,
      max: this.config.rateLimitMax,
      message: { error: 'Too many requests, please try again later' },
    });
    this.app.use('/api', limiter);
  }

  /**
   * Setup routes
   */
  private setupRoutes(): void {
    // Health checks (no rate limit)
    this.app.use('/health', healthRouter);

    // Prometheus metrics endpoint (excluded from rate limiting, protected by Bearer token)
    this.app.get('/metrics', (req, res, next) => {
      const metricsToken = process.env.METRICS_TOKEN;
      if (!metricsToken) {
        return res.status(403).json({ error: 'Metrics endpoint not configured' });
      }
      const authHeader = req.headers.authorization;
      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!token || token !== metricsToken) {
        return res.status(403).json({ error: 'Forbidden' });
      }
      next();
    }, getMetrics);

    // API routes
    this.app.use('/api/trades', tradesRouter);
    this.app.use('/api/pnl', pnlRouter);
    this.app.use('/api/signals', signalsRouter);
    this.app.use('/api/admin', adminRouter);
    this.app.use('/api/revenue', revenueRouter);

    // 404 handler
    this.app.use((_req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Sentry error capture (must be before custom error handler)
    if (process.env.SENTRY_DSN) {
      Sentry.setupExpressErrorHandler(this.app);
    }

    // Global error handler
    this.app.use(errorHandler);
  }

  /**
   * Start server
   */
  async start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = this.app.listen(this.config.port, () => {
        logger.info(`[ApiServer] Listening on port ${this.config.port}`);
        resolve();
      });
    });
  }

  /**
   * Stop server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server?.close(() => {
          logger.info('[ApiServer] Stopped');
          resolve();
        });
      });
    }
  }

  /**
   * Get Express app (for testing)
   */
  getApp(): express.Application {
    return this.app;
  }
}
