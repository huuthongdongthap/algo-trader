/**
 * Message Bus Interface
 * Abstract interface for pub/sub messaging — NATS or Redis backend
 */

export interface MessageEnvelope<T = unknown> {
  topic: string;
  data: T;
  timestamp: number;
  source: string;
}

export type MessageHandler<T = unknown> = (envelope: MessageEnvelope<T>) => void | Promise<void>;

export interface IMessageBus {
  /** Connect to the message bus */
  connect(): Promise<void>;

  /** Publish a typed message to a topic */
  publish<T>(topic: string, data: T, source?: string): Promise<void>;

  /** Subscribe to a topic with a handler */
  subscribe<T>(topic: string, handler: MessageHandler<T>): Promise<() => void>;

  /** Request-reply pattern (send request, await single response) */
  request<TReq, TRes>(topic: string, data: TReq, timeoutMs?: number): Promise<TRes>;

  /** Check if connected */
  isConnected(): boolean;

  /** Graceful shutdown */
  close(): Promise<void>;
}
