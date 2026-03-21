// Onboarding API routes — quickstart guide + setup checklist for new users
import type { IncomingMessage, ServerResponse } from 'node:http';
import { sendJson } from './http-response-helpers.js';
import type { Tier } from '../users/subscription-tier.js';
import { TIER_CONFIG } from '../users/subscription-tier.js';

interface AuthedRequest extends IncomingMessage {
  user?: { id: string; email: string; tier: Tier };
}

/**
 * Handle /api/onboarding/* routes. Returns true if matched.
 */
export async function handleOnboardingRoutes(
  req: AuthedRequest,
  res: ServerResponse,
  pathname: string,
  method: string,
): Promise<boolean> {
  // GET /api/onboarding/quickstart
  if (pathname === '/api/onboarding/quickstart' && method === 'GET') {
    const tier = req.user?.tier ?? 'free';
    const limits = TIER_CONFIG[tier];

    sendJson(res, 200, {
      welcome: `Welcome to CashClaw! You're on the ${tier} plan.`,
      steps: [
        {
          step: 1,
          title: 'Save your API key',
          description: 'Your API key was shown after registration. Use it in the Authorization header: "ApiKey YOUR_KEY"',
          done: true,
        },
        {
          step: 2,
          title: 'Explore the dashboard',
          description: 'Visit /dashboard to see your trading overview, P&L chart, and strategy controls.',
          link: '/dashboard',
        },
        {
          step: 3,
          title: 'Start paper trading',
          description: 'All strategies run in paper mode by default — no real money at risk. Try starting a strategy from the dashboard.',
          link: '/api/strategy/start',
        },
        {
          step: 4,
          title: 'Connect a Telegram bot (optional)',
          description: 'Get real-time trade alerts on Telegram. Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in your environment.',
        },
        {
          step: 5,
          title: 'Upgrade for live trading',
          description: tier === 'free'
            ? 'Upgrade to Pro ($29/mo) or Enterprise ($199/mo) to unlock live trading, backtesting, and more strategies.'
            : 'You have access to live trading. Set LIVE_TRADING=true and add your exchange API keys.',
          link: tier === 'free' ? '/#pricing' : undefined,
        },
      ],
      tierInfo: {
        current: tier,
        maxStrategies: limits.maxStrategies === Infinity ? 'unlimited' : limits.maxStrategies,
        maxCapital: limits.maxCapital === Infinity ? 'unlimited' : `$${limits.maxCapital.toLocaleString()}`,
        features: limits.features,
        apiRateLimit: `${limits.apiRateLimit} req/min`,
      },
      apiDocs: '/api/docs',
    });
    return true;
  }

  return false;
}
