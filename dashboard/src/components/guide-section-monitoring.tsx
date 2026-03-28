/**
 * Guide section: Troubleshooting & Emergency — customer-facing help.
 */
import { CopyBlock, CollapsibleItem } from './guide-shared-components';

export function GuideTroubleshooting() {
  return (
    <section id="troubleshooting">
      <h2 className="text-xl font-bold font-mono text-white mb-4">Troubleshooting & Emergency</h2>

      <div className="space-y-6">
        {/* Common Issues */}
        <div className="space-y-2">
          <p className="text-sm font-mono text-white font-bold mb-2">Common Issues</p>
          <CollapsibleItem title="Bot stopped unexpectedly">
            <p>Check logs and restart:</p>
            <CopyBlock code={`pm2 logs cashclaw --lines 50
pm2 restart cashclaw`} />
            <p className="mt-2">Common causes: VPS ran out of memory, network timeout, .env misconfigured.</p>
          </CollapsibleItem>
          <CollapsibleItem title="Balance drop > 10%">
            <p className="text-red-400">STOP immediately. Check logs. Widen spread before restart.</p>
            <CopyBlock code={`pm2 stop cashclaw
# Edit .env: increase MM_SPREAD to 0.12, reduce MM_SIZE to 10
pm2 restart cashclaw`} />
          </CollapsibleItem>
          <CollapsibleItem title="401 Unauthorized error">
            <p>API keys expired or invalid. Regenerate keys on Polymarket:</p>
            <CopyBlock code={`# Edit .env with new PRIVATE_KEY
nano .env
pm2 restart cashclaw`} />
          </CollapsibleItem>
          <CollapsibleItem title="No fills for 24+ hours">
            <p>Your spread may be too wide or markets too thin. Try:</p>
            <CopyBlock code={`# Reduce spread to attract more fills
# Edit .env: MM_SPREAD=0.06
nano .env
pm2 restart cashclaw`} />
          </CollapsibleItem>
          <CollapsibleItem title="Disk full on VPS">
            <p>Clear old PM2 logs:</p>
            <CopyBlock code="pm2 flush" />
          </CollapsibleItem>
          <CollapsibleItem title="License key not working">
            <p>Verify your key is correct and not expired. Check:</p>
            <CopyBlock code={`# Verify license status
pm2 logs cashclaw --lines 10 | grep -i license`} />
            <p className="mt-2">
              Contact <span className="text-[#00D9FF]">support@cashclaw.cc</span> if issues persist.
            </p>
          </CollapsibleItem>
        </div>

        {/* Emergency Stop */}
        <div>
          <p className="text-sm font-mono text-red-400 font-bold mb-3">Emergency Stop Procedures</p>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-mono text-[#00D9FF] font-bold mb-2">Level 1 — Quick stop</p>
              <CopyBlock code="pm2 stop cashclaw" />
            </div>
            <div>
              <p className="text-sm font-mono text-yellow-400 font-bold mb-2">Level 2 — Cancel all orders</p>
              <CopyBlock code={`pm2 stop cashclaw
# Go to polymarket.com -> My Portfolio -> Cancel All Orders`} />
            </div>
            <div>
              <p className="text-sm font-mono text-red-400 font-bold mb-2">Level 3 — Full shutdown + withdraw</p>
              <CopyBlock code={`pm2 delete cashclaw
# Go to polymarket.com -> withdraw all USDC to your wallet`} />
            </div>
          </div>
        </div>

        {/* Support */}
        <div className="border border-[#00D9FF]/30 bg-[#00D9FF]/5 rounded-lg p-4">
          <p className="text-sm font-mono text-[#00D9FF] font-bold mb-1">Need Help?</p>
          <div className="text-sm font-mono text-[#8892B0] space-y-1">
            <p>Email: <span className="text-white">support@cashclaw.cc</span></p>
            <p>Telegram: <span className="text-white">@cashclaw_support</span></p>
            <p>Response time: &lt;24 hours (Pro/Elite: &lt;4 hours)</p>
          </div>
        </div>

        {/* Glossary */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-3">Glossary</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm font-mono border-collapse">
              <thead>
                <tr className="border-b border-[#2D3142]">
                  <th className="text-left py-2 pr-6 text-[#00D9FF] w-1/3">Term</th>
                  <th className="text-left py-2 text-[#00D9FF]">Definition</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3142]">
                {[
                  ['bid', 'Buy price — highest price you\'re willing to pay'],
                  ['ask', 'Sell price — lowest price you\'re willing to sell at'],
                  ['spread', 'Difference between bid and ask — your profit per fill'],
                  ['fill', 'Order match — someone accepted your price'],
                  ['maker rebate', 'Daily reward for providing liquidity'],
                  ['DRY_RUN', 'Simulation mode — no real money at risk'],
                  ['adverse selection', 'Losing when counterparty knows more than you'],
                ].map(([term, def]) => (
                  <tr key={term}>
                    <td className="py-2 pr-6 text-white">{term}</td>
                    <td className="py-2 text-[#8892B0]">{def}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
}
