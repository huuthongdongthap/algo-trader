// Circuit breaker pattern - auto-disable failing components to prevent cascade failures
import { logger } from '../core/logger.js';

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of failures before opening the circuit */
  failureThreshold: number;
  /** Milliseconds to wait before attempting half-open */
  resetTimeoutMs: number;
  /** Max attempts allowed in half-open state */
  halfOpenMaxAttempts?: number;
  /** Optional name for logging */
  name?: string;
  /** Callback invoked when state transitions */
  onStateChange?: (prev: CircuitState, next: CircuitState) => void;
}

export interface CircuitBreakerStatus {
  state: CircuitState;
  failureCount: number;
  lastFailureTime: number | null;
  halfOpenAttempts: number;
}

/** Error thrown when circuit is open and rejecting calls */
export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit breaker '${name}' is OPEN — rejecting call`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime: number | null = null;
  private halfOpenAttempts = 0;
  private readonly name: string;

  constructor(private readonly options: CircuitBreakerOptions) {
    this.name = options.name ?? 'unnamed';
  }

  /** Execute fn through the circuit breaker */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.checkAndTransition();

    if (this.state === 'open') {
      throw new CircuitOpenError(this.name);
    }

    if (this.state === 'half-open') {
      const maxAttempts = this.options.halfOpenMaxAttempts ?? 1;
      if (this.halfOpenAttempts >= maxAttempts) {
        throw new CircuitOpenError(this.name);
      }
      this.halfOpenAttempts++;
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Transition open → half-open if reset timeout has elapsed */
  private checkAndTransition(): void {
    if (
      this.state === 'open' &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.options.resetTimeoutMs
    ) {
      this.transition('half-open');
      this.halfOpenAttempts = 0;
    }
  }

  private onSuccess(): void {
    if (this.state === 'half-open') {
      this.failureCount = 0;
      this.lastFailureTime = null;
      this.transition('closed');
    } else if (this.state === 'closed') {
      // Partial reset on success
      this.failureCount = Math.max(0, this.failureCount - 1);
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Failed probe — go back to open
      this.transition('open');
      return;
    }

    if (this.state === 'closed' && this.failureCount >= this.options.failureThreshold) {
      this.transition('open');
    }
  }

  private transition(next: CircuitState): void {
    const prev = this.state;
    this.state = next;
    logger.warn(`CircuitBreaker state change`, 'CircuitBreaker', {
      name: this.name,
      from: prev,
      to: next,
      failureCount: this.failureCount,
    });
    this.options.onStateChange?.(prev, next);
  }

  getStatus(): CircuitBreakerStatus {
    this.checkAndTransition();
    return {
      state: this.state,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
      halfOpenAttempts: this.halfOpenAttempts,
    };
  }

  /** Manually reset to closed (use after known fix) */
  reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.halfOpenAttempts = 0;
    this.transition('closed');
  }
}
