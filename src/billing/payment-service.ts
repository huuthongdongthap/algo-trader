/**
 * Payment Service
 * Payment tracking and revenue metrics
 * Integrated with Dunning System for suspension/reinstatement
 * Provider: NOWPayments (USDT TRC20)
 */

import { AuditLogService } from '../audit/audit-log-service';
import { DunningService } from './dunning-service';
import { LicenseService } from './license-service';
import { RevenueMetricsCalculator } from './metrics/revenue-metrics';

export interface Payment {
  id: string;
  providerPaymentId: string;
  subscriptionId?: string;
  customerEmail: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  productId?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
}

export type PaymentStatus = 'pending' | 'success' | 'failed' | 'refunded';

export interface CreatePaymentInput {
  providerPaymentId: string;
  subscriptionId?: string;
  customerEmail: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  productId?: string;
  metadata?: Record<string, unknown>;
}

export interface RevenueMetrics {
  mrr: number;
  totalRevenue: number;
  avgLicenseValue: number;
  paymentSuccessRate: number;
  paymentStatusDistribution: PaymentStatusDistribution;
}

export interface PaymentStatusDistribution {
  success: number;
  failed: number;
  pending: number;
  refunded: number;
}

export class PaymentService {
  private static instance: PaymentService;
  private payments: Map<string, Payment> = new Map();
  private auditService: AuditLogService;
  private dunningService: DunningService;
  private licenseService: LicenseService;

  private constructor() {
    this.auditService = AuditLogService.getInstance();
    this.dunningService = DunningService.getInstance();
    this.licenseService = LicenseService.getInstance();
  }

  static getInstance(): PaymentService {
    if (!PaymentService.instance) PaymentService.instance = new PaymentService();
    return PaymentService.instance;
  }

  async createPayment(input: CreatePaymentInput): Promise<Payment> {
    const id = `pay_${this.generateId()}`;
    const now = new Date().toISOString();

    const payment: Payment = {
      id,
      providerPaymentId: input.providerPaymentId,
      subscriptionId: input.subscriptionId,
      customerEmail: input.customerEmail,
      amount: input.amount,
      currency: input.currency,
      status: input.status,
      productId: input.productId,
      createdAt: now,
      updatedAt: now,
      metadata: input.metadata,
    };

    this.payments.set(id, payment);
    return payment;
  }

  async getPayment(id: string): Promise<Payment | undefined> {
    return this.payments.get(id);
  }

  async getPaymentByProviderId(providerId: string): Promise<Payment | undefined> {
    for (const payment of this.payments.values()) {
      if (payment.providerPaymentId === providerId) return payment;
    }
    return undefined;
  }

  async getPaymentsByCustomer(customerEmail: string): Promise<Payment[]> {
    return Array.from(this.payments.values()).filter(
      (p) => p.customerEmail === customerEmail
    );
  }

  async updatePaymentStatus(id: string, status: PaymentStatus): Promise<Payment | undefined> {
    const payment = this.payments.get(id);
    if (!payment) return undefined;

    payment.status = status;
    payment.updatedAt = new Date().toISOString();
    this.payments.set(id, payment);
    return payment;
  }

  async recordPaymentSuccess(
    providerPaymentId: string,
    customerEmail: string,
    amount: number,
    currency: string,
    subscriptionId?: string
  ): Promise<Payment> {
    const payment = await this.createPayment({
      providerPaymentId,
      customerEmail,
      amount,
      currency,
      status: 'success',
      subscriptionId,
    });

    await this.handlePaymentResult(payment, subscriptionId, customerEmail, 'success');
    return payment;
  }

  async recordPaymentFailed(
    providerPaymentId: string,
    customerEmail: string,
    amount: number,
    currency: string,
    subscriptionId?: string
  ): Promise<Payment> {
    const payment = await this.createPayment({
      providerPaymentId,
      customerEmail,
      amount,
      currency,
      status: 'failed',
      subscriptionId,
    });

    await this.handlePaymentResult(payment, subscriptionId, customerEmail, 'failed');
    return payment;
  }

  private async handlePaymentResult(
    payment: Payment,
    subscriptionId: string | undefined,
    customerEmail: string,
    status: 'success' | 'failed'
  ): Promise<void> {
    if (subscriptionId) {
      const license = await this.licenseService.getLicenseBySubscription(subscriptionId);
      if (license) {
        const dunning = this.dunningService;
        status === 'success'
          ? await dunning.recordPaymentSuccess(license.id, customerEmail, subscriptionId)
          : await dunning.recordPaymentFailure(license.id, customerEmail, subscriptionId);
      }
    }

    await this.auditService.log(subscriptionId || customerEmail, 'created', {
      metadata: {
        eventType: status === 'success' ? 'payment_success' : 'payment_failed',
        amount: payment.amount,
        currency: payment.currency,
      },
    });
  }

  async getAllPayments(): Promise<Payment[]> {
    return Array.from(this.payments.values());
  }

  async getRevenueMetrics(): Promise<RevenueMetrics> {
    const payments = Array.from(this.payments.values());
    return RevenueMetricsCalculator.calculate(payments);
  }

  private generateId(): string {
    return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
}
