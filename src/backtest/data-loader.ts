// Historical price data loader for backtesting engine
// Supports CSV files, in-memory arrays, and synthetic data generation

import { readFileSync } from 'fs';

/** OHLCV candle structure for backtesting */
export interface HistoricalCandle {
  /** Unix timestamp in milliseconds */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/** Parse a single CSV row into a HistoricalCandle */
function parseCsvRow(row: string, headers: string[]): HistoricalCandle | null {
  const cols = row.split(',').map(c => c.trim());
  if (cols.length < 6) return null;

  const idx = (name: string) => headers.indexOf(name);

  // Support both unix timestamps and ISO date strings
  const tsRaw = cols[idx('timestamp') !== -1 ? idx('timestamp') : 0];
  const timestamp = isNaN(Number(tsRaw)) ? new Date(tsRaw).getTime() : Number(tsRaw);

  return {
    timestamp,
    open: parseFloat(cols[idx('open') !== -1 ? idx('open') : 1]),
    high: parseFloat(cols[idx('high') !== -1 ? idx('high') : 2]),
    low: parseFloat(cols[idx('low') !== -1 ? idx('low') : 3]),
    close: parseFloat(cols[idx('close') !== -1 ? idx('close') : 4]),
    volume: parseFloat(cols[idx('volume') !== -1 ? idx('volume') : 5]),
  };
}

/**
 * Load OHLCV data from a CSV file.
 * Expected columns: timestamp,open,high,low,close,volume
 */
export function loadFromCsv(filePath: string): HistoricalCandle[] {
  const raw = readFileSync(filePath, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const candles: HistoricalCandle[] = [];

  for (let i = 1; i < lines.length; i++) {
    const candle = parseCsvRow(lines[i], headers);
    if (candle && !isNaN(candle.close)) {
      candles.push(candle);
    }
  }

  // Ensure chronological order
  return candles.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Load candles from an in-memory array.
 * Validates and normalizes each entry.
 */
export function loadFromArray(data: Partial<HistoricalCandle>[]): HistoricalCandle[] {
  const candles: HistoricalCandle[] = [];

  for (const item of data) {
    if (!item.timestamp || item.close === undefined) continue;
    const close = item.close;
    candles.push({
      timestamp: item.timestamp,
      open: item.open ?? close,
      high: item.high ?? close,
      low: item.low ?? close,
      close,
      volume: item.volume ?? 0,
    });
  }

  return candles.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * Generate synthetic OHLCV data using random walk.
 * Useful for strategy testing without real market data.
 */
export function generateMockData(symbol: string, days: number, startPrice: number): HistoricalCandle[] {
  void symbol; // symbol used for context / future seeding
  const candles: HistoricalCandle[] = [];
  const MS_PER_DAY = 86_400_000;
  const startTs = Date.now() - days * MS_PER_DAY;

  let price = startPrice;

  for (let i = 0; i < days; i++) {
    const timestamp = startTs + i * MS_PER_DAY;
    // Daily volatility ~2%
    const change = (Math.random() - 0.48) * price * 0.02;
    const open = price;
    const close = Math.max(0.01, price + change);
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    const volume = Math.random() * 1_000_000 + 100_000;

    candles.push({ timestamp, open, high, low, close, volume });
    price = close;
  }

  return candles;
}

/**
 * Async generator to iterate candles one by one.
 * Useful for streaming large datasets without loading all into memory.
 */
export async function* candleIterator(candles: HistoricalCandle[]): AsyncGenerator<HistoricalCandle> {
  for (const candle of candles) {
    yield candle;
  }
}
