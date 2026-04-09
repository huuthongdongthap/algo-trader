/**
 * On-Chain Position Reconciler
 * Periodically queries Polygon CTF contract for actual token balances,
 * compares with local Redis position cache, and alerts on discrepancies.
 *
 * CTF contract: ERC1155 on Polygon (chainId 137)
 * Publishes alerts to NATS `risk.alert` topic.
 */

import { ethers } from 'ethers';
import { getRedisClient, type RedisClientType } from '../redis';
import { getMessageBus } from '../messaging';
import { Topics } from '../messaging/topic-schema';
import { logger } from '../utils/logger';

/** Polymarket CTF contract address on Polygon */
const CTF_CONTRACT_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

const ERC1155_ABI = [
  'function balanceOf(address account, uint256 id) view returns (uint256)',
  'function balanceOfBatch(address[] accounts, uint256[] ids) view returns (uint256[])',
];

const CRITICAL_THRESHOLD_UNITS = 5_000_000; // $5 in 6-decimal USDC units

export interface PositionDiscrepancy {
  marketId: string;
  tokenId: string;
  localBalance: number;
  onChainBalance: number;
  difference: number;
  severity: 'INFO' | 'WARNING' | 'CRITICAL';
}

export interface ReconciliationResult {
  checkedAt: number;
  positionsChecked: number;
  discrepancies: PositionDiscrepancy[];
}

export class OnChainPositionReconciler {
  private provider: ethers.JsonRpcProvider;
  private contract: ethers.Contract;
  private redis: RedisClientType;
  private walletAddress: string;
  private loopHandle: ReturnType<typeof setInterval> | null = null;
  private readonly autoCorrect: boolean;

  constructor(options: {
    rpcUrl?: string;
    walletAddress: string;
    redis?: RedisClientType;
    autoCorrect?: boolean;
  }) {
    const rpcUrl =
      options.rpcUrl ||
      process.env.POLYGON_RPC_URL ||
      process.env.ETH_RPC_URL ||
      'https://polygon-rpc.com';

    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.contract = new ethers.Contract(CTF_CONTRACT_ADDRESS, ERC1155_ABI, this.provider);
    this.redis = options.redis || getRedisClient();
    this.walletAddress = options.walletAddress;
    this.autoCorrect = options.autoCorrect ?? false;
  }

  /**
   * Read tracked polymarket positions from Redis.
   * Keys follow pattern: polymarket:position:{marketId}:{tokenId}
   */
  private async getLocalPositions(): Promise<Array<{ marketId: string; tokenId: string; balance: number }>> {
    // Use SCAN instead of KEYS to avoid blocking Redis on large keyspaces
    const positions: Array<{ marketId: string; tokenId: string; balance: number }> = [];
    let cursor = '0';
    do {
      const [nextCursor, keys] = await this.redis.scan(
        cursor, 'MATCH', 'polymarket:position:*', 'COUNT', '100'
      );
      cursor = nextCursor;
      for (const key of keys) {
        const parts = key.split(':');
        if (parts.length < 4) continue;
        const marketId = parts[2];
        const tokenId = parts[3];
        const raw = await this.redis.get(key);
        const balance = raw ? parseFloat(raw) : 0;
        positions.push({ marketId, tokenId, balance });
      }
    } while (cursor !== '0');

    return positions;
  }

  /** Query on-chain ERC1155 balance. Token IDs are uint256 strings. */
  private async getOnChainBalance(tokenId: string): Promise<number> {
    try {
      const raw: bigint = await this.contract.balanceOf(this.walletAddress, BigInt(tokenId));
      return Number(raw);
    } catch (err) {
      logger.warn(`[Reconciler] balanceOf failed for tokenId ${tokenId}: ${(err as Error).message}`);
      return -1; // -1 signals RPC failure — treated as INFO discrepancy
    }
  }

  /** Severity: CRITICAL if |diff| >= $5, WARNING if any diff, INFO otherwise. */
  private classifySeverity(difference: number): 'INFO' | 'WARNING' | 'CRITICAL' {
    const absDiff = Math.abs(difference);
    if (absDiff >= CRITICAL_THRESHOLD_UNITS) return 'CRITICAL';
    if (absDiff > 0) return 'WARNING';
    return 'INFO';
  }

  /**
   * Run a single reconciliation pass over all locally tracked positions.
   */
  async reconcile(): Promise<ReconciliationResult> {
    const checkedAt = Date.now();
    const localPositions = await this.getLocalPositions();
    const discrepancies: PositionDiscrepancy[] = [];

    for (const pos of localPositions) {
      const onChainBalance = await this.getOnChainBalance(pos.tokenId);
      const difference = pos.balance - onChainBalance;

      if (difference !== 0 || onChainBalance === -1) {
        const severity = onChainBalance === -1 ? 'INFO' : this.classifySeverity(difference);

        const discrepancy: PositionDiscrepancy = {
          marketId: pos.marketId,
          tokenId: pos.tokenId,
          localBalance: pos.balance,
          onChainBalance,
          difference,
          severity,
        };

        discrepancies.push(discrepancy);

        logger.warn(
          `[Reconciler] ${severity} — market=${pos.marketId} token=${pos.tokenId} ` +
          `local=${pos.balance} onChain=${onChainBalance} diff=${difference}`
        );

        // Publish alert to NATS risk.alert topic
        try {
          const bus = getMessageBus();
          await bus.publish(Topics.RISK_ALERT, discrepancy, 'position-reconciler');
        } catch (err) {
          logger.error(`[Reconciler] Failed to publish alert: ${(err as Error).message}`);
        }

        // Auto-correct: overwrite local cache with on-chain truth
        if (this.autoCorrect && onChainBalance >= 0) {
          const key = `polymarket:position:${pos.marketId}:${pos.tokenId}`;
          await this.redis.set(key, onChainBalance.toString());
          logger.info(`[Reconciler] Auto-corrected ${key} → ${onChainBalance}`);
        }
      }
    }

    logger.info(
      `[Reconciler] Pass complete — checked=${localPositions.length} discrepancies=${discrepancies.length}`
    );

    return { checkedAt, positionsChecked: localPositions.length, discrepancies };
  }

  /**
   * Start a recurring reconciliation loop.
   * @param intervalMs - Interval between passes (default: 60 seconds)
   */
  startReconciliationLoop(intervalMs = 60_000): void {
    if (this.loopHandle) {
      logger.warn('[Reconciler] Loop already running — skipping startReconciliationLoop()');
      return;
    }

    logger.info(`[Reconciler] Starting reconciliation loop every ${intervalMs}ms`);

    // Run immediately on start, then on interval
    this.reconcile().catch((err) =>
      logger.error(`[Reconciler] Initial pass failed: ${(err as Error).message}`)
    );

    this.loopHandle = setInterval(() => {
      this.reconcile().catch((err) =>
        logger.error(`[Reconciler] Reconciliation pass failed: ${(err as Error).message}`)
      );
    }, intervalMs);
  }

  /** Stop the reconciliation loop */
  stop(): void {
    if (this.loopHandle) {
      clearInterval(this.loopHandle);
      this.loopHandle = null;
      logger.info('[Reconciler] Reconciliation loop stopped');
    }
  }
}
