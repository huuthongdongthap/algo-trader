/**
 * Guide section: VPS/Cloud deployment setup (alternative to M1 Max).
 */
import { CopyBlock } from './guide-shared-components';

export function GuideVpsSetup() {
  return (
    <section id="vps-setup">
      <h2 className="text-xl font-bold font-mono text-white mb-2">VPS / Cloud Setup (Alternative)</h2>
      <p className="text-sm font-mono text-[#8892B0] mb-4">
        Deploy on any Linux VPS ($10-20/mo) as backup or primary. Docker or bare metal.
      </p>

      <div className="space-y-6">
        {/* Option A: Docker */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00FF41] font-bold">Option A:</span> Docker (recommended)
          </p>
          <CopyBlock code={`ssh root@YOUR_VPS_IP

# Install Docker
curl -fsSL https://get.docker.com | sh

# Clone and run
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader
cp .env.example .env
# Edit .env with your keys

# Single container
docker compose up -d

# Check status
docker compose ps
docker compose logs -f algo-trade`} />
        </div>

        {/* Option B: Bare metal */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Option B:</span> Bare metal (Node.js + PM2)
          </p>
          <CopyBlock code={`ssh root@YOUR_VPS_IP

# Install Node.js 20 + pnpm + PM2
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs
npm install -g pnpm pm2

# Clone and install
git clone https://github.com/longtho638-jpg/algo-trader.git
cd algo-trader && git checkout main
pnpm install --ignore-scripts
cp .env.example .env

# Start API server
pm2 start "npx tsx src/app.ts" --name algo-trade
pm2 save && pm2 startup`} />
        </div>

        {/* CI/CD */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-yellow-400 font-bold">CI/CD:</span> GitHub Actions
          </p>
          <p className="text-sm font-mono text-[#8892B0] mb-2">
            Push to <span className="text-white">main</span> triggers auto-deploy via GitHub Actions.
            Dashboard deploys to CF Pages. API updates require PM2 restart on VPS/M1 Max.
          </p>
          <CopyBlock code={`# On VPS: pull latest and restart
cd ~/algo-trader
git pull origin main
pnpm install --ignore-scripts
pm2 restart algo-trade`} />
        </div>

        {/* CF Worker Edge Proxy */}
        <div>
          <p className="text-sm font-mono text-white mb-2">
            <span className="text-[#00D9FF] font-bold">Edge Proxy:</span> CF Worker with KV Cache
          </p>
          <p className="text-sm font-mono text-[#8892B0]">
            Auth requests go through a CF Worker at{' '}
            <span className="text-white">algo-trader.agencyos-openclaw.workers.dev</span>.
            User accounts stored in CF KV. JWT tokens issued for dashboard auth.
            No database server needed for auth — fully serverless.
          </p>
        </div>

        {/* Parallel setup note */}
        <div className="border border-[#00D9FF]/30 bg-[#00D9FF]/5 rounded-lg p-4">
          <p className="text-sm font-mono text-[#00D9FF] font-bold mb-1">M1 Max + VPS in Parallel</p>
          <p className="text-sm font-mono text-[#8892B0] leading-relaxed">
            You can run M1 Max as primary (CF Tunnel for API) and VPS as failover.
            Both pull from the same Git repo. Only one should handle IPN webhooks at a time
            to avoid duplicate subscription activations.
          </p>
        </div>
      </div>
    </section>
  );
}
