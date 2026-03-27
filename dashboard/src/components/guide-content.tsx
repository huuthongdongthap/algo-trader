/**
 * Shared guide/SOPs content for operator documentation.
 * Used by both /docs (public) and /app/guide (app) routes.
 */
import { useState } from 'react';

function CopyBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative group">
      <pre className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4 text-sm font-mono text-[#8892B0] overflow-x-auto">
        {code}
      </pre>
      <button
        onClick={() => {
          navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
        className="absolute top-2 right-2 px-2 py-1 text-xs bg-[#2D3142] text-[#8892B0] rounded hover:text-white transition opacity-0 group-hover:opacity-100"
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
    </div>
  );
}

function TroubleshootItem({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#2D3142] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left text-sm font-mono text-[#8892B0] hover:text-white hover:bg-[#1A1A2E] transition-colors"
      >
        <span>{title}</span>
        <svg
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className={`flex-shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        >
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>
      {open && <div className="px-4 pb-4 pt-1 text-sm font-mono text-[#8892B0] space-y-2">{children}</div>}
    </div>
  );
}

export function GuideContent() {
  return (
    <div className="space-y-16 text-[#8892B0]">

      {/* Self-Hosted Banner */}
      <div className="border border-[#00D9FF]/30 bg-[#00D9FF]/5 rounded-lg p-4">
        <p className="text-sm font-mono text-[#00D9FF] font-bold mb-1">CashClaw v1 — Self-Hosted</p>
        <p className="text-sm font-mono text-[#8892B0] leading-relaxed">
          You run the bot on your own VPS. Your keys, your server, your profits.
          CashClaw provides the software + dashboard + updates. You provide the infrastructure ($10-20/mo VPS) and Polymarket wallet.
        </p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
          <div className="bg-[#1A1A2E] rounded p-2">
            <span className="text-[#00FF41]">You own:</span> Private keys, VPS, profits
          </div>
          <div className="bg-[#1A1A2E] rounded p-2">
            <span className="text-[#00D9FF]">We provide:</span> Bot code, dashboard, updates
          </div>
          <div className="bg-[#1A1A2E] rounded p-2">
            <span className="text-yellow-400">Cost:</span> $10-20/mo VPS + CashClaw tier
          </div>
        </div>
      </div>

      {/* Section 1: How It Works */}
      <section id="how-it-works">
        <h2 className="text-xl font-bold font-mono text-white mb-4">How It Works</h2>
        <div className="space-y-3 text-sm font-mono leading-relaxed">
          <p>Bot places BUY and SELL orders simultaneously on Polymarket.</p>
          <p>When someone takes your order, you earn the spread.</p>
          <p>Polymarket pays additional maker rebate daily.</p>
          <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4 mt-4">
            <p className="text-[#00D9FF] font-bold mb-2">Example</p>
            <p>Market: <span className="text-white">"Bitcoin hits $200K?"</span></p>
            <p className="mt-1">
              BID YES @ <span className="text-[#00FF41]">0.42</span>{' '}
              → ASK YES @ <span className="text-[#00FF41]">0.52</span>{' '}
              → <span className="text-[#00D9FF] font-bold">$0.10/share profit</span>
            </p>
          </div>
        </div>
      </section>

      {/* Section 2: Expected Returns */}
      <section id="returns">
        <h2 className="text-xl font-bold font-mono text-white mb-4">Expected Returns</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm font-mono border-collapse">
            <thead>
              <tr className="border-b border-[#2D3142]">
                <th className="text-left py-2 pr-6 text-[#00D9FF]">Capital</th>
                <th className="text-left py-2 pr-6 text-[#00D9FF]">Daily</th>
                <th className="text-left py-2 text-[#00D9FF]">Monthly</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2D3142]">
              <tr>
                <td className="py-2 pr-6 text-white">$1,000</td>
                <td className="py-2 pr-6">$5–25</td>
                <td className="py-2">$150–750</td>
              </tr>
              <tr>
                <td className="py-2 pr-6 text-white">$5,000</td>
                <td className="py-2 pr-6">$25–100</td>
                <td className="py-2">$750–3,000</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-4 border-l-4 border-red-500 bg-red-500/10 px-4 py-3 rounded-r-lg">
          <p className="text-sm font-mono text-red-400 font-bold">WARNING</p>
          <p className="text-sm font-mono text-red-300 mt-1">
            Month 1 may LOSE $200–500 while learning. This is NOT a money printer.
          </p>
        </div>
      </section>

      {/* Section 3: Quick Start */}
      <section id="quick-start">
        <h2 className="text-xl font-bold font-mono text-white mb-2">Quick Start</h2>
        <p className="text-sm font-mono text-[#8892B0] mb-4">
          Setup takes ~15 minutes. You need: a Polymarket account, a VPS ($10-20/mo), and a terminal.
        </p>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-mono text-white mb-2">
              <span className="text-[#00D9FF] font-bold">Step 1:</span> Create Polymarket wallet
            </p>
            <p className="text-sm font-mono text-[#8892B0]">
              Go to <span className="text-[#00D9FF]">polymarket.com</span> → connect wallet → save your{' '}
              <span className="text-yellow-400">PRIVATE KEY</span> securely.
            </p>
          </div>

          <div>
            <p className="text-sm font-mono text-white mb-2">
              <span className="text-[#00D9FF] font-bold">Step 2:</span> Rent VPS
            </p>
            <p className="text-sm font-mono text-[#8892B0]">
              DigitalOcean $10–20/mo — 2GB RAM, Ubuntu 24.
            </p>
          </div>

          <div>
            <p className="text-sm font-mono text-white mb-2">
              <span className="text-[#00D9FF] font-bold">Step 3:</span> Install
            </p>
            <CopyBlock code={`ssh root@YOUR_VPS_IP
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm pm2
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader && git checkout main
pnpm install --ignore-scripts
cp .env.example .env`} />
          </div>

          <div>
            <p className="text-sm font-mono text-white mb-2">
              <span className="text-[#00D9FF] font-bold">Step 4:</span> Configure .env
            </p>
            <CopyBlock code={`PRIVATE_KEY=0x_your_private_key
DRY_RUN=true
MAX_BANKROLL=200
MM_SPREAD=0.10
MM_SIZE=20
MM_MAX_MARKETS=5
# License key (omit = FREE tier: 1 market, 5 trades/day)
# RAAS_LICENSE_KEY=your_license_key_here`} />
            <div className="mt-3 border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3">
              <p className="text-xs font-mono text-yellow-400 font-bold mb-1">License Tiers</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono text-[#8892B0]">
                <div className="bg-[#1A1A2E] rounded p-2">
                  <span className="text-white block mb-1">FREE</span>
                  1 market · 5 trades/day · no WS/micro-price
                </div>
                <div className="bg-[#1A1A2E] rounded p-2">
                  <span className="text-[#00D9FF] block mb-1">PRO</span>
                  10 markets · unlimited · all features
                </div>
                <div className="bg-[#1A1A2E] rounded p-2">
                  <span className="text-yellow-400 block mb-1">ENTERPRISE</span>
                  999 markets · unlimited · all features
                </div>
              </div>
              <p className="text-xs font-mono text-[#8892B0] mt-2">
                Generate key:{' '}
                <span className="text-[#00FF41]">pnpm license:generate pro 365</span>
                {' '}(run on your server)
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-mono text-white mb-2">
              <span className="text-[#00D9FF] font-bold">Step 5:</span> Run bot
            </p>
            <CopyBlock code="pm2 start pnpm --name cashclaw -- run polymarket" />
          </div>
        </div>
      </section>

      {/* Section 4: Daily Operations */}
      <section id="daily-ops">
        <h2 className="text-xl font-bold font-mono text-white mb-1">Daily Operations</h2>
        <p className="text-sm font-mono text-[#8892B0] mb-4">5 min/day</p>
        <div className="space-y-4">
          <div>
            <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">Check status</p>
            <CopyBlock code="pm2 status" />
          </div>
          <div>
            <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">View logs</p>
            <CopyBlock code="pm2 logs cashclaw --lines 30" />
          </div>
          <div>
            <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">Check portfolio</p>
            <p className="text-sm font-mono text-[#8892B0]">
              Open <span className="text-[#00D9FF]">polymarket.com</span> → My Portfolio → verify positions and P&L.
            </p>
          </div>
          <div>
            <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">Daily log template</p>
            <CopyBlock code={`# Date: YYYY-MM-DD
# Capital: $XXX
# Fills today: XX
# P&L: +$XX / -$XX
# Notes: `} />
          </div>
        </div>
      </section>

      {/* Section 5: Parameters */}
      <section id="parameters">
        <h2 className="text-xl font-bold font-mono text-white mb-4">Parameters</h2>
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-sm font-mono border-collapse">
            <thead>
              <tr className="border-b border-[#2D3142]">
                <th className="text-left py-2 pr-6 text-[#00D9FF]">Parameter</th>
                <th className="text-left py-2 pr-4 text-[#00FF41]">Safe</th>
                <th className="text-left py-2 pr-4 text-[#00D9FF]">Optimal</th>
                <th className="text-left py-2 text-red-400">Dangerous</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#2D3142]">
              <tr>
                <td className="py-2 pr-6 text-white">MM_SPREAD</td>
                <td className="py-2 pr-4 text-[#00FF41]">0.10</td>
                <td className="py-2 pr-4">0.06–0.08</td>
                <td className="py-2 text-red-400">&lt;0.04</td>
              </tr>
              <tr>
                <td className="py-2 pr-6 text-white">MM_SIZE</td>
                <td className="py-2 pr-4 text-[#00FF41]">20</td>
                <td className="py-2 pr-4">30–50</td>
                <td className="py-2 text-red-400">&gt;100</td>
              </tr>
              <tr>
                <td className="py-2 pr-6 text-white">MM_MAX_MARKETS</td>
                <td className="py-2 pr-4 text-[#00FF41]">5</td>
                <td className="py-2 pr-4">8–10</td>
                <td className="py-2 text-red-400">&gt;15</td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="space-y-2 text-sm font-mono">
          <p className="text-white font-bold mb-2">Tuning rules:</p>
          <p>Fills &lt;3/day → reduce spread (tighter)</p>
          <p>Fills &gt;30/day → increase spread (wider)</p>
          <p>2-day loss → widen spread + reduce size</p>
        </div>
      </section>

      {/* Section 6: Fair Value Mode */}
      <section id="fair-value">
        <h2 className="text-xl font-bold font-mono text-white mb-4">Fair Value Mode</h2>
        <div className="space-y-4 text-sm font-mono leading-relaxed">
          <p>
            By default, the bot quotes around the <span className="text-white">market midpoint</span> — it has no opinion on the true probability.
            This is <span className="text-yellow-400">BLIND MODE</span>: you earn spread but risk adverse selection from informed traders.
          </p>
          <p>
            When you set your own probability estimate in <span className="text-[#00D9FF]">data/fair-values.json</span>, the bot quotes
            around <span className="text-white">your value</span> instead. This is{' '}
            <span className="text-[#00FF41] font-bold">INFORMED MODE</span>: your edge comes from knowing the true probability better than the market.
          </p>

          <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4">
            <p className="text-[#00D9FF] font-bold mb-2">Example</p>
            <p>Market mid: <span className="text-white">0.45</span> — Your estimate: <span className="text-[#00FF41]">0.30</span></p>
            <p className="mt-1">Bot quotes BID @ <span className="text-[#00FF41]">0.27</span> / ASK @ <span className="text-[#00FF41]">0.33</span> (around your 0.30)</p>
            <p className="mt-1 text-[#8892B0]">You buy cheap if wrong-side takers push it up. You sell high when it reverts.</p>
          </div>

          <div>
            <p className="text-white font-bold mb-2">Confidence levels &amp; spreads</p>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-[#2D3142]">
                    <th className="text-left py-2 pr-6 text-[#00D9FF]">Confidence</th>
                    <th className="text-left py-2 pr-6 text-[#00D9FF]">Auto Spread</th>
                    <th className="text-left py-2 text-[#00D9FF]">When to use</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#2D3142]">
                  <tr>
                    <td className="py-2 pr-6 text-[#00FF41]">high</td>
                    <td className="py-2 pr-6">6¢</td>
                    <td className="py-2 text-[#8892B0]">Strong research, primary sources, high conviction</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-6 text-yellow-400">medium</td>
                    <td className="py-2 pr-6">8¢</td>
                    <td className="py-2 text-[#8892B0]">Good data, reasonable estimate, moderate conviction</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-6 text-[#8892B0]">low</td>
                    <td className="py-2 pr-6">12¢</td>
                    <td className="py-2 text-[#8892B0]">Rough guess, directional only, use wide spread</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <p className="text-white font-bold mb-2">Set a fair value</p>
            <CopyBlock code={`# List current estimates
pnpm fv:list

# Set estimate: slug value confidence [notes]
pnpm fv -- set will-btc-hit-100k 0.35 medium "Based on on-chain flow data"

# Remove estimate (reverts to blind mode for that market)
pnpm fv -- remove will-btc-hit-100k`} />
          </div>

          <div>
            <p className="text-white font-bold mb-2">Or edit data/fair-values.json directly</p>
            <CopyBlock code={`{
  "markets": {
    "will-btc-hit-100k": {
      "value": 0.35,
      "confidence": "medium",
      "spread_override": null,
      "notes": "Based on on-chain flow data",
      "updated": "2025-01-15"
    }
  }
}`} />
            <p className="text-[#8892B0] mt-2">The bot picks up file changes automatically — no restart needed.</p>
          </div>

          <div className="border-l-4 border-yellow-500 bg-yellow-500/10 px-4 py-3 rounded-r-lg">
            <p className="text-yellow-400 font-bold mb-1">Warning</p>
            <p className="text-yellow-300">
              If your fair value is more than 20¢ from the market mid, the bot logs a warning.
              Double-check your estimate — a large gap means either a big edge or a mistake.
            </p>
          </div>
        </div>
      </section>

      {/* Section 7: Troubleshooting */}
      <section id="troubleshooting">
        <h2 className="text-xl font-bold font-mono text-white mb-4">Troubleshooting</h2>
        <div className="space-y-2">
          <TroubleshootItem title="Bot stopped unexpectedly">
            <p>Restart the bot process:</p>
            <CopyBlock code="pm2 restart cashclaw" />
          </TroubleshootItem>
          <TroubleshootItem title="Balance drop &gt;10%">
            <p className="text-red-400">STOP immediately. Check logs. Widen spread before restart.</p>
            <CopyBlock code={`pm2 stop cashclaw
pm2 logs cashclaw --lines 50`} />
          </TroubleshootItem>
          <TroubleshootItem title="401 Unauthorized error">
            <p>API keys expired or invalid. Regenerate keys on Polymarket then restart:</p>
            <CopyBlock code={`# Edit .env with new PRIVATE_KEY
pm2 restart cashclaw`} />
          </TroubleshootItem>
          <TroubleshootItem title="Disk full">
            <p>Clear PM2 logs to free disk space:</p>
            <CopyBlock code="pm2 flush" />
          </TroubleshootItem>
          <TroubleshootItem title="Internet / VPS down">
            <p>
              Polymarket heartbeat mechanism auto-cancels open orders after timeout. No action needed for short outages.
              Verify positions on polymarket.com after reconnect.
            </p>
          </TroubleshootItem>
        </div>
      </section>

      {/* Section 7: Emergency Stop */}
      <section id="emergency">
        <h2 className="text-xl font-bold font-mono text-white mb-4">Emergency Stop</h2>
        <div className="space-y-6">
          <div>
            <p className="text-sm font-mono text-[#00D9FF] font-bold mb-2">Level 1 — Quick stop</p>
            <CopyBlock code="pm2 stop cashclaw" />
          </div>
          <div>
            <p className="text-sm font-mono text-yellow-400 font-bold mb-2">Level 2 — Cancel all open orders</p>
            <CopyBlock code={`pm2 stop cashclaw
# Then go to polymarket.com → My Portfolio → Cancel All Orders`} />
          </div>
          <div>
            <p className="text-sm font-mono text-red-400 font-bold mb-2">Level 3 — Permanent shutdown</p>
            <CopyBlock code={`pm2 delete cashclaw
# Then go to polymarket.com → withdraw all USDC`} />
          </div>
        </div>
      </section>

      {/* Section 8: Glossary */}
      <section id="glossary">
        <h2 className="text-xl font-bold font-mono text-white mb-4">Glossary</h2>
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
                ['bid', 'Buy price — the highest price you are willing to pay'],
                ['ask', 'Sell price — the lowest price you are willing to sell at'],
                ['spread', 'Difference between bid and ask — this is your profit per fill'],
                ['fill', 'Order match — someone accepted your price'],
                ['inventory', 'Number of tokens currently held in your wallet'],
                ['adverse selection', 'Losing when counterparty knows more than you about the market outcome'],
                ['maker rebate', 'Daily reward Polymarket pays you for providing liquidity (placing orders)'],
                ['micro-price', 'Volume-weighted midpoint between best bid and ask — fairer than simple midpoint'],
                ['DRY_RUN', 'Simulation mode — no real money, safe to test strategies'],
              ].map(([term, def]) => (
                <tr key={term}>
                  <td className="py-2 pr-6 text-white">{term}</td>
                  <td className="py-2 text-[#8892B0]">{def}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
