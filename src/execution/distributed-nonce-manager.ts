/**
 * Distributed Nonce Manager
 * Redis INCR-based atomic nonce pool for concurrent transaction safety.
 *
 * Pattern: reserveNonce() → sign tx → broadcast tx → if fail: releaseNonce()
 * Multiple workers can safely call reserveNonce() simultaneously — Redis INCR is atomic.
 *
 * Redis key schema: nonce:{walletAddress} → current nonce counter
 */

import { getRedisClient } from '../redis/index';
import { logger } from '../utils/logger';

/** Milliseconds before a reserved nonce is considered stale and released */
const NONCE_TTL_MS = 30_000;

/** Redis key prefix for nonce counters */
const NONCE_KEY_PREFIX = 'nonce:';

export interface NonceReservation {
  walletAddress: string;
  nonce: number;
  reservedAt: number;
}

/**
 * Manages transaction nonces across multiple concurrent workers via Redis.
 * Uses Redis INCR for atomic, race-condition-free nonce assignment.
 */
export class DistributedNonceManager {
  /**
   * Fetch the current on-chain nonce for a wallet from an RPC provider.
   * Called once on first use to seed the Redis counter.
   *
   * @param walletAddress - Checksummed wallet address
   * @returns On-chain transaction count (next valid nonce)
   */
  private readonly getOnChainNonce: (walletAddress: string) => Promise<number>;

  constructor(getOnChainNonce: (walletAddress: string) => Promise<number>) {
    this.getOnChainNonce = getOnChainNonce;
  }

  /** Redis key for a wallet's nonce counter */
  private nonceKey(walletAddress: string): string {
    return `${NONCE_KEY_PREFIX}${walletAddress.toLowerCase()}`;
  }

  /**
   * Seed Redis nonce from blockchain if not yet initialised.
   * Uses SET NX (set-if-not-exists) so only the first caller seeds it.
   */
  private async ensureInitialised(walletAddress: string): Promise<void> {
    const redis = getRedisClient();
    const key = this.nonceKey(walletAddress);

    // Check if already seeded
    const existing = await redis.get(key);
    if (existing !== null) return;

    // Fetch on-chain nonce and seed (NX = only set if missing to avoid race)
    const onChainNonce = await this.getOnChainNonce(walletAddress);
    // Use SET NX — if another worker seeded between our GET and SET, that's fine
    await redis.set(key, onChainNonce, 'NX' as never);

    logger.info('[NonceManager] Seeded nonce from chain', {
      walletAddress,
      onChainNonce,
    });
  }

  /**
   * Atomically reserve the next nonce for a wallet.
   * INCR returns the value AFTER incrementing, so we subtract 1 for the reserved nonce.
   *
   * @param walletAddress - Checksummed wallet address
   * @returns Reservation object containing the reserved nonce
   */
  async reserveNonce(walletAddress: string): Promise<NonceReservation> {
    await this.ensureInitialised(walletAddress);

    const redis = getRedisClient();
    const key = this.nonceKey(walletAddress);

    // INCR is atomic — safe for multiple concurrent callers
    const afterIncrement = await redis.incr(key);
    const reservedNonce = afterIncrement - 1;

    logger.debug('[NonceManager] Reserved nonce', {
      walletAddress,
      nonce: reservedNonce,
    });

    return {
      walletAddress,
      nonce: reservedNonce,
      reservedAt: Date.now(),
    };
  }

  /**
   * Release a nonce back by decrementing the counter.
   * Call this ONLY when a transaction definitively failed before broadcast
   * (i.e., signing error, not a broadcast error — broadcast may have landed).
   *
   * WARNING: Only safe to call if you are certain the nonce was never used on-chain.
   *
   * @param reservation - The reservation returned by reserveNonce()
   */
  async releaseNonce(reservation: NonceReservation): Promise<void> {
    const ageMs = Date.now() - reservation.reservedAt;
    if (ageMs > NONCE_TTL_MS) {
      logger.warn('[NonceManager] Stale nonce release skipped — may be unsafe', {
        walletAddress: reservation.walletAddress,
        nonce: reservation.nonce,
        ageMs,
      });
      return;
    }

    const redis = getRedisClient();
    const key = this.nonceKey(reservation.walletAddress);
    await redis.decr(key);

    logger.info('[NonceManager] Released nonce', {
      walletAddress: reservation.walletAddress,
      nonce: reservation.nonce,
    });
  }

  /**
   * Get the current nonce counter value without reserving.
   * Useful for monitoring and debugging.
   */
  async getCurrentNonce(walletAddress: string): Promise<number | null> {
    const redis = getRedisClient();
    const raw = await redis.get(this.nonceKey(walletAddress));
    return raw !== null ? parseInt(raw, 10) : null;
  }

  /**
   * Force-reset the nonce counter from the blockchain.
   * Use after detecting nonce desync (e.g., manual transactions sent outside the bot).
   */
  async resyncFromChain(walletAddress: string): Promise<number> {
    const onChainNonce = await this.getOnChainNonce(walletAddress);
    const redis = getRedisClient();
    await redis.set(this.nonceKey(walletAddress), onChainNonce);

    logger.info('[NonceManager] Resynced nonce from chain', {
      walletAddress,
      onChainNonce,
    });

    return onChainNonce;
  }
}
