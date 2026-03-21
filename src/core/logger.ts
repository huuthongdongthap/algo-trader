// Structured JSON logger with level filtering
import type { LogLevel } from './types.js';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0, info: 1, warn: 2, error: 3,
};

let currentLevel: LogLevel = 'info';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: string;
  data?: Record<string, unknown>;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[currentLevel];
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function log(level: LogLevel, message: string, context?: string, data?: Record<string, unknown>): void {
  if (!shouldLog(level)) return;
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...(context && { context }),
    ...(data && { data }),
  };
  const output = formatEntry(entry);
  if (level === 'error') {
    console.error(output);
  } else if (level === 'warn') {
    console.warn(output);
  } else {
    console.log(output);
  }
}

export const logger = {
  setLevel(level: LogLevel) { currentLevel = level; },
  getLevel(): LogLevel { return currentLevel; },
  debug(msg: string, ctx?: string, data?: Record<string, unknown>) { log('debug', msg, ctx, data); },
  info(msg: string, ctx?: string, data?: Record<string, unknown>) { log('info', msg, ctx, data); },
  warn(msg: string, ctx?: string, data?: Record<string, unknown>) { log('warn', msg, ctx, data); },
  error(msg: string, ctx?: string, data?: Record<string, unknown>) { log('error', msg, ctx, data); },
};
