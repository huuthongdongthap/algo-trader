/**
 * Paper Trading Test — Fetch live markets, run LLM probability,
 * generate trade signals. No real money involved.
 */

import { LlmRouter } from '../src/lib/llm-router.js';
import { LlmSentimentStrategy } from '../src/strategies/polymarket/llm-sentiment-strategy.js';
import type { MarketOpportunity } from '../src/polymarket/market-scanner.js';

const CLOB_URL = 'https://clob.polymarket.com';

interface ClobMarket {
  condition_id: string;
  tokens: Array<{ token_id: string; outcome: string }>;
  description?: string;
  question?: string;
  active: boolean;
  volume?: string;
}

async function fetchMarkets(limit = 10): Promise<MarketOpportunity[]> {
  const res = await fetch(CLOB_URL + '/markets?limit=' + limit + '&active=true');
  const data = await res.json() as { data: ClobMarket[] };

  const opportunities: MarketOpportunity[] = [];
  for (const m of data.data) {
    if (!m.active || !m.tokens || m.tokens.length < 2) continue;

    const yesToken = m.tokens.find(t => t.outcome === 'Yes');
    const noToken = m.tokens.find(t => t.outcome === 'No');
    if (!yesToken || !noToken) continue;

    // Fetch orderbook for price
    try {
      const bookRes = await fetch(CLOB_URL + '/book?token_id=' + yesToken.token_id);
      const book = await bookRes.json() as { bids: Array<{price: string}>; asks: Array<{price: string}> };

      const yesBid = parseFloat(book.bids?.[0]?.price || '0');
      const yesAsk = parseFloat(book.asks?.[0]?.price || '1');
      const yesMid = (yesBid + yesAsk) / 2 || 0.5;
      const noMid = 1 - yesMid;

      opportunities.push({
        conditionId: m.condition_id,
        description: m.description || m.question || 'Unknown',
        yesTokenId: yesToken.token_id,
        noTokenId: noToken.token_id,
        yesMidPrice: yesMid,
        noMidPrice: noMid,
        priceSum: yesMid + noMid,
        priceSumDelta: yesMid + noMid - 1,
        yesSpread: yesAsk - yesBid,
        noSpread: 0,
        volume: parseFloat(m.volume || '0'),
        score: 0,
      });
    } catch {
      continue;
    }
  }
  return opportunities;
}

async function main() {
  console.log('=== PAPER TRADING TEST ===');
  console.log('Time:', new Date().toISOString());

  // 1. Fetch live markets
  console.log('\n--- Fetching markets ---');
  const markets = await fetchMarkets(5);
  console.log('Markets found:', markets.length);

  if (markets.length === 0) {
    console.log('No active markets. Exiting.');
    return;
  }

  // 2. Init LLM strategy
  const router = new LlmRouter();
  const strategy = new LlmSentimentStrategy(
    { minEdge: 0.03, minConfidence: 0.5, capitalUsdc: 50000, kellyFraction: 0.25 },
    router,
  );

  // 3. Evaluate each market
  console.log('\n--- Evaluating with LLM ---');
  for (const market of markets) {
    const q = market.description.slice(0, 60);
    console.log('\nMarket: ' + q + '...');
    console.log('  YES=' + market.yesMidPrice.toFixed(3) + ' NO=' + market.noMidPrice.toFixed(3));

    const signal = await strategy.evaluate(market);
    if (signal) {
      console.log('  SIGNAL: ' + signal.side + ' edge=' + signal.edge.toFixed(3) +
        ' conf=' + signal.confidence.toFixed(2) + ' size=$' + signal.positionSize.toFixed(0));
    } else {
      console.log('  No signal (edge too small or confidence too low)');
    }
  }

  // 4. Summary
  const signals = strategy.getSignals();
  console.log('\n=== SUMMARY ===');
  console.log('Markets scanned:', markets.length);
  console.log('Signals generated:', signals.length);
  console.log('Cloud spend:', JSON.stringify(router.getCloudSpend()));

  if (signals.length > 0) {
    const totalSize = signals.reduce((s, sig) => s + sig.positionSize, 0);
    console.log('Total position size: $' + totalSize.toFixed(0));
    console.log('Avg edge: ' + (signals.reduce((s, sig) => s + sig.edge, 0) / signals.length).toFixed(3));
  }
}

main().catch(console.error);
