/**
 * Polar Payment Handler
 * Handle payment events from Polar.sh
 */

import { PaymentService } from '../../../../billing/payment-service';

interface PolarPaymentData {
  id: string;
  amount: number;
  currency: string;
  status: string;
  customer_email?: string;
  subscription_id?: string;
}

export async function handlePaymentSuccess(
  data: PolarPaymentData,
  paymentService: PaymentService
): Promise<void> {
  await paymentService.recordPaymentSuccess(
    data.id,
    data.customer_email || '',
    data.amount,
    data.currency,
    data.subscription_id
  );
}

export async function handlePaymentFailed(
  data: PolarPaymentData,
  paymentService: PaymentService
): Promise<void> {
  await paymentService.recordPaymentFailed(
    data.id,
    data.customer_email || '',
    data.amount,
    data.currency,
    data.subscription_id
  );
}
