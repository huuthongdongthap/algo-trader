import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLogger, type AuditEventInput } from '../../src/audit/audit-logger.js';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

function makeInput(overrides: Partial<AuditEventInput> = {}): AuditEventInput {
  return {
    category: 'trade',
    action: 'order.placed',
    details: { size: 100, market: 'BTC-USD' },
    ...overrides,
  };
}

describe('AuditLogger', () => {
  let auditLogger: AuditLogger;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'audit-test-'));
    auditLogger = new AuditLogger(join(tempDir, 'audit.jsonl'), 100);
  });

  describe('logEvent', () => {
    it('should return event with UUID and timestamp', () => {
      const event = auditLogger.logEvent(makeInput());
      expect(event.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(event.timestamp).toBeTruthy();
      expect(event.category).toBe('trade');
      expect(event.action).toBe('order.placed');
    });

    it('should include optional userId and ip', () => {
      const event = auditLogger.logEvent(makeInput({ userId: 'user-1', ip: '1.2.3.4' }));
      expect(event.userId).toBe('user-1');
      expect(event.ip).toBe('1.2.3.4');
    });

    it('should omit userId/ip when not provided', () => {
      const event = auditLogger.logEvent(makeInput());
      expect(event.userId).toBeUndefined();
      expect(event.ip).toBeUndefined();
    });

    it('should add event to buffer', () => {
      auditLogger.logEvent(makeInput());
      auditLogger.logEvent(makeInput({ action: 'order.cancelled' }));
      expect(auditLogger.getBufferSize()).toBe(2);
    });

    it('should handle different categories', () => {
      const auth = auditLogger.logEvent(makeInput({ category: 'auth', action: 'login' }));
      const config = auditLogger.logEvent(makeInput({ category: 'config', action: 'update' }));
      expect(auth.category).toBe('auth');
      expect(config.category).toBe('config');
    });
  });

  describe('getRecentEvents', () => {
    it('should return last N events', () => {
      for (let i = 0; i < 10; i++) {
        auditLogger.logEvent(makeInput({ action: `action-${i}` }));
      }
      const recent = auditLogger.getRecentEvents(3);
      expect(recent).toHaveLength(3);
      expect(recent[0].action).toBe('action-7');
      expect(recent[2].action).toBe('action-9');
    });

    it('should return all if count > buffer', () => {
      auditLogger.logEvent(makeInput());
      auditLogger.logEvent(makeInput());
      expect(auditLogger.getRecentEvents(100)).toHaveLength(2);
    });

    it('should return empty for empty buffer', () => {
      expect(auditLogger.getRecentEvents(10)).toEqual([]);
    });
  });

  describe('buffer overflow', () => {
    it('should drop oldest when buffer is full', () => {
      const small = new AuditLogger(join(tempDir, 'small.jsonl'), 5);
      for (let i = 0; i < 8; i++) {
        small.logEvent(makeInput({ action: `a-${i}` }));
      }
      expect(small.getBufferSize()).toBe(5);
      const recent = small.getRecentEvents(5);
      expect(recent[0].action).toBe('a-3');
      expect(recent[4].action).toBe('a-7');
    });
  });

  describe('getFilePath', () => {
    it('should return configured file path', () => {
      expect(auditLogger.getFilePath()).toContain('audit.jsonl');
    });
  });
});
