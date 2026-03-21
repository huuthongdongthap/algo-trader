// Seed demo leaders for copy-trading leaderboard showcase
// Provides realistic trader profiles for the marketplace demo
import type { LeaderBoard } from './leader-board.js';

interface DemoLeader {
  id: string;
  name: string;
  wins: number;
  losses: number;
  totalReturn: number;
  maxDrawdown: number;
  followers: number;
}

const DEMO_LEADERS: DemoLeader[] = [
  { id: 'demo-alpha-whale', name: 'AlphaWhale', wins: 342, losses: 158, totalReturn: 0.87, maxDrawdown: 0.12, followers: 47 },
  { id: 'demo-poly-sniper', name: 'PolySniper', wins: 215, losses: 85, totalReturn: 1.24, maxDrawdown: 0.08, followers: 112 },
  { id: 'demo-quant-sage', name: 'QuantSage', wins: 189, losses: 111, totalReturn: 0.45, maxDrawdown: 0.18, followers: 23 },
  { id: 'demo-degen-chad', name: 'DegenChad', wins: 98, losses: 52, totalReturn: 2.15, maxDrawdown: 0.35, followers: 8 },
  { id: 'demo-steady-eddie', name: 'SteadyEddie', wins: 410, losses: 190, totalReturn: 0.32, maxDrawdown: 0.05, followers: 89 },
  { id: 'demo-arb-king', name: 'ArbKing', wins: 567, losses: 233, totalReturn: 0.68, maxDrawdown: 0.09, followers: 156 },
  { id: 'demo-momentum-mike', name: 'MomentumMike', wins: 134, losses: 66, totalReturn: 0.91, maxDrawdown: 0.22, followers: 34 },
  { id: 'demo-market-maker-pro', name: 'MMPro', wins: 890, losses: 310, totalReturn: 0.28, maxDrawdown: 0.03, followers: 201 },
];

/**
 * Seed the leaderboard with demo traders for showcase.
 * Idempotent — skips if leaders already exist.
 */
export function seedDemoLeaders(leaderBoard: LeaderBoard): number {
  let seeded = 0;
  for (const demo of DEMO_LEADERS) {
    if (leaderBoard.getTraderProfile(demo.id)) continue;

    leaderBoard.registerTrader(demo.id, demo.name);

    // Simulate trade history to build up stats
    const totalTrades = demo.wins + demo.losses;
    for (let i = 0; i < totalTrades; i++) {
      const isWin = i < demo.wins;
      const tradeReturn = isWin
        ? (demo.totalReturn / demo.wins) * (0.5 + Math.random())
        : -(demo.maxDrawdown / demo.losses) * (0.3 + Math.random() * 0.7);

      leaderBoard.updateStats(demo.id, {} as any, tradeReturn);
    }

    // Set follower count
    for (let f = 0; f < demo.followers; f++) {
      leaderBoard.incrementFollowers(demo.id);
    }
    seeded++;
  }
  return seeded;
}
