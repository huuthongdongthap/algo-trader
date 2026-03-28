/**
 * Guide section: Infrastructure overview — current system architecture.
 */

export function GuideInfrastructure() {
  return (
    <section id="infrastructure">
      <h2 className="text-xl font-bold font-mono text-white mb-4">Infrastructure Overview</h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs font-mono mb-6">
        <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-3">
          <p className="text-[#00D9FF] font-bold mb-2">Landing</p>
          <p>cashclaw.cc</p>
          <p className="text-[#8892B0] mt-1">CF Pages &middot; project: algo-trader</p>
        </div>
        <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-3">
          <p className="text-[#00D9FF] font-bold mb-2">Dashboard</p>
          <p>cashclaw-dashboard.pages.dev</p>
          <p className="text-[#8892B0] mt-1">CF Pages &middot; React SPA</p>
        </div>
        <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-3">
          <p className="text-[#00D9FF] font-bold mb-2">API Server</p>
          <p>api.cashclaw.cc</p>
          <p className="text-[#8892B0] mt-1">CF Tunnel &rarr; M1 Max:3000 &middot; Express</p>
        </div>
        <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-3">
          <p className="text-[#00D9FF] font-bold mb-2">Auth</p>
          <p>algo-trader.agencyos-openclaw.workers.dev</p>
          <p className="text-[#8892B0] mt-1">CF Worker &middot; KV-backed JWT</p>
        </div>
      </div>

      <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4 text-xs font-mono text-[#8892B0]">
        <p className="text-white font-bold mb-2">Architecture Flow</p>
        <pre className="overflow-x-auto whitespace-pre">{`User Browser
  |
  +---> cashclaw.cc (CF Pages - static)
  +---> cashclaw-dashboard.pages.dev (CF Pages - SPA)
  |       |
  |       +---> CF Worker (Auth: signup/login/me)
  |       +---> api.cashclaw.cc (API calls)
  |                 |
  |                 +---> CF Tunnel (HTTP/2)
  |                         |
  |                         +---> M1 Max :3000 (Express API)
  |                                 +--- PM2: algo-trade
  |                                 +--- PM2: openclaw-daemon
  |                                 +--- PM2: openclaw-gateway :8000
  |                                 +--- PM2: paper-trading
  |
  +---> NOWPayments (USDT TRC20 checkout)
          |
          +---> IPN webhook --> api.cashclaw.cc/api/webhooks/nowpayments`}</pre>
      </div>
    </section>
  );
}
