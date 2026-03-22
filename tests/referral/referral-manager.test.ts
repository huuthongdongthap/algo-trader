import { describe, it, expect, vi } from 'vitest';
import { ReferralManager } from '../../src/referral/referral-manager.js';
import type { ReferralStore } from '../../src/referral/referral-store.js';
import type { RewardCalculator } from '../../src/referral/reward-calculator.js';

function makeMockStore(): ReferralStore {
  const codes = new Map<string, any>();
  const links: any[] = [];
  return {
    getCodeByValue: vi.fn((code: string) => codes.get(code) ?? null),
    saveCode: vi.fn((code: string, ownerId: string, maxUses: number) => {
      codes.set(code, { code, owner_id: ownerId, created_at: Date.now(), usage_count: 0, max_uses: maxUses, active: 1 });
    }),
    getCodesForOwner: vi.fn(() => []),
    incrementUsage: vi.fn((code: string) => {
      const c = codes.get(code);
      if (c) c.usage_count++;
    }),
    deactivateCode: vi.fn((code: string) => {
      const c = codes.get(code);
      if (c) c.active = 0;
    }),
    saveLink: vi.fn((referrerId, refereeId, code) => {
      links.push({ referrer_id: referrerId, referee_id: refereeId, code, created_at: Date.now() });
    }),
    getLinkForReferee: vi.fn(() => null),
    getLinksForReferrer: vi.fn(() => links),
    getPayoutsForReferrer: vi.fn(() => []),
    savePayout: vi.fn(() => 1),
    getPendingPayouts: vi.fn(() => []),
    markPayoutPaid: vi.fn(),
  } as unknown as ReferralStore;
}

function makeMockCalc(): RewardCalculator {
  return {} as unknown as RewardCalculator;
}

describe('ReferralManager', () => {
  describe('generateCode', () => {
    it('should generate 8-char alphanumeric code', () => {
      const store = makeMockStore();
      const mgr = new ReferralManager(store, makeMockCalc());
      const code = mgr.generateCode('user-1');
      expect(code.code).toHaveLength(8);
      expect(code.ownerId).toBe('user-1');
      expect(code.active).toBe(true);
      expect(code.usageCount).toBe(0);
    });

    it('should set maxUses', () => {
      const store = makeMockStore();
      const mgr = new ReferralManager(store, makeMockCalc());
      const code = mgr.generateCode('user-1', 50);
      expect(code.maxUses).toBe(50);
    });
  });

  describe('redeemCode', () => {
    it('should redeem valid code', () => {
      const store = makeMockStore();
      const mgr = new ReferralManager(store, makeMockCalc());
      mgr.generateCode('owner-1');
      const code = (store.getCodeByValue as any).mock.results[0]?.value?.code
        ?? (store.saveCode as any).mock.calls[0][0];
      // Manually set up the stored code for getCodeByValue
      const storedCode = { code, owner_id: 'owner-1', created_at: Date.now(), usage_count: 0, max_uses: 100, active: 1 };
      (store.getCodeByValue as any).mockReturnValue(storedCode);

      const link = mgr.redeemCode(code, 'new-user-1');
      expect(link.referrerId).toBe('owner-1');
      expect(link.refereeId).toBe('new-user-1');
      expect(store.saveLink).toHaveBeenCalled();
      expect(store.incrementUsage).toHaveBeenCalledWith(code);
    });

    it('should throw for unknown code', () => {
      const store = makeMockStore();
      (store.getCodeByValue as any).mockReturnValue(null);
      const mgr = new ReferralManager(store, makeMockCalc());
      expect(() => mgr.redeemCode('INVALID', 'user-1')).toThrow('not found');
    });

    it('should throw for inactive code', () => {
      const store = makeMockStore();
      (store.getCodeByValue as any).mockReturnValue({ code: 'X', owner_id: 'o', active: false, usage_count: 0, max_uses: 100 });
      const mgr = new ReferralManager(store, makeMockCalc());
      expect(() => mgr.redeemCode('X', 'user-1')).toThrow('inactive');
    });

    it('should throw for exhausted code', () => {
      const store = makeMockStore();
      (store.getCodeByValue as any).mockReturnValue({ code: 'X', owner_id: 'o', active: 1, usage_count: 100, max_uses: 100 });
      const mgr = new ReferralManager(store, makeMockCalc());
      expect(() => mgr.redeemCode('X', 'user-1')).toThrow('exhausted');
    });

    it('should throw for self-referral', () => {
      const store = makeMockStore();
      (store.getCodeByValue as any).mockReturnValue({ code: 'X', owner_id: 'user-1', active: 1, usage_count: 0, max_uses: 100 });
      const mgr = new ReferralManager(store, makeMockCalc());
      expect(() => mgr.redeemCode('X', 'user-1')).toThrow('own referral');
    });

    it('should throw for double redemption', () => {
      const store = makeMockStore();
      (store.getCodeByValue as any).mockReturnValue({ code: 'X', owner_id: 'o', active: 1, usage_count: 0, max_uses: 100 });
      (store.getLinkForReferee as any).mockReturnValue({ referrer_id: 'o', referee_id: 'user-1' });
      const mgr = new ReferralManager(store, makeMockCalc());
      expect(() => mgr.redeemCode('X', 'user-1')).toThrow('already redeemed');
    });
  });

  describe('deactivateCode', () => {
    it('should call store.deactivateCode', () => {
      const store = makeMockStore();
      (store.getCodeByValue as any).mockReturnValue({ code: 'X', owner_id: 'o', active: 1 });
      const mgr = new ReferralManager(store, makeMockCalc());
      mgr.deactivateCode('X');
      expect(store.deactivateCode).toHaveBeenCalledWith('X');
    });

    it('should throw for unknown code', () => {
      const store = makeMockStore();
      (store.getCodeByValue as any).mockReturnValue(null);
      const mgr = new ReferralManager(store, makeMockCalc());
      expect(() => mgr.deactivateCode('NOPE')).toThrow('not found');
    });
  });
});
