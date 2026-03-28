/**
 * Guide section: Trading Parameters — configuration and tuning for customers.
 */
import { CopyBlock } from './guide-shared-components';

export function GuideParameters() {
  return (
    <section id="parameters">
      <h2 className="text-xl font-bold font-mono text-white mb-4">Trading Parameters</h2>

      <div className="space-y-6">
        {/* Parameter Table */}
        <div className="overflow-x-auto">
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
                <td className="py-2 pr-4">0.06-0.08</td>
                <td className="py-2 text-red-400">&lt;0.04</td>
              </tr>
              <tr>
                <td className="py-2 pr-6 text-white">MM_SIZE</td>
                <td className="py-2 pr-4 text-[#00FF41]">20</td>
                <td className="py-2 pr-4">30-50</td>
                <td className="py-2 text-red-400">&gt;100</td>
              </tr>
              <tr>
                <td className="py-2 pr-6 text-white">MM_MAX_MARKETS</td>
                <td className="py-2 pr-4 text-[#00FF41]">5</td>
                <td className="py-2 pr-4">8-10</td>
                <td className="py-2 text-red-400">&gt;15</td>
              </tr>
              <tr>
                <td className="py-2 pr-6 text-white">MAX_BANKROLL</td>
                <td className="py-2 pr-4 text-[#00FF41]">200</td>
                <td className="py-2 pr-4">500-2000</td>
                <td className="py-2 text-red-400">&gt;5000</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Tuning Rules */}
        <div className="space-y-2 text-sm font-mono">
          <p className="text-white font-bold mb-2">Tuning Rules</p>
          <p>Fills &lt;3/day &rarr; reduce spread (tighter)</p>
          <p>Fills &gt;30/day &rarr; increase spread (wider)</p>
          <p>2-day consecutive loss &rarr; widen spread + reduce size</p>
          <p>Consistent profit &rarr; slowly increase MM_SIZE by 10</p>
        </div>

        {/* Fair Value Mode */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Fair Value Mode (Advanced)</p>
          <div className="text-sm font-mono text-[#8892B0] space-y-2">
            <p>
              By default the bot quotes around the <span className="text-white">market midpoint</span> (blind mode).
              Set your own probability estimate for better edge:
            </p>
            <CopyBlock code={`# List current estimates
pnpm fv:list

# Set estimate: slug value confidence [notes]
pnpm fv -- set will-btc-hit-100k 0.35 medium "Based on on-chain data"

# Remove estimate (revert to blind mode)
pnpm fv -- remove will-btc-hit-100k`} />
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-xs font-mono border-collapse">
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
                    <td className="py-2 pr-6">6c</td>
                    <td className="py-2">Strong research, primary sources</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-6 text-yellow-400">medium</td>
                    <td className="py-2 pr-6">8c</td>
                    <td className="py-2">Good data, reasonable estimate</td>
                  </tr>
                  <tr>
                    <td className="py-2 pr-6 text-[#8892B0]">low</td>
                    <td className="py-2 pr-6">12c</td>
                    <td className="py-2">Rough guess, directional only</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
