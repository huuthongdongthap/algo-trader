// Append-only audit trail logger
// Writes events to data/audit.jsonl (one JSON per line) + in-memory ring buffer
// Immutable by design: no delete/update methods (compliance requirement)

import { appendFileSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { logger } from '../core/logger.js';

export type AuditCategory = 'trade' | 'auth' | 'config' | 'system';

export interface AuditEvent {
  id: string;
  timestamp: string;
  category: AuditCategory;
  action: string;
  userId?: string;
  details: Record<string, unknown>;
  ip?: string;
}

export interface AuditEventInput {
  category: AuditCategory;
  action: string;
  userId?: string;
  details: Record<string, unknown>;
  ip?: string;
}

const DEFAULT_AUDIT_PATH = 'data/audit.jsonl';
const DEFAULT_BUFFER_SIZE = 1000;

export class AuditLogger {
  private readonly filePath: string;
  private readonly bufferSize: number;
  /** Ring buffer — oldest entries dropped when full */
  private buffer: AuditEvent[] = [];

  constructor(filePath = DEFAULT_AUDIT_PATH, bufferSize = DEFAULT_BUFFER_SIZE) {
    this.filePath = filePath;
    this.bufferSize = bufferSize;
    // Ensure parent directory exists
    try {
      mkdirSync(dirname(filePath), { recursive: true });
    } catch {
      // Already exists — ignore
    }
  }

  /**
   * Append a single audit event.
   * Assigns a UUID + ISO timestamp, writes to file and buffer.
   * Never throws — logs error internally to avoid disrupting trading flow.
   */
  logEvent(input: AuditEventInput): AuditEvent {
    const event: AuditEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      category: input.category,
      action: input.action,
      details: input.details,
      ...(input.userId !== undefined && { userId: input.userId }),
      ...(input.ip !== undefined && { ip: input.ip }),
    };

    // Persist to append-only JSONL file
    try {
      appendFileSync(this.filePath, JSON.stringify(event) + '\n', 'utf8');
    } catch (err) {
      logger.error('audit: failed to write event to file', 'AuditLogger', {
        error: String(err),
        eventId: event.id,
      });
    }

    // Maintain ring buffer
    if (this.buffer.length >= this.bufferSize) {
      this.buffer.shift();
    }
    this.buffer.push(event);

    return event;
  }

  /**
   * Return last N events from the in-memory buffer.
   * Returns a shallow copy — callers cannot mutate internal buffer.
   */
  getRecentEvents(count: number): AuditEvent[] {
    const start = Math.max(0, this.buffer.length - count);
    return this.buffer.slice(start);
  }

  /** Total number of events currently held in buffer */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /** File path being written to (read-only access for external callers) */
  getFilePath(): string {
    return this.filePath;
  }
}

// Module-level singleton — shared across entire app
let _instance: AuditLogger | null = null;

export function getAuditLogger(filePath?: string): AuditLogger {
  if (!_instance) _instance = new AuditLogger(filePath);
  return _instance;
}
