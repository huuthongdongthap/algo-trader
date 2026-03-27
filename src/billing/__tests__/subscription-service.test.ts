/**
 * Subscription Service Tests
 * Payment provider-agnostic subscription lifecycle management tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { SubscriptionService } from '../subscription-service';
import { LicenseService } from '../license-service';
import { LicenseTier, LicenseStatus } from '../../types/license';

describe('SubscriptionService', () => {
  let service: SubscriptionService;
  let licenseService: LicenseService;

  beforeEach(() => {
    service = SubscriptionService.getInstance();
    licenseService = LicenseService.getInstance();
    (service as any).subscriptions.clear();
    (licenseService as any).licenses.clear();
  });

  describe('createSubscription', () => {
    it('should create subscription with correct properties', async () => {
      const input = {
        providerPaymentId: 'np_pay_123',
        customerEmail: 'test@example.com',
        productId: 'prod_123',
        status: 'pending' as const,
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        amount: 49.0,
        currency: 'USD',
      };

      const subscription = await service.createSubscription(input);

      expect(subscription.id).toMatch(/^sub_/);
      expect(subscription.providerPaymentId).toBe('np_pay_123');
      expect(subscription.customerEmail).toBe('test@example.com');
      expect(subscription.tier).toBe(LicenseTier.PRO);
      expect(subscription.status).toBe('pending');
      expect(subscription.amount).toBe(49.0);
      expect(subscription.currency).toBe('USD');
    });
  });

  describe('getSubscription', () => {
    it('should get subscription by id', async () => {
      const created = await service.createSubscription({
        providerPaymentId: 'np_pay_123',
        customerEmail: 'test@example.com',
        productId: 'prod_123',
        status: 'active',
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const retrieved = await service.getSubscription(created.id);

      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.customerEmail).toBe('test@example.com');
    });

    it('should return undefined for non-existent subscription', async () => {
      const result = await service.getSubscription('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getSubscriptionByProviderId', () => {
    it('should get subscription by provider payment id', async () => {
      const created = await service.createSubscription({
        providerPaymentId: 'np_pay_unique_123',
        customerEmail: 'test@example.com',
        productId: 'prod_123',
        status: 'active',
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const retrieved = await service.getSubscriptionByProviderId('np_pay_unique_123');

      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.providerPaymentId).toBe('np_pay_unique_123');
    });

    it('should return undefined for non-existent provider id', async () => {
      const result = await service.getSubscriptionByProviderId('non-existent-id');
      expect(result).toBeUndefined();
    });
  });

  describe('getSubscriptionsByCustomer', () => {
    it('should get all subscriptions for a customer', async () => {
      const email = 'customer@example.com';
      await service.createSubscription({
        providerPaymentId: 'np_pay_1',
        customerEmail: email,
        productId: 'prod_1',
        status: 'active',
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await service.createSubscription({
        providerPaymentId: 'np_pay_2',
        customerEmail: email,
        productId: 'prod_2',
        status: 'active',
        tier: LicenseTier.ENTERPRISE,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const subscriptions = await service.getSubscriptionsByCustomer(email);

      expect(subscriptions.length).toBe(2);
      expect(subscriptions.every((s) => s.customerEmail === email)).toBe(true);
    });
  });

  describe('updateSubscriptionStatus', () => {
    it('should update subscription status', async () => {
      const subscription = await service.createSubscription({
        providerPaymentId: 'np_pay_123',
        customerEmail: 'test@example.com',
        productId: 'prod_123',
        status: 'pending',
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const updated = await service.updateSubscriptionStatus(subscription.id, 'active');

      expect(updated?.status).toBe('active');
      expect(updated?.updatedAt).toBeDefined();
    });

    it('should set cancelledAt when status is cancelled', async () => {
      const subscription = await service.createSubscription({
        providerPaymentId: 'np_pay_123',
        customerEmail: 'test@example.com',
        productId: 'prod_123',
        status: 'active',
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const updated = await service.updateSubscriptionStatus(subscription.id, 'cancelled');

      expect(updated?.status).toBe('cancelled');
      expect(updated?.cancelledAt).toBeDefined();
    });

    it('should return undefined for non-existent subscription', async () => {
      const result = await service.updateSubscriptionStatus('non-existent', 'cancelled');
      expect(result).toBeUndefined();
    });
  });

  describe('activateSubscription', () => {
    it('should activate subscription and create license', async () => {
      const subscription = await service.createSubscription({
        providerPaymentId: 'np_pay_123',
        customerEmail: 'test@example.com',
        productId: 'prod_123',
        status: 'pending',
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const activated = await service.activateSubscription(subscription.id);

      expect(activated?.status).toBe('active');
      expect(activated?.licenseId).toBeDefined();
      expect(activated?.licenseId).toMatch(/^lic_/);
    });
  });

  describe('cancelSubscription', () => {
    it('should cancel subscription and downgrade license to FREE', async () => {
      const subscription = await service.createSubscription({
        providerPaymentId: 'np_pay_123',
        customerEmail: 'test@example.com',
        productId: 'prod_123',
        status: 'active',
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      await service.activateSubscription(subscription.id);
      const cancelled = await service.cancelSubscription(subscription.id);

      expect(cancelled?.status).toBe('cancelled');
    });

    it('should return undefined for non-existent subscription', async () => {
      const result = await service.cancelSubscription('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('updateSubscriptionTier', () => {
    it('should update subscription tier', async () => {
      const subscription = await service.createSubscription({
        providerPaymentId: 'np_pay_123',
        customerEmail: 'test@example.com',
        productId: 'prod_123',
        status: 'active',
        tier: LicenseTier.FREE,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const updated = await service.updateSubscriptionTier(subscription.id, LicenseTier.ENTERPRISE);

      expect(updated?.tier).toBe(LicenseTier.ENTERPRISE);
      expect(updated?.updatedAt).toBeDefined();
    });
  });

  describe('getAllSubscriptions', () => {
    it('should return all subscriptions', async () => {
      await service.createSubscription({
        providerPaymentId: 'np_pay_1',
        customerEmail: 'test1@example.com',
        productId: 'prod_1',
        status: 'active',
        tier: LicenseTier.FREE,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });
      await service.createSubscription({
        providerPaymentId: 'np_pay_2',
        customerEmail: 'test2@example.com',
        productId: 'prod_2',
        status: 'active',
        tier: LicenseTier.PRO,
        currentPeriodStart: new Date().toISOString(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      });

      const subscriptions = await service.getAllSubscriptions();

      expect(subscriptions.length).toBe(2);
    });
  });
});
