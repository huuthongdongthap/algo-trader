// NegRiskScan Agent — scan multi-outcome events for YES+NO sum arbitrage
// If sum of all YES tokens < $1.00 in neg-risk market → arb opportunity
import type { SpecialistAgent, AgentTask, AgentResult } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';
import { logger } from '../core/logger.js';

interface NegRiskOpportunity {
  eventId: string;
  title: string;
  marketCount: number;
  totalYesPrice: number;
  spread: number; // deviation from $1.00
  direction: 'buy-all' | 'sell-all';
  markets: { question: string; yesPrice: number }[];
}

export class NegRiskScanAgent implements SpecialistAgent {
  readonly name = 'neg-risk-scan';
  readonly description = 'Scan multi-outcome events for neg-risk arbitrage (YES sum != $1.00)';
  readonly taskTypes = ['neg-risk-scan' as const];

  canHandle(task: AgentTask): boolean {
    return task.type === 'neg-risk-scan';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    try {
      const { minSpread = 0.02, limit = 50 } = task.payload as { minSpread?: number; limit?: number };
      logger.info(`NegRiskScan: scanning events (minSpread=${minSpread})`, 'NegRiskScanAgent');

      const { GammaClient } = await import('../polymarket/gamma-client.js');
      const gamma = new GammaClient();
      const events = await gamma.getEvents(limit);

      const opportunities: NegRiskOpportunity[] = [];

      for (const event of events) {
        if (event.markets.length < 2) continue;

        const totalYes = event.markets.reduce((sum, m) => sum + m.yesPrice, 0);
        const spread = Math.abs(totalYes - 1.0);

        if (spread >= minSpread) {
          opportunities.push({
            eventId: event.id,
            title: event.title,
            marketCount: event.markets.length,
            totalYesPrice: Math.round(totalYes * 10000) / 10000,
            spread: Math.round(spread * 10000) / 10000,
            direction: totalYes < 1.0 ? 'buy-all' : 'sell-all',
            markets: event.markets.map(m => ({ question: m.question, yesPrice: m.yesPrice })),
          });
        }
      }

      opportunities.sort((a, b) => b.spread - a.spread);

      return successResult(this.name, task.id, {
        scanned: events.length,
        opportunities: opportunities.length,
        results: opportunities,
        note: opportunities.length === 0
          ? `No neg-risk arb found with spread >= ${minSpread}`
          : `Found ${opportunities.length} opportunities. buy-all = sum < $1, sell-all = sum > $1.`,
      }, Date.now() - start);
    } catch (err) {
      return failResult(this.name, task.id, err instanceof Error ? err.message : String(err), Date.now() - start);
    }
  }
}
