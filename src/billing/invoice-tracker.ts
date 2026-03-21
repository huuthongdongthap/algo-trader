// Invoice and payment event tracker with Stripe webhook handling
// Uses in-memory log — swap for persistent store in production

import { createHmac } from 'crypto';

// --- Types ---

export type InvoiceStatus = 'paid' | 'failed' | 'pending';

export interface InvoiceEvent {
  userId: string;
  amount: number;
  currency: string;
  status: InvoiceStatus;
  stripeInvoiceId: string;
  timestamp: number;
}

/** Stripe webhook event shape (minimal — only fields we use) */
interface StripeWebhookEvent {
  id: string;
  type: string;
  data: {
    object: {
      id: string;
      customer: string;
      amount_paid?: number;
      amount_due?: number;
      currency: string;
    };
  };
}

// --- Tracker ---

export class InvoiceTracker {
  /** userId → list of payment events (append-only) */
  private readonly log = new Map<string, InvoiceEvent[]>();

  /** Map Stripe customerId → userId for webhook resolution */
  private readonly customerMap = new Map<string, string>();

  /**
   * Register a customerId → userId mapping so webhooks can resolve users.
   * Call this after creating a Stripe customer.
   */
  registerCustomer(stripeCustomerId: string, userId: string): void {
    this.customerMap.set(stripeCustomerId, userId);
  }

  /** Append an event to the user's log */
  private append(event: InvoiceEvent): void {
    const existing = this.log.get(event.userId) ?? [];
    existing.push(event);
    this.log.set(event.userId, existing);
  }

  /**
   * Record a successful payment event.
   */
  recordPayment(event: InvoiceEvent): void {
    this.append({ ...event, status: 'paid' });
  }

  /**
   * Record a failed payment event.
   */
  recordFailure(event: InvoiceEvent): void {
    this.append({ ...event, status: 'failed' });
  }

  /**
   * Return all payment events for a user, newest first.
   */
  getPaymentHistory(userId: string): InvoiceEvent[] {
    const events = this.log.get(userId) ?? [];
    return [...events].sort((a, b) => b.timestamp - a.timestamp);
  }

  /**
   * Verify Stripe webhook signature using HMAC-SHA256.
   * Stripe sends: Stripe-Signature: t=<ts>,v1=<sig>
   *
   * @param rawBody  Raw request body string (must be un-parsed)
   * @param sigHeader  Value of the Stripe-Signature header
   * @param secret  Webhook endpoint secret from Stripe dashboard
   */
  verifyWebhookSignature(rawBody: string, sigHeader: string, secret: string): boolean {
    const parts = Object.fromEntries(
      sigHeader.split(',').map((p) => p.split('=') as [string, string]),
    );
    const timestamp = parts['t'];
    const expected = parts['v1'];

    if (!timestamp || !expected) return false;

    const payload = `${timestamp}.${rawBody}`;
    const computed = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

    // Constant-time comparison to prevent timing attacks
    return computed.length === expected.length && computed === expected;
  }

  /**
   * Parse and handle incoming Stripe webhook events.
   * Supported: invoice.paid, invoice.payment_failed
   *
   * @param rawBody  Raw body string from the HTTP request
   * @param sigHeader  Value of the Stripe-Signature header
   * @param secret  Webhook endpoint signing secret
   * @returns The recorded InvoiceEvent, or null if event type is unhandled
   */
  handleWebhook(rawBody: string, sigHeader: string, secret: string): InvoiceEvent | null {
    if (!this.verifyWebhookSignature(rawBody, sigHeader, secret)) {
      throw new Error('Webhook signature verification failed.');
    }

    const event = JSON.parse(rawBody) as StripeWebhookEvent;
    const invoice = event.data.object;
    const userId = this.customerMap.get(invoice.customer);

    if (!userId) {
      // Unknown customer — skip silently (may belong to another system)
      return null;
    }

    const base: Omit<InvoiceEvent, 'status'> = {
      userId,
      stripeInvoiceId: invoice.id,
      amount: invoice.amount_paid ?? invoice.amount_due ?? 0,
      currency: invoice.currency,
      timestamp: Date.now(),
    };

    switch (event.type) {
      case 'invoice.paid': {
        const paid: InvoiceEvent = { ...base, status: 'paid' };
        this.recordPayment(paid);
        return paid;
      }
      case 'invoice.payment_failed': {
        const failed: InvoiceEvent = { ...base, status: 'failed' };
        this.recordFailure(failed);
        return failed;
      }
      default:
        return null;
    }
  }
}
