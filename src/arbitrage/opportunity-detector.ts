/**
 * Opportunity Detector
 * Detects triangular, DEX-CEX spread, and funding rate arbitrage
 */

import { PricePoint, ArbitrageOpportunity, ArbitrageLeg, DetectorConfig } from './types';
import { DEFAULT_DETECTOR_CONFIG, TRIANGULAR_PAIRS, EXCHANGE_FEE_RATES } from './config';

export class OpportunityDetector {
  private config: DetectorConfig;
  private opportunityCounter = 0;

  constructor(config: Partial<DetectorConfig> = {}) {
    this.config = { ...DEFAULT_DETECTOR_CONFIG, ...config };
  }

  detectTriangularArbitrage(prices: PricePoint[]): ArbitrageOpportunity | null {
    for (const [exchange, pairs] of Object.entries(TRIANGULAR_PAIRS)) {
      for (const [pair1, pair2, pair3] of pairs) {
        const opportunity = this.checkTriangularPath(exchange, pair1, pair2, pair3, prices);
        if (opportunity && opportunity.expectedProfitPct > this.config.minProfitThreshold) {
          return opportunity;
        }
      }
    }
    return null;
  }

  private checkTriangularPath(
    exchange: string,
    pair1: string,
    pair2: string,
    pair3: string,
    prices: PricePoint[]
  ): ArbitrageOpportunity | null {
    const p1 = prices.find((p) => p.symbol === pair1);
    const p2 = prices.find((p) => p.symbol === pair2);
    const p3 = prices.find((p) => p.symbol === pair3);

    if (!p1 || !p2 || !p3) return null;

    const startAmount = 1000;
    const afterTrade1 = (startAmount / p1.ask) * (1 - this.getFee(exchange));
    const afterTrade2 = (afterTrade1 / p2.ask) * (1 - this.getFee(exchange));
    const finalAmount = (afterTrade2 * p3.bid) * (1 - this.getFee(exchange));

    const profit = finalAmount - startAmount;
    const profitPct = (profit / startAmount) * 100;

    if (profitPct <= this.config.minProfitThreshold) return null;

    return this.createOpportunity('triangular', [
      { exchange: exchange as any, symbol: pair1, side: 'buy', price: p1.ask, amount: startAmount, fee: this.getFee(exchange) },
      { exchange: exchange as any, symbol: pair2, side: 'buy', price: p2.ask, amount: afterTrade1, fee: this.getFee(exchange) },
      { exchange: exchange as any, symbol: pair3, side: 'sell', price: p3.bid, amount: afterTrade2, fee: this.getFee(exchange) },
    ], profit, profitPct);
  }

  detectDexCexArbitrage(dexPrices: PricePoint[], cexPrices: PricePoint[]): ArbitrageOpportunity[] {
    const opportunities: ArbitrageOpportunity[] = [];

    for (const dexPrice of dexPrices) {
      const cexPrice = cexPrices.find((p) => p.symbol === dexPrice.symbol);
      if (!cexPrice) continue;

      const spread = ((dexPrice.bid - cexPrice.ask) / cexPrice.ask) * 100;
      const totalFees = this.getFee(dexPrice.exchange) + this.getFee(cexPrice.exchange);
      const netProfit = spread - totalFees;

      if (netProfit > this.config.minProfitThreshold) {
        opportunities.push(this.createOpportunity('dex-cex', [
          { exchange: cexPrice.exchange, symbol: cexPrice.symbol, side: 'buy', price: cexPrice.ask, amount: 1000, fee: this.getFee(cexPrice.exchange) },
          { exchange: dexPrice.exchange, symbol: dexPrice.symbol, side: 'sell', price: dexPrice.bid, amount: 1000, fee: this.getFee(dexPrice.exchange) },
        ], netProfit * 10, netProfit));
      }
    }

    return opportunities;
  }

  detectFundingRateArbitrage(prices: PricePoint[], fundingRates: Record<string, number>): ArbitrageOpportunity | null {
    for (const [symbol, rate] of Object.entries(fundingRates)) {
      const price = prices.find((p) => p.symbol === symbol);
      if (!price) continue;

      if (rate > 0.01) {
        const expectedProfit = rate * 100;
        if (expectedProfit > this.config.minProfitThreshold) {
          return this.createOpportunity('funding-rate', [
            { exchange: price.exchange, symbol, side: 'sell', price: price.bid, amount: 1000, fee: this.getFee(price.exchange) },
          ], expectedProfit * 10, expectedProfit);
        }
      }
    }
    return null;
  }

  private createOpportunity(
    type: ArbitrageOpportunity['type'],
    legs: ArbitrageLeg[],
    profit: number,
    profitPct: number
  ): ArbitrageOpportunity {
    const now = Date.now();
    return {
      id: `opp_${++this.opportunityCounter}_${now}`,
      type,
      legs,
      expectedProfit: profit,
      expectedProfitPct: profitPct,
      totalFees: legs.reduce((sum, leg) => sum + leg.fee, 0),
      confidence: Math.min(95, 50 + profitPct * 10),
      detectedAt: now,
      expiresAt: now + 5000,
    };
  }

  private getFee(exchange: string): number {
    return EXCHANGE_FEE_RATES[exchange] ?? 0.001;
  }
}
