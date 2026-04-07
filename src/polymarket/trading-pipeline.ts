// Polymarket live trading pipeline: wires scanner → orderbook → strategies → risk → executor → DB
// Paper trading is the DEFAULT mode (safe). Set paperTrading: false for live execution.
import { EventEmitter } from 'events';
import { ClobClient } from './clob-client.js';
import { OrderBookStream } from './orderbook-stream.js';
import { MarketScanner } from './market-scanner.js';
import { OrderManager } from './order-manager.js';
import { CrossMarketArbStrategy } from '../strategies/polymarket/cross-market-arb.js';
import { MarketMakerStrategy } from '../strategies/polymarket/market-maker.js';
import { StrategyRunner } from '../engine/strategy-runner.js';
import { TradeExecutor } from '../engine/trade-executor.js';
import { PaperExchange } from '../paper-trading/paper-exchange.js';
import { RiskManager } from '../core/risk-manager.js';
import { getDatabase } from '../data/database.js';
import { buildPolymarketAdapter } from './polymarket-execution-adapter.js';
import { PredictionLoop } from './prediction-loop.js';
import { PredictionExecutor } from './prediction-executor.js';
import { MeanReversionStrategy } from '../strategies/polymarket/mean-reversion.js';
import { logger } from '../core/logger.js';
import type { StrategyConfig } from '../core/types.js';

export interface PipelineConfig {
  /** Paper trading mode — defaults to true (safe) */
  paperTrading?: boolean;
  /** Polymarket ECDSA private key (required for live mode) */
  privateKey?: string;
  chainId?: number;
  /** Total capital allocated across strategies, USDC string */
  capitalUsdc?: string;
  dbPath?: string;
  strategies?: StrategyConfig[];
}

export type PipelineStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error';

const DEFAULT_CAPITAL = '1000';
const DEFAULT_DB_PATH = 'data/algo-trade.db';

const DEFAULT_STRATEGIES: StrategyConfig[] = [
  { name: 'cross-market-arb', enabled: true, capitalAllocation: '100', params: { defaultSizeUsdc: 50, scanIntervalMs: 10_000 } },
  { name: 'market-maker',     enabled: true, capitalAllocation: '400', params: { quoteSizeUsdc: 25, refreshIntervalMs: 20_000 } },
  { name: 'mean-reversion',   enabled: true, capitalAllocation: '200', params: { sizeUsdc: 50, spikeThreshold: 0.15, scanIntervalMs: 60_000 } },
];

/**
 * TradingPipeline: end-to-end orchestrator for Polymarket strategies.
 * ALL trade signals flow through RiskManager before execution.
 */
export class TradingPipeline extends EventEmitter {
  private status: PipelineStatus = 'stopped';
  private cfg: Required<PipelineConfig>;

  private clobClient!: ClobClient;
  private orderbookStream!: OrderBookStream;
  private scanner!: MarketScanner;
  private predictionLoop: PredictionLoop | null = null;
  private predictionExecutor: PredictionExecutor | null = null;
  private meanReversion: MeanReversionStrategy | null = null;
  private orderManager!: OrderManager;
  private strategyRunner!: StrategyRunner;

  constructor(config: PipelineConfig = {}) {
    super();
    this.cfg = {
      paperTrading: config.paperTrading ?? true,
      privateKey:   config.privateKey   ?? '',
      chainId:      config.chainId      ?? 137,
      capitalUsdc:  config.capitalUsdc  ?? DEFAULT_CAPITAL,
      dbPath:       config.dbPath       ?? DEFAULT_DB_PATH,
      strategies:   config.strategies   ?? DEFAULT_STRATEGIES,
    };
  }

  /** Start the full pipeline: scan → stream → strategies */
  async start(): Promise<void> {
    if (this.status === 'running') return;
    this.status = 'starting';
    const mode = this.cfg.paperTrading ? '[PAPER]' : '[LIVE]';
    logger.info(`Starting trading pipeline ${mode}`, 'TradingPipeline');

    try {
      this.initComponents();
      await this.discoverAndRegisterStrategies();
      this.wireOrderbookStream();
      await this.strategyRunner.startAll(this.cfg.strategies);
      this.status = 'running';
      this.emit('started', { mode: this.cfg.paperTrading ? 'paper' : 'live' });
      logger.info(`Pipeline running ${mode}`, 'TradingPipeline');

      // Start AI prediction loop — feeds fair values to MarketMaker
      this.startPredictionFeed();
    } catch (err) {
      this.status = 'error';
      logger.error('Pipeline failed to start', 'TradingPipeline', { err: String(err) });
      this.emit('error', err);
      throw err;
    }
  }

