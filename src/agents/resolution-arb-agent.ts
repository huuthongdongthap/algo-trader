// Resolution Arb Agent — find markets in UMA oracle challenge window
// After outcome proposed but before finalization (2h window), price often 0.95-0.99
// Buy YES at 0.97, redeem at 1.00 = near risk-free 3%
import type { SpecialistAgent, AgentTask, AgentResult } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';
import { logger } from '../core/logger.js';

interface ResolutionArbOpportunity {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  resolved: boolean;
  outcome: string | null;
  potentialReturn: number;
  volume: number;
  riskLevel: 'low' | 'medium';
}

export class ResolutionArbAgent implements SpecialistAgent {
  readonly name = 'resolution-arb';
  readonly description = 'Find markets in resolution/challenge window for near risk-free arb';
  readonly taskTypes = ['resolution-arb' as const];

  canHandle(task: AgentTask): boolean {
    return task.type === 'resolution-arb';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    try {
      const {
        minPrice = 0.90,
        limit = 200,
      } = task.payload as { minPrice?: number; limit?: number };

      logger.info(`ResolutionArb: scanning for challenge-window markets (minPrice=${minPrice})`, 'ResolutionArbAgent');

      const { GammaClient } = await import('../polymarket/gamma-client.js');
      const gamma = new GammaClient();
      const markets = await gamma.getTrending(limit);

      const now = Date.now();
      const opportunities: ResolutionArbOpportunity[] = [];

      for (const m of markets) {
        if (m.resolved) continue;
        if (!m.endDate) continue;

        const endTime = new Date(m.endDate).getTime();
        // Market past end date but not yet resolved = likely in challenge window
        const pastEnd = endTime < now;
        // Or very close to end (within 6 hours)
        const nearEnd = endTime - now < 6 * 60 * 60 * 1000 && endTime > now;

        if (!pastEnd && !nearEnd) continue;

        const highSide = Math.max(m.yesPrice, m.noPrice);
        if (highSide < minPrice) continue;

        const potentialReturn = Math.round((1 / highSide - 1) * 10000) / 100;

        opportunities.push({
          marketId: m.id,
          question: m.question,
          yesPrice: m.yesPrice,
          noPrice: m.noPrice,
          resolved: m.resolved,
          outcome: m.outcome,
          potentialReturn,
          volume: m.volume,
          riskLevel: pastEnd ? 'low' : 'medium',
        });
      }

      opportunities.sort((a, b) => {
        if (a.riskLevel !== b.riskLevel) return a.riskLevel === 'low' ? -1 : 1;
        return b.potentialReturn - a.potentialReturn;
      });

      return successResult(this.name, task.id, {
        scanned: markets.length,
        opportunities: opportunities.length,
        results: opportunities,
        note: opportunities.length === 0
          ? 'No resolution-arb opportunities found. Markets in challenge window are rare.'
          : `Found ${opportunities.length} markets near/past resolution. "low" risk = past end date, likely in UMA challenge window.`,
      }, Date.now() - start);
    } catch (err) {
      return failResult(this.name, task.id, err instanceof Error ? err.message : String(err), Date.now() - start);
    }
  }
}
