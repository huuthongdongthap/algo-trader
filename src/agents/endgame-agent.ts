// Endgame Agent — find markets resolving soon with high-confidence pricing
// Buy YES at 0.90+ when outcome is near-certain = low-risk returns
import type { SpecialistAgent, AgentTask, AgentResult } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';
import { logger } from '../core/logger.js';

interface EndgameOpportunity {
  marketId: string;
  question: string;
  yesPrice: number;
  noPrice: number;
  hoursToResolution: number;
  potentialReturn: number; // % return if correct
  confidence: 'very-high' | 'high';
  volume24h: number;
}

export class EndgameAgent implements SpecialistAgent {
  readonly name = 'endgame';
  readonly description = 'Find resolving-soon markets with high-confidence near-certain outcomes';
  readonly taskTypes = ['endgame' as const];

  canHandle(task: AgentTask): boolean {
    return task.type === 'endgame';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    try {
      const {
        hoursWindow = 48,
        minPrice = 0.85,
        limit = 100,
      } = task.payload as { hoursWindow?: number; minPrice?: number; limit?: number };

      logger.info(`Endgame: scanning markets resolving within ${hoursWindow}h, price >= ${minPrice}`, 'EndgameAgent');

      const { GammaClient } = await import('../polymarket/gamma-client.js');
      const gamma = new GammaClient();
      const markets = await gamma.getTrending(limit);

      const now = Date.now();
      const windowMs = hoursWindow * 60 * 60 * 1000;
      const opportunities: EndgameOpportunity[] = [];

      for (const m of markets) {
        if (m.closed || m.resolved || !m.endDate) continue;

        const endTime = new Date(m.endDate).getTime();
        const timeLeft = endTime - now;
        if (timeLeft <= 0 || timeLeft > windowMs) continue;

        const highSide = Math.max(m.yesPrice, m.noPrice);
        if (highSide < minPrice) continue;

        const hoursLeft = Math.round(timeLeft / (60 * 60 * 1000) * 10) / 10;
        const potentialReturn = Math.round((1 / highSide - 1) * 10000) / 100; // % return

        opportunities.push({
          marketId: m.id,
          question: m.question,
          yesPrice: m.yesPrice,
          noPrice: m.noPrice,
          hoursToResolution: hoursLeft,
          potentialReturn,
          confidence: highSide >= 0.95 ? 'very-high' : 'high',
          volume24h: m.volume24h,
        });
      }

      opportunities.sort((a, b) => a.hoursToResolution - b.hoursToResolution);

      return successResult(this.name, task.id, {
        scanned: markets.length,
        opportunities: opportunities.length,
        results: opportunities,
        note: opportunities.length === 0
          ? `No endgame markets found within ${hoursWindow}h with price >= ${minPrice}`
          : `Found ${opportunities.length} markets. Lower hoursToResolution + higher price = lower risk.`,
      }, Date.now() - start);
    } catch (err) {
      return failResult(this.name, task.id, err instanceof Error ? err.message : String(err), Date.now() - start);
    }
  }
}
