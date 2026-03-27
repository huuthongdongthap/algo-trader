/**
 * Sticky public navbar for landing, pricing, login, signup pages.
 * Blurs on scroll. Mobile hamburger menu.
 */
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

export function PublicNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-200 ${
        scrolled ? 'bg-[#0F0F1A]/90 backdrop-blur-md border-b border-[#2D3142]' : 'bg-transparent'
      }`}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
        {/* Logo */}
        <Link to="/" className="text-[#00D9FF] font-bold text-lg font-mono tracking-tight">
          CashClaw
        </Link>

        {/* Desktop links */}
        <nav className="hidden md:flex items-center gap-6">
          <Link
            to="/pricing"
            className="text-[#8892B0] hover:text-white text-sm font-mono transition-colors"
          >
            Pricing
          </Link>
          <Link
            to="/docs"
            className="text-[#8892B0] hover:text-white text-sm font-mono transition-colors"
          >
            Docs
          </Link>
          <Link
            to="/login"
            className="text-[#8892B0] hover:text-white text-sm font-mono transition-colors"
          >
            Login
          </Link>
          <Link
            to="/signup"
            className="bg-[#00D9FF] text-[#0F0F1A] text-sm font-bold font-mono px-4 py-1.5 rounded hover:bg-[#00D9FF]/80 transition-colors"
          >
            Get Started
          </Link>
        </nav>

        {/* Mobile hamburger */}
        <button
          className="md:hidden text-[#8892B0] hover:text-white p-1"
          onClick={() => setMenuOpen((v) => !v)}
          aria-label="Toggle menu"
        >
          {menuOpen ? (
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          ) : (
            <svg width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 12h18M3 6h18M3 18h18" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="md:hidden bg-[#1A1A2E] border-b border-[#2D3142] px-4 py-4 flex flex-col gap-3">
          <Link
            to="/pricing"
            onClick={() => setMenuOpen(false)}
            className="text-[#8892B0] hover:text-white text-sm font-mono transition-colors"
          >
            Pricing
          </Link>
          <Link
            to="/docs"
            onClick={() => setMenuOpen(false)}
            className="text-[#8892B0] hover:text-white text-sm font-mono transition-colors"
          >
            Docs
          </Link>
          <Link
            to="/login"
            onClick={() => setMenuOpen(false)}
            className="text-[#8892B0] hover:text-white text-sm font-mono transition-colors"
          >
            Login
          </Link>
          <Link
            to="/signup"
            onClick={() => setMenuOpen(false)}
            className="bg-[#00D9FF] text-[#0F0F1A] text-sm font-bold font-mono px-4 py-1.5 rounded text-center hover:bg-[#00D9FF]/80 transition-colors"
          >
            Get Started
          </Link>
        </div>
      )}
    </header>
  );
}
