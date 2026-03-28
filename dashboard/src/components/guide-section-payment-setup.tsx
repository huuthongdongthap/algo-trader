/**
 * Guide section: NOWPayments setup and invoice management.
 */
import { CopyBlock } from './guide-shared-components';

export function GuidePaymentSetup() {
  return (
    <section id="payment-setup">
      <h2 className="text-xl font-bold font-mono text-white mb-2">Payment Setup (NOWPayments)</h2>
      <p className="text-sm font-mono text-[#8892B0] mb-4">
        All payments via NOWPayments USDT TRC20. Shared account across 4 projects.
      </p>

      <div className="space-y-6">
        {/* Pricing Tiers */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">CashClaw Pricing Tiers</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono border-collapse">
              <thead>
                <tr className="border-b border-[#2D3142]">
                  <th className="text-left py-2 pr-6 text-[#00D9FF]">Tier</th>
                  <th className="text-left py-2 pr-6 text-[#00D9FF]">Price</th>
                  <th className="text-left py-2 pr-6 text-[#00D9FF]">Invoice ID</th>
                  <th className="text-left py-2 text-[#00D9FF]">Features</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3142]">
                <tr>
                  <td className="py-2 pr-6 text-white">Starter</td>
                  <td className="py-2 pr-6">$49/mo</td>
                  <td className="py-2 pr-6 text-[#8892B0]">4725459350</td>
                  <td className="py-2">1 strategy, Polymarket only</td>
                </tr>
                <tr>
                  <td className="py-2 pr-6 text-white">Pro</td>
                  <td className="py-2 pr-6">$149/mo</td>
                  <td className="py-2 pr-6 text-[#8892B0]">5493882802</td>
                  <td className="py-2">5 strategies, all markets</td>
                </tr>
                <tr>
                  <td className="py-2 pr-6 text-white">Elite</td>
                  <td className="py-2 pr-6">$499/mo</td>
                  <td className="py-2 pr-6 text-[#8892B0]">5264305182</td>
                  <td className="py-2">Unlimited, dedicated support</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* IPN Webhook */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">IPN Webhook</p>
          <p className="text-sm font-mono text-[#8892B0] mb-2">
            NOWPayments sends payment status updates to your IPN endpoint.
            Webhook verifies HMAC-SHA512 signature before processing.
          </p>
          <CopyBlock code={`# Webhook URL (configure in NOWPayments dashboard)
https://api.cashclaw.cc/api/webhooks/nowpayments

# IPN statuses:
# finished  -> activate subscription + license
# refunded  -> cancel subscription
# failed    -> log + notify
# waiting/confirming/confirmed -> ignore (intermediate)`} />
        </div>

        {/* Multi-project */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Multi-Project Support</p>
          <p className="text-sm font-mono text-[#8892B0] mb-2">
            Same NOWPayments account serves 4 projects with different tier pricing:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs font-mono">
            <div className="bg-[#1A1A2E] rounded p-2">
              <span className="text-[#00D9FF] block mb-1">CashClaw</span>
              Starter $49 / Pro $149 / Elite $499
            </div>
            <div className="bg-[#1A1A2E] rounded p-2">
              <span className="text-[#00D9FF] block mb-1">OpenClaw</span>
              Starter $49 / Pro $149 / Growth $399 / Premium $799 / Master $4999
            </div>
            <div className="bg-[#1A1A2E] rounded p-2">
              <span className="text-[#00D9FF] block mb-1">Sophia AI Factory</span>
              Basic $199 / Premium $399 / Enterprise $799 / Master $4999
            </div>
            <div className="bg-[#1A1A2E] rounded p-2">
              <span className="text-[#00D9FF] block mb-1">Mekong</span>
              Starter $49 / Pro $149
            </div>
          </div>
        </div>

        {/* .env keys */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Required .env Keys</p>
          <CopyBlock code={`NOWPAYMENTS_API_KEY=your_api_key
NOWPAYMENTS_IPN_SECRET=your_ipn_secret
ADMIN_API_KEY=your_admin_key_for_coupon_api`} />
        </div>
      </div>
    </section>
  );
}
