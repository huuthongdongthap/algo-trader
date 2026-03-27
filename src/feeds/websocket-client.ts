/**
 * Base WebSocket Client - Enhanced
 * Foundation for exchange-specific WebSocket connections
 * Features: auto-reconnect with jitter, heartbeat monitoring, latency tracking
 */

import { EventEmitter } from 'events';
import { logger } from '../utils/logger';

export interface WebSocketMessage {
  type: 'orderbook' | 'trade' | 'ticker' | 'heartbeat' | 'error' | 'latency';
  exchange: string;
  symbol: string;
  data: unknown;
  timestamp: number;
  latency?: number;
}

export interface WebSocketConfig {
  url: string;
  reconnectDelay: number;
  maxReconnectDelay: number;
  heartbeatInterval: number;
  reconnectMultiplier: number;
  maxReconnectAttempts: number;
  enableJitter: boolean;
  heartbeatTimeout: number;
  latencyTracking: boolean;
}

export interface ConnectionStats {
  connectedAt?: number;
  disconnectedAt?: number;
  reconnectCount: number;
  messageCount: number;
  heartbeatCount: number;
  lastLatency?: number;
  avgLatency: number;
  minLatency: number;
  maxLatency: number;
  p95Latency: number;
  latencySamples: number[];
  uptime: number;
}

export type WebSocketState = 'connecting' | 'connected' | 'disconnected' | 'reconnecting' | 'failed';

