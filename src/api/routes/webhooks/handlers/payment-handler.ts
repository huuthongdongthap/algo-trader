/**
 * NOWPayments Payment Handler
 * Handle payment events from NOWPayments IPN with idempotency
 */

import { PaymentService } from '../../../../billing/payment-service';
import { NowPaymentsIpnPayload } from '../../../../billing/nowpayments-service';

/**
 * Record successful payment (IPN status=finished)
 * Idempotent: skips if payment_id already recorded
 */
export async function handleIpnPaymentSuccess(
  ipn: NowPaymentsIpnPayload,
  paymentService: PaymentService
): Promise<void> {
  const existing = await paymentService.getPaymentByProviderId(ipn.payment_id);
  if (existing) return;

  await paymentService.recordPaymentSuccess(
    ipn.payment_id,
    ipn.order_id || '',
    ipn.price_amount,
    ipn.price_currency,
    ipn.invoice_id
  );
}

/**
 * Record failed payment (IPN status=failed/expired/refunded)
 * Idempotent: skips if payment_id already recorded
 */
export async function handleIpnPaymentFailed(
  ipn: NowPaymentsIpnPayload,
  paymentService: PaymentService
): Promise<void> {
  const existing = await paymentService.getPaymentByProviderId(ipn.payment_id);
  if (existing) return;

  await paymentService.recordPaymentFailed(
    ipn.payment_id,
    ipn.order_id || '',
    ipn.price_amount,
    ipn.price_currency,
    ipn.invoice_id
  );
}
