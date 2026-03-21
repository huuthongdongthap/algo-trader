// Aggregated price feed: Polymarket CLOB + CEX public APIs
// EventEmitter for price alerts, in-memory ring buffer per market (no external deps)

import { EventEmitter } from 'node:events';

export interface PriceTick {
  market: string; source: string;
  bid: string; ask: string;
  mid: string;    // (bid+ask)/2
  spread: string; // ask-bid
  volume?: string;
  timestamp: number;
}

export interface AggregatedPrice {
  market: string; ticks: PriceTick[];
  bestBid: string; bestAsk: string;
  vwap: string; updatedAt: number;
}

export type FetchFn = (market: string) => Promise<PriceTick | null>;

interface FeedSource {
  name: string; fetchFn: FetchFn; intervalMs: number;
  timer?: ReturnType<typeof setInterval>;
}

// ---------------------------------------------------------------------------
// Ring buffer (oldest-first read)
// ---------------------------------------------------------------------------
class RingBuffer<T> {
  private buf: T[]; private head = 0; private count = 0;
  constructor(private cap: number) { this.buf = new Array<T>(cap); }
  push(item: T): void {
    this.buf[this.head] = item;
    this.head = (this.head + 1) % this.cap;
    if (this.count < this.cap) this.count++;
  }
  toArray(n?: number): T[] {
    const take = Math.min(n ?? this.count, this.count);
    const out: T[] = [];
    let i = (this.head - this.count + this.cap) % this.cap;
    for (let k = 0; k < this.count; k++) {
      if (k >= this.count - take) out.push(this.buf[i]);
      i = (i + 1) % this.cap;
    }
    return out;
  }
  get size(): number { return this.count; }
}

// ---------------------------------------------------------------------------
// Built-in fetch helpers (native fetch, no deps)
// ---------------------------------------------------------------------------

/** Polymarket CLOB orderbook */
export async function fetchPolymarketPrice(conditionId: string): Promise<PriceTick | null> {
  try {
    const url = `https://clob.polymarket.com/book?token_id=${encodeURIComponent(conditionId)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { bids?: { price: string }[]; asks?: { price: string }[] };
    const bid = data.bids?.[0]?.price ?? '0';
    const ask = data.asks?.[0]?.price ?? '0';
    const mid = ((parseFloat(bid) + parseFloat(ask)) / 2).toFixed(6);
    const spread = (parseFloat(ask) - parseFloat(bid)).toFixed(6);
    return { market: conditionId, source: 'polymarket', bid, ask, mid, spread, timestamp: Date.now() };
  } catch { return null; }
}

/** Binance public book ticker (no auth) */
export async function fetchBinancePrice(symbol: string): Promise<PriceTick | null> {
  try {
    const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=${encodeURIComponent(symbol)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const data = await res.json() as { bidPrice: string; askPrice: string };
    const { bidPrice: bid, askPrice: ask } = data;
    const mid = ((parseFloat(bid) + parseFloat(ask)) / 2).toFixed(8);
    const spread = (parseFloat(ask) - parseFloat(bid)).toFixed(8);
    return { market: symbol, source: 'binance', bid, ask, mid, spread, timestamp: Date.now() };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// PriceFeed
// ---------------------------------------------------------------------------

export class PriceFeed extends EventEmitter {
  private sources = new Map<string, FeedSource>();
  private history = new Map<string, RingBuffer<PriceTick>>();
  private latestBySource = new Map<string, Map<string, PriceTick>>();

  constructor(private histCap = 1000) { super(); }

  addSource(name: string, fetchFn: FetchFn, intervalMs = 5000): void {
    if (this.sources.has(name)) this.removeSource(name);
    this.sources.set(name, { name, fetchFn, intervalMs });
  }

  removeSource(name: string): void {
    const src = this.sources.get(name);
    if (src?.timer) clearInterval(src.timer);
    this.sources.delete(name);
  }

  startPolling(market: string): void {
    if (!this.history.has(market)) this.history.set(market, new RingBuffer(this.histCap));
    for (const [, src] of this.sources) {
      if (src.timer) continue;
      src.timer = setInterval(async () => {
        const tick = await src.fetchFn(market);
        if (tick) this.onTick(tick);
      }, src.intervalMs);
    }
  }

  stopPolling(): void {
    for (const [, src] of this.sources) {
      if (src.timer) { clearInterval(src.timer); src.timer = undefined; }
    }
  }

  /** Manually push a tick (testing / external feeds) */
  pushTick(tick: PriceTick): void { this.onTick(tick); }

  getLatestPrice(market: string): AggregatedPrice | null {
    const srcMap = this.latestBySource.get(market);
    if (!srcMap || srcMap.size === 0) return null;
    const ticks = [...srcMap.values()];
    const bids = ticks.map(t => parseFloat(t.bid)).filter(v => v > 0);
    const asks = ticks.map(t => parseFloat(t.ask)).filter(v => v > 0);
    if (!bids.length || !asks.length) return null;
    const bestBid = Math.max(...bids).toFixed(8);
    const bestAsk = Math.min(...asks).toFixed(8);
    const vols = ticks.map(t => (t.volume ? parseFloat(t.volume) : 1));
    const totalVol = vols.reduce((s, v) => s + v, 0);
    const vwap = (ticks.reduce((s, t, i) => s + parseFloat(t.mid) * vols[i], 0) / totalVol).toFixed(8);
    return { market, ticks, bestBid, bestAsk, vwap, updatedAt: Date.now() };
  }

  getPriceHistory(market: string, count = 100): PriceTick[] {
    return this.history.get(market)?.toArray(count) ?? [];
  }

  private onTick(tick: PriceTick): void {
    if (!this.history.has(tick.market)) this.history.set(tick.market, new RingBuffer(this.histCap));
    this.history.get(tick.market)!.push(tick);
    if (!this.latestBySource.has(tick.market)) this.latestBySource.set(tick.market, new Map());
    this.latestBySource.get(tick.market)!.set(tick.source, tick);
    this.emit('tick', tick);
    this.emit(`tick:${tick.market}`, tick);
  }
}
