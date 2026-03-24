// VolumeAlert Agent — detect volume anomalies across active markets
// Sudden volume spike (>Nx 24h avg) before resolution = someone knows something
import type { SpecialistAgent, AgentTask, AgentResult } from './agent-base.js';
import { successResult, failResult } from './agent-base.js';
import { logger } from '../core/logger.js';

interface VolumeAnomaly {
  marketId: string;
  question: string;
  volume: number;
  volume24h: number;
  liquidity: number;
  volumeToLiquidityRatio: number;
  yesPrice: number;
  endDate: string;
  signal: 'high-volume' | 'extreme-volume';
}

export class VolumeAlertAgent implements SpecialistAgent {
  readonly name = 'volume-alert';
  readonly description = 'Detect volume anomalies across active markets (insider signal detection)';
  readonly taskTypes = ['volume-alert' as const];

  canHandle(task: AgentTask): boolean {
    return task.type === 'volume-alert';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    try {
      const {
        minVolumeRatio = 3.0,
        limit = 100,
      } = task.payload as { minVolumeRatio?: number; limit?: number };

      logger.info(`VolumeAlert: scanning for volume spikes >= ${minVolumeRatio}x`, 'VolumeAlertAgent');

      const { GammaClient } = await import('../polymarket/gamma-client.js');
      const gamma = new GammaClient();
      const markets = await gamma.getTrending(limit);

      const anomalies: VolumeAnomaly[] = [];

      for (const m of markets) {
        if (m.closed || m.resolved) continue;
        if (m.liquidity <= 0 || m.volume24h <= 0) continue;

        // Volume-to-liquidity ratio: high ratio = unusual activity relative to pool size
        const volLiqRatio = m.volume24h / m.liquidity;

        if (volLiqRatio >= minVolumeRatio) {
          anomalies.push({
            marketId: m.id,
            question: m.question,
            volume: m.volume,
            volume24h: m.volume24h,
            liquidity: m.liquidity,
            volumeToLiquidityRatio: Math.round(volLiqRatio * 100) / 100,
            yesPrice: m.yesPrice,
            endDate: m.endDate,
            signal: volLiqRatio >= 10 ? 'extreme-volume' : 'high-volume',
          });
        }
      }

      anomalies.sort((a, b) => b.volumeToLiquidityRatio - a.volumeToLiquidityRatio);

      return successResult(this.name, task.id, {
        scanned: markets.length,
        anomalies: anomalies.length,
        results: anomalies,
        note: anomalies.length === 0
          ? `No volume anomalies found (ratio >= ${minVolumeRatio}x)`
          : `Found ${anomalies.length} markets with abnormal volume. "extreme-volume" (>=10x) = strongest signal.`,
      }, Date.now() - start);
    } catch (err) {
      return failResult(this.name, task.id, err instanceof Error ? err.message : String(err), Date.now() - start);
    }
  }
}
