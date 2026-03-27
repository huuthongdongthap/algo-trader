/**
 * Polar.sh API Client
 * ROIaaS Phase 2 - Payment provider integration
 */

import { Polar } from '@polar-sh/sdk';
import { logger } from '../utils/logger';

export interface PolarSubscription {
  id: string;
  product_id: string;
  customer_email: string;
  status: 'active' | 'cancelled' | 'expired';
  current_period_start: string;
  current_period_end: string;
  amount?: number;
  currency?: string;
}

export interface PolarCheckout {
  id: string;
  product_id: string;
  customer_email?: string;
  status: 'created' | 'completed' | 'abandoned';
  created_at: string;
}

export class PolarService {
  private static instance: PolarService;
  private client: Polar;
  private webhookSecret?: string;

  private constructor() {
    const apiKey = process.env.POLAR_API_KEY;
    if (!apiKey) {
      logger.warn('POLAR_API_KEY not configured - Polar features disabled');
      this.client = {} as Polar;
    } else {
      this.client = new Polar({
        accessToken: apiKey,
        server: 'production',
      });
    }
    this.webhookSecret = process.env.POLAR_WEBHOOK_SECRET;
  }

  static getInstance(): PolarService {
    if (!PolarService.instance) {
      PolarService.instance = new PolarService();
    }
    return PolarService.instance;
  }

  async verifyWebhook(payload: string, signature: string): Promise<boolean> {
    if (!this.webhookSecret) {
      logger.warn('POLAR_WEBHOOK_SECRET not configured');
      return false;
    }

    try {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(this.webhookSecret);
      const key = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['verify']
      );

      const signatureBuffer = Uint8Array.from(
        signature.replace('whsec_', ''),
        (c) => parseInt(c, 16)
      );

      const payloadData = encoder.encode(payload);

      const isValid = await crypto.subtle.verify(
        'HMAC',
        key,
        signatureBuffer,
        payloadData
      );

      return isValid;
    } catch (error) {
      logger.error('Webhook verification failed:', { error });
      return false;
    }
  }

  async getSubscription(subscriptionId: string): Promise<PolarSubscription | null> {
    try {
      const response = await this.client.subscriptions.get({ id: subscriptionId });
      return response as unknown as PolarSubscription;
    } catch (error) {
      logger.error('Failed to fetch subscription:', { error });
      return null;
    }
  }

  async listSubscriptions(customerEmail?: string): Promise<PolarSubscription[]> {
    try {
      const response = await this.client.subscriptions.list({});
      let subscriptions = (response as unknown as { results?: PolarSubscription[] }).results || [];

      if (customerEmail) {
        subscriptions = subscriptions.filter(
          (s) => s.customer_email === customerEmail
        );
      }

      return subscriptions;
    } catch (error) {
      logger.error('Failed to list subscriptions:', { error });
      return [];
    }
  }

  async createCheckout(productIds: string[], customerEmail?: string): Promise<PolarCheckout | null> {
    try {
      const response = await this.client.checkouts.create({
        productId: productIds[0],
        customerEmail: customerEmail,
      } as never);
      return response as unknown as PolarCheckout;
    } catch (error) {
      logger.error('Failed to create checkout:', { error });
      return null;
    }
  }
}
