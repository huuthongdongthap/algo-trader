// EventCluster Agent — build correlation matrix within multi-market events
// If "Trump wins PA" moves, "Trump wins MI" should follow → trade lagging markets
import type { SpecialistAgent, AgentTask, AgentResult } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';
import { logger } from '../core/logger.js';

interface MarketCorrelation {
  marketA: string;
  marketB: string;
  priceA: number;
  priceB: number;
  priceDiff: number;
}

interface EventClusterResult {
  eventId: string;
  title: string;
  marketCount: number;
  avgYesPrice: number;
  priceStdDev: number;
  outliers: MarketCorrelation[];
}

export class EventClusterAgent implements SpecialistAgent {
  readonly name = 'event-cluster';
  readonly description = 'Analyze cross-market correlations within events to find lagging markets';
  readonly taskTypes = ['event-cluster' as const];

  canHandle(task: AgentTask): boolean {
    return task.type === 'event-cluster';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    try {
      const {
        minMarkets = 3,
        minPriceDiff = 0.10,
        limit = 30,
      } = task.payload as { minMarkets?: number; minPriceDiff?: number; limit?: number };

      logger.info(`EventCluster: analyzing events with >= ${minMarkets} markets`, 'EventClusterAgent');

      const { GammaClient } = await import('../polymarket/gamma-client.js');
      const gamma = new GammaClient();
      const events = await gamma.getEvents(limit);

      const clusters: EventClusterResult[] = [];

      for (const event of events) {
        if (event.markets.length < minMarkets) continue;

        const prices = event.markets.map(m => m.yesPrice);
        const avg = prices.reduce((s, p) => s + p, 0) / prices.length;
        const variance = prices.reduce((s, p) => s + (p - avg) ** 2, 0) / prices.length;
        const stdDev = Math.sqrt(variance);

        // Find outlier pairs — markets with large price differences within same event
        const outliers: MarketCorrelation[] = [];
        for (let i = 0; i < event.markets.length; i++) {
          for (let j = i + 1; j < event.markets.length; j++) {
            const diff = Math.abs(event.markets[i].yesPrice - event.markets[j].yesPrice);
            if (diff >= minPriceDiff) {
              outliers.push({
                marketA: event.markets[i].question,
                marketB: event.markets[j].question,
                priceA: event.markets[i].yesPrice,
                priceB: event.markets[j].yesPrice,
                priceDiff: Math.round(diff * 10000) / 10000,
              });
            }
          }
        }

        if (outliers.length > 0) {
          outliers.sort((a, b) => b.priceDiff - a.priceDiff);
          clusters.push({
            eventId: event.id,
            title: event.title,
            marketCount: event.markets.length,
            avgYesPrice: Math.round(avg * 10000) / 10000,
            priceStdDev: Math.round(stdDev * 10000) / 10000,
            outliers: outliers.slice(0, 5), // top 5 pairs per event
          });
        }
      }

      clusters.sort((a, b) => b.priceStdDev - a.priceStdDev);

      return successResult(this.name, task.id, {
        scanned: events.length,
        clustersFound: clusters.length,
        results: clusters,
        note: clusters.length === 0
          ? `No significant price divergence found within events (minDiff=${minPriceDiff})`
          : `Found ${clusters.length} events with internal price divergence. High stdDev = potential correlation trade.`,
      }, Date.now() - start);
    } catch (err) {
      return failResult(this.name, task.id, err instanceof Error ? err.message : String(err), Date.now() - start);
    }
  }
}
