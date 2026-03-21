// Individual CommandDefinition objects for every Trading Room slash command.
// Imported by room-commands.ts for registration — do not call directly.

import type { CommandDefinition } from './command-registry.js';
import type { ParsedCommand } from './command-parser.js';

// ─── Shared formatting helpers (internal) ────────────────────────────────────

export function ok(action: string, detail?: string): string {
  const ts = new Date().toISOString();
  return `[${ts}] OK  ${action}${detail ? `\n    ${detail}` : ''}`;
}

export function stub(command: string, parsed: ParsedCommand): string {
  const sub = parsed.subcommand ? ` ${parsed.subcommand}` : '';
  const flags = Object.entries(parsed.flags)
    .map(([k, v]) => `--${k} ${v}`)
    .join(' ');
  console.log(`[room-commands] /${command}${sub} ${flags}`.trim());
  return ok(`/${command}${sub}`, flags || undefined);
}

// ─── /trade ───────────────────────────────────────────────────────────────────

export const tradeCmd: CommandDefinition = {
  name: 'trade',
  description: 'Start, stop, or check trading strategies',
  subcommands: ['start', 'stop', 'status'],
  requiredArgs: [],
  optionalFlags: {
    strategy: 'Strategy name (e.g. cross-market-arb)',
    capital:  'Capital allocation in USD',
    dry:      'Dry-run mode (no real orders)',
  },
  handler: async (parsed) => {
    if (parsed.subcommand === 'start') {
      const strategy = parsed.flags['strategy'] ?? 'default';
      const capital  = parsed.flags['capital']  ?? 'unset';
      return ok('/trade start', `strategy=${strategy}  capital=${capital}  dry=${parsed.flags['dry'] ?? false}`);
    }
    if (parsed.subcommand === 'stop') {
      return ok('/trade stop', 'All active strategies queued for graceful shutdown.');
    }
    return ok('/trade status', 'Engine: IDLE  |  Active strategies: 0  |  Open positions: 0');
  },
};

// ─── /arb ─────────────────────────────────────────────────────────────────────

export const arbCmd: CommandDefinition = {
  name: 'arb',
  description: 'Arbitrage operations across Polymarket, Kalshi, and CEX',
  subcommands: ['scan', 'execute', 'history'],
  requiredArgs: [],
  optionalFlags: {
    market:    'Market ID to target',
    threshold: 'Min spread threshold (decimal, e.g. 0.02)',
    limit:     'Number of history records to show',
  },
  handler: async (parsed) => {
    if (parsed.subcommand === 'execute') {
      return ok('/arb execute', `market=${parsed.flags['market'] ?? 'unset'}  [stub — no order sent]`);
    }
    if (parsed.subcommand === 'history') {
      return ok('/arb history', `Showing last ${parsed.flags['limit'] ?? '10'} arb trades  [stub]`);
    }
    return ok('/arb scan', `threshold=${parsed.flags['threshold'] ?? '0.02'}  Polymarket ↔ Kalshi ↔ CEX  [stub]`);
  },
};

// ─── /scan ────────────────────────────────────────────────────────────────────

export const scanCmd: CommandDefinition = {
  name: 'scan',
  description: 'Scan markets, spreads, or opportunities',
  subcommands: ['markets', 'spreads', 'opportunities'],
  requiredArgs: [],
  optionalFlags: {
    exchange: 'Filter by exchange name',
    top:      'Return top N results',
  },
  handler: async (parsed) => stub('scan', parsed),
};

// ─── /status ──────────────────────────────────────────────────────────────────

export const statusCmd: CommandDefinition = {
  name: 'status',
  description: 'Show system status: engine, strategies, P&L, health',
  subcommands: ['engine', 'strategies', 'pnl', 'health'],
  requiredArgs: [],
  optionalFlags: { verbose: 'Show extended metrics' },
  handler: async (parsed) => {
    const sections: Record<string, string> = {
      engine:     'Engine: IDLE  |  Uptime: 0s  |  Queue: 0 tasks',
      strategies: 'Active: 0  |  Disabled: 0  |  Errored: 0',
      pnl:        'Realized: $0.00  |  Unrealized: $0.00  |  Drawdown: 0%',
      health:     'DB: OK  |  WS feeds: 0 connected  |  OpenClaw: OK',
    };
    const key = parsed.subcommand ?? 'engine';
    return ok(`/status ${key}`, sections[key] ?? 'Unknown subsystem');
  },
};

// ─── /tune ────────────────────────────────────────────────────────────────────

