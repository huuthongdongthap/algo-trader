// HFT Loop Agent — continuous OpenClaw command chain operating like a solo HFT firm
// Chain: warm-model → scan → estimate → signal → calibrate → repeat (24/7, latency→0)
// Uses AgentDispatcher to chain existing agents in a tight loop
// Usage: algo hft-loop [--interval <seconds>] [--max-cycles <n>]

import type { AgentTask, AgentResult, SpecialistAgent, AgentTaskType } from './agent-base.js';
import { createTask, successResult, failResult } from './agent-base.js';
import type { AgentDispatcher } from './agent-dispatcher.js';
import { logger } from '../core/logger.js';

// Chain sequence: each step feeds the next
const HFT_CHAIN = [
  { type: 'scan',      desc: 'Scan markets for opportunities' },
  { type: 'estimate',  desc: 'AI probability estimation on top markets' },
  { type: 'risk',      desc: 'Risk assessment on positions' },
  { type: 'calibrate', desc: 'Calibrate model parameters from results' },
  { type: 'report',    desc: 'Generate cycle performance report' },
] as const;

export class HftLoopAgent implements SpecialistAgent {
  readonly name = 'hft-loop';
  readonly description = 'Continuous HFT-style command chain — OpenClaw + DeepSeek R1 24/7';
  readonly taskTypes: AgentTaskType[] = ['hft-loop'];

  private dispatcher: AgentDispatcher | null = null;
  private running = false;

  /** Inject dispatcher for chaining sub-agents */
  setDispatcher(dispatcher: AgentDispatcher): void {
    this.dispatcher = dispatcher;
  }

  canHandle(task: AgentTask): boolean {
    return task.type === 'hft-loop';
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    const start = Date.now();
    const intervalSec = Number(task.payload['interval'] ?? 60);
    const maxCycles = Number(task.payload['maxCycles'] ?? 0); // 0 = infinite
    const dispatcher = this.dispatcher;

    if (!dispatcher) {
      return failResult(this.name, task.id, 'Dispatcher not injected — call setDispatcher() first', 0);
    }

    this.running = true;
    let cycleCount = 0;
    const stats = { totalCycles: 0, totalLatencyMs: 0, chainResults: [] as string[] };

    logger.info(`HFT Loop starting — interval ${intervalSec}s, max ${maxCycles || 'infinite'} cycles`, 'HftLoop');

    // Phase 0: Warm model before loop
    try {
      const warmTask = createTask('warm-model', {});
      const warmResult = await dispatcher.dispatch(warmTask);
      logger.info(`Model warm: ${warmResult.success ? 'OK' : 'FAIL'} (${warmResult.durationMs}ms)`, 'HftLoop');
    } catch (err) {
      logger.warn(`Warm-model failed (non-fatal): ${err}`, 'HftLoop');
    }

    // Main loop
    while (this.running) {
      cycleCount++;
      const cycleStart = Date.now();
      const cycleResults: string[] = [];

      logger.info(`=== HFT Cycle #${cycleCount} ===`, 'HftLoop');

      for (const step of HFT_CHAIN) {
        if (!this.running) break;
        try {
          const stepTask = createTask(step.type as AgentTask['type'], {
            source: 'hft-loop',
            cycle: cycleCount,
            limit: 20,
          });
          const result = await dispatcher.dispatch(stepTask);
          const status = result.success ? 'OK' : 'FAIL';
          cycleResults.push(`${step.type}:${status}(${result.durationMs}ms)`);
          logger.info(`  ${step.type} → ${status} (${result.durationMs}ms)`, 'HftLoop');
        } catch (err) {
          cycleResults.push(`${step.type}:ERR`);
          logger.warn(`  ${step.type} → ERROR: ${err}`, 'HftLoop');
        }
      }

      const cycleMs = Date.now() - cycleStart;
      stats.totalCycles = cycleCount;
      stats.totalLatencyMs += cycleMs;
      stats.chainResults = cycleResults;

      logger.info(`Cycle #${cycleCount} done in ${cycleMs}ms — [${cycleResults.join(' → ')}]`, 'HftLoop');

      // Check exit conditions
      if (maxCycles > 0 && cycleCount >= maxCycles) {
        logger.info(`Reached max cycles (${maxCycles}), stopping`, 'HftLoop');
        break;
      }

      // Sleep between cycles (but not after last)
      if (this.running) {
        await new Promise(r => setTimeout(r, intervalSec * 1000));
      }
    }

    this.running = false;
    return successResult(this.name, task.id, {
      totalCycles: stats.totalCycles,
      avgCycleMs: stats.totalCycles > 0 ? Math.round(stats.totalLatencyMs / stats.totalCycles) : 0,
      lastChain: stats.chainResults,
    }, Date.now() - start);
  }

  /** Stop the loop gracefully */
  stop(): void {
    this.running = false;
    logger.info('HFT Loop stop requested', 'HftLoop');
  }
}
