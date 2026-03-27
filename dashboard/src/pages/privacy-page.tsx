/**
 * Privacy Policy stub page.
 */
import { Link } from 'react-router-dom';
import { PublicNavbar } from '../components/public-navbar';
import { Footer } from '../components/footer';

export function PrivacyPage() {
  return (
    <div className="min-h-screen bg-[#0F0F1A] text-white font-mono flex flex-col">
      <PublicNavbar />
      <main className="flex-1 max-w-3xl mx-auto px-4 sm:px-6 py-20">
        <h1 className="text-2xl font-bold text-white mb-6">Privacy Policy</h1>
        <p className="text-[#8892B0] text-sm leading-relaxed mb-4">
          CashClaw collects your email address and authentication credentials to provide the service.
          We do not sell your data to third parties.
        </p>
        <p className="text-[#8892B0] text-sm leading-relaxed mb-4">
          Your Polymarket wallet credentials are stored encrypted and used solely to execute
          market making operations on your behalf.
        </p>
        <p className="text-[#8892B0] text-sm leading-relaxed mb-8">
          Full privacy policy coming soon. For questions contact{' '}
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

export default PrivacyPage;
