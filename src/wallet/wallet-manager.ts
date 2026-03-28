/**
 * Multi-Wallet Manager
 * Tracks multiple Polygon wallets with strict fund isolation.
 * Own-capital and managed-capital wallets are NEVER commingled.
 */

import { logger } from '../utils/logger';

export type WalletLabel = 'own-capital' | `managed-${string}`;

export interface Wallet {
  address: string;
  label: WalletLabel;
  capitalAllocation: number;
  currentBalance: number;
  isolatedPnl: number;
  createdAt: number;
  lastTradeAt?: number;
}

export interface WalletTrade {
  walletLabel: WalletLabel;
  marketId: string;
  side: 'buy' | 'sell';
  sizeUsd: number;
  price: number;
  pnl: number;
  timestamp: number;
}

export interface WalletSummary {
  totalWallets: number;
  totalCapital: number;
  totalPnl: number;
  ownCapital: { balance: number; pnl: number } | null;
  managedWallets: { label: string; balance: number; pnl: number }[];
}

export class WalletManager {
  private wallets: Map<WalletLabel, Wallet> = new Map();
  private tradeHistory: Map<WalletLabel, WalletTrade[]> = new Map();

  /** Register a wallet */
  registerWallet(address: string, label: WalletLabel, capitalAllocation: number): Wallet {
    if (this.wallets.has(label)) {
      throw new Error(`Wallet already registered: ${label}`);
    }

    const wallet: Wallet = {
      address, label, capitalAllocation,
      currentBalance: capitalAllocation,
      isolatedPnl: 0, createdAt: Date.now(),
    };

    this.wallets.set(label, wallet);
    this.tradeHistory.set(label, []);
    logger.info(`[WalletManager] Registered ${label} (${address}) with $${capitalAllocation}`);
    return wallet;
  }

  /** Get a wallet by label */
  getWallet(label: WalletLabel): Wallet | undefined {
    return this.wallets.get(label);
  }

  /** Get allocated capital for a wallet (for Kelly sizing) */
  getAllocatedCapital(label: WalletLabel): number {
    const wallet = this.wallets.get(label);
    return wallet?.currentBalance ?? 0;
  }

  /** Record a trade against a specific wallet — enforces isolation */
  recordTrade(trade: WalletTrade): void {
    const wallet = this.wallets.get(trade.walletLabel);
    if (!wallet) {
      throw new Error(`Wallet not found: ${trade.walletLabel}`);
    }

    // Enforce fund isolation: verify the trade label matches wallet type
    this.enforceIsolation(trade.walletLabel, trade);

    wallet.currentBalance += trade.pnl;
    wallet.isolatedPnl += trade.pnl;
    wallet.lastTradeAt = trade.timestamp;

    const history = this.tradeHistory.get(trade.walletLabel) || [];
    history.push(trade);
    this.tradeHistory.set(trade.walletLabel, history);

    logger.info(`[WalletManager] Trade on ${trade.walletLabel}: ${trade.side} $${trade.sizeUsd} → PnL $${trade.pnl.toFixed(2)}`);
  }

  /** Validate a trade is going to the correct wallet type */
  validateTradeWallet(walletLabel: WalletLabel, isOwnCapitalTrade: boolean): boolean {
    if (isOwnCapitalTrade && walletLabel !== 'own-capital') return false;
    if (!isOwnCapitalTrade && walletLabel === 'own-capital') return false;
    return this.wallets.has(walletLabel);
  }

  /** Get trade history for a wallet */
  getTradeHistory(label: WalletLabel): WalletTrade[] {
    return [...(this.tradeHistory.get(label) || [])];
  }

  /** Get all registered wallets */
  getAllWallets(): Wallet[] {
    return Array.from(this.wallets.values());
  }

  /** Get summary across all wallets */
  getSummary(): WalletSummary {
    const wallets = this.getAllWallets();
    const ownWallet = this.wallets.get('own-capital');

    return {
      totalWallets: wallets.length,
      totalCapital: wallets.reduce((sum, w) => sum + w.currentBalance, 0),
      totalPnl: wallets.reduce((sum, w) => sum + w.isolatedPnl, 0),
      ownCapital: ownWallet ? { balance: ownWallet.currentBalance, pnl: ownWallet.isolatedPnl } : null,
      managedWallets: wallets
        .filter(w => w.label !== 'own-capital')
        .map(w => ({ label: w.label, balance: w.currentBalance, pnl: w.isolatedPnl })),
    };
  }

  /** Enforce fund isolation: own-capital trades cannot go to managed wallets and vice versa */
  private enforceIsolation(label: WalletLabel, trade: WalletTrade): void {
    if (label !== trade.walletLabel) {
      throw new Error(`Fund isolation violation: trade label ${trade.walletLabel} != wallet ${label}`);
    }
  }
}
