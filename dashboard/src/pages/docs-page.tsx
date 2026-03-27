/**
 * Public docs page at /docs — full page with PublicNavbar + Footer.
 * Left sticky TOC on desktop, horizontal scrollable bar on mobile.
 * Active section tracked via IntersectionObserver.
 */
import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { PublicNavbar } from '../components/public-navbar';
import { Footer } from '../components/footer';
import { GuideContent } from '../components/guide-content';

const TOC_ITEMS = [
  { id: 'how-it-works', label: 'How It Works' },
  { id: 'returns', label: 'Expected Returns' },
  { id: 'quick-start', label: 'Quick Start' },
  { id: 'daily-ops', label: 'Daily Operations' },
  { id: 'parameters', label: 'Parameters' },
  { id: 'troubleshooting', label: 'Troubleshooting' },
  { id: 'emergency', label: 'Emergency Stop' },
  { id: 'glossary', label: 'Glossary' },
];

export function DocsPage() {
  const [activeId, setActiveId] = useState('how-it-works');
  const observerRef = useRef<IntersectionObserver | null>(null);

  useEffect(() => {
    const options = { rootMargin: '-20% 0px -70% 0px', threshold: 0 };

    observerRef.current = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          setActiveId(entry.target.id);
        }
      });
    }, options);

    TOC_ITEMS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observerRef.current?.observe(el);
    });

    return () => observerRef.current?.disconnect();
  }, []);

  const scrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  return (
    <div className="min-h-screen bg-[#0F0F1A] flex flex-col">
      <PublicNavbar />

      {/* Mobile TOC — horizontal scroll bar */}
      <div className="md:hidden sticky top-14 z-40 bg-[#0F0F1A]/95 backdrop-blur border-b border-[#2D3142] px-4 py-2 overflow-x-auto">
        <div className="flex gap-4 whitespace-nowrap">
          {TOC_ITEMS.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => scrollTo(id)}
              className={`text-xs font-mono py-1 transition-colors ${
                activeId === id ? 'text-[#00D9FF]' : 'text-[#8892B0] hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Main layout */}
      <div className="flex-1 max-w-6xl mx-auto w-full px-4 sm:px-6 pt-20 md:pt-24 pb-16 flex gap-10">

        {/* Desktop sidebar TOC */}
        <aside className="hidden md:block w-[200px] flex-shrink-0">
          <div className="sticky top-24">
            <p className="text-xs font-mono text-[#8892B0] uppercase tracking-widest mb-4">On this page</p>
            <nav className="space-y-1">
              {TOC_ITEMS.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => scrollTo(id)}
                  className={`block w-full text-left text-xs font-mono py-1.5 px-2 rounded transition-colors ${
                    activeId === id
                      ? 'text-[#00D9FF] bg-[#00D9FF]/10'
                      : 'text-[#8892B0] hover:text-white'
                  }`}
                >
                  {label}
                </button>
              ))}
            </nav>

            <div className="mt-8 pt-6 border-t border-[#2D3142]">
              <p className="text-xs font-mono text-[#8892B0] mb-2">Have an account?</p>
              <Link
                to="/app/guide"
                className="text-xs font-mono text-[#00D9FF] hover:underline"
              >
                View in app →
              </Link>
            </div>
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 max-w-[800px]">
          <div className="mb-10">
            <h1 className="text-2xl font-bold font-mono text-white mb-2">Operator Guide</h1>
            <p className="text-sm font-mono text-[#8892B0]">
              CashClaw SOPs — everything you need to run the market-making bot profitably.
            </p>
          </div>
          <GuideContent />
        </main>
      </div>

      <Footer />
    </div>
  );
}
