/**
 * Trading Loop - Core Arbitrage Engine
 * Orchestrates WebSocket feeds, spread detection, and atomic execution
 * Target latency: <500ms p95 (WS tick → detection → execution signal)
 */

import { FeedAggregator, UnifiedOrderBook, UnifiedTrade, UnifiedTicker } from '../feeds/feed-aggregator';
import { SpreadDetector, ArbitrageOpportunity as SpreadOpportunity } from './spread-detector';
import { ExecutionEngine, ArbitrageOpportunity, ArbitrageLeg } from './types';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface TradingLoopConfig {
  symbols: string[];
  exchanges: ('binance' | 'okx' | 'bybit')[];
  minSpreadPercent: number;
  maxLatencyMs: number;
  enableDryRun: boolean;
  enableLogging: boolean;
  checkIntervalMs: number;
}

export interface TradingLoopMetrics {
  isRunning: boolean;
  uptimeMs: number;
  opportunitiesFound: number;
  opportunitiesExecuted: number;
  totalProfit: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  lastScanTime?: number;
  errors: number;
}

export interface TradingOpportunity {
  id: string;
  symbol: string;
  buyExchange: string;
  sellExchange: string;
  buyPrice: number;
  sellPrice: number;
  spread: number;
  spreadPercent: number;
  timestamp: number;
  latency: number;
  score?: number;
  confidence?: 'high' | 'medium' | 'low';
}

export class TradingLoop extends EventEmitter {
  private feedAggregator: FeedAggregator;
  private spreadDetector: SpreadDetector;
  private executionEngine: ExecutionEngine;
  private config: TradingLoopConfig;
  private isRunning = false;
  private scanInterval: NodeJS.Timeout | null = null;
  private startTime = 0;
  private metrics: TradingLoopMetrics = {
    isRunning: false,
    uptimeMs: 0,
    opportunitiesFound: 0,
    opportunitiesExecuted: 0,
    totalProfit: 0,
    avgLatencyMs: 0,
    p95LatencyMs: 0,
    errors: 0,
  };
  private latencySamples: number[] = [];

  constructor(config: Partial<TradingLoopConfig> = {}) {
    super();
    this.config = {
      symbols: config.symbols || ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
      exchanges: config.exchanges || ['binance', 'okx', 'bybit'],
      minSpreadPercent: config.minSpreadPercent || 0.05,
      maxLatencyMs: config.maxLatencyMs || 500,
      enableDryRun: config.enableDryRun ?? true,
      enableLogging: config.enableLogging ?? true,
      checkIntervalMs: config.checkIntervalMs || 100,
    };

    this.feedAggregator = new FeedAggregator();
    this.spreadDetector = new SpreadDetector({
      minSpreadPercent: this.config.minSpreadPercent,
      maxLatencyMs: this.config.maxLatencyMs,
      checkIntervalMs: this.config.checkIntervalMs,
      enableMLScoring: true,
    });
    this.executionEngine = new ExecutionEngine({
      dryRun: this.config.enableDryRun,
    });

    this.setupFeedHandlers();
  }

  private setupFeedHandlers(): void {
    this.feedAggregator.onFeed((msg) => {
      switch (msg.type) {
        case 'orderbook':
          this.handleOrderBook(msg.data);
          break;
        case 'trade':
          this.handleTrade(msg.data);
          break;
        case 'ticker':
          this.handleTicker(msg.data);
          break;
      }
    });
  }

  private handleOrderBook(orderBook: UnifiedOrderBook): void {
    // Order book updates are processed by spread detector via Redis
    if (this.config.enableLogging) {
      this.log('orderbook', `${orderBook.exchange} ${orderBook.symbol} bid:${orderBook.bids[0]?.price} ask:${orderBook.asks[0]?.price}`);
    }
  }

  private handleTrade(trade: UnifiedTrade): void {
    if (this.config.enableLogging) {
      this.log('trade', `${trade.exchange} ${trade.symbol} ${trade.side} @ ${trade.price}`);
    }
  }

  private handleTicker(ticker: UnifiedTicker): void {
    // Ticker updates feed into spread detector
    if (this.config.enableLogging && ticker.last > 0) {
      this.log('ticker', `${ticker.exchange} ${ticker.symbol} last:${ticker.last}`);
    }
  }

