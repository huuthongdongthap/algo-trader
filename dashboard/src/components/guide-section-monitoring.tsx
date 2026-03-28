/**
 * Guide section: Monitoring, health checks, and daily operations.
 */
import { CopyBlock, CollapsibleItem } from './guide-shared-components';

export function GuideMonitoring() {
  return (
    <section id="monitoring">
      <h2 className="text-xl font-bold font-mono text-white mb-2">Monitoring & Operations</h2>
      <p className="text-sm font-mono text-[#8892B0] mb-4">
        Health checks, logs, and daily maintenance. 5 min/day.
      </p>

      <div className="space-y-6">
        {/* Health Check */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Health Check</p>
          <CopyBlock code={`# API health
curl https://api.cashclaw.cc/health

# Expected: {"status":"ok","uptime":...}`} />
        </div>

        {/* PM2 Management */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">PM2 Process Management</p>
          <CopyBlock code={`# Status of all processes
pm2 status

# View logs (real-time)
pm2 logs algo-trade
pm2 logs algo-trade --lines 50

# Restart a process
pm2 restart algo-trade

# Restart all
pm2 restart all

# Clear old logs
pm2 flush`} />
        </div>

        {/* Metrics */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Prometheus Metrics</p>
          <p className="text-sm font-mono text-[#8892B0] mb-2">
            Metrics endpoint available at <span className="text-white">/metrics</span> (Bearer token required).
          </p>
          <CopyBlock code={`curl -H "Authorization: Bearer your_metrics_token" \\
  https://api.cashclaw.cc/metrics`} />
        </div>

        {/* Sentry */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Error Tracking (Sentry)</p>
          <p className="text-sm font-mono text-[#8892B0]">
            Sentry configured for production error tracking.
            Errors from API server and dashboard are captured automatically.
            Check Sentry dashboard for unhandled exceptions and performance issues.
          </p>
        </div>

        {/* Daily Checklist */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Daily Operator Checklist</p>
          <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4 text-sm font-mono text-[#8892B0] space-y-1">
            <p>1. <span className="text-[#00FF41]">pm2 status</span> — all processes online?</p>
            <p>2. <span className="text-[#00FF41]">curl api.cashclaw.cc/health</span> — API responding?</p>
            <p>3. Check Sentry — any new errors?</p>
            <p>4. Check NOWPayments dashboard — pending payments?</p>
            <p>5. Review <span className="text-white">pm2 logs algo-trade --lines 20</span> for warnings</p>
          </div>
        </div>

        {/* Emergency */}
        <div>
          <p className="text-sm font-mono text-red-400 font-bold mb-2">Emergency Procedures</p>
          <div className="space-y-2">
            <CollapsibleItem title="API server down">
              <CopyBlock code={`pm2 restart algo-trade
# If still down, check logs:
pm2 logs algo-trade --lines 50
# Nuclear option:
pm2 delete algo-trade
pm2 start "npx tsx src/app.ts" --name algo-trade`} />
            </CollapsibleItem>
            <CollapsibleItem title="CF Tunnel disconnected">
              <CopyBlock code={`# Check tunnel status
cloudflared tunnel info e568b5a2-ffe0-40bf-8f44-dd558e6c2767
# Restart tunnel
cloudflared tunnel run e568b5a2-ffe0-40bf-8f44-dd558e6c2767`} />
            </CollapsibleItem>
            <CollapsibleItem title="Bot losing money rapidly">
              <p className="text-red-400">STOP immediately. Widen spreads before restarting.</p>
              <CopyBlock code={`pm2 stop algo-trade
# Edit .env: increase MM_SPREAD, decrease MM_SIZE
pm2 restart algo-trade`} />
            </CollapsibleItem>
          </div>
        </div>
      </div>
    </section>
  );
}
