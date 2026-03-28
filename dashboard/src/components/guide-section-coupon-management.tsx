/**
 * Guide section: Coupon system management across all projects.
 */
import { CopyBlock } from './guide-shared-components';

export function GuideCouponManagement() {
  return (
    <section id="coupon-management">
      <h2 className="text-xl font-bold font-mono text-white mb-2">Coupon Management</h2>
      <p className="text-sm font-mono text-[#8892B0] mb-4">
        Create and manage discount codes across all 4 projects from one dashboard.
      </p>

      <div className="space-y-6">
        {/* Admin Dashboard */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Admin Dashboard</p>
          <p className="text-sm font-mono text-[#8892B0] mb-2">
            Navigate to{' '}
            <span className="text-[#00D9FF]">/app/coupons</span> in this dashboard.
            Requires an admin API key stored in localStorage as{' '}
            <span className="text-white">adminApiKey</span>.
          </p>
          <CopyBlock code={`# Set admin key in browser console
localStorage.setItem('adminApiKey', 'your_ADMIN_API_KEY')`} />
        </div>

        {/* API Endpoints */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Coupon API</p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <thead>
                <tr className="border-b border-[#2D3142]">
                  <th className="text-left py-2 pr-4 text-[#00D9FF]">Method</th>
                  <th className="text-left py-2 pr-4 text-[#00D9FF]">Endpoint</th>
                  <th className="text-left py-2 text-[#00D9FF]">Auth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#2D3142]">
                <tr>
                  <td className="py-2 pr-4 text-[#00FF41]">POST</td>
                  <td className="py-2 pr-4 text-white">/api/coupons</td>
                  <td className="py-2">X-API-Key (admin)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-[#00FF41]">GET</td>
                  <td className="py-2 pr-4 text-white">/api/coupons</td>
                  <td className="py-2">X-API-Key (admin)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-red-400">DELETE</td>
                  <td className="py-2 pr-4 text-white">/api/coupons/:code</td>
                  <td className="py-2">X-API-Key (admin)</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-[#00FF41]">POST</td>
                  <td className="py-2 pr-4 text-white">/api/coupons/apply</td>
                  <td className="py-2">Public</td>
                </tr>
                <tr>
                  <td className="py-2 pr-4 text-[#00FF41]">POST</td>
                  <td className="py-2 pr-4 text-white">/api/coupons/activate</td>
                  <td className="py-2">Public</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Create coupon via curl */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Create Coupon (CLI)</p>
          <CopyBlock code={`curl -X POST https://api.cashclaw.cc/api/coupons \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: your_ADMIN_API_KEY" \\
  -d '{
    "code": "LAUNCH50",
    "discountPercent": 50,
    "maxUses": 100,
    "expiresAt": "2026-12-31",
    "tiers": ["STARTER", "PRO", "ELITE"]
  }'`} />
        </div>

        {/* Free coupon flow */}
        <div>
          <p className="text-sm font-mono text-white font-bold mb-2">Free Coupon Flow (100% discount)</p>
          <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-4 text-xs font-mono text-[#8892B0]">
            <pre className="overflow-x-auto whitespace-pre">{`1. User enters coupon code on landing page
2. API returns discountedPrice = 0
3. Landing shows signup modal (email + password)
4. Modal calls CF Worker /api/auth/signup
5. Account created in CF KV -> JWT token returned
6. Token saved to localStorage -> redirect to /app
7. User auto-logged into dashboard`}</pre>
          </div>
        </div>

        {/* Persistence */}
        <div className="border border-yellow-500/30 bg-yellow-500/5 rounded-lg p-4">
          <p className="text-sm font-mono text-yellow-400 font-bold mb-1">Persistence</p>
          <p className="text-sm font-mono text-[#8892B0]">
            Coupons persist in <span className="text-white">data/coupons.json</span> on M1 Max.
            Survives PM2 restarts. Loaded on server startup, saved on create/use/deactivate.
          </p>
        </div>
      </div>
    </section>
  );
}