  /**
   * Start trading loop
   */
  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('Trading loop already running');
    }

    this.log('info', 'Starting trading loop...');
    this.startTime = Date.now();

    try {
      // Connect to WebSocket feeds
      await this.feedAggregator.connect();
      await this.feedAggregator.subscribe(this.config.symbols);

      this.isRunning = true;
      this.metrics.isRunning = true;

      // Start spread detection scan loop
      this.startScanLoop();

      this.log('info', `Trading loop started: ${this.config.symbols.length} symbols, ${this.config.exchanges.length} exchanges`);
      this.emit('started', {
        symbols: this.config.symbols,
        exchanges: this.config.exchanges,
      });
    } catch (error) {
      this.metrics.errors++;
      this.log('error', `Failed to start trading loop: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Stop trading loop
   */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    this.log('info', 'Stopping trading loop...');

    if (this.scanInterval) {
      clearInterval(this.scanInterval);
      this.scanInterval = null;
    }

    await this.feedAggregator.disconnect();
    this.spreadDetector.stop();

    this.isRunning = false;
    this.metrics.isRunning = false;
    this.metrics.uptimeMs = Date.now() - this.startTime;

    this.log('info', `Trading loop stopped. Uptime: ${this.metrics.uptimeMs}ms`);
    this.emit('stopped', this.getMetrics());
  }

  /**
   * Start continuous spread detection scan
   */
  private startScanLoop(): void {
    this.scanInterval = setInterval(async () => {
      try {
        const startTime = Date.now();
        const opportunities = await this.spreadDetector.scan(
          this.config.symbols,
          this.config.exchanges
        );

        // Track latency
        const scanLatency = Date.now() - startTime;
        this.recordLatency(scanLatency);

        if (opportunities.length > 0) {
          this.metrics.opportunitiesFound += opportunities.length;
          this.handleOpportunities(opportunities);
        }
      } catch (error) {
        this.metrics.errors++;
        this.log('error', `Scan error: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, this.config.checkIntervalMs);
  }

  /**
   * Handle detected arbitrage opportunities
   */
  private async handleOpportunities(opportunities: SpreadOpportunity[]): Promise<void> {
    for (const opp of opportunities) {
      this.log('opportunity', JSON.stringify({
        id: opp.id,
        symbol: opp.symbol,
        spread: opp.spreadPercent.toFixed(4),
        score: opp.score,
        confidence: opp.confidence,
      }));

      this.emit('opportunity', opp);

      // Execute if confidence is high enough
      if (opp.confidence === 'high' || (opp.score && opp.score >= 80)) {
        try {
          // Convert SpreadOpportunity to ArbitrageOpportunity format
          const legs: ArbitrageLeg[] = [
            {
              exchange: opp.buyExchange as any,
              symbol: opp.symbol,
              side: 'buy',
              price: opp.buyPrice,
              amount: 1000, // Default amount
              fee: 0.001, // Default fee
            },
            {
              exchange: opp.sellExchange as any,
              symbol: opp.symbol,
              side: 'sell',
              price: opp.sellPrice,
              amount: 1000,
              fee: 0.001,
            },
          ];

          const arbitrageOpp: ArbitrageOpportunity = {
            id: opp.id,
            type: 'cross-exchange',
            legs,
            expectedProfit: opp.spread,
            expectedProfitPct: opp.spreadPercent,
            totalFees: 0.002,
            confidence: opp.confidence === 'high' ? 90 : opp.confidence === 'medium' ? 70 : 50,
            detectedAt: opp.timestamp,
            expiresAt: opp.timestamp + 5000,
          };

          const result = await this.executionEngine.execute(arbitrageOpp);
          this.metrics.opportunitiesExecuted++;

          if (result.success) {
            this.metrics.totalProfit += result.actualProfit;
            this.log('execution', `Executed ${opp.id}: profit $${result.actualProfit.toFixed(2)}`);
          } else {
            this.log('error', `Execution failed: ${result.error}`);
          }

          this.emit('execution', { opportunity: arbitrageOpp, result });
        } catch (error) {
          this.metrics.errors++;
          this.log('error', `Execution error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }

  /**
   * Record latency sample for p95 calculation
   */
  private recordLatency(latency: number): void {
    this.latencySamples.push(latency);
    if (this.latencySamples.length > 1000) {
      this.latencySamples.shift();
    }

    const sorted = [...this.latencySamples].sort((a, b) => a - b);
    const avg = sorted.reduce((a, b) => a + b, 0) / sorted.length;
    const p95Index = Math.floor(sorted.length * 0.95);
    const p95 = sorted[p95Index] || 0;

    this.metrics.avgLatencyMs = avg;
    this.metrics.p95LatencyMs = p95;
  }

  /**
   * Get current metrics
   */
  getMetrics(): TradingLoopMetrics & { isUnderTarget: boolean; targetLatencyMs: number } {
    const spreadMetrics = this.spreadDetector.getMetrics();
    return {
      ...this.metrics,
      isUnderTarget: spreadMetrics.isUnderTarget,
      targetLatencyMs: spreadMetrics.targetLatencyMs,
      uptimeMs: this.isRunning ? Date.now() - this.startTime : this.metrics.uptimeMs,
    };
  }

  /**
   * Log message if enabled
   */
  private log(level: string, message: string): void {
    if (this.config.enableLogging) {
      const timestamp = new Date().toISOString();
      const prefix = `[TradingLoop:${level}]`;
      if (level === 'error') {
        logger.error(`${prefix} ${timestamp} ${message}`);
      } else {
        logger.info(`${prefix} ${timestamp} ${message}`);
      }
    }
  }

  /**
   * Check if loop is running
   */
  isLoopRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(config: Partial<TradingLoopConfig>): void {
    this.config = { ...this.config, ...config };
    this.log('info', `Config updated: ${Object.keys(config).join(', ')}`);
  }
}
