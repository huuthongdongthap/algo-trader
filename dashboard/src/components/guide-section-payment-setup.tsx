/**
 * Guide section: Pricing & Payment — customer-facing tier info and payment guide.
 */

export function GuidePricing() {
  return (
    <section id="pricing">
      <h2 className="text-xl font-bold font-mono text-white mb-4">Pricing & Payment</h2>

      <div className="space-y-6">
        {/* Tier Comparison */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4">
            <p className="text-white font-bold text-lg mb-1">Starter</p>
            <p className="text-[#00D9FF] font-bold text-2xl mb-3">$49<span className="text-sm text-[#8892B0]">/mo</span></p>
            <ul className="text-xs font-mono text-[#8892B0] space-y-1">
              <li>1 trading strategy</li>
              <li>Polymarket only</li>
              <li>5 markets max</li>
              <li>Community support</li>
              <li>Dashboard access</li>
            </ul>
          </div>
          <div className="bg-[#1A1A2E] border-2 border-[#00D9FF] rounded-lg p-4 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#00D9FF] text-[#0D1117] px-3 py-0.5 rounded-full text-xs font-bold">
              Popular
            </div>
            <p className="text-white font-bold text-lg mb-1">Pro</p>
            <p className="text-[#00D9FF] font-bold text-2xl mb-3">$149<span className="text-sm text-[#8892B0]">/mo</span></p>
            <ul className="text-xs font-mono text-[#8892B0] space-y-1">
              <li>5 strategies + AI scanner</li>
              <li>All markets (Poly + CEX)</li>
              <li>10 markets max</li>
              <li>Priority support</li>
              <li>Dark edge agents</li>
            </ul>
          </div>
          <div className="bg-[#1A1A2E] border border-yellow-500/50 rounded-lg p-4">
            <p className="text-white font-bold text-lg mb-1">Elite</p>
            <p className="text-yellow-400 font-bold text-2xl mb-3">$499<span className="text-sm text-[#8892B0]">/mo</span></p>
            <ul className="text-xs font-mono text-[#8892B0] space-y-1">
              <li>Unlimited strategies</li>
              <li>All markets</li>
              <li>Unlimited markets</li>
              <li>Dedicated support</li>
              <li>Custom AI training</li>
            </ul>
          </div>
        </div>

        {/* How to Pay */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">How to Subscribe</p>
          <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4 text-sm font-mono text-[#8892B0] space-y-2">
            <p>1. Go to <span className="text-[#00D9FF]">cashclaw.cc</span> &rarr; Pricing section</p>
            <p>2. Choose your tier &rarr; click &quot;Buy&quot;</p>
            <p>3. Pay with crypto via NOWPayments (USDT TRC20, BTC, ETH, 100+ coins)</p>
            <p>4. After payment confirms, your license key will be emailed</p>
            <p>5. Add <span className="text-white">RAAS_LICENSE_KEY</span> to your .env and restart bot</p>
          </div>
        </div>

        {/* Coupon */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Have a Coupon Code?</p>
          <p className="text-sm font-mono text-[#8892B0]">
            Enter your coupon code on the <span className="text-[#00D9FF]">cashclaw.cc</span> pricing page
            before checkout. Discounts are applied automatically.
            100% discount coupons grant free access — just create an account.
          </p>
        </div>

        {/* Free Tier */}
        <div className="border border-[#00FF41]/30 bg-[#00FF41]/5 rounded-lg p-4">
          <p className="text-sm font-mono text-[#00FF41] font-bold mb-1">Free Tier Available</p>
          <p className="text-sm font-mono text-[#8892B0]">
            No license key = FREE tier: 1 market, 5 trades/day, no AI scanner.
            Perfect for testing before upgrading.
          </p>
        </div>
      </div>
    </section>
  );
}
