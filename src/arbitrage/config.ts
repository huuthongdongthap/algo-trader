/**
 * Arbitrage Engine Configuration
 * Phase 2: Multi-exchange arbitrage trading
 */

import { ScannerConfig, DetectorConfig, ExecutorConfig } from './types';

export const DEFAULT_SCANNER_CONFIG: ScannerConfig = {
  exchanges: ['binance', 'coinbase', 'kraken', 'uniswap'],
  symbols: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'],
  pollIntervalMs: 1000,
  minVolume24h: 100000,
};

export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  minProfitThreshold: 0.5,
  maxSlippageTolerance: 0.3,
  supportedTypes: ['triangular', 'dex-cex', 'cross-exchange'],
};

export const DEFAULT_EXECUTOR_CONFIG: ExecutorConfig = {
  dryRun: true,
  maxPositionSize: 1000,
  slippageTolerance: 0.5,
  minProfitThreshold: 0.5,
  timeoutMs: 5000,
};

export const EXCHANGE_FEE_RATES: Record<string, number> = {
  binance: 0.001,
  coinbase: 0.005,
  kraken: 0.0026,
  uniswap: 0.003,
};

export const TRIANGULAR_PAIRS: Record<string, string[][]> = {
  binance: [
    ['BTC/USDT', 'ETH/BTC', 'ETH/USDT'],
    ['SOL/USDT', 'SOL/BTC', 'BTC/USDT'],
  ],
  coinbase: [
    ['BTC/USD', 'ETH/BTC', 'ETH/USD'],
    ['SOL/USD', 'SOL/BTC', 'BTC/USD'],
  ],
};

export const GAS_ESTIMATES: Record<string, number> = {
  ethereum: 50,
  polygon: 0.5,
  arbitrum: 1,
};
