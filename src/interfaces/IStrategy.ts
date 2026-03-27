/**
 * Strategy Interface
 *
 * Standard interface for all trading strategies.
 */

export interface ISignal {
  action: 'buy' | 'sell' | 'wait';
  confidence: number;
  reason: string;
  metadata?: Record<string, any>;
}

export interface ICandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IStrategy {
  /**
   * Get strategy name
   */
  getName(): string;

  /**
   * Initialize strategy (load models, setup, etc.)
   */
  initialize(): Promise<void>;

  /**
   * Train strategy on historical data (if applicable)
   */
  train?(candles: ICandle[]): Promise<void>;

  /**
   * Execute strategy and return trading signal
   */
  execute(candles: ICandle[]): Promise<ISignal>;

  /**
   * Get strategy status
   */
  getStatus?(): Record<string, any>;

  /**
   * Cleanup resources
   */
  dispose?(): void;
}
