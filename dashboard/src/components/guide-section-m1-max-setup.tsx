/**
 * Guide section: Quick Start — customer VPS setup guide.
 * Generic instructions for any VPS provider, no internal IPs.
 */
import { CopyBlock, CollapsibleItem } from './guide-shared-components';

export function GuideQuickStart() {
  return (
    <section id="quick-start">
      <h2 className="text-xl font-bold font-mono text-white mb-2">Quick Start</h2>
      <p className="text-sm font-mono text-[#8892B0] mb-4">
        Setup takes ~15 minutes. You need: a Polymarket account, a VPS ($10-20/mo), and a terminal.
      </p>

      <div className="space-y-6">
        {/* Step 1 */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 1:</span> Create Polymarket Wallet
          </p>
          <p className="text-sm font-mono text-[#8892B0]">
            Go to <span className="text-[#00D9FF]">polymarket.com</span> &rarr; connect wallet &rarr; save your{' '}
            <span className="text-yellow-400">PRIVATE KEY</span> securely.
            Fund your wallet with at least $100 USDC on Polygon.
          </p>
        </div>

        {/* Step 2 */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 2:</span> Rent a VPS
          </p>
          <p className="text-sm font-mono text-[#8892B0] mb-2">
            Any Linux VPS works. Recommended: DigitalOcean, Hetzner, or Vultr.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-[#2D3142]">
                  <th className="text-left py-2 pr-4 text-[#00D9FF]">Provider</th>
                  <th className="text-left py-2 pr-4 text-[#00D9FF]">Price</th>
                  <th className="text-left py-2 text-[#00D9FF]">Specs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3142]">
                <tr>
                  <td className="py-2 pr-4 text-white">DigitalOcean</td>
                  <td className="py-2 pr-4">$12/mo</td>
                  <td className="py-2">2GB RAM, Ubuntu 24, 1 vCPU</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-white">Hetzner</td>
                  <td className="py-2 pr-4">$5/mo</td>
                  <td className="py-2">4GB RAM, Ubuntu 24, 2 vCPU</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-white">Vultr</td>
                  <td className="py-2 pr-4">$6/mo</td>
                  <td className="py-2">2GB RAM, Ubuntu 24, 1 vCPU</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Step 3 */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 3:</span> Install CashClaw
          </p>
          <CopyBlock code={`ssh root@YOUR_VPS_IP

# Install Node.js 20 + tools
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm pm2

# Clone CashClaw
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader && git checkout main
pnpm install --ignore-scripts

# Copy config template
cp .env.example .env`} />
        </div>

        {/* Step 4 */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 4:</span> Configure .env
          </p>
          <CopyBlock code={`# Your Polymarket credentials
PRIVATE_KEY=0x_your_private_key
DRY_RUN=true    # START WITH TRUE! Test before live trading

# Trading parameters (safe defaults)
MAX_BANKROLL=200
MM_SPREAD=0.10
MM_SIZE=20
MM_MAX_MARKETS=5

# License (omit = FREE tier: 1 market, 5 trades/day)
# RAAS_LICENSE_KEY=your_license_key_here`} />
          <div className="mt-3 border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-3">
            <p className="text-xs font-mono text-yellow-400 font-bold mb-1">License Tiers</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs font-mono text-[#8892B0]">
              <div className="bg-[#1A1A2E] rounded p-2">
                <span className="text-white block mb-1">Starter ($49/mo)</span>
                1 strategy &middot; Polymarket only
              </div>
              <div className="bg-[#1A1A2E] rounded p-2">
                <span className="text-[#00D9FF] block mb-1">Pro ($149/mo)</span>
                5 strategies &middot; all markets &middot; AI scanner
              </div>
              <div className="bg-[#1A1A2E] rounded p-2">
                <span className="text-yellow-400 block mb-1">Elite ($499/mo)</span>
                Unlimited &middot; all features &middot; dedicated support
              </div>
            </div>
          </div>
        </div>

        {/* Step 5 */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 5:</span> Start the Bot
          </p>
          <CopyBlock code={`# Start in DRY RUN first (no real money)
pm2 start "npx tsx src/app.ts" --name cashclaw

# Check it's running
pm2 status

# View live logs
pm2 logs cashclaw --lines 30

# Save PM2 config (auto-restart on reboot)
pm2 save && pm2 startup`} />
        </div>

        {/* Step 6 */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 6:</span> Go Live
          </p>
          <p className="text-sm font-mono text-[#8892B0] mb-2">
            After 2-3 days of successful DRY_RUN, switch to live trading:
          </p>
          <CopyBlock code={`# Edit .env: change DRY_RUN=false
nano .env

# Restart with live trading
pm2 restart cashclaw`} />
          <div className="mt-3 border-l-4 border-red-500 bg-red-500/10 px-4 py-3 rounded-r-lg">
            <p className="text-sm font-mono text-red-400 font-bold">Before going live</p>
            <p className="text-sm font-mono text-red-300 mt-1">
              Start with small bankroll ($100-200). Watch for 48 hours. Scale up slowly.
            </p>
          </div>
        </div>

        {/* Docker alternative */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Alternative: Docker Setup</p>
          <CollapsibleItem title="Use Docker instead of bare metal">
            <CopyBlock code={`# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone and run
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader
cp .env.example .env
# Edit .env with your keys

docker compose up -d
docker compose logs -f cashclaw`} />
          </CollapsibleItem>
        </div>

        {/* Apple Silicon */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Alternative: Apple Silicon (M1/M2/M3/M4)</p>
          <CollapsibleItem title="Run on your Mac instead of VPS">
            <p className="mb-2">If you have a Mac with Apple Silicon, you can run CashClaw locally with bonus AI features:</p>
            <CopyBlock code={`# Clone and install (same as VPS)
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader && git checkout main
pnpm install --ignore-scripts
cp .env.example .env

# Start bot
pm2 start "npx tsx src/app.ts" --name cashclaw`} />
            <p className="mt-2">
              <span className="text-[#00D9FF]">Bonus:</span> On Apple Silicon with 32GB+ RAM, you can run local AI models
              (Nemotron, DeepSeek R1) for enhanced market scanning without API costs.
            </p>
          </CollapsibleItem>
        </div>
      </div>
    </section>
  );
}