export abstract class BaseWebSocketClient extends EventEmitter {
  protected ws: WebSocket | null = null;
  protected config: WebSocketConfig;
  protected reconnectAttempts = 0;
  protected heartbeatTimer: NodeJS.Timeout | null = null;
  protected heartbeatTimeoutTimer: NodeJS.Timeout | null = null;
  protected messageHandlers: Set<(msg: WebSocketMessage) => void> = new Set();
  protected state: WebSocketState = 'disconnected';
  protected stats: ConnectionStats;
  protected lastMessageTime: number = 0;
  protected pendingHeartbeat: boolean = false;
  protected reconnectTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<WebSocketConfig>) {
    super();
    this.config = {
      url: config.url || '',
      reconnectDelay: config.reconnectDelay || 1000,
      maxReconnectDelay: config.maxReconnectDelay || 30000,
      heartbeatInterval: config.heartbeatInterval || 30000,
      reconnectMultiplier: config.reconnectMultiplier || 2,
      maxReconnectAttempts: config.maxReconnectAttempts || 10,
      enableJitter: config.enableJitter ?? true,
      heartbeatTimeout: config.heartbeatTimeout || 10000,
      latencyTracking: config.latencyTracking ?? true,
    };

    this.stats = {
      reconnectCount: 0,
      messageCount: 0,
      heartbeatCount: 0,
      avgLatency: 0,
      minLatency: Infinity,
      maxLatency: 0,
      p95Latency: 0,
      latencySamples: [],
      uptime: 0,
    };
  }

  abstract connect(): Promise<void>;
  abstract disconnect(): Promise<void>;
  abstract subscribe(symbols: string[]): Promise<void>;
  abstract unsubscribe(symbols: string[]): Promise<void>;

  protected abstract handleMessage(data: unknown): WebSocketMessage | null;
  protected abstract getSubscriptions(symbols: string[]): unknown;
  protected abstract sendHeartbeat(): void;

  public onMessage(handler: (msg: WebSocketMessage) => void): void {
    this.messageHandlers.add(handler);
  }

  public offMessage(handler: (msg: WebSocketMessage) => void): void {
    this.messageHandlers.delete(handler);
  }

  public getState(): WebSocketState {
    return this.state;
  }

  public getStats(): ConnectionStats {
    const now = Date.now();
    if (this.state === 'connected' && this.stats.connectedAt) {
      this.stats.uptime = now - this.stats.connectedAt;
    }
    return { ...this.stats };
  }

  public isConnected(): boolean {
    return this.state === 'connected' && this.ws?.readyState === WebSocket.OPEN;
  }

  protected async connectWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.state = 'connecting';
        this.emit('stateChange', { from: 'disconnected', to: 'connecting' });

        this.ws = new WebSocket(this.config.url);

        this.ws.onopen = () => {
          const now = Date.now();
          this.state = 'connected';
          this.stats.connectedAt = now;
          this.reconnectAttempts = 0;
          this.lastMessageTime = now;

          logger.info(`[WebSocket] Connected to ${this.config.url}`);
          this.emit('connected', { url: this.config.url, timestamp: now });

          this.startHeartbeat();
          resolve();
        };

        this.ws.onclose = (event) => {
          const now = Date.now();
          const prevState = this.state;
          this.state = 'disconnected';
          this.stats.disconnectedAt = now;
          this.stopHeartbeat();

          logger.info(`[WebSocket] Disconnected from ${this.config.url}`, {
            code: event.code,
            reason: event.reason,
          });

          this.emit('disconnected', {
            code: event.code,
            reason: event.reason,
            timestamp: now,
          });

          // Only reconnect if not manually disconnected
          if (prevState !== 'failed' && this.reconnectAttempts < this.config.maxReconnectAttempts) {
            this.scheduleReconnect();
          } else if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
            this.state = 'failed';
            this.emit('failed', {
              reason: 'Max reconnect attempts reached',
              attempts: this.reconnectAttempts,
            });
          }
        };

        this.ws.onerror = (error) => {
          logger.error(`[WebSocket] Error:`, { error });
          this.state = 'disconnected';
          this.emit('error', { error, timestamp: Date.now() });
          reject(error);
        };

        this.ws.onmessage = (event) => {
          const now = Date.now();
          this.lastMessageTime = now;
          this.pendingHeartbeat = false;
          this.stats.messageCount++;

          try {
            const data = JSON.parse(event.data as string);
            const message = this.handleMessage(data);

            if (message) {
              // Calculate latency if timestamp is provided
              if (this.config.latencyTracking && data.ts) {
                const latency = now - data.ts;
                this.recordLatency(latency);
                message.latency = latency;
              }

              this.messageHandlers.forEach((handler) => handler(message));
              this.emit('message', message);
            }
          } catch (parseError) {
            logger.error('[WebSocket] Failed to parse message:', { parseError });
            this.emit('error', { error: parseError, type: 'parse', timestamp: now });
          }
        };
      } catch (error) {
        this.state = 'disconnected';
        reject(error);
      }
    });
  }

  protected sendMessage(message: unknown): boolean {
    if (this.isConnected()) {
      this.ws!.send(JSON.stringify(message));
      return true;
    }
    logger.warn('[WebSocket] Cannot send message - not connected');
    return false;
  }

  protected scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }

    this.state = 'reconnecting';
    this.stats.reconnectCount++;

    // Exponential backoff with optional jitter
    let delay = Math.min(
      this.config.reconnectDelay * Math.pow(this.config.reconnectMultiplier, this.reconnectAttempts),
      this.config.maxReconnectDelay
    );

    if (this.config.enableJitter) {
      // Add ±20% jitter to prevent thundering herd
      const jitter = delay * 0.2 * (Math.random() * 2 - 1);
      delay += jitter;
    }

    this.reconnectAttempts++;

    logger.info(`[WebSocket] Reconnecting in ${Math.round(delay)}ms (attempt ${this.reconnectAttempts}/${this.config.maxReconnectAttempts})`);

    this.emit('reconnecting', {
      attempt: this.reconnectAttempts,
      maxAttempts: this.config.maxReconnectAttempts,
      delay,
    });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect().catch((error) => {
        logger.error('[WebSocket] Reconnect failed:', { error });
      });
    }, delay);
  }

  protected startHeartbeat(): void {
    this.stopHeartbeat();

    // Send heartbeat at configured interval
    this.heartbeatTimer = setInterval(() => {
      this.pendingHeartbeat = true;
      this.sendHeartbeat();

      // Start timeout timer for heartbeat response
      this.heartbeatTimeoutTimer = setTimeout(() => {
        if (this.pendingHeartbeat) {
          logger.warn('[WebSocket] Heartbeat timeout - connection may be stale');
          this.emit('heartbeatTimeout', { timestamp: Date.now() });

          // Force reconnect if heartbeat times out
          this.forceReconnect('Heartbeat timeout');
        }
      }, this.config.heartbeatTimeout);
    }, this.config.heartbeatInterval);
  }

  protected stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
    this.pendingHeartbeat = false;
  }

  protected handleHeartbeatResponse(): void {
    this.pendingHeartbeat = false;
    this.stats.heartbeatCount++;

    if (this.heartbeatTimeoutTimer) {
      clearTimeout(this.heartbeatTimeoutTimer);
      this.heartbeatTimeoutTimer = null;
    }
  }

  protected recordLatency(latency: number): void {
    if (!this.config.latencyTracking) return;

    // Keep last 1000 samples for p95 calculation
    if (this.stats.latencySamples.length >= 1000) {
      this.stats.latencySamples.shift();
    }
    this.stats.latencySamples.push(latency);

    // Update statistics
    this.stats.lastLatency = latency;
    this.stats.minLatency = Math.min(this.stats.minLatency, latency);
    this.stats.maxLatency = Math.max(this.stats.maxLatency, latency);

    // Calculate average
    const sum = this.stats.latencySamples.reduce((a, b) => a + b, 0);
    this.stats.avgLatency = sum / this.stats.latencySamples.length;

    // Calculate p95
    const sorted = [...this.stats.latencySamples].sort((a, b) => a - b);
    const p95Index = Math.floor(sorted.length * 0.95);
    this.stats.p95Latency = sorted[p95Index] || 0;
  }

  protected forceReconnect(reason: string): void {
    logger.info(`[WebSocket] Force reconnect: ${reason}`);

    this.emit('forceReconnect', { reason, timestamp: Date.now() });

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.reconnectAttempts = 0;
    this.scheduleReconnect();
  }

  /**
   * Wait for connection with timeout
   */
  public async waitForConnection(timeout: number = 10000): Promise<boolean> {
    if (this.isConnected()) {
      return true;
    }

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.removeListener('connected', onConnected);
        this.removeListener('failed', onFailed);
        resolve(false);
      }, timeout);

      const onConnected = () => {
        clearTimeout(timer);
        this.removeListener('failed', onFailed);
        resolve(true);
      };

      const onFailed = () => {
        clearTimeout(timer);
        this.removeListener('connected', onConnected);
        resolve(false);
      };

      this.once('connected', onConnected);
      this.once('failed', onFailed);
    });
  }

  /**
   * Reset statistics
   */
  public resetStats(): void {
    this.stats = {
      reconnectCount: this.stats.reconnectCount,
      messageCount: 0,
      heartbeatCount: 0,
      avgLatency: 0,
      minLatency: Infinity,
      maxLatency: 0,
      p95Latency: 0,
      latencySamples: [],
      uptime: 0,
    };
  }
}
