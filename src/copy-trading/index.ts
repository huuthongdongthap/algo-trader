// Copy trading module — barrel export
export { LeaderBoard } from './leader-board.js';
export type { LeaderProfile } from './leader-board.js';

export { FollowerManager } from './follower-manager.js';
export type { FollowRelation } from './follower-manager.js';

export { CopyEngine } from './copy-engine.js';
export type { FollowerContext, CopyTradeResult } from './copy-engine.js';

export { CopyTradingService } from './copy-trading-service.js';
export type { FollowerCapitalResolver, CopyTradeDispatcher } from './copy-trading-service.js';

export { seedDemoLeaders } from './seed-demo-leaders.js';