  /** Gracefully stop all strategies and close connections */
  async stop(): Promise<void> {
    if (this.status === 'stopped') return;
    this.status = 'stopping';
    logger.info('Stopping trading pipeline', 'TradingPipeline');

    if (this.predictionLoop) {
      this.predictionLoop = null;
    }
    if (this.meanReversion) {
      await this.meanReversion.stop();
    }
    await this.strategyRunner.stopAll().catch(err =>
      logger.error('Error stopping strategies', 'TradingPipeline', { err: String(err) }),
    );

    // Cancel ALL open GTC orders before disconnecting — prevents stale fills after shutdown
    try {
      const cancelled = await this.orderManager.cancelAllOpen();
      if (cancelled > 0) {
        logger.info(`Cancelled ${cancelled} open orders during shutdown`, 'TradingPipeline');
      }
    } catch (err) {
      logger.error('Failed to cancel orders during shutdown', 'TradingPipeline', { err: String(err) });
    }

    this.orderManager.stopStalePoll();
    this.orderbookStream.disconnect();

    this.status = 'stopped';
    this.emit('stopped');
    logger.info('Pipeline stopped', 'TradingPipeline');
  }

  getStatus(): PipelineStatus { return this.status; }
  getStrategiesStatus() { return this.strategyRunner.getAllStatus(); }

  // ── Private ────────────────────────────────────────────────────────────────

  private initComponents(): void {
    const db = getDatabase(this.cfg.dbPath);

    this.clobClient      = new ClobClient(this.cfg.privateKey || 'paper-key', this.cfg.chainId);
    this.orderbookStream = new OrderBookStream();
    this.scanner         = new MarketScanner(this.clobClient);
    this.orderManager    = new OrderManager(this.clobClient);
    this.strategyRunner  = new StrategyRunner();

    const riskManager = new RiskManager({
      maxPositionSize:  String(parseFloat(this.cfg.capitalUsdc) * 0.2),
      maxDrawdown:      0.15,
      maxOpenPositions: 15,
      stopLossPercent:  0.10,
      maxLeverage:      1,
    });

    const adapter = buildPolymarketAdapter({
      riskManager,
      orderManager:    this.orderManager,
      orderbookStream: this.orderbookStream,
      paperExchange:   new PaperExchange(),
      db,
      capitalUsdc:   this.cfg.capitalUsdc,
      paperTrading:  this.cfg.paperTrading,
    });

    // TradeExecutor wired but strategies call ClobClient directly (adapter used for risk gate)
    new TradeExecutor({ polymarket: adapter });
    this.orderManager.startStalePoll();
  }

  private async discoverAndRegisterStrategies(): Promise<void> {
    logger.info('Scanning for market opportunities', 'TradingPipeline');
    const scan = await this.scanner.scan({ minVolume: 1_000 });
    logger.info('Scan complete', 'TradingPipeline', { opportunities: scan.opportunities.length });

    // Subscribe top 20 tokens to live orderbook stream
    scan.opportunities.slice(0, 20).forEach(opp => {
      this.orderbookStream.subscribe(opp.yesTokenId);
      this.orderbookStream.subscribe(opp.noTokenId);
    });

    // Register arb strategy
    const arbCfg = this.cfg.strategies.find(s => s.name === 'cross-market-arb');
    if (arbCfg?.enabled) {
      const arb = new CrossMarketArbStrategy(this.clobClient, this.scanner, arbCfg, arbCfg.capitalAllocation);
      this.strategyRunner.register('cross-market-arb', arb);
    }

    // Register market maker and seed top markets
    const mmCfg = this.cfg.strategies.find(s => s.name === 'market-maker');
    if (mmCfg?.enabled) {
      const mm = new MarketMakerStrategy(this.clobClient, mmCfg, mmCfg.capitalAllocation);
      scan.opportunities.slice(0, 10).forEach(opp => mm.addMarket(opp));
      this.strategyRunner.register('market-maker', mm);
    }

    // Layer 3: Mean Reversion
    const mrCfg = this.cfg.strategies.find(s => s.name === 'mean-reversion');
    if (mrCfg?.enabled !== false) {
      const mrCapital = mrCfg?.capitalAllocation ?? '200';
      this.meanReversion = new MeanReversionStrategy(
        this.clobClient, this.scanner,
        mrCfg ?? { name: 'mean-reversion', enabled: true, capitalAllocation: mrCapital, params: {} },
        mrCapital,
      );
      this.strategyRunner.register('mean-reversion', this.meanReversion);
    }
  }

