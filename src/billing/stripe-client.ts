// Stripe API client using native fetch — NO Stripe SDK
// Uses Basic Auth with Bearer token and application/x-www-form-urlencoded body

const STRIPE_BASE = 'https://api.stripe.com';

// --- Response types ---

export interface StripeCustomer {
  id: string;
  object: 'customer';
  email: string;
  name: string | null;
  created: number;
}

export interface StripeSubscription {
  id: string;
  object: 'subscription';
  customer: string;
  status: 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete' | 'unpaid';
  current_period_end: number;
  cancel_at_period_end: boolean;
  items: {
    data: Array<{
      id: string;
      price: { id: string };
    }>;
  };
}

export interface StripeError {
  error: {
    code: string;
    message: string;
    type: string;
  };
}

// --- Client ---

export class StripeClient {
  private readonly authHeader: string;

  constructor(private readonly apiKey: string) {
    // Stripe uses HTTP Basic Auth: apiKey as username, empty password
    this.authHeader = `Basic ${Buffer.from(`${apiKey}:`).toString('base64')}`;
  }

  /** Encode an object as application/x-www-form-urlencoded */
  private encode(params: Record<string, string>): string {
    return Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
  }

  /** Generic request helper */
  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: Record<string, string>,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: this.authHeader,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    };

    if (body && (method === 'POST' || method === 'DELETE')) {
      init.body = this.encode(body);
    }

    const res = await fetch(`${STRIPE_BASE}${path}`, init);
    const data = (await res.json()) as T | StripeError;

    if (!res.ok) {
      const err = data as StripeError;
      throw new Error(`Stripe ${method} ${path} failed: ${err.error?.message ?? res.statusText}`);
    }

    return data as T;
  }

  /**
   * Create a Stripe customer
   * POST /v1/customers
   */
  async createCustomer(email: string, name: string): Promise<StripeCustomer> {
    return this.request<StripeCustomer>('POST', '/v1/customers', { email, name });
  }

  /**
   * Create a subscription for an existing customer
   * POST /v1/subscriptions
   */
  async createSubscription(customerId: string, priceId: string): Promise<StripeSubscription> {
    return this.request<StripeSubscription>('POST', '/v1/subscriptions', {
      customer: customerId,
      'items[0][price]': priceId,
    });
  }

  /**
   * Cancel a subscription immediately
   * DELETE /v1/subscriptions/{id}
   */
  async cancelSubscription(subId: string): Promise<StripeSubscription> {
    return this.request<StripeSubscription>('DELETE', `/v1/subscriptions/${subId}`);
  }

  /**
   * Retrieve a subscription by ID
   * GET /v1/subscriptions/{id}
   */
  async getSubscription(subId: string): Promise<StripeSubscription> {
    return this.request<StripeSubscription>('GET', `/v1/subscriptions/${subId}`);
  }

  /**
   * Update a subscription's price (for upgrades/downgrades)
   * POST /v1/subscriptions/{id}
   */
  async updateSubscription(subId: string, itemId: string, newPriceId: string): Promise<StripeSubscription> {
    return this.request<StripeSubscription>('POST', `/v1/subscriptions/${subId}`, {
      'items[0][id]': itemId,
      'items[0][price]': newPriceId,
    });
  }
}
