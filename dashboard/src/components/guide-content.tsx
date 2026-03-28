/**
 * Main guide/SOPs content — imports modular sections.
 * Used by both /docs (public) and /app/guide (app) routes.
 * Updated: 2026-03-28
 */
import { GuideInfrastructure } from './guide-section-infrastructure';
import { GuideM1MaxSetup } from './guide-section-m1-max-setup';
import { GuideVpsSetup } from './guide-section-vps-setup';
import { GuidePaymentSetup } from './guide-section-payment-setup';
import { GuideCouponManagement } from './guide-section-coupon-management';
import { GuideMonitoring } from './guide-section-monitoring';
import { InfoBanner } from './guide-shared-components';

export function GuideContent() {
  return (
    <div className="space-y-16 text-[#8892B0]">

      {/* Banner */}
      <InfoBanner color="cyan" label="CashClaw v2 — Hybrid Infrastructure (2026)">
        <p>
          M1 Max local server (primary) + VPS failover. CF Pages for static sites, CF Workers for auth,
          CF Tunnel for API. NOWPayments USDT across 4 projects.
        </p>
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="bg-[#1A1A2E] rounded p-2">
            <span className="text-[#00FF41]">Primary:</span> M1 Max (64GB, MLX LLMs)
          </div>
          <div className="bg-[#1A1A2E] rounded p-2">
            <span className="text-[#00D9FF]">Edge:</span> CF Pages + Workers + Tunnel
          </div>
          <div className="bg-[#1A1A2E] rounded p-2">
            <span className="text-yellow-400">Payments:</span> NOWPayments USDT TRC20
          </div>
        </div>
      </InfoBanner>

      {/* Table of Contents */}
      <nav aria-label="Table of contents">
        <p className="text-xs font-mono text-[#00D9FF] uppercase tracking-widest mb-3">Contents</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm font-mono">
          {[
            { href: '#infrastructure', label: '1. Infrastructure Overview' },
            { href: '#m1-max-setup', label: '2. M1 Max Setup' },
            { href: '#vps-setup', label: '3. VPS / Cloud Setup' },
            { href: '#payment-setup', label: '4. Payment Setup' },
            { href: '#coupon-management', label: '5. Coupon Management' },
            { href: '#monitoring', label: '6. Monitoring & Operations' },
          ].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="text-[#8892B0] hover:text-[#00D9FF] transition-colors"
            >
              {item.label}
            </a>
          ))}
        </div>
      </nav>

      <GuideInfrastructure />
      <GuideM1MaxSetup />
      <GuideVpsSetup />
      <GuidePaymentSetup />
      <GuideCouponManagement />
      <GuideMonitoring />

    </div>
  );
}
