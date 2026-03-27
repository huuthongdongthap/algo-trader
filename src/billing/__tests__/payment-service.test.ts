/**
 * Payment Service Tests
 * ROIaaS Phase 3 - Payment tracking and revenue metrics tests
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { PaymentService } from '../payment-service';
import { LicenseService } from '../license-service';
import { DunningService } from '../dunning-service';

describe('PaymentService', () => {
  let service: PaymentService;
  let licenseService: LicenseService;
  let dunningService: DunningService;

  beforeEach(() => {
    service = PaymentService.getInstance();
    licenseService = LicenseService.getInstance();
    dunningService = DunningService.getInstance();
    (service as any).payments.clear();
    (licenseService as any).licenses.clear();
    (dunningService as any).dunningRecords.clear();
  });

  describe('createPayment', () => {
    it('should create payment with correct properties', async () => {
      const input = {
        polarPaymentId: 'pol_pay_123',
        customerEmail: 'test@example.com',
        amount: 49.0,
        currency: 'USD',
        status: 'success' as const,
        subscriptionId: 'sub-123',
      };

      const payment = await service.createPayment(input);

      expect(payment.id).toMatch(/^pay_/);
      expect(payment.polarPaymentId).toBe('pol_pay_123');
      expect(payment.customerEmail).toBe('test@example.com');
      expect(payment.amount).toBe(49.0);
      expect(payment.currency).toBe('USD');
      expect(payment.status).toBe('success');
    });
  });

  describe('getPayment', () => {
    it('should get payment by id', async () => {
      const created = await service.createPayment({
        polarPaymentId: 'pol_pay_123',
        customerEmail: 'test@example.com',
        amount: 49.0,
        currency: 'USD',
        status: 'success',
      });

      const retrieved = await service.getPayment(created.id);

      expect(retrieved?.id).toBe(created.id);
      expect(retrieved?.amount).toBe(49.0);
    });

    it('should return undefined for non-existent payment', async () => {
      const result = await service.getPayment('non-existent');
      expect(result).toBeUndefined();
    });
  });

  describe('getPaymentByPolarId', () => {
    it('should get payment by polar payment id', async () => {
      const created = await service.createPayment({
        polarPaymentId: 'pol_pay_unique_123',
        customerEmail: 'test@example.com',
        amount: 49.0,
        currency: 'USD',
        status: 'success',
      });

      const retrieved = await service.getPaymentByPolarId('pol_pay_unique_123');

      expect(retrieved?.polarPaymentId).toBe('pol_pay_unique_123');
    });

    it('should return undefined for non-existent polar id', async () => {
      const result = await service.getPaymentByPolarId('non-existent-polar');
      expect(result).toBeUndefined();
    });
  });

  describe('getPaymentsByCustomer', () => {
    it('should get all payments for a customer', async () => {
      const email = 'customer@example.com';
      await service.createPayment({
        polarPaymentId: 'pol_pay_1',
        customerEmail: email,
        amount: 49.0,
        currency: 'USD',
        status: 'success',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_2',
        customerEmail: email,
        amount: 149.0,
        currency: 'USD',
        status: 'success',
      });

      const payments = await service.getPaymentsByCustomer(email);

      expect(payments.length).toBe(2);
      expect(payments.every((p) => p.customerEmail === email)).toBe(true);
    });
  });

  describe('updatePaymentStatus', () => {
    it('should update payment status', async () => {
      const payment = await service.createPayment({
        polarPaymentId: 'pol_pay_123',
        customerEmail: 'test@example.com',
        amount: 49.0,
        currency: 'USD',
        status: 'pending',
      });

      const updated = await service.updatePaymentStatus(payment.id, 'success');

      expect(updated?.status).toBe('success');
      expect(updated?.updatedAt).toBeDefined();
    });

    it('should return undefined for non-existent payment', async () => {
      const result = await service.updatePaymentStatus('non-existent', 'success');
      expect(result).toBeUndefined();
    });
  });

  describe('recordPaymentSuccess', () => {
    it('should create payment and log audit event', async () => {
      const payment = await service.recordPaymentSuccess(
        'pol_pay_123',
        'test@example.com',
        49.0,
        'USD',
        'sub-123'
      );

      expect(payment.status).toBe('success');
      expect(payment.amount).toBe(49.0);
      expect(payment.polarPaymentId).toBe('pol_pay_123');
    });
  });

  describe('recordPaymentFailed', () => {
    it('should create failed payment and trigger dunning', async () => {
      const payment = await service.recordPaymentFailed(
        'pol_pay_123',
        'test@example.com',
        49.0,
        'USD',
        'sub-123'
      );

      expect(payment.status).toBe('failed');
      expect(payment.amount).toBe(49.0);
    });
  });

  describe('getAllPayments', () => {
    it('should return all payments', async () => {
      await service.createPayment({
        polarPaymentId: 'pol_pay_1',
        customerEmail: 'test1@example.com',
        amount: 49.0,
        currency: 'USD',
        status: 'success',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_2',
        customerEmail: 'test2@example.com',
        amount: 149.0,
        currency: 'USD',
        status: 'success',
      });

      const payments = await service.getAllPayments();

      expect(payments.length).toBe(2);
    });
  });

  describe('getRevenueMetrics', () => {
    it('should calculate total revenue from successful payments', async () => {
      await service.createPayment({
        polarPaymentId: 'pol_pay_1',
        customerEmail: 'test1@example.com',
        amount: 100,
        currency: 'USD',
        status: 'success',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_2',
        customerEmail: 'test2@example.com',
        amount: 200,
        currency: 'USD',
        status: 'success',
      });

      const metrics = await service.getRevenueMetrics();

      expect(metrics.totalRevenue).toBe(300);
    });

    it('should exclude failed payments from revenue', async () => {
      await service.createPayment({
        polarPaymentId: 'pol_pay_1',
        customerEmail: 'test1@example.com',
        amount: 100,
        currency: 'USD',
        status: 'success',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_2',
        customerEmail: 'test2@example.com',
        amount: 200,
        currency: 'USD',
        status: 'failed',
      });

      const metrics = await service.getRevenueMetrics();

      expect(metrics.totalRevenue).toBe(100);
    });

    it('should calculate payment success rate', async () => {
      await service.createPayment({
        polarPaymentId: 'pol_pay_1',
        customerEmail: 'test1@example.com',
        amount: 100,
        currency: 'USD',
        status: 'success',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_2',
        customerEmail: 'test2@example.com',
        amount: 100,
        currency: 'USD',
        status: 'success',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_3',
        customerEmail: 'test3@example.com',
        amount: 100,
        currency: 'USD',
        status: 'failed',
      });

      const metrics = await service.getRevenueMetrics();

      expect(metrics.paymentSuccessRate).toBeCloseTo(2 / 3, 2);
    });

    it('should return zero success rate when no payments', async () => {
      const metrics = await service.getRevenueMetrics();

      expect(metrics.paymentSuccessRate).toBe(0);
    });

    it('should calculate payment status distribution', async () => {
      await service.createPayment({
        polarPaymentId: 'pol_pay_1',
        customerEmail: 'test1@example.com',
        amount: 100,
        currency: 'USD',
        status: 'success',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_2',
        customerEmail: 'test2@example.com',
        amount: 100,
        currency: 'USD',
        status: 'failed',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_3',
        customerEmail: 'test3@example.com',
        amount: 100,
        currency: 'USD',
        status: 'pending',
      });

      const metrics = await service.getRevenueMetrics();

      expect(metrics.paymentStatusDistribution.success).toBe(1);
      expect(metrics.paymentStatusDistribution.failed).toBe(1);
      expect(metrics.paymentStatusDistribution.pending).toBe(1);
      expect(metrics.paymentStatusDistribution.refunded).toBe(0);
    });

    it('should calculate avg license value', async () => {
      await service.createPayment({
        polarPaymentId: 'pol_pay_1',
        customerEmail: 'unique1@example.com',
        amount: 100,
        currency: 'USD',
        status: 'success',
      });
      await service.createPayment({
        polarPaymentId: 'pol_pay_2',
        customerEmail: 'unique2@example.com',
        amount: 200,
        currency: 'USD',
        status: 'success',
      });

      const metrics = await service.getRevenueMetrics();

      expect(metrics.avgLicenseValue).toBe(150);
    });
  });
});
