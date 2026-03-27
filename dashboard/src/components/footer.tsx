/**
 * Public footer for landing, pricing, auth pages.
 * 3-column layout with disclaimer.
 */
import { Link } from 'react-router-dom';

export function Footer() {
  return (
    <footer className="border-t border-[#2D3142] bg-[#0F0F1A] mt-auto">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-8">
          {/* Brand */}
          <div>
            <p className="text-[#00D9FF] font-bold font-mono text-base mb-2">CashClaw</p>
            <p className="text-[#8892B0] text-xs font-mono leading-relaxed">
              Automated market making for Polymarket prediction markets.
            </p>
          </div>

          {/* Product links */}
          <div>
            <p className="text-white text-xs font-mono uppercase tracking-widest mb-3">Product</p>
            <ul className="space-y-2">
              <li>
                <Link to="/pricing" className="text-[#8892B0] hover:text-white text-xs font-mono transition-colors">
                  Pricing
                </Link>
              </li>
              <li>
                <Link to="/docs" className="text-[#8892B0] hover:text-white text-xs font-mono transition-colors">
                  Docs
                </Link>
              </li>
              <li>
                <Link to="/login" className="text-[#8892B0] hover:text-white text-xs font-mono transition-colors">
                  Login
                </Link>
              </li>
              <li>
                <Link to="/signup" className="text-[#8892B0] hover:text-white text-xs font-mono transition-colors">
                  Sign Up
                </Link>
              </li>
            </ul>
          </div>

          {/* Legal */}
          <div>
            <p className="text-white text-xs font-mono uppercase tracking-widest mb-3">Legal</p>
            <ul className="space-y-2">
              <li>
                <Link to="/terms" className="text-[#8892B0] hover:text-white text-xs font-mono transition-colors">
                  Terms of Service
                </Link>
              </li>
              <li>
                <Link to="/privacy" className="text-[#8892B0] hover:text-white text-xs font-mono transition-colors">
                  Privacy Policy
                </Link>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-8 pt-6 border-t border-[#2D3142] flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
          <p className="text-[#8892B0] text-xs font-mono">
            &copy; 2026 Binh Phap Venture Studio. All rights reserved.
          </p>
          <p className="text-[#8892B0] text-xs font-mono">
            Not financial advice. Trade at your own risk.
          </p>
        </div>
      </div>
    </footer>
  );
}
