/**
 * NOWPayments Checkout Handler
 * Placeholder for checkout tracking — NOWPayments uses pre-created invoices
 */

import { NowPaymentsIpnPayload } from '../../../../billing/nowpayments-service';

/**
 * Track intermediate payment states (waiting, confirming, etc.)
 * No subscription action needed for intermediate states.
 */
export async function handleIpnIntermediate(ipn: NowPaymentsIpnPayload): Promise<void> {
  // Log intermediate status for monitoring — no action required
}