export const tuneCmd: CommandDefinition = {
  name: 'tune',
  description: 'AI parameter tuning — delegates to OpenClaw',
  subcommands: [],
  requiredArgs: [],
  optionalFlags: {
    mode:     'Tuning mode: auto | manual (default: manual)',
    strategy: 'Strategy name to tune',
  },
  handler: async (parsed) => {
    const strategy = parsed.subcommand ?? parsed.flags['strategy'] ?? 'default';
    const mode     = parsed.flags['mode'] ?? 'manual';
    return ok('/tune', `strategy=${strategy}  mode=${mode}  [delegating to OpenClaw — stub]`);
  },
};

// ─── /report ──────────────────────────────────────────────────────────────────

export const reportCmd: CommandDefinition = {
  name: 'report',
  description: 'Generate AI performance report (daily | weekly | monthly)',
  subcommands: ['daily', 'weekly', 'monthly'],
  requiredArgs: [],
  optionalFlags: { format: 'Output format: text | json | csv' },
  handler: async (parsed) => {
    const period = parsed.subcommand ?? 'daily';
    const format = parsed.flags['format'] ?? 'text';
    return ok(`/report ${period}`, `format=${format}  [AI report generation stub — OpenClaw not called]`);
  },
};

// ─── /stealth ─────────────────────────────────────────────────────────────────

export const stealthCmd: CommandDefinition = {
  name: 'stealth',
  description: 'Toggle stealth trading mode (reduces market footprint)',
  subcommands: ['on', 'off', 'status'],
  requiredArgs: [],
  optionalFlags: {},
  handler: async (parsed) => {
    const sub = parsed.subcommand ?? 'status';
    const msg: Record<string, string> = {
      on:     'Stealth mode ENABLED  — order splitting + delay active',
      off:    'Stealth mode DISABLED — standard order routing',
      status: 'Stealth mode: OFF  [stub — runtime state not wired]',
    };
    return ok(`/stealth ${sub}`, msg[sub] ?? 'Unknown stealth subcommand');
  },
};

// ─── /risk ────────────────────────────────────────────────────────────────────

export const riskCmd: CommandDefinition = {
  name: 'risk',
  description: 'Risk management: check limits, override controls',
  subcommands: ['check', 'limits', 'override'],
  requiredArgs: [],
  optionalFlags: {
    limit:  'Limit name to override',
    value:  'New limit value',
    reason: 'Override justification',
  },
  handler: async (parsed) => {
    if (parsed.subcommand === 'override') {
      const limit  = parsed.flags['limit']  ?? 'unset';
      const value  = parsed.flags['value']  ?? 'unset';
      const reason = parsed.flags['reason'] ?? 'none';
      return ok('/risk override', `limit=${limit}  value=${value}  reason="${reason}"  [stub]`);
    }
    if (parsed.subcommand === 'limits') {
      return ok('/risk limits', 'maxPositionSize: unset  |  maxDrawdown: unset  |  maxLeverage: unset  [stub]');
    }
    return ok('/risk check', 'All limits within bounds  [stub — RiskManager not connected]');
  },
};

// ─── /alert ───────────────────────────────────────────────────────────────────

export const alertCmd: CommandDefinition = {
  name: 'alert',
  description: 'Manage trading alerts (add, remove, list)',
  subcommands: ['add', 'remove', 'list'],
  requiredArgs: [],
  optionalFlags: {
    type:      'Alert type: price | pnl | drawdown | custom',
    threshold: 'Trigger threshold',
    channel:   'Notification channel: console | webhook',
    id:        'Alert ID (for remove)',
  },
  handler: async (parsed) => stub('alert', parsed),
};

// ─── /export ──────────────────────────────────────────────────────────────────

export const exportCmd: CommandDefinition = {
  name: 'export',
  description: 'Export trades, P&L, or tax report data',
  subcommands: ['trades', 'pnl', 'tax'],
  requiredArgs: [],
  optionalFlags: {
    from:   'Start date (ISO 8601)',
    to:     'End date (ISO 8601)',
    format: 'Output format: csv | json',
    out:    'Output file path',
  },
  handler: async (parsed) => {
    const sub     = parsed.subcommand ?? 'trades';
    const fmt     = parsed.flags['format'] ?? 'csv';
    const from    = parsed.flags['from']   ?? 'epoch';
    const to      = parsed.flags['to']     ?? 'now';
    const outPath = parsed.flags['out']    ?? `./export-${sub}-${Date.now()}.${fmt}`;
    return ok(`/export ${sub}`, `from=${from}  to=${to}  format=${fmt}  out=${outPath}  [stub — no file written]`);
  },
};
