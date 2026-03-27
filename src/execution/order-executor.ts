/**
 * Order Executor
 * Executes arbitrage trades across exchanges
 *
 * Execution flow:
 * 1. Validate opportunity (spread, latency, balance)
 * 2. Place buy order on exchange A (lower price)
 * 3. Place sell order on exchange B (higher price)
 * 4. Track fill status
 * 5. Handle partial fills & rollback
 */

import { ArbitrageOpportunity } from '../arbitrage/spread-detector';

export interface ExecutionResult {
  id: string;
  opportunityId: string;
  status: 'PENDING' | 'EXECUTING' | 'FILLED' | 'PARTIAL' | 'FAILED' | 'ROLLBACK' | 'CANCELED';
  buyOrder?: OrderResult;
  sellOrder?: OrderResult;
  profit?: number;
  error?: string;
  timestamp: number;
}

export interface OrderResult {
  orderId: string;
  exchange: string;
  symbol: string;
  side: 'buy' | 'sell';
  price: number;
  amount: number;
  filled: number;
  remaining: number;
  status: 'open' | 'closed' | 'canceled' | 'rejected';
  fee?: number;
}

export interface ExecutionConfig {
  defaultAmount: number;
  maxSlippage: number;
  timeoutMs: number;
  retryAttempts: number;
}

export class OrderExecutor {
  private config: ExecutionConfig;
  private pendingExecutions: Map<string, ExecutionResult>;

  constructor(config?: Partial<ExecutionConfig>) {
    this.config = {
      defaultAmount: 0.01, // BTC
      maxSlippage: 0.05, // 5%
      timeoutMs: 5000,
      retryAttempts: 3,
      ...config,
    };

    this.pendingExecutions = new Map();
  }

  /**
   * Execute arbitrage trade
   */
  async execute(
    opportunity: ArbitrageOpportunity,
    amount?: number
  ): Promise<ExecutionResult> {
    const execAmount = amount || this.config.defaultAmount;
    const execution: ExecutionResult = {
      id: `exec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      opportunityId: opportunity.id,
      status: 'PENDING',
      timestamp: Date.now(),
    };

    this.pendingExecutions.set(execution.id, execution);

    try {
      execution.status = 'EXECUTING';

      // Place buy order on lower exchange
      execution.buyOrder = await this.placeOrder({
        exchange: opportunity.buyExchange,
        symbol: opportunity.symbol,
        side: 'buy',
        price: opportunity.buyPrice,
        amount: execAmount,
      });

      if (execution.buyOrder.status === 'rejected') {
        throw new Error(`Buy order rejected: ${execution.buyOrder.orderId}`);
      }

      // Place sell order on higher exchange
      execution.sellOrder = await this.placeOrder({
        exchange: opportunity.sellExchange,
        symbol: opportunity.symbol,
        side: 'sell',
        price: opportunity.sellPrice,
        amount: execAmount,
      });

      if (execution.sellOrder.status === 'rejected') {
        throw new Error(`Sell order rejected: ${execution.sellOrder.orderId}`);
      }

      // Check if both orders filled
      const buyFilled = execution.buyOrder.filled / execution.buyOrder.amount;
      const sellFilled = execution.sellOrder.filled / execution.sellOrder.amount;

      if (buyFilled >= 0.99 && sellFilled >= 0.99) {
        execution.status = 'FILLED';
        execution.profit = this.calculateProfit(opportunity, execAmount);
      } else if (buyFilled > 0 || sellFilled > 0) {
        execution.status = 'PARTIAL';
      }

      return execution;
    } catch (error) {
      execution.status = 'FAILED';
      execution.error = error instanceof Error ? error.message : 'Unknown error';
      return execution;
    }
  }

  /**
   * Place single order (mock implementation)
   */
  private async placeOrder(params: {
    exchange: string;
    symbol: string;
    side: 'buy' | 'sell';
    price: number;
    amount: number;
  }): Promise<OrderResult> {
    // Mock order placement - replace with actual exchange API
    const orderId = `${params.exchange}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    return {
      orderId,
      exchange: params.exchange,
      symbol: params.symbol,
      side: params.side,
      price: params.price,
      amount: params.amount,
      filled: params.amount, // Assume full fill for mock
      remaining: 0,
      status: 'closed',
      fee: params.amount * params.price * 0.001, // 0.1% fee
    };
  }

  /**
   * Calculate profit after execution
   */
  private calculateProfit(
    opportunity: ArbitrageOpportunity,
    amount: number
  ): number {
    const buyCost = opportunity.buyPrice * amount;
    const sellRevenue = opportunity.sellPrice * amount;
    const fees = (buyCost + sellRevenue) * 0.001; // 0.1% fee per side
    return sellRevenue - buyCost - fees;
  }

  /**
   * Get execution by ID
   */
  getExecution(id: string): ExecutionResult | undefined {
    return this.pendingExecutions.get(id);
  }

  /**
   * Get all pending executions
   */
  getPendingExecutions(): ExecutionResult[] {
    return Array.from(this.pendingExecutions.values()).filter(
      e => e.status === 'PENDING' || e.status === 'EXECUTING'
    );
  }

  /**
   * Cancel pending execution
   */
  async cancel(executionId: string): Promise<boolean> {
    const execution = this.pendingExecutions.get(executionId);
    if (!execution || execution.status !== 'PENDING') {
      return false;
    }

    execution.status = 'CANCELED';
    return true;
  }

  /**
   * Clear completed executions older than TTL
   */
  cleanup(ttlMs = 3600000): void {
    const now = Date.now();
    for (const [id, execution] of this.pendingExecutions.entries()) {
      if (
        ['FILLED', 'FAILED', 'ROLLBACK'].includes(execution.status) &&
        now - execution.timestamp > ttlMs
      ) {
        this.pendingExecutions.delete(id);
      }
    }
  }
}
