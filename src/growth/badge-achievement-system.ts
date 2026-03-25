// Badge/achievement system — gamification for user retention and viral sharing
// Badges are earned by hitting milestones; shareable for social proof

export interface Badge {
  id: string;
  name: string;
  description: string;
  icon: string;        // emoji
  category: 'trading' | 'prediction' | 'social' | 'milestone';
  tier: 'bronze' | 'silver' | 'gold' | 'diamond';
}

export interface EarnedBadge {
  badge: Badge;
  userId: string;
  earnedAt: number;
}

export interface UserStats {
  tradeCount: number;
  winCount: number;
  totalPnl: number;
  brierScore: number | null;
  referralCount: number;
  daysActive: number;
  capitalTier: number;
  followers: number;
}

// ── Badge definitions ────────────────────────────────────────────────────────

const BADGES: Badge[] = [
  // Trading badges
  { id: 'first-trade', name: 'First Blood', description: 'Execute your first trade', icon: '🎯', category: 'trading', tier: 'bronze' },
  { id: 'ten-trades', name: 'Getting Started', description: 'Complete 10 trades', icon: '📊', category: 'trading', tier: 'bronze' },
  { id: 'hundred-trades', name: 'Seasoned Trader', description: 'Complete 100 trades', icon: '💹', category: 'trading', tier: 'silver' },
  { id: 'thousand-trades', name: 'Market Veteran', description: 'Complete 1,000 trades', icon: '🏆', category: 'trading', tier: 'gold' },
  { id: 'profitable-week', name: 'Green Week', description: 'Profitable for 7 consecutive days', icon: '📈', category: 'trading', tier: 'silver' },
  { id: 'hundred-usd-profit', name: 'Centurion', description: 'Earn $100 total profit', icon: '💰', category: 'trading', tier: 'bronze' },
  { id: 'thousand-usd-profit', name: 'Grand Trader', description: 'Earn $1,000 total profit', icon: '💎', category: 'trading', tier: 'gold' },

  // Prediction badges
  { id: 'brier-good', name: 'Sharp Eye', description: 'Achieve Brier score < 0.20', icon: '🔮', category: 'prediction', tier: 'silver' },
  { id: 'brier-excellent', name: 'Oracle', description: 'Achieve Brier score < 0.10', icon: '🧙', category: 'prediction', tier: 'diamond' },
  { id: 'win-streak-5', name: 'Hot Hand', description: '5 consecutive winning trades', icon: '🔥', category: 'prediction', tier: 'silver' },
  { id: 'win-rate-70', name: 'Sharpshooter', description: 'Maintain 70%+ win rate (min 20 trades)', icon: '🎯', category: 'prediction', tier: 'gold' },

  // Social badges
  { id: 'first-referral', name: 'Evangelist', description: 'Refer your first user', icon: '🤝', category: 'social', tier: 'bronze' },
  { id: 'five-referrals', name: 'Influencer', description: 'Refer 5 users', icon: '📣', category: 'social', tier: 'silver' },
  { id: 'first-follower', name: 'Leader', description: 'Get your first copy-trading follower', icon: '👥', category: 'social', tier: 'silver' },
  { id: 'ten-followers', name: 'Fund Manager', description: 'Get 10 copy-trading followers', icon: '🏦', category: 'social', tier: 'gold' },

  // Milestone badges
  { id: 'tier-2', name: 'Tier Up', description: 'Reach capital tier 2 ($500)', icon: '⬆️', category: 'milestone', tier: 'bronze' },
  { id: 'tier-3', name: 'Scaling Up', description: 'Reach capital tier 3 ($1,000)', icon: '🚀', category: 'milestone', tier: 'silver' },
  { id: 'tier-4', name: 'Whale Status', description: 'Reach capital tier 4 ($5,000)', icon: '🐋', category: 'milestone', tier: 'gold' },
  { id: 'thirty-days', name: 'Committed', description: 'Active for 30 days', icon: '📅', category: 'milestone', tier: 'bronze' },
  { id: 'ninety-days', name: 'Dedicated', description: 'Active for 90 days', icon: '🗓️', category: 'milestone', tier: 'silver' },
];

// ── Badge checker ────────────────────────────────────────────────────────────

/** Check which badges a user has earned based on their stats */
export function checkEarnedBadges(stats: UserStats): Badge[] {
  const earned: Badge[] = [];

  // Trading
  if (stats.tradeCount >= 1) earned.push(findBadge('first-trade'));
  if (stats.tradeCount >= 10) earned.push(findBadge('ten-trades'));
  if (stats.tradeCount >= 100) earned.push(findBadge('hundred-trades'));
  if (stats.tradeCount >= 1000) earned.push(findBadge('thousand-trades'));
  if (stats.totalPnl >= 100) earned.push(findBadge('hundred-usd-profit'));
  if (stats.totalPnl >= 1000) earned.push(findBadge('thousand-usd-profit'));

  // Prediction
  if (stats.brierScore !== null && stats.brierScore < 0.20) earned.push(findBadge('brier-good'));
  if (stats.brierScore !== null && stats.brierScore < 0.10) earned.push(findBadge('brier-excellent'));
  if (stats.tradeCount >= 20 && stats.winCount / stats.tradeCount >= 0.70) earned.push(findBadge('win-rate-70'));

  // Social
  if (stats.referralCount >= 1) earned.push(findBadge('first-referral'));
  if (stats.referralCount >= 5) earned.push(findBadge('five-referrals'));
  if (stats.followers >= 1) earned.push(findBadge('first-follower'));
  if (stats.followers >= 10) earned.push(findBadge('ten-followers'));

  // Milestones
  if (stats.capitalTier >= 2) earned.push(findBadge('tier-2'));
  if (stats.capitalTier >= 3) earned.push(findBadge('tier-3'));
  if (stats.capitalTier >= 4) earned.push(findBadge('tier-4'));
  if (stats.daysActive >= 30) earned.push(findBadge('thirty-days'));
  if (stats.daysActive >= 90) earned.push(findBadge('ninety-days'));

  return earned;
}

/** Detect newly earned badges by diffing against previously earned set */
export function detectNewBadges(stats: UserStats, previousBadgeIds: Set<string>): Badge[] {
  return checkEarnedBadges(stats).filter(b => !previousBadgeIds.has(b.id));
}

/** Get all defined badges */
export function getAllBadges(): Badge[] {
  return [...BADGES];
}

/** Find badge by ID */
export function findBadge(id: string): Badge {
  const badge = BADGES.find(b => b.id === id);
  if (!badge) throw new Error(`Unknown badge: ${id}`);
  return badge;
}

/** Format badge for display */
export function formatBadge(badge: Badge): string {
  return `${badge.icon} ${badge.name} (${badge.tier})`;
}
