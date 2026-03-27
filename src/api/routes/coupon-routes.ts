/**
 * Coupon API Routes
 * POST /api/coupons          — Admin: create coupon
 * GET  /api/coupons          — Admin: list coupons
 * POST /api/coupons/apply    — Customer: apply coupon → get NOWPayments checkout URL
 * DELETE /api/coupons/:code  — Admin: deactivate coupon
 */

import { Router, Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { CouponService } from '../../billing/coupon-service';
import { logger } from '../../utils/logger';

// All tiers across all projects (shared NOWPayments account)
const TIER_PRICES: Record<string, Record<string, { price: number; invoiceId: string }>> = {
  cashclaw: {
    STARTER: { price: 49, invoiceId: '4725459350' },
    PRO: { price: 149, invoiceId: '5493882802' },
    ELITE: { price: 499, invoiceId: '5264305182' },
  },
  openclaw: {
    STARTER: { price: 49, invoiceId: '6245075877' },
    PRO: { price: 149, invoiceId: '5438578229' },
    GROWTH: { price: 399, invoiceId: '5749708735' },
    PREMIUM: { price: 799, invoiceId: '4598891970' },
    MASTER: { price: 4999, invoiceId: '4296538179' },
  },
  sophia: {
    BASIC: { price: 199, invoiceId: '5710519960' },
    STARTER: { price: 199, invoiceId: '5710519960' },
    PREMIUM: { price: 399, invoiceId: '4559269964' },
    GROWTH: { price: 399, invoiceId: '4559269964' },
    ENTERPRISE: { price: 799, invoiceId: '6336799275' },
    MASTER: { price: 4999, invoiceId: '5589879034' },
  },
  mekong: {
    STARTER: { price: 49, invoiceId: '6245075877' },
    PRO: { price: 149, invoiceId: '5438578229' },
  },
};

// Project success/cancel URLs
const PROJECT_URLS: Record<string, { success: string; cancel: string }> = {
  cashclaw: { success: 'https://cashclaw.cc/dashboard.html', cancel: 'https://cashclaw.cc/#pricing' },
  openclaw: { success: 'https://agencyos.network/dashboard', cancel: 'https://agencyos.network/pricing' },
  sophia: { success: 'https://sophia.agencyos.network/dashboard', cancel: 'https://sophia.agencyos.network/pricing' },
  mekong: { success: 'https://raas-landing.pages.dev/', cancel: 'https://raas-landing.pages.dev/' },
};

const NOWPAYMENTS_API_KEY = process.env.NOWPAYMENTS_API_KEY || '';

// Express admin auth middleware — timing-safe API key validation
function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const adminKeys = (process.env.ADMIN_API_KEYS || '').split(',').filter(Boolean);
  const defaultKey = process.env.ADMIN_API_KEY;
  if (defaultKey) adminKeys.push(defaultKey);

  const apiKey = req.headers['x-api-key'] as string | undefined;
  if (!apiKey || apiKey.length === 0) {
    res.status(401).json({ error: 'Unauthorized — valid X-API-Key required' });
    return;
  }

  const match = adminKeys.some((key) => {
    if (key.length !== apiKey.length) return false;
    return timingSafeEqual(Buffer.from(key), Buffer.from(apiKey));
  });

  if (!match) {
    res.status(401).json({ error: 'Unauthorized — valid X-API-Key required' });
    return;
  }
  next();
}

export const couponRouter: Router = Router();
const couponService = CouponService.getInstance();

// Admin: create coupon (auth required)
couponRouter.post('/', requireAdmin, async (req: Request, res: Response) => {
  try {
    const coupon = couponService.createCoupon(req.body);
    return res.json({ success: true, coupon });
  } catch (err: any) {
    return res.status(400).json({ error: err.message });
  }
});

// Admin: list coupons (auth required)
couponRouter.get('/', requireAdmin, (_req: Request, res: Response) => {
  return res.json({ coupons: couponService.listCoupons() });
});

// Admin: deactivate coupon (auth required)
couponRouter.delete('/:code', requireAdmin, (req: Request, res: Response) => {
  const ok = couponService.deactivateCoupon(req.params.code as string);
  return res.json({ success: ok });
});

// Customer: apply coupon → create discounted NOWPayments invoice → return checkout URL
// Accepts: { code, tier, project? } — project defaults to "cashclaw"
couponRouter.post('/apply', async (req: Request, res: Response) => {
  const { code, tier, project } = req.body;
  if (!code || !tier) {
    return res.status(400).json({ error: 'code and tier required' });
  }

  const projectKey = (project || 'cashclaw').toLowerCase();
  const tierKey = tier.toUpperCase();
  const projectTiers = TIER_PRICES[projectKey];
  if (!projectTiers) {
    return res.status(400).json({ error: `Unknown project: ${projectKey}` });
  }
  const tierConfig = projectTiers[tierKey];
  if (!tierConfig) {
    const validTiers = Object.keys(projectTiers).join(', ');
    return res.status(400).json({ error: `Invalid tier for ${projectKey}. Use: ${validTiers}` });
  }

  const result = couponService.applyCoupon(code, tierKey, tierConfig.price);
  if (!result.valid) {
    return res.status(400).json({ error: result.error });
  }

  // 100% discount = free
  if (result.discountedPrice === 0) {
    couponService.recordUse(code);
    return res.json({
      success: true,
      discountPercent: result.discountPercent,
      originalPrice: tierConfig.price,
      finalPrice: 0,
      message: 'Free access granted',
      checkoutUrl: null,
    });
  }

  // Create discounted invoice via NOWPayments API
  const urls = PROJECT_URLS[projectKey] || PROJECT_URLS.cashclaw;
  try {
    const invoiceRes = await fetch('https://api.nowpayments.io/v1/invoice', {
      method: 'POST',
      headers: {
        'x-api-key': NOWPAYMENTS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        price_amount: result.discountedPrice,
        price_currency: 'usd',
        order_id: `${projectKey}_${tierKey}_coupon_${code}_${Date.now()}`,
        order_description: `${projectKey} ${tierKey} (${result.discountPercent}% off with ${code})`,
        success_url: urls.success,
        cancel_url: urls.cancel,
      }),
    });

    const invoice = await invoiceRes.json() as { id?: string };

    if (!invoice.id) {
      logger.error('[Coupon] NOWPayments invoice creation failed', invoice);
      return res.status(500).json({ error: 'Payment provider error' });
    }

    couponService.recordUse(code);
    return res.json({
      success: true,
      discountPercent: result.discountPercent,
      originalPrice: tierConfig.price,
      finalPrice: result.discountedPrice,
      checkoutUrl: `https://nowpayments.io/payment?iid=${invoice.id}`,
    });
  } catch (err) {
    logger.error('[Coupon] Invoice creation error', { err });
    return res.status(500).json({ error: 'Failed to create payment' });
  }
});
