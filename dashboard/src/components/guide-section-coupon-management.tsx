/**
 * Guide section: Daily Operations — customer-facing monitoring and daily tasks.
 */
import { CopyBlock } from './guide-shared-components';

export function GuideDailyOps() {
  return (
    <section id="daily-ops">
      <h2 className="text-xl font-bold font-mono text-white mb-1">Daily Operations</h2>
      <p className="text-sm font-mono text-[#8892B0] mb-4">5 min/day to keep your bot healthy.</p>

      <div className="space-y-6">
        {/* Status Check */}
        <div>
          <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">Check status</p>
          <CopyBlock code="pm2 status" />
        </div>

        {/* View Logs */}
        <div>
          <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">View logs</p>
          <CopyBlock code="pm2 logs cashclaw --lines 30" />
        </div>

        {/* Check Portfolio */}
        <div>
          <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">Check portfolio</p>
          <p className="text-sm font-mono text-[#8892B0]">
            Open <span className="text-[#00D9FF]">polymarket.com</span> &rarr; My Portfolio &rarr; verify positions and P&L.
          </p>
        </div>

        {/* Update Bot */}
        <div>
          <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">Update to latest version</p>
          <CopyBlock code={`cd ~/algo-trader
git pull origin main
pnpm install --ignore-scripts
pm2 restart cashclaw`} />
        </div>

        {/* Daily Log */}
        <div>
          <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">Daily log template</p>
          <CopyBlock code={`# Date: YYYY-MM-DD
# Capital: $___
# Fills today: ___
# P&L: +$__ / -$__
# Notes:`} />
        </div>

        {/* Dashboard */}
        <div>
          <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-2">Dashboard</p>
          <p className="text-sm font-mono text-[#8892B0]">
            This dashboard shows your bot status, active strategies, backtests, and P&L reporting.
            Navigate using the sidebar to explore all features.
          </p>
        </div>
      </div>
    </section>
  );
}
