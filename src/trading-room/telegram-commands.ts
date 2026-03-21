// Telegram command handlers for phone-based trading control
// Each handler returns a formatted HTML string response
import type { StrategyName } from '../core/types.js';

export interface TelegramCommandHandler {
  command: string;
  description: string;
  handler: (args: string[]) => Promise<string>;
}

// Context injected at runtime by TelegramController bootstrap
export interface CommandContext {
  getEngineStatus: () => { running: boolean; activeStrategies: StrategyName[] };
  getPnl: () => {
    equity: string;
    realizedPnl: string;
    unrealizedPnl: string;
    tradeCount: number;
    winCount: number;
  };
  startStrategy: (name: string) => Promise<boolean>;
  stopStrategy: (name: string) => Promise<boolean>;
  scanMarkets: () => Promise<string>;
  tuneStrategy: (name: string) => Promise<string>;
}

const VALID_STRATEGIES: StrategyName[] = [
  'cross-market-arb',
  'market-maker',
  'grid-trading',
  'dca-bot',
  'funding-rate-arb',
];

function listCommandsText(handlers: TelegramCommandHandler[]): string {
  return handlers.map((h) => `/${h.command} — ${h.description}`).join('\n');
}

export function createTelegramHandlers(ctx: CommandContext): TelegramCommandHandler[] {
  // Handlers declared before /start so listCommandsText works correctly
  const handlers: TelegramCommandHandler[] = [];

  handlers.push({
    command: 'start',
    description: 'Welcome + list all commands',
    handler: async () => {
      const lines = [
        '<b>🤖 Algo-Trade Bot</b>',
        'Commands available:',
        '',
        listCommandsText(handlers),
      ];
      return lines.join('\n');
    },
  });

  handlers.push({
    command: 'help',
    description: 'List all commands',
    handler: async () => {
      return ['<b>Available Commands</b>', '', listCommandsText(handlers)].join('\n');
    },
  });

  handlers.push({
    command: 'status',
    description: 'Engine status, active strategies, P&L snapshot',
    handler: async () => {
      const { running, activeStrategies } = ctx.getEngineStatus();
      const pnl = ctx.getPnl();
      const winRate =
        pnl.tradeCount > 0
          ? ((pnl.winCount / pnl.tradeCount) * 100).toFixed(1)
          : '0.0';
      return [
        `<b>📡 Engine Status</b>`,
        `Running: ${running ? '✅' : '❌'}`,
        `Active strategies: ${activeStrategies.length > 0 ? activeStrategies.join(', ') : 'none'}`,
        `Equity: <code>${pnl.equity}</code>`,
        `Realized PnL: ${pnl.realizedPnl}`,
        `Unrealized PnL: ${pnl.unrealizedPnl}`,
        `Trades: ${pnl.tradeCount} (Win: ${winRate}%)`,
      ].join('\n');
    },
  });

  handlers.push({
    command: 'pnl',
    description: 'Current profit/loss summary',
    handler: async () => {
      const pnl = ctx.getPnl();
      const winRate =
        pnl.tradeCount > 0
          ? ((pnl.winCount / pnl.tradeCount) * 100).toFixed(1)
          : '0.0';
      return [
        `<b>📊 P&L Summary</b>`,
        `Equity: <code>${pnl.equity}</code>`,
        `Realized: ${pnl.realizedPnl}`,
        `Unrealized: ${pnl.unrealizedPnl}`,
        `Trades: ${pnl.tradeCount} | Win rate: ${winRate}%`,
      ].join('\n');
    },
  });

  handlers.push({
    command: 'trade',
    description: 'Start a strategy — /trade <strategy>',
    handler: async (args) => {
      const name = args[0];
      if (!name) return '❌ Usage: /trade <strategy-name>';
      if (!VALID_STRATEGIES.includes(name as StrategyName)) {
        return `❌ Unknown strategy: ${name}\nValid: ${VALID_STRATEGIES.join(', ')}`;
      }
      const ok = await ctx.startStrategy(name);
      return ok ? `✅ Strategy <code>${name}</code> started` : `❌ Failed to start <code>${name}</code>`;
    },
  });

  handlers.push({
    command: 'stop',
    description: 'Stop a strategy — /stop <strategy>',
    handler: async (args) => {
      const name = args[0];
      if (!name) return '❌ Usage: /stop <strategy-name>';
      if (!VALID_STRATEGIES.includes(name as StrategyName)) {
        return `❌ Unknown strategy: ${name}\nValid: ${VALID_STRATEGIES.join(', ')}`;
      }
      const ok = await ctx.stopStrategy(name);
      return ok ? `✅ Strategy <code>${name}</code> stopped` : `❌ Failed to stop <code>${name}</code>`;
    },
  });

  handlers.push({
    command: 'scan',
    description: 'Quick market scan',
    handler: async () => {
      const result = await ctx.scanMarkets();
      return `<b>🔍 Market Scan</b>\n${result}`;
    },
  });

  handlers.push({
    command: 'tune',
    description: 'Trigger AI tuning — /tune <strategy>',
    handler: async (args) => {
      const name = args[0];
      if (!name) return '❌ Usage: /tune <strategy-name>';
      if (!VALID_STRATEGIES.includes(name as StrategyName)) {
        return `❌ Unknown strategy: ${name}\nValid: ${VALID_STRATEGIES.join(', ')}`;
      }
      const result = await ctx.tuneStrategy(name);
      return `<b>🎯 Tuning <code>${name}</code></b>\n${result}`;
    },
  });

  return handlers;
}
