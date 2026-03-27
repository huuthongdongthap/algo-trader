/**
 * Public landing page. Full-screen dark cyberpunk, no sidebar.
 * Sections: navbar, hero, how-it-works, stats bar, pricing preview, footer.
 */
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { PublicNavbar } from '../components/public-navbar';
import { Footer } from '../components/footer';
import { TerminalAnimation } from '../components/terminal-animation';

function useFadeIn(selector: string) {
  useEffect(() => {
    const els = document.querySelectorAll<HTMLElement>(selector);
    if (!('IntersectionObserver' in window)) {
      els.forEach((el) => el.classList.add('visible'));
      return;
    }
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { (e.target as HTMLElement).classList.add('visible'); } }),
      { threshold: 0.1 }
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, [selector]);
}

const HOW_ITEMS = [
  {
    title: 'Select Markets',
    body: 'The bot scans Polymarket for high-liquidity questions with favourable spreads and selects the top candidates automatically.',
    icon: (
      <svg width="28" height="28" fill="none" stroke="#00D9FF" strokeWidth="1.5" viewBox="0 0 24 24">
        <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
      </svg>
    ),
  },
  {
    title: 'Bot Quotes',
    body: 'CashClaw posts bid and ask orders around the fair-value mid-price, earning the spread on every matched trade.',
    icon: (
      <svg width="28" height="28" fill="none" stroke="#00D9FF" strokeWidth="1.5" viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    title: 'You Profit',
    body: 'Filled orders generate spread income. Safety limits cap inventory risk. Funds stay in your Polymarket wallet.',
    icon: (
      <svg width="28" height="28" fill="none" stroke="#00FF41" strokeWidth="1.5" viewBox="0 0 24 24">
        <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
      </svg>
    ),
  },
];

const STATS = [
  { value: '0%', label: 'maker fees on Polymarket' },
  { value: '87.3%', label: 'of traders lose money' },
  { value: '24/7', label: 'automated operation' },
  { value: '< 2s', label: 'requote latency' },
];

const PRICING_CARDS = [
  { name: 'Free', price: '$0', sub: 'forever', cta: 'Start Free', href: '/signup?tier=free', highlight: false,
    features: ['1 active strategy', '5 trades / day', '$50 daily loss cap', '$500 max position'] },
  { name: 'Pro', price: '$49', sub: 'per month', cta: 'Start Pro', href: '/signup?tier=pro', highlight: true,
    features: ['5 active strategies', 'Unlimited trades', '$500 daily loss cap', '$5,000 max position'] },
  { name: 'Enterprise', price: '$199', sub: 'per month', cta: 'Contact Us', href: '/signup?tier=enterprise', highlight: false,
    features: ['Unlimited strategies', 'Unlimited trades', '$5,000 daily loss cap', '$50,000 max position'] },
];

export function LandingPage() {
  useFadeIn('.fade-in');

  return (
    <div className="min-h-screen bg-[#0F0F1A] text-white font-mono" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #2D3142 1px, transparent 0)', backgroundSize: '32px 32px' }}>
      <PublicNavbar />

      {/* Hero */}
      <section className="pt-32 pb-20 px-4 sm:px-6 max-w-6xl mx-auto">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div className="fade-in opacity-0 transition-all duration-700 translate-y-4" style={{ '--tw-translate-y': '1rem' } as React.CSSProperties}>
            <p className="text-[#00D9FF] text-xs uppercase tracking-widest mb-4">Prediction Market Automation</p>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold leading-tight tracking-tight text-white mb-6">
              Polymarket Market Making.<br />
              <span className="text-[#00D9FF]">Automated.</span>
            </h1>
            <p className="text-[#8892B0] text-base leading-relaxed mb-8 max-w-md">
              CashClaw quotes bid/ask spreads on Polymarket 24/7. You earn the spread. Safety limits protect your capital. No manual trading required.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link
                to="/signup"
                className="bg-[#00D9FF] text-[#0F0F1A] font-bold px-6 py-3 rounded hover:bg-[#00D9FF]/80 transition-colors text-sm"
              >
                Start Free
              </Link>
              <Link
                to="/pricing"
                className="border border-[#2D3142] text-[#8892B0] hover:text-white hover:border-[#00D9FF]/50 font-semibold px-6 py-3 rounded transition-colors text-sm"
              >
                View Pricing
              </Link>
            </div>
          </div>

          <div className="fade-in opacity-0 transition-all duration-700 delay-200">
            <TerminalAnimation />
          </div>
        </div>
      </section>

      {/* Stats bar */}
      <section className="border-y border-[#2D3142] bg-[#1A1A2E]/50 py-6 px-4 sm:px-6">
        <div className="max-w-6xl mx-auto grid grid-cols-2 sm:grid-cols-4 gap-6 text-center">
          {STATS.map(({ value, label }) => (
            <div key={label} className="fade-in opacity-0 transition-all duration-500">
              <p className="text-[#00D9FF] text-xl font-bold mb-1">{value}</p>
              <p className="text-[#8892B0] text-xs">{label}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 px-4 sm:px-6 max-w-6xl mx-auto">
        <div className="text-center mb-12 fade-in opacity-0 transition-all duration-700">
          <p className="text-[#00D9FF] text-xs uppercase tracking-widest mb-3">How It Works</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-white">Three steps to passive spread income</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {HOW_ITEMS.map(({ title, body, icon }, i) => (
            <div
              key={title}
              className="fade-in opacity-0 transition-all duration-700 bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-6 hover:border-[#00D9FF]/40 transition-colors"
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              <div className="mb-4">{icon}</div>
              <h3 className="text-white font-bold mb-2 text-sm">{title}</h3>
              <p className="text-[#8892B0] text-xs leading-relaxed">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing preview */}
      <section className="py-20 px-4 sm:px-6 max-w-6xl mx-auto">
        <div className="text-center mb-12 fade-in opacity-0 transition-all duration-700">
          <p className="text-[#00D9FF] text-xs uppercase tracking-widest mb-3">Pricing</p>
          <h2 className="text-2xl sm:text-3xl font-bold text-white">Simple, transparent plans</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PRICING_CARDS.map(({ name, price, sub, cta, href, highlight, features }, i) => (
            <div
              key={name}
              className={`fade-in opacity-0 transition-all duration-700 rounded-lg p-6 flex flex-col gap-4 ${
                highlight
                  ? 'bg-[#1A1A2E] border-2 border-[#00D9FF] relative'
                  : 'bg-[#1A1A2E] border border-[#2D3142]'
              }`}
              style={{ transitionDelay: `${i * 100}ms` }}
            >
              {highlight && (
                <span className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#00D9FF] text-[#0F0F1A] text-xs font-bold px-3 py-0.5 rounded-full">
                  POPULAR
                </span>
              )}
              <div>
                <p className="text-[#8892B0] text-xs uppercase tracking-widest mb-1">{name}</p>
                <p className="text-white text-3xl font-bold">{price}<span className="text-[#8892B0] text-sm font-normal ml-1">{sub}</span></p>
              </div>
              <ul className="space-y-2 flex-1">
                {features.map((f) => (
                  <li key={f} className="flex items-center gap-2 text-xs text-[#8892B0]">
                    <span className="w-1 h-1 rounded-full bg-[#00D9FF] flex-shrink-0" />
                    {f}
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
        <p className="text-center mt-6">
          <Link to="/pricing" className="text-[#00D9FF] text-xs hover:underline">
            See full pricing details
          </Link>
        </p>
      </section>

      <Footer />

      <style>{`
        .fade-in.visible { opacity: 1 !important; transform: translateY(0) !important; }
      `}</style>
    </div>
  );
}
