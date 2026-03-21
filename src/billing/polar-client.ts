// Polar.sh API client using native fetch — NO @polar-sh/sdk
// Bearer token auth, JSON body — mirrors stripe-client.ts pattern

const POLAR_BASE = 'https://api.polar.sh/v1';

// --- Response types ---

export interface PolarProduct {
  id: string;
  name: string;
  description: string | null;
  is_recurring: boolean;
  prices: Array<{
    id: string;
    amount_type: 'fixed' | 'free';
    price_amount: number | null;
    price_currency: string;
    recurring_interval: 'month' | 'year' | null;
  }>;
  benefits: Array<{ id: string; description: string }>;
}

export interface PolarSubscription {
  id: string;
  status: 'active' | 'canceled' | 'incomplete' | 'past_due' | 'trialing' | 'unpaid';
  customer_id: string;
  product_id: string;
  price_id: string;
  current_period_end: string | null; // ISO 8601
  cancel_at_period_end: boolean;
}

export interface PolarCheckout {
  id: string;
  url: string;
  status: 'open' | 'confirmed' | 'succeeded' | 'failed';
  customer_email: string | null;
  product_price_id: string;
}

export interface PolarCustomer {
  id: string;
  email: string;
  name: string | null;
  created_at: string;
}

interface PolarListResponse<T> {
  items: T[];
  pagination: { total_count: number; max_page: number };
}

// --- Client ---

export class PolarClient {
  constructor(private readonly apiKey: string) {}

  /** Generic JSON request helper */
  private async request<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<T> {
    const init: RequestInit = {
      method,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    };

    if (body && method === 'POST') {
      init.body = JSON.stringify(body);
    }

    const res = await fetch(`${POLAR_BASE}${path}`, init);

    if (!res.ok) {
      let message = res.statusText;
      try {
        const errBody = (await res.json()) as { detail?: string; message?: string };
        message = errBody.detail ?? errBody.message ?? message;
      } catch {
        // ignore parse errors
      }
      throw new Error(`Polar ${method} ${path} failed (${res.status}): ${message}`);
    }

    return res.json() as Promise<T>;
  }

  /**
   * Create a hosted checkout session for a price.
   * POST /v1/checkouts/custom
   */
  async createCheckout(
    priceId: string,
    successUrl: string,
    customerEmail: string,
  ): Promise<PolarCheckout> {
    return this.request<PolarCheckout>('POST', '/checkouts/custom', {
      product_price_id: priceId,
      success_url: successUrl,
      customer_email: customerEmail,
    });
  }

  /**
   * Retrieve a subscription by ID.
   * GET /v1/subscriptions/{id}
   */
  async getSubscription(subId: string): Promise<PolarSubscription> {
    return this.request<PolarSubscription>('GET', `/subscriptions/${subId}`);
  }

  /**
   * Cancel a subscription at period end.
   * POST /v1/subscriptions/{id}/cancel
   */
  async cancelSubscription(subId: string): Promise<PolarSubscription> {
    return this.request<PolarSubscription>('POST', `/subscriptions/${subId}/cancel`);
  }

  /**
   * List all available products (plans).
   * GET /v1/products
   */
  async listProducts(): Promise<PolarProduct[]> {
    const res = await this.request<PolarListResponse<PolarProduct>>('GET', '/products');
    return res.items;
  }

  /**
   * Find a customer by email address.
   * GET /v1/customers?email=
   * Returns null when no customer found.
   */
  async getCustomerByEmail(email: string): Promise<PolarCustomer | null> {
    const encoded = encodeURIComponent(email);
    const res = await this.request<PolarListResponse<PolarCustomer>>(
      'GET',
      `/customers?email=${encoded}`,
    );
    return res.items[0] ?? null;
  }
}
