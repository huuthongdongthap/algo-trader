/**
 * Guide section: M1 Max local server setup instructions.
 */
import { CopyBlock, CollapsibleItem } from './guide-shared-components';

export function GuideM1MaxSetup() {
  return (
    <section id="m1-max-setup">
      <h2 className="text-xl font-bold font-mono text-white mb-2">M1 Max Setup (Primary)</h2>
      <p className="text-sm font-mono text-[#8892B0] mb-4">
        Local server on Apple Silicon. SSH access + PM2 process management + CF Tunnel.
      </p>

      <div className="space-y-6">
        {/* SSH Access */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 1:</span> SSH into M1 Max
          </p>
          <CopyBlock code="ssh macbook@192.168.11.111" />
        </div>

        {/* Clone & Install */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 2:</span> Clone and install
          </p>
          <CopyBlock code={`git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader && git checkout main
pnpm install --ignore-scripts
cp .env.example .env`} />
        </div>

        {/* Env Config */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 3:</span> Configure .env
          </p>
          <CopyBlock code={`# Required API keys
NOWPAYMENTS_API_KEY=your_nowpayments_api_key
NOWPAYMENTS_IPN_SECRET=your_ipn_secret
ADMIN_API_KEY=your_admin_key

# Polymarket
PRIVATE_KEY=0x_your_private_key
DRY_RUN=true

# Server
PORT=3000
NODE_ENV=production

# Local LLMs (MLX on M1 Max)
OPENCLAW_GATEWAY_URL=http://localhost:11435/v1
OPENCLAW_SCANNER_URL=http://localhost:11436/v1`} />
        </div>

        {/* PM2 Processes */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 4:</span> Start PM2 processes
          </p>
          <CopyBlock code={`# API server (entry: src/app.ts)
pm2 start "npx tsx src/app.ts" --name algo-trade

# OpenClaw daemon (AI agent coordinator)
pm2 start "npx tsx src/openclaw/daemon.ts" --name openclaw-daemon

# OpenClaw gateway (LLM proxy :8000)
pm2 start "npx tsx src/openclaw/gateway.ts" --name openclaw-gateway

# Paper trading (risk-free validation)
pm2 start "npx tsx src/paper-trading/runner.ts" --name paper-trading

# Save PM2 config for auto-restart
pm2 save`} />
        </div>

        {/* CF Tunnel */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 5:</span> Cloudflare Tunnel
          </p>
          <p className="text-sm font-mono text-[#8892B0] mb-2">
            Tunnel ID: <span className="text-white">e568b5a2-ffe0-40bf-8f44-dd558e6c2767</span> (HTTP/2 protocol)
          </p>
          <CopyBlock code={`# Install cloudflared
brew install cloudflare/cloudflare/cloudflared

# Login (one-time)
cloudflared tunnel login

# Run tunnel (routes api.cashclaw.cc -> localhost:3000)
cloudflared tunnel run e568b5a2-ffe0-40bf-8f44-dd558e6c2767`} />
        </div>

        {/* Local LLMs */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Step 6:</span> Local LLMs (MLX)
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-[#2D3142]">
                  <th className="text-left py-2 pr-4 text-[#00D9FF]">Model</th>
                  <th className="text-left py-2 pr-4 text-[#00D9FF]">Purpose</th>
                  <th className="text-left py-2 pr-4 text-[#00D9FF]">Speed</th>
                  <th className="text-left py-2 text-[#00D9FF]">Port</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3142]">
                <tr>
                  <td className="py-2 pr-4 text-white">Nemotron-3 Nano</td>
                  <td className="py-2 pr-4">Fast scanner</td>
                  <td className="py-2 pr-4">35-50 t/s</td>
                  <td className="py-2">11436</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-white">DeepSeek R1</td>
                  <td className="py-2 pr-4">Deep reasoning</td>
                  <td className="py-2 pr-4">8-15 t/s</td>
                  <td className="py-2">11435</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-white">Qwen2.5 Coder</td>
                  <td className="py-2 pr-4">Code generation</td>
                  <td className="py-2 pr-4">20-30 t/s</td>
                  <td className="py-2">11437</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Troubleshooting */}
        <div className="space-y-2">
          <p className="text-sm font-mono text-white font-bold mb-2">Troubleshooting</p>
          <CollapsibleItem title="PM2 process keeps restarting">
            <p>Check logs for the specific process:</p>
            <CopyBlock code="pm2 logs algo-trade --lines 50" />
            <p className="mt-2">Common causes: missing .env keys, port already in use, TypeScript errors.</p>
          </CollapsibleItem>
          <CollapsibleItem title="CF Tunnel not connecting">
            <p>Verify tunnel status and credentials:</p>
            <CopyBlock code={`cloudflared tunnel info e568b5a2-ffe0-40bf-8f44-dd558e6c2767
# Restart tunnel
cloudflared tunnel run e568b5a2-ffe0-40bf-8f44-dd558e6c2767`} />
          </CollapsibleItem>
          <CollapsibleItem title="MLX model out of memory">
            <p>M1 Max has 64GB unified memory. If OOM, reduce concurrent models:</p>
            <CopyBlock code={`# Stop one model to free memory
pm2 stop openclaw-gateway
# Check memory usage
vm_stat | head -5`} />
          </CollapsibleItem>
        </div>
      </div>
    </section>
  );
}
