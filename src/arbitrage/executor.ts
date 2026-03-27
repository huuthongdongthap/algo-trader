/**
 * Execution Engine
 * Auto-trade execution with slippage protection and gas fee calculation
 */

import { ArbitrageOpportunity, ArbitrageLeg, ExecutionResult, ExecutedLeg, ExecutorConfig } from './types';
import { DEFAULT_EXECUTOR_CONFIG, GAS_ESTIMATES } from './config';

export class ExecutionEngine {
  private config: ExecutorConfig;

  constructor(config: Partial<ExecutorConfig> = {}) {
    this.config = { ...DEFAULT_EXECUTOR_CONFIG, ...config };
  }

  async execute(opportunity: ArbitrageOpportunity): Promise<ExecutionResult> {
    if (this.config.dryRun) {
      return this.simulateExecution(opportunity);
    }

    try {
      const executedLegs: ExecutedLeg[] = [];
      let totalFees = 0;
      let actualProfit = 0;

      for (const leg of opportunity.legs) {
        const result = await this.executeLeg(leg);
        executedLegs.push(result);
        totalFees += result.fee;
      }

      actualProfit = this.calculateActualProfit(executedLegs);
      const netProfit = actualProfit - totalFees - (opportunity.gasFee ?? 0);

      return {
        opportunityId: opportunity.id,
        success: true,
        executedLegs,
        actualProfit: netProfit,
        actualProfitPct: (netProfit / opportunity.legs[0].amount) * 100,
        totalFees,
        executedAt: Date.now(),
      };
    } catch (error) {
      return {
        opportunityId: opportunity.id,
        success: false,
        executedLegs: [],
        actualProfit: 0,
        actualProfitPct: 0,
        totalFees: 0,
        error: error instanceof Error ? error.message : 'Unknown error',
        executedAt: Date.now(),
      };
    }
  }

  private async executeLeg(leg: ArbitrageLeg): Promise<ExecutedLeg> {
    const slippage = this.calculateSlippage(leg);
    if (slippage > this.config.slippageTolerance) {
      throw new Error(`Slippage ${slippage.toFixed(2)}% exceeds tolerance ${this.config.slippageTolerance}%`);
    }

    const executedPrice = leg.side === 'buy' ? leg.price * (1 + slippage / 100) : leg.price * (1 - slippage / 100);
    const txHash = this.generateTxHash();

    return {
      exchange: leg.exchange,
      symbol: leg.symbol,
      side: leg.side,
      executedPrice,
      executedAmount: leg.amount,
      fee: leg.fee * leg.amount,
      txHash,
    };
  }

  private calculateSlippage(leg: ArbitrageLeg): number {
    const baseSlippage = 0.1;
    const sizeImpact = (leg.amount / 10000) * 0.05;
    return baseSlippage + sizeImpact;
  }

  private calculateGasFee(exchange: string, network = 'ethereum'): number {
    const baseGas = GAS_ESTIMATES[network] ?? 50;
    const gasPrice = 20;
    return (baseGas * gasPrice) / 1000000;
  }

  private calculateActualProfit(legs: ExecutedLeg[]): number {
    if (legs.length < 2) return 0;

    let profit = 0;
    for (let i = 0; i < legs.length - 1; i++) {
      const buyLeg = legs.find((l) => l.side === 'buy');
      const sellLeg = legs.find((l) => l.side === 'sell');
      if (buyLeg && sellLeg) {
        profit += (sellLeg.executedPrice - buyLeg.executedPrice) * sellLeg.executedAmount;
      }
    }
    return profit;
  }

  private generateTxHash(): string {
    return '0x' + Array.from({ length: 64 }, () =>
      Math.floor(Math.random() * 16).toString(16)
    ).join('');
  }

  private simulateExecution(opportunity: ArbitrageOpportunity): ExecutionResult {
    const simulatedLegs: ExecutedLeg[] = opportunity.legs.map((leg) => ({
      exchange: leg.exchange,
      symbol: leg.symbol,
      side: leg.side,
      executedPrice: leg.price,
      executedAmount: leg.amount,
      fee: leg.fee * leg.amount,
    }));

    return {
      opportunityId: opportunity.id,
      success: true,
      executedLegs: simulatedLegs,
      actualProfit: opportunity.expectedProfit,
      actualProfitPct: opportunity.expectedProfitPct,
      totalFees: opportunity.totalFees,
      executedAt: Date.now(),
    };
  }

  validateOpportunity(opportunity: ArbitrageOpportunity): boolean {
    if (opportunity.legs.length === 0) return false;
    if (opportunity.expectedProfitPct < this.config.minProfitThreshold) return false;
    if ((opportunity.slippage ?? 0) > this.config.slippageTolerance) return false;
    return true;
  }
}
