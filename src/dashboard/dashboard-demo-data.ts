/**
 * Demo/fixture data for dashboard API endpoints
 * Contains static mock data for paper trading, SDK examples, marketplace, and onboarding
 */

// ── Paper trading status (Sprint 45) ─────────────────────────────────────────

export function getPaperTradingStatus() {
  return {
    sessions: [
      { id: 'ps_demo1', strategy: 'polymarket-arb', capital: 10000, equity: 10847, pnl: 847, pnlPct: 8.47, trades: 42, winRate: 0.64, status: 'active', startedAt: Date.now() - 3 * 86_400_000 },
      { id: 'ps_demo2', strategy: 'momentum-scalper', capital: 5000, equity: 5234, pnl: 234, pnlPct: 4.68, trades: 18, winRate: 0.56, status: 'active', startedAt: Date.now() - 1 * 86_400_000 },
      { id: 'ps_demo3', strategy: 'market-maker', capital: 20000, equity: 19650, pnl: -350, pnlPct: -1.75, trades: 156, winRate: 0.71, status: 'stopped', startedAt: Date.now() - 7 * 86_400_000 },
    ],
    totalCapital: 35000,
    totalEquity: 35731,
    totalPnl: 731,
  };
}

// ── SDK examples (Sprint 47) ─────────────────────────────────────────────────

export function getSdkExamples() {
  return { examples: [
    { title: 'Install & Setup', lang: 'bash', code: 'npm install @cashclaw/sdk\n# or\npnpm add @cashclaw/sdk' },
    { title: 'Initialize Client', lang: 'typescript', code: `import { AlgoTradeClient } from '@cashclaw/sdk';\n\nconst client = new AlgoTradeClient({\n  baseUrl: 'https://api.cashclaw.cc',\n  apiKey: 'your_api_key_here',\n});` },
    { title: 'Health Check', lang: 'typescript', code: `const health = await client.getHealth();\nconsole.log(health.status); // "ok"` },
    { title: 'Start a Strategy', lang: 'typescript', code: `await client.startStrategy('polymarket-arb');\nconsole.log('Strategy started!');` },
    { title: 'Get Trades', lang: 'typescript', code: `const { trades } = await client.getTrades();\nfor (const t of trades) {\n  console.log(t.side, t.fillPrice, t.strategy);\n}` },
    { title: 'Run Backtest', lang: 'typescript', code: `const result = await client.request('POST', '/api/backtest', {\n  strategy: 'momentum-scalper',\n  market: 'BTC-USD',\n  startDate: '2025-01-01',\n  endDate: '2025-12-31',\n  config: { initialCapital: 10000 },\n});\nconsole.log('Return:', result.totalReturn);` },
    { title: 'Follow a Trader', lang: 'typescript', code: `await client.request('POST', '/api/copy-trading/follow', {\n  leaderId: 'demo-alpha-whale',\n  maxCapital: 5000,\n});\nconsole.log('Following AlphaWhale!');` },
    { title: 'Webhook (TradingView)', lang: 'typescript', code: `// POST to /api/webhooks/tradingview\n// with your webhook secret in Authorization header\n{\n  "action": "buy",\n  "symbol": "POLY_YES_TOKEN",\n  "size": "100",\n  "strategy": "tv-signals"\n}` },
  ]};
}

// ── Marketplace strategies (Sprint 38) ──────────────────────────────────────

export const DEMO_STRATEGIES = [
  { id: 'strat-poly-arb', name: 'Polymarket Arbitrage', author: 'AlphaWhale', category: 'polymarket', priceCents: 4900, rating: 4.8, downloads: 156, description: 'Cross-market arbitrage exploiting price discrepancies between Polymarket and other prediction platforms.' },
  { id: 'strat-momentum', name: 'Momentum Scalper Pro', author: 'PolySniper', category: 'polymarket', priceCents: 2900, rating: 4.5, downloads: 234, description: 'High-frequency momentum strategy with adaptive entry/exit signals and Kelly-based position sizing.' },
  { id: 'strat-mm', name: 'Market Maker Suite', author: 'MMPro', category: 'crypto', priceCents: 9900, rating: 4.9, downloads: 89, description: 'Professional market-making strategy with dynamic spread adjustment and inventory management.' },
  { id: 'strat-mean-rev', name: 'Mean Reversion Alpha', author: 'QuantSage', category: 'crypto', priceCents: 3900, rating: 4.3, downloads: 167, description: 'Statistical mean-reversion strategy using Bollinger Bands and Z-score for entry timing.' },
  { id: 'strat-trend', name: 'Trend Following MACD', author: 'SteadyEddie', category: 'crypto', priceCents: 0, rating: 4.1, downloads: 412, description: 'Free trend-following strategy using MACD crossovers with multi-timeframe confirmation.' },
  { id: 'strat-kalshi', name: 'Kalshi Event Trader', author: 'ArbKing', category: 'other', priceCents: 5900, rating: 4.6, downloads: 78, description: 'Event-driven strategy for Kalshi markets with sentiment analysis and probability modeling.' },
  { id: 'strat-polyclaw-hedge', name: 'PolyClaw Hedge T1/T2', author: 'CashClaw', category: 'polymarket', priceCents: 9900, rating: 4.9, downloads: 42, description: 'AI-powered hedge discovery using LLM implication analysis. Finds logically necessary relationships between Polymarket events for 95%+ coverage portfolios. Includes Kelly position sizing and two-tier cache.' },
];

export function getMarketplaceBrowse() {
  return { items: DEMO_STRATEGIES, total: DEMO_STRATEGIES.length };
}

// ── Onboarding checklist (Sprint 39) ────────────────────────────────────────

export function getOnboardingChecklist() {
  return {
    steps: [
      { step: 1, title: 'Create Account', description: 'Register and get your API key', icon: 'key', done: true },
      { step: 2, title: 'Explore Dashboard', description: 'View your trading overview and P&L charts', icon: 'chart', done: true },
      { step: 3, title: 'Run a Backtest', description: 'Test a strategy with historical data before going live', icon: 'flask', done: false },
      { step: 4, title: 'Start Paper Trading', description: 'Try strategies with simulated money — no risk', icon: 'play', done: false },
      { step: 5, title: 'Connect Notifications', description: 'Set up Telegram alerts for trade signals', icon: 'bell', done: false },
      { step: 6, title: 'Upgrade to Pro', description: 'Unlock live trading, AI tuning, and copy-trading', icon: 'star', done: false },
    ],
  };
}
