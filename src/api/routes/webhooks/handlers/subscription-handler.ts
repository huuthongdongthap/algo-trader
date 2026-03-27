/**
 * Polar Subscription Handler
 * Handle subscription lifecycle events from Polar.sh
 */

import { SubscriptionService } from '../../../../billing/subscription-service';
import { LicenseService } from '../../../../billing/license-service';
import { AuditLogService } from '../../../../audit/audit-log-service';
import { LicenseTier } from '../../../../types/license';

interface PolarSubscriptionData {
  id: string;
  product_id: string;
  customer_email: string;
  status: string;
  current_period_start: string;
  current_period_end: string;
  amount?: number;
  currency?: string;
}

export async function handleSubscriptionCreated(
  data: PolarSubscriptionData,
  subscriptionService: SubscriptionService,
  auditService: AuditLogService
): Promise<void> {
  const tier = mapProductToTier(data.product_id);

  await subscriptionService.createSubscription({
    polarSubscriptionId: data.id,
    customerEmail: data.customer_email,
    productId: data.product_id,
    status: 'pending',
    tier,
    currentPeriodStart: data.current_period_start,
    currentPeriodEnd: data.current_period_end,
    amount: data.amount,
    currency: data.currency,
  });

  await auditService.log(data.customer_email, 'created', {
    metadata: {
      eventType: 'subscription_created',
      subscriptionId: data.id,
      tier,
    },
  });
}

export async function handleSubscriptionActive(
  data: PolarSubscriptionData,
  subscriptionService: SubscriptionService,
  licenseService: LicenseService,
  auditService: AuditLogService
): Promise<void> {
  let subscription = await subscriptionService.getSubscriptionByPolarId(data.id);

  if (!subscription) {
    const tier = mapProductToTier(data.product_id);
    subscription = await subscriptionService.createSubscription({
      polarSubscriptionId: data.id,
      customerEmail: data.customer_email,
      productId: data.product_id,
      status: 'active',
      tier,
      currentPeriodStart: data.current_period_start,
      currentPeriodEnd: data.current_period_end,
      amount: data.amount,
      currency: data.currency,
    });
  }

  const activated = await subscriptionService.activateSubscription(subscription.id);

  await auditService.log(activated?.licenseId || data.customer_email, 'activated', {
    metadata: {
      eventType: 'subscription_activated',
      subscriptionId: data.id,
      tier: subscription.tier,
    },
  });
}

export async function handleSubscriptionUpdated(
  data: PolarSubscriptionData,
  subscriptionService: SubscriptionService,
  licenseService: LicenseService
): Promise<void> {
  const subscription = await subscriptionService.getSubscriptionByPolarId(data.id);
  if (subscription) {
    const newTier = mapProductToTier(data.product_id);
    await subscriptionService.updateSubscriptionTier(subscription.id, newTier);
  }
}

export async function handleSubscriptionCancelled(
  data: PolarSubscriptionData,
  subscriptionService: SubscriptionService
): Promise<void> {
  const subscription = await subscriptionService.getSubscriptionByPolarId(data.id);
  if (subscription) {
    await subscriptionService.cancelSubscription(subscription.id);
  }
}

function mapProductToTier(productId: string): LicenseTier {
  if (productId.includes('enterprise')) return LicenseTier.ENTERPRISE;
  if (productId.includes('pro') || productId.includes('professional')) return LicenseTier.PRO;
  return LicenseTier.FREE;
}
