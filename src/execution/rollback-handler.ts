/**
 * Rollback Handler
 * Handles failed executions and position rollback
 *
 * Rollback scenarios:
 * - One leg fills, other fails: Close filled position immediately
 * - Partial fills: Cancel remaining, close filled portion
 * - Exchange error: Attempt recovery, then rollback
 */

import { ExecutionResult, OrderResult } from './order-executor';

export interface RollbackResult {
  success: boolean;
  action: 'CLOSE_LONG' | 'CLOSE_SHORT' | 'CANCEL_PENDING' | 'NO_ACTION';
  closedOrder?: OrderResult;
  loss: number;
  reason: string;
  timestamp: number;
}

export interface RollbackConfig {
  autoRollback: boolean;
  maxLossPercent: number;
  rollbackTimeoutMs: number;
  retryAttempts: number;
}

export class RollbackHandler {
  private config: RollbackConfig;
  private rollbackHistory: RollbackResult[];

  constructor(config?: Partial<RollbackConfig>) {
    this.config = {
      autoRollback: true,
      maxLossPercent: 2.0, // 2% max loss per trade
      rollbackTimeoutMs: 10000,
      retryAttempts: 3,
      ...config,
    };

    this.rollbackHistory = [];
  }

  /**
   * Handle failed execution
   */
  async handleFailedExecution(execution: ExecutionResult): Promise<RollbackResult> {
    // No positions to rollback
    if (!execution.buyOrder && !execution.sellOrder) {
      return this.createResult('NO_ACTION', 0, 'No positions to rollback');
    }

    // Buy filled, sell failed - need to sell the position
    if (execution.buyOrder && execution.buyOrder.filled > 0 && !execution.sellOrder) {
      return await this.closeLongPosition(execution.buyOrder);
    }

    // Sell filled, buy failed - need to buy back (short position)
    if (execution.sellOrder && execution.sellOrder.filled > 0 && !execution.buyOrder) {
      return await this.closeShortPosition(execution.sellOrder);
    }

    // Partial fills on both sides
    if (execution.buyOrder && execution.sellOrder) {
      const buyFilled = execution.buyOrder.filled;
      const sellFilled = execution.sellOrder.filled;

      if (buyFilled > sellFilled) {
        return await this.closeLongPosition(execution.buyOrder, buyFilled - sellFilled);
      } else if (sellFilled > buyFilled) {
        return await this.closeShortPosition(execution.sellOrder, sellFilled - buyFilled);
      }
    }

    return this.createResult('NO_ACTION', 0, 'No rollback needed');
  }

  /**
   * Close long position (bought, need to sell)
   */
  private async closeLongPosition(
    order: OrderResult,
    amount?: number
  ): Promise<RollbackResult> {
    const closeAmount = amount || order.filled;
    if (closeAmount <= 0) {
      return this.createResult('NO_ACTION', 0, 'No position to close');
    }

    // Mock market sell - replace with actual exchange API
    const closeOrder: OrderResult = {
      orderId: `rollback-${order.orderId}`,
      exchange: order.exchange,
      symbol: order.symbol,
      side: 'sell',
      price: order.price * 0.99, // Assume slight slippage
      amount: closeAmount,
      filled: closeAmount,
      remaining: 0,
      status: 'closed',
      fee: closeAmount * order.price * 0.001,
    };

    const loss = this.calculateLoss(order, closeOrder);
    const action = loss > 0 ? 'CLOSE_LONG' : 'CLOSE_LONG';

    const result = this.createResult(action, loss, 'Closed long position');
    result.closedOrder = closeOrder;
    return result;
  }

  /**
   * Close short position (sold, need to buy back)
   */
  private async closeShortPosition(
    order: OrderResult,
    amount?: number
  ): Promise<RollbackResult> {
    const closeAmount = amount || order.filled;
    if (closeAmount <= 0) {
      return this.createResult('NO_ACTION', 0, 'No position to close');
    }

    // Mock market buy - replace with actual exchange API
    const closeOrder: OrderResult = {
      orderId: `rollback-${order.orderId}`,
      exchange: order.exchange,
      symbol: order.symbol,
      side: 'buy',
      price: order.price * 1.01, // Assume slight slippage
      amount: closeAmount,
      filled: closeAmount,
      remaining: 0,
      status: 'closed',
      fee: closeAmount * order.price * 0.001,
    };

    const loss = this.calculateLoss(order, closeOrder);
    const result = this.createResult('CLOSE_SHORT', loss, 'Closed short position');
    result.closedOrder = closeOrder;
    return result;
  }

  /**
   * Calculate PnL from rollback
   */
  private calculateLoss(openOrder: OrderResult, closeOrder: OrderResult): number {
    const openValue = openOrder.price * openOrder.amount;
    const closeValue = closeOrder.price * closeOrder.amount;
    const fees = (openOrder.fee || 0) + (closeOrder.fee || 0);

    if (openOrder.side === 'buy') {
      // Long: bought high, sold low = loss
      return closeValue - openValue - fees;
    } else {
      // Short: sold high, bought back = profit if positive
      return openValue - closeValue - fees;
    }
  }

  /**
   * Create rollback result
   */
  private createResult(
    action: RollbackResult['action'],
    loss: number,
    reason: string
  ): RollbackResult {
    const result: RollbackResult = {
      success: loss >= -this.config.maxLossPercent,
      action,
      loss,
      reason,
      timestamp: Date.now(),
    };

    if (!result.success) {
      result.reason += ` (Loss ${loss.toFixed(2)} exceeds max ${this.config.maxLossPercent}%)`;
    }

    this.rollbackHistory.push(result);
    return result;
  }

  /**
   * Get rollback history
   */
  getHistory(limit = 100): RollbackResult[] {
    return this.rollbackHistory.slice(-limit);
  }

  /**
   * Get total losses from rollbacks
   */
  getTotalLosses(): number {
    return this.rollbackHistory.reduce((sum, r) => sum + r.loss, 0);
  }

  /**
   * Clear old history
   */
  clearHistory(olderThanMs = 86400000): void {
    const cutoff = Date.now() - olderThanMs;
    this.rollbackHistory = this.rollbackHistory.filter(r => r.timestamp > cutoff);
  }
}
