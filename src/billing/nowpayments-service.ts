/**
 * NOWPayments Crypto Payment Service
 * Replaces Polar.sh — USDT TRC20 payments via NOWPayments IPN
 *
 * Features:
 * - IPN signature verification (HMAC-SHA512)
 * - Invoice URL generation (pre-created invoices)
 * - Tier-to-invoice mapping
 * - Payment status checking via REST API
 */

import { logger } from '../utils/logger';
import { LicenseTier } from '../types/license';

// NOWPayments IPN payload from webhook
export interface NowPaymentsIpnPayload {
  payment_id: string;
  payment_status: NowPaymentsStatus;
  pay_address?: string;
  price_amount: number;
  price_currency: string;
  pay_amount?: number;
  pay_currency?: string;
  order_id?: string;
  order_description?: string;
  invoice_id?: string;
  actually_paid?: number;
  outcome_amount?: number;
  outcome_currency?: string;
}

export type NowPaymentsStatus =
  | 'waiting'
  | 'confirming'
  | 'confirmed'
  | 'sending'
  | 'partially_paid'
  | 'finished'
  | 'failed'
  | 'refunded'
  | 'expired';

// Tier configuration with pre-created invoice IDs from NOWPayments dashboard
export interface NowPaymentsTierConfig {
  tier: LicenseTier;
  invoiceId: string;
  price: number;
  currency: string;
  name: string;
}

// Configure invoice IDs from NOWPayments dashboard (customers set these in .env or config)
export const NOWPAYMENTS_TIERS: Record<string, NowPaymentsTierConfig> = {
  PRO: {
    tier: LicenseTier.PRO,
    invoiceId: process.env.NOWPAYMENTS_INVOICE_PRO || '',
    price: 99,
    currency: 'USD',
    name: 'Pro Trader',
  },
  ENTERPRISE: {
    tier: LicenseTier.ENTERPRISE,
    invoiceId: process.env.NOWPAYMENTS_INVOICE_ENTERPRISE || '',
    price: 299,
    currency: 'USD',
    name: 'Enterprise',
  },
};

export class NowPaymentsService {
  private static instance: NowPaymentsService;
  private apiKey: string;
  private ipnSecret: string;
  private baseUrl = 'https://api.nowpayments.io/v1';

  private constructor() {
    this.apiKey = process.env.NOWPAYMENTS_API_KEY || '';
    this.ipnSecret = process.env.NOWPAYMENTS_IPN_SECRET || '';

    if (!this.apiKey) {
      logger.warn('NOWPAYMENTS_API_KEY not configured - payment features disabled');
    }
    if (!this.ipnSecret) {
      logger.warn('NOWPAYMENTS_IPN_SECRET not configured - webhook verification disabled');
    }
  }

  static getInstance(): NowPaymentsService {
    if (!NowPaymentsService.instance) {
      NowPaymentsService.instance = new NowPaymentsService();
    }
    return NowPaymentsService.instance;
  }

  /**
   * Verify IPN webhook signature (HMAC-SHA512 over sorted JSON keys)
   */
  async verifyWebhook(rawBody: string, signature: string): Promise<boolean> {
    if (!this.ipnSecret) {
      logger.warn('NOWPAYMENTS_IPN_SECRET not configured');
      return false;
    }

    try {
      const parsed = JSON.parse(rawBody) as Record<string, unknown>;
      const sortedKeys = Object.keys(parsed).sort();
      const sorted = JSON.stringify(parsed, sortedKeys);

      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(this.ipnSecret),
        { name: 'HMAC', hash: 'SHA-512' },
        false,
        ['sign']
      );

      const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(sorted));
      const computed = Array.from(new Uint8Array(sig))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');

      return computed === signature;
    } catch (error) {
      logger.error('IPN signature verification failed:', { error });
      return false;
    }
  }

  /**
   * Generate checkout URL for a tier (pre-created invoice)
   */
  createCheckoutUrl(tierKey: string, customerRef: string): string | null {
    const config = NOWPAYMENTS_TIERS[tierKey];
    if (!config || !config.invoiceId) {
      logger.warn(`No invoice configured for tier: ${tierKey}`);
      return null;
    }

    const orderId = `algotrade_${customerRef}_${Date.now()}`;
    return `https://nowpayments.io/payment?iid=${config.invoiceId}&order_id=${orderId}`;
  }

  /**
   * Check payment status via NOWPayments API
   */
  async getPaymentStatus(paymentId: string): Promise<NowPaymentsIpnPayload | null> {
    if (!this.apiKey) return null;

    try {
      const res = await fetch(`${this.baseUrl}/payment/${paymentId}`, {
        headers: { 'x-api-key': this.apiKey },
      });

      if (!res.ok) {
        logger.error(`NOWPayments API error: ${res.status}`);
        return null;
      }

      return (await res.json()) as NowPaymentsIpnPayload;
    } catch (error) {
      logger.error('Failed to check payment status:', { error });
      return null;
    }
  }

  /**
   * Look up tier by invoice ID from IPN payload
   */
  getTierByInvoiceId(invoiceId: string): NowPaymentsTierConfig | null {
    return (
      Object.values(NOWPAYMENTS_TIERS).find((t) => t.invoiceId === invoiceId) ?? null
    );
  }

  /**
   * Parse customer reference from order_id (format: algotrade_{ref}_{timestamp})
   */
  parseCustomerRef(orderId: string): string | null {
    const parts = orderId.split('_');
    if (parts.length >= 3 && parts[0] === 'algotrade') {
      return parts.slice(1, -1).join('_');
    }
    return null;
  }

  /**
   * Map IPN status to internal action
   */
  getStatusAction(status: NowPaymentsStatus): 'activate' | 'cancel' | 'ignore' {
    switch (status) {
      case 'finished':
        return 'activate';
      case 'refunded':
        return 'cancel';
      case 'failed':
      case 'expired':
        return 'cancel';
      default:
        return 'ignore';
    }
  }
}
