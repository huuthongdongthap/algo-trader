// SplitMergeArb Agent — monitor YES+NO CLOB prices vs $1.00 for split/merge arb
// If YES + NO < $1.00: buy both on CLOB → merge on-chain → profit
// If YES + NO > $1.00: split on-chain → sell both on CLOB → profit
import type { SpecialistAgent, AgentTask, AgentResult } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';
import { logger } from '../core/logger.js';

interface SplitMergeOpportunity {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  sum: number;
  spread: number;
  direction: 'buy-merge' | 'split-sell';
  estimatedProfitBps: number; // basis points
  volume24h: number;
  liquidity: number;
}

export class SplitMergeArbAgent implements SpecialistAgent {
  readonly name = 'split-merge-arb';
  readonly description = 'Monitor YES+NO prices vs $1.00 for split/merge arbitrage opportunities';
  readonly taskTypes = ['split-merge-arb' as const];

  canHandle(task: AgentTask): boolean {
    return task.type === 'split-merge-arb';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    try {
      const {
        minSpreadBps = 100, // 1% minimum
        limit = 100,
      } = task.payload as { minSpreadBps?: number; limit?: number };

      const minSpread = minSpreadBps / 10000;
      logger.info(`SplitMergeArb: scanning for YES+NO spread >= ${minSpreadBps}bps`, 'SplitMergeArbAgent');

      const { GammaClient } = await import('../polymarket/gamma-client.js');
      const gamma = new GammaClient();
      const markets = await gamma.getTrending(limit);

      const opportunities: SplitMergeOpportunity[] = [];

      for (const m of markets) {
        if (m.closed || m.resolved) continue;
        if (m.yesPrice <= 0 || m.noPrice <= 0) continue;

        const sum = m.yesPrice + m.noPrice;
        const spread = Math.abs(sum - 1.0);

        if (spread >= minSpread) {
          // Account for ~1-2% taker fee on CLOB side
          const takerFee = 0.02;
          const netProfitBps = Math.round((spread - takerFee) * 10000);

          if (netProfitBps > 0) {
            opportunities.push({
              marketId: m.id,
              question: m.question,
              yesPrice: m.yesPrice,
              noPrice: m.noPrice,
              sum: Math.round(sum * 10000) / 10000,
              spread: Math.round(spread * 10000) / 10000,
              direction: sum < 1.0 ? 'buy-merge' : 'split-sell',
              estimatedProfitBps: netProfitBps,
              volume24h: m.volume24h,
              liquidity: m.liquidity,
            });
          }
        }
      }

      opportunities.sort((a, b) => b.estimatedProfitBps - a.estimatedProfitBps);

      return successResult(this.name, task.id, {
        scanned: markets.length,
        opportunities: opportunities.length,
        results: opportunities,
        note: opportunities.length === 0
          ? `No split-merge arb found (min spread=${minSpreadBps}bps after 2% taker fee)`
          : `Found ${opportunities.length} arb opportunities. buy-merge: YES+NO < $1, split-sell: YES+NO > $1. Profit after ~2% taker fee.`,
      }, Date.now() - start);
    } catch (err) {
      return failResult(this.name, task.id, err instanceof Error ? err.message : String(err), Date.now() - start);
    }
  }
}