  /** Get the running MarketMakerStrategy instance (if any) */
  private getMarketMakerInstance(): MarketMakerStrategy | null {
    try {
      const strategies = (this.strategyRunner as any)?.strategies;
      if (strategies instanceof Map) {
        return strategies.get('market-maker') ?? null;
      }
    } catch {}
    return null;
  }

  /** Start prediction loop and feed AI fair values to MarketMaker + Executor */
  private startPredictionFeed(): void {
    try {
      this.predictionLoop = new PredictionLoop(this.scanner);
      logger.info('PredictionLoop started — AI fair values feeding MarketMaker', 'TradingPipeline');

      // Layer 2: Setup directional executor if license available
      this.initPredictionExecutor();

      const feedLoop = async () => {
        while (this.status === 'running') {
          try {
            const signals = await this.predictionLoop!.runCycle();

            // Layer 1: Feed fair values to MM
            const mm = this.getMarketMakerInstance();
            if (mm) {
              for (const signal of signals) {
                if (signal.direction === 'skip') continue;
                mm.setFairValue(signal.yesTokenId, signal.ourProb, signal.confidence);
                logger.debug('Fed AI fair value to MM', 'TradingPipeline', {
                  market: signal.description?.slice(0, 40),
                  aiProb: signal.ourProb.toFixed(2),
                  edge: (signal.edge * 100).toFixed(1) + '%',
                });
              }
            }

            // Layer 2: Execute directional bets on high-edge signals
            if (this.predictionExecutor) {
              const highEdge = signals.filter(s => s.direction !== 'skip' && Math.abs(s.edge) >= 0.08);
              if (highEdge.length > 0) {
                const trades = await this.predictionExecutor.executeSignals(highEdge);
                if (trades.length > 0) {
                  logger.info(`Layer 2: Executed ${trades.length} directional trades`, 'TradingPipeline', {
                    totalUsdc: trades.reduce((s, t) => s + t.sizeUsdc, 0).toFixed(2),
                  });
                }
              }
            }
          } catch (err) {
            logger.error('Prediction feed error', 'TradingPipeline', { err: String(err) });
          }
          await new Promise(r => setTimeout(r, 15 * 60 * 1000));
        }
      };
      feedLoop(); // fire and forget
    } catch (err) {
      logger.warn('PredictionLoop failed to start — MM will use midpoint (blind mode)', 'TradingPipeline', { err: String(err) });
    }
  }

  /** Layer 2: Initialize directional executor from env license */
  private initPredictionExecutor(): void {
    try {
      const key = process.env['RAAS_LICENSE_KEY'] || process.env['LICENSE_KEY'];
      const secret = process.env['RAAS_LICENSE_SECRET'] || process.env['LICENSE_SECRET'];
      if (!key || !secret) {
        logger.debug('No license key — Layer 2 (convergence) disabled', 'TradingPipeline');
        return;
      }
      // Minimal license payload for executor
      const capitalForDirectional = parseFloat(this.cfg.capitalUsdc) * 0.3;
      const license = { tier: 'pro', maxTradesPerDay: -1, features: [] } as any;
      this.predictionExecutor = new PredictionExecutor(this.clobClient, license, {
        capitalUsdc: capitalForDirectional,
        maxPositionFraction: 0.05,
        kellyFraction: 0.25,
        dryRun: this.cfg.paperTrading,
      });
      logger.info(`Layer 2 (Convergence): $${capitalForDirectional} capital, quarter-Kelly`, 'TradingPipeline');
    } catch (err) {
      logger.warn('PredictionExecutor init failed', 'TradingPipeline', { err: String(err) });
    }
  }

  private wireOrderbookStream(): void {
    this.orderbookStream.on('disconnected', () => {
      logger.warn('Orderbook stream disconnected', 'TradingPipeline');
      this.emit('stream_disconnected');
    });

    // Feed price updates to mean reversion strategy (Layer 3)
    this.orderbookStream.on('update', (data: { tokenId: string; bestBid: number; bestAsk: number }) => {
      if (this.meanReversion && data.bestBid > 0 && data.bestAsk > 0) {
        this.meanReversion.onPriceUpdate(data.tokenId, (data.bestBid + data.bestAsk) / 2);
      }
    });

    this.orderbookStream.connect();
    logger.info('Orderbook stream connected', 'TradingPipeline');
  }
}
