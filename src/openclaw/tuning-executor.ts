// Tuning Executor: applies approved parameter changes to running strategies
// Supports manual review, semi-auto (confidence gated), and full-auto modes

import { logger } from '../core/logger.js';
import type { StrategyName } from '../core/types.js';
import type { TuningProposal } from './algorithm-tuner.js';
import { AlgorithmTuner } from './algorithm-tuner.js';

export type TuningMode = 'manual' | 'semi-auto' | 'full-auto';

/** Callback interface: strategy must expose param hot-swap to executor */
export interface TunableStrategy {
  getParams(): Record<string, unknown>;
  setParams(params: Record<string, unknown>): void;
}

interface ParamSnapshot {
  params: Record<string, unknown>;
  capturedAt: number;
}

export class TuningExecutor {
  /** One-level undo store: previous params per strategy */
  private readonly snapshots: Map<StrategyName, ParamSnapshot> = new Map();
  /** Registry of live strategy instances */
  private readonly strategies: Map<StrategyName, TunableStrategy> = new Map();

  constructor(private readonly tuner: AlgorithmTuner) {}

  /** Register a live strategy so the executor can hot-swap its params */
  register(name: StrategyName, strategy: TunableStrategy): void {
    this.strategies.set(name, strategy);
  }

  /**
   * Apply a tuning proposal according to the chosen mode.
   * Returns true if params were actually changed, false if skipped.
   */
  applyTuning(proposal: TuningProposal, mode: TuningMode): boolean {
    const strategy = this.strategies.get(proposal.strategy);

    switch (mode) {
      case 'manual':
        // Log suggestion only — human must review and apply manually
        logger.info(
          [
            `[TuningExecutor] MANUAL suggestion for "${proposal.strategy}":`,
            `  Confidence: ${(proposal.confidence * 100).toFixed(0)}%`,
            `  Expected improvement: ${proposal.expectedImprovement > 0 ? '+' : ''}${proposal.expectedImprovement}%`,
            `  Reasoning: ${proposal.reasoning}`,
            `  Suggested params: ${JSON.stringify(proposal.suggestedParams)}`,
          ].join('\n'),
          'TuningExecutor',
        );
        return false;

      case 'semi-auto': {
        const violations = this.tuner.validateProposal(proposal);
        if (violations.length > 0) {
          logger.warn(
            `[TuningExecutor] Semi-auto skipped "${proposal.strategy}" — safety violations: ${violations.join(', ')}`,
            'TuningExecutor',
          );
          return false;
        }
        if (proposal.confidence <= 0.8) {
          logger.info(
            `[TuningExecutor] Semi-auto skipped "${proposal.strategy}" — confidence ${(proposal.confidence * 100).toFixed(0)}% <= 80%`,
            'TuningExecutor',
          );
          return false;
        }
        return this.commitParams(proposal, strategy);
      }

      case 'full-auto': {
        // Explicit opt-in required — caller must pass TuningMode 'full-auto' knowingly
        const violations = this.tuner.validateProposal(proposal);
        if (violations.length > 0) {
          logger.warn(
            `[TuningExecutor] Full-auto blocked "${proposal.strategy}" — safety violations: ${violations.join(', ')}`,
            'TuningExecutor',
          );
          return false;
        }
        return this.commitParams(proposal, strategy);
      }
    }
  }

  /**
   * Revert a strategy to its previous params (one-level undo).
   * Returns false if no snapshot is available.
   */
  rollback(strategyName: StrategyName): boolean {
    const snapshot = this.snapshots.get(strategyName);
    const strategy = this.strategies.get(strategyName);

    if (!snapshot) {
      logger.warn(`[TuningExecutor] No rollback snapshot for "${strategyName}"`, 'TuningExecutor');
      return false;
    }

    if (strategy) {
      strategy.setParams(snapshot.params);
    }

    this.snapshots.delete(strategyName);
    logger.info(
      `[TuningExecutor] Rolled back "${strategyName}" to params from ${new Date(snapshot.capturedAt).toISOString()}`,
      'TuningExecutor',
    );
    return true;
  }

  // --- private helpers ---

  private commitParams(
    proposal: TuningProposal,
    strategy: TunableStrategy | undefined,
  ): boolean {
    if (!strategy) {
      // Strategy not registered — log params for external application
      logger.info(
        `[TuningExecutor] Strategy "${proposal.strategy}" not registered; params logged only: ${JSON.stringify(proposal.suggestedParams)}`,
        'TuningExecutor',
      );
      return false;
    }

    // Capture current params for rollback BEFORE applying
    this.snapshots.set(proposal.strategy, {
      params: { ...strategy.getParams() },
      capturedAt: Date.now(),
    });

    // Merge suggested params over current (partial update)
    const merged = { ...strategy.getParams(), ...proposal.suggestedParams };
    strategy.setParams(merged);

    logger.info(
      `[TuningExecutor] Applied tuning to "${proposal.strategy}": ${JSON.stringify(proposal.suggestedParams)}`,
      'TuningExecutor',
    );
    return true;
  }
}
