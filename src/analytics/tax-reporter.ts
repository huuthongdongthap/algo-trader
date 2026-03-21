// Tax-ready reporting: FIFO gain/loss calculation, TurboTax/H&R Block compatible CSV export

import type { TradeResult } from '../core/types.js';

export interface TaxableEvent {
  date: string;          // ISO date YYYY-MM-DD
  type: 'trade' | 'income';
  symbol: string;        // derived from marketId
  quantity: number;
  proceeds: number;      // sale proceeds
  costBasis: number;     // purchase cost
  gainLoss: number;      // proceeds - costBasis
  holdingPeriod: number; // days held
}

export interface TaxSummary {
  totalGains: number;
  totalLosses: number;
  netGainLoss: number;
  shortTermNet: number;  // held <= 365 days
  longTermNet: number;   // held > 365 days
  eventCount: number;
}

interface LotEntry {
  date: string;
  price: number;
  size: number;
  symbol: string;
}

/** Extract symbol from marketId (e.g. 'BTC-USDT' → 'BTC-USDT') */
function symbolFromMarketId(marketId: string): string {
  return marketId.toUpperCase();
}

/**
 * Match buy lots to sells using FIFO to calculate realized gains.
 * Returns one TaxableEvent per matched sell.
 */
export function calculateGainLoss(trades: TradeResult[]): TaxableEvent[] {
  const lots = new Map<string, LotEntry[]>(); // keyed by symbol
  const events: TaxableEvent[] = [];

  // Sort chronologically to ensure correct FIFO ordering
  const sorted = [...trades].sort((a, b) => a.timestamp - b.timestamp);

  for (const trade of sorted) {
    const symbol = symbolFromMarketId(trade.marketId);
    const price = parseFloat(trade.fillPrice);
    const size = parseFloat(trade.fillSize);
    const fees = parseFloat(trade.fees);
    const date = new Date(trade.timestamp).toISOString().slice(0, 10);

    if (trade.side === 'buy') {
      const bucket = lots.get(symbol) ?? [];
      bucket.push({ date, price, size, symbol });
      lots.set(symbol, bucket);
    } else {
      // sell: match against FIFO lots
      let remaining = size;
      const bucket = lots.get(symbol) ?? [];

      while (remaining > 0 && bucket.length > 0) {
        const lot = bucket[0];
        const matchSize = Math.min(lot.size, remaining);

        const proceeds = price * matchSize - fees * (matchSize / size);
        const costBasis = lot.price * matchSize;
        const gainLoss = proceeds - costBasis;

        const sellDate = new Date(trade.timestamp);
        const buyDate = new Date(lot.date);
        const holdingPeriod = Math.floor(
          (sellDate.getTime() - buyDate.getTime()) / (1000 * 60 * 60 * 24),
        );

        events.push({
          date,
          type: 'trade',
          symbol,
          quantity: matchSize,
          proceeds,
          costBasis,
          gainLoss,
          holdingPeriod,
        });

        remaining -= matchSize;
        lot.size -= matchSize;
        if (lot.size <= 0) bucket.shift();
      }

      lots.set(symbol, bucket);
    }
  }

  return events;
}

/**
 * Filter taxable events to a specific calendar year.
 */
export function generateTaxReport(trades: TradeResult[], year: number): TaxableEvent[] {
  const all = calculateGainLoss(trades);
  return all.filter(e => e.date.startsWith(String(year)));
}

/** Escape a CSV field value (quote if contains comma, newline, or quote) */
function csvField(value: string | number): string {
  const str = String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Export taxable events to CSV string.
 * Format compatible with TurboTax and H&R Block import.
 * Columns: Description, Date Acquired, Date Sold, Proceeds, Cost Basis, Gain/Loss, Term
 */
export function exportToCsv(events: TaxableEvent[]): string {
  const headers = [
    'Description',
    'Date Acquired',
    'Date Sold',
    'Proceeds',
    'Cost Basis',
    'Gain or Loss',
    'Term',
  ];

  const rows = events.map(e => {
    const term = e.holdingPeriod > 365 ? 'Long-term' : 'Short-term';
    // Date acquired is approximated; actual FIFO lot date is embedded in costBasis
    const acquiredDate = 'Various';
    return [
      csvField(`${e.symbol} - ${e.quantity.toFixed(8)}`),
      csvField(acquiredDate),
      csvField(e.date),
      csvField(e.proceeds.toFixed(2)),
      csvField(e.costBasis.toFixed(2)),
      csvField(e.gainLoss.toFixed(2)),
      csvField(term),
    ].join(',');
  });

  return [headers.join(','), ...rows].join('\n');
}

/**
 * Aggregate events into a tax summary with short/long-term breakdown.
 */
export function getSummary(events: TaxableEvent[]): TaxSummary {
  let totalGains = 0;
  let totalLosses = 0;
  let shortTermNet = 0;
  let longTermNet = 0;

  for (const e of events) {
    if (e.gainLoss > 0) totalGains += e.gainLoss;
    else totalLosses += e.gainLoss; // negative

    if (e.holdingPeriod > 365) longTermNet += e.gainLoss;
    else shortTermNet += e.gainLoss;
  }

  return {
    totalGains,
    totalLosses,
    netGainLoss: totalGains + totalLosses,
    shortTermNet,
    longTermNet,
    eventCount: events.length,
  };
}
