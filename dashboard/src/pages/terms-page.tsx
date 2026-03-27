/**
 * Terms of Service stub page.
 */
import { Link } from 'react-router-dom';
import { PublicNavbar } from '../components/public-navbar';
import { Footer } from '../components/footer';

export function TermsPage() {
  return (
    <div className="min-h-screen bg-[#0F0F1A] text-white font-mono flex flex-col">
      <PublicNavbar />
      <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 py-20">
        <h1 className="text-2xl font-bold text-white mb-6">Terms of Service</h1>
        <p className="text-[#8892B0] text-sm leading-relaxed mb-4">
          By using CashClaw you agree to trade responsibly. CashClaw is an automation tool — you remain
          responsible for all activity in your Polymarket account.
        </p>
        <p className="text-[#8892B0] text-sm leading-relaxed mb-4">
          CashClaw does not provide financial advice. All trading involves risk. Daily loss caps and position
          limits are safety features, not guarantees against loss.
        </p>
        <p className="text-[#8892B0] text-sm leading-relaxed mb-8">
          Full terms coming soon. For questions contact{' '}
          <a href="mailto:support@cashclaw.cc" className="text-[#00D9FF] hover:underline">
            support@cashclaw.cc
          </a>.
        </p>
        <Link to="/" className="text-[#00D9FF] text-sm hover:underline">← Back to home</Link>
      </main>
      <Footer />
    </div>
  );
}

export default TermsPage;
