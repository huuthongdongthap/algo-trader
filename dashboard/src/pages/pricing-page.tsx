/**
 * Public pricing page. Full-page, no sidebar.
 * 3-column plan table + FAQ accordion.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PublicNavbar } from '../components/public-navbar';
import { Footer } from '../components/footer';

const PLANS = [
  {
    name: 'Free',
    price: '$0',
    sub: 'forever',
    href: '/signup?tier=free',
    cta: 'Get Started',
    highlight: false,
    features: [
      { label: 'Active strategies', value: '1' },
      { label: 'Trades per day', value: '5' },
      { label: 'Daily loss cap', value: '$50' },
      { label: 'Max position size', value: '$500' },
      { label: 'Market scanning', value: 'Basic' },
      { label: 'Safety limits', value: true },
      { label: 'API access', value: false },
      { label: 'Priority support', value: false },
    ],
  },
  {
    name: 'Pro',
    price: '$49',
    sub: '/ month',
    href: '/signup?tier=pro',
    cta: 'Start Pro',
    highlight: true,
    features: [
      { label: 'Active strategies', value: '5' },
      { label: 'Trades per day', value: 'Unlimited' },
      { label: 'Daily loss cap', value: '$500' },
      { label: 'Max position size', value: '$5,000' },
      { label: 'Market scanning', value: 'Advanced' },
      { label: 'Safety limits', value: true },
      { label: 'API access', value: true },
      { label: 'Priority support', value: false },
    ],
  },
  {
    name: 'Enterprise',
    price: '$199',
    sub: '/ month',
    href: '/signup?tier=enterprise',
    cta: 'Get Started',
    highlight: false,
    features: [
      { label: 'Active strategies', value: 'Unlimited' },
      { label: 'Trades per day', value: 'Unlimited' },
      { label: 'Daily loss cap', value: '$5,000' },
      { label: 'Max position size', value: '$50,000' },
      { label: 'Market scanning', value: 'Full coverage' },
      { label: 'Safety limits', value: true },
      { label: 'API access', value: true },
      { label: 'Priority support', value: true },
    ],
  },
];

const FAQS = [
  {
    q: 'How does CashClaw make money for me?',
    a: 'CashClaw posts bid and ask orders around the fair-value mid-price on Polymarket. When both sides fill, you earn the spread. Higher liquidity markets produce more fills.',
  },
  {
    q: 'Is my capital at risk?',
    a: 'All trading carries risk. CashClaw enforces daily loss caps and maximum position sizes to limit downside. You control your Polymarket wallet at all times — funds never leave your account.',
  },
  {
    q: 'What markets does CashClaw trade?',
    a: 'The bot targets high-liquidity Polymarket prediction markets with measurable spreads. The selection algorithm scores markets by volume, liquidity depth, and spread width.',
  },
  {
    q: 'Can I cancel anytime?',
    a: 'Yes. Pro and Enterprise plans are month-to-month with no lock-in. Cancel before your next billing date and you will not be charged again.',
  },
  {
    q: 'Do I need a Polymarket account?',
    a: 'Yes. CashClaw connects to your existing Polymarket account via API key. You retain full custody of funds.',
  },
];

function CheckIcon() {
  return (
    <svg width="14" height="14" fill="none" stroke="#00FF41" strokeWidth="2" viewBox="0 0 24 24">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg width="14" height="14" fill="none" stroke="#8892B0" strokeWidth="2" viewBox="0 0 24 24">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#2D3142]">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between py-4 text-left text-sm font-mono text-white hover:text-[#00D9FF] transition-colors"
      >
        <span>{q}</span>
        <svg
          width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
          className={`flex-shrink-0 ml-4 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <p className="text-[#8892B0] text-xs leading-relaxed pb-4 font-mono">{a}</p>
      )}
    </div>
  );
}

export function PricingPage() {
  return (
    <div className="min-h-screen bg-[#0F0F1A] text-white font-mono flex flex-col">
      <PublicNavbar />

      <main className="flex-1 pt-24 pb-16 px-4 sm:px-6 max-w-6xl mx-auto w-full">
        {/* Header */}
        <div className="text-center mb-12">
          <p className="text-[#00D9FF] text-xs uppercase tracking-widest mb-3">Pricing</p>
          <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4">Simple, transparent plans</h1>
          <p className="text-[#8892B0] text-sm max-w-md mx-auto">
            Start free. Upgrade when you're ready. No hidden fees. Cancel anytime.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-20">
          {PLANS.map(({ name, price, sub, href, cta, highlight, features }) => (
            <div
              key={name}
              className={`relative rounded-lg p-6 flex flex-col gap-5 ${
                highlight
                  ? 'border-2 border-[#00D9FF] bg-[#1A1A2E]'
                  : 'border border-[#2D3142] bg-[#1A1A2E]'
              }`}
            >
              {highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#00D9FF] text-[#0F0F1A] text-xs font-bold px-3 py-0.5 rounded-full">
                  POPULAR
                </span>
              )}

              <div>
                <p className="text-[#8892B0] text-xs uppercase tracking-widest mb-2">{name}</p>
                <p className="text-white text-4xl font-bold">
                  {price}
                  <span className="text-[#8892B0] text-sm font-normal ml-1">{sub}</span>
                </p>
              </div>

              <ul className="space-y-2.5 flex-1">
                {features.map(({ label, value }) => (
                  <li key={label} className="flex items-center justify-between text-xs">
                    <span className="text-[#8892B0]">{label}</span>
                    <span className="flex items-center gap-1 font-mono">
                      {typeof value === 'boolean' ? (
                        value ? <CheckIcon /> : <XIcon />
                      ) : (
                        <span className="text-white">{value}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>

              <Link
                to={href}
                className={`text-center text-sm font-bold px-4 py-2.5 rounded transition-colors ${
                  highlight
                    ? 'bg-[#00D9FF] text-[#0F0F1A] hover:bg-[#00D9FF]/80'
                    : 'border border-[#2D3142] text-[#8892B0] hover:text-white hover:border-[#00D9FF]/50'
                }`}
              >
                {cta}
              </Link>
            </div>
          ))}
        </div>

        {/* FAQ */}
        <div className="max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-white mb-6 text-center">Frequently asked questions</h2>
          <div>
            {FAQS.map(({ q, a }) => (
              <FaqItem key={q} q={q} a={a} />
            ))}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
