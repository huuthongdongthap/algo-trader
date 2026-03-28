/**
 * Wallet Manager Tests
 */

import { describe, it, expect } from 'vitest';
import { WalletManager, type WalletLabel } from '../wallet-manager';

describe('WalletManager', () => {
  describe('registration', () => {
    it('should register a wallet', () => {
      const wm = new WalletManager();
      const wallet = wm.registerWallet('0xabc', 'own-capital', 50000);
      expect(wallet.label).toBe('own-capital');
      expect(wallet.capitalAllocation).toBe(50000);
      expect(wallet.currentBalance).toBe(50000);
    });

    it('should reject duplicate labels', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'own-capital', 50000);
      expect(() => wm.registerWallet('0xdef', 'own-capital', 30000)).toThrow('already registered');
    });

    it('should register managed wallets', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'managed-client1', 100000);
      const wallet = wm.getWallet('managed-client1');
      expect(wallet?.label).toBe('managed-client1');
    });
  });

  describe('fund isolation', () => {
    it('should allow own-capital trade on own wallet', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'own-capital', 50000);
      expect(() => wm.recordTrade({
        walletLabel: 'own-capital', marketId: 'BTC', side: 'buy',
        sizeUsd: 1000, price: 50000, pnl: 50, timestamp: Date.now(),
      })).not.toThrow();
    });

    it('should reject trade on non-existent wallet', () => {
      const wm = new WalletManager();
      expect(() => wm.recordTrade({
        walletLabel: 'own-capital', marketId: 'BTC', side: 'buy',
        sizeUsd: 1000, price: 50000, pnl: 50, timestamp: Date.now(),
      })).toThrow('not found');
    });

    it('should validate own-capital trades go to own wallet', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'own-capital', 50000);
      wm.registerWallet('0xdef', 'managed-client1', 100000);

      expect(wm.validateTradeWallet('own-capital', true)).toBe(true);
      expect(wm.validateTradeWallet('managed-client1', true)).toBe(false);
    });

    it('should validate managed trades go to managed wallet', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'own-capital', 50000);
      wm.registerWallet('0xdef', 'managed-client1', 100000);

      expect(wm.validateTradeWallet('managed-client1', false)).toBe(true);
      expect(wm.validateTradeWallet('own-capital', false)).toBe(false);
    });
  });

  describe('per-wallet capital', () => {
    it('should return allocated capital per wallet for Kelly sizing', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'own-capital', 50000);
      wm.registerWallet('0xdef', 'managed-client1', 100000);

      expect(wm.getAllocatedCapital('own-capital')).toBe(50000);
      expect(wm.getAllocatedCapital('managed-client1')).toBe(100000);
    });

    it('should return 0 for unknown wallet', () => {
      const wm = new WalletManager();
      expect(wm.getAllocatedCapital('managed-unknown' as WalletLabel)).toBe(0);
    });

    it('should track isolated PnL per wallet', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'own-capital', 50000);
      wm.registerWallet('0xdef', 'managed-client1', 100000);

      wm.recordTrade({ walletLabel: 'own-capital', marketId: 'BTC', side: 'buy', sizeUsd: 1000, price: 50000, pnl: 200, timestamp: Date.now() });
      wm.recordTrade({ walletLabel: 'managed-client1', marketId: 'ETH', side: 'sell', sizeUsd: 500, price: 3000, pnl: -50, timestamp: Date.now() });

      expect(wm.getWallet('own-capital')!.isolatedPnl).toBe(200);
      expect(wm.getWallet('managed-client1')!.isolatedPnl).toBe(-50);
      expect(wm.getWallet('own-capital')!.currentBalance).toBe(50200);
      expect(wm.getWallet('managed-client1')!.currentBalance).toBe(99950);
    });
  });

  describe('summary', () => {
    it('should return correct summary across all wallets', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'own-capital', 50000);
      wm.registerWallet('0xdef', 'managed-client1', 100000);
      wm.registerWallet('0xghi', 'managed-client2', 75000);

      const summary = wm.getSummary();
      expect(summary.totalWallets).toBe(3);
      expect(summary.totalCapital).toBe(225000);
      expect(summary.ownCapital).not.toBeNull();
      expect(summary.managedWallets.length).toBe(2);
    });
  });

  describe('trade history', () => {
    it('should track trades per wallet', () => {
      const wm = new WalletManager();
      wm.registerWallet('0xabc', 'own-capital', 50000);

      wm.recordTrade({ walletLabel: 'own-capital', marketId: 'BTC', side: 'buy', sizeUsd: 1000, price: 50000, pnl: 100, timestamp: 1 });
      wm.recordTrade({ walletLabel: 'own-capital', marketId: 'ETH', side: 'sell', sizeUsd: 500, price: 3000, pnl: -20, timestamp: 2 });

      const history = wm.getTradeHistory('own-capital');
      expect(history.length).toBe(2);
      expect(history[0].marketId).toBe('BTC');
    });
  });
});
