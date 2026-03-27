/**
 * Account page — profile, current plan, API key, billing, danger zone.
 */
import { useAuthStore } from '../stores/auth-store';
import { Link } from 'react-router-dom';
import { getTierLimits } from '../lib/tier-config';

const TIER_LABELS: Record<string, string> = {
  free: 'Free',
  pro: 'Pro',
  enterprise: 'Enterprise',
};

const TIER_BADGE_COLORS: Record<string, string> = {
  free: 'bg-[#2D3142] text-[#8892B0]',
  pro: 'bg-[#00D9FF]/10 text-[#00D9FF] border border-[#00D9FF]/30',
  enterprise: 'bg-[#FFD700]/10 text-[#FFD700] border border-[#FFD700]/30',
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-bg-card border border-bg-border rounded-lg p-6 space-y-4">
      <h2 className="text-white text-sm font-bold font-mono">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-bg-border last:border-0">
      <span className="text-muted text-xs font-mono">{label}</span>
      <span className="text-white text-xs font-mono">{value}</span>
    </div>
  );
}

export function AccountPage() {
  const { email, tier, tenantId, apiKey, token } = useAuthStore();

  const limits = getTierLimits(tier);
  const badgeClass = TIER_BADGE_COLORS[tier] ?? TIER_BADGE_COLORS['free'];
  const tierLabel = TIER_LABELS[tier] ?? tier;

  // Mask the API key — show prefix + first 8 chars then ****
  const maskedKey = apiKey
    ? apiKey.slice(0, 12) + '••••••••••••'
    : token
    ? 'algo_••••••••••••••••••••••••'
    : '—';

  const memberSince = (() => {
    // Derive from JWT iat if available, else show dash
    if (!token) return '—';
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return '—';
      const payload = JSON.parse(atob(parts[1]!.replace(/-/g, '+').replace(/_/g, '/')));
      if (payload.iat) return new Date(payload.iat * 1000).toLocaleDateString();
    } catch (error) {
      console.error('[Account Page] Failed to parse JWT:', error);
      /* ignore */ }
    return '—';
  })();

  return (
    <div className="space-y-6 max-w-2xl">
      <h1 className="text-white text-2xl font-bold font-mono">Account</h1>

      {/* Profile */}
      <Card title="Profile">
        <Row label="Email" value={email || '—'} />
        <Row label="Tenant ID" value={<code className="text-[#00D9FF] text-[10px]">{tenantId ?? '—'}</code>} />
        <Row label="Member since" value={memberSince} />
      </Card>

      {/* Current Plan */}
      <Card title="Current Plan">
        <div className="flex items-center justify-between mb-4">
          <span className={`px-2.5 py-1 rounded text-xs font-bold font-mono ${badgeClass}`}>
            {tierLabel}
          </span>
          <Link
            to="/pricing"
            className="text-xs font-mono text-[#00D9FF] hover:underline"
          >
            Upgrade plan →
          </Link>
        </div>
        <div className="space-y-0">
          <Row label="Trades / day" value={limits.tradesPerDay} />
          <Row label="Daily loss cap" value={limits.dailyLossCap} />
          <Row label="Max position size" value={limits.maxPosition} />
        </div>
      </Card>

      {/* API Key */}
      <Card title="API Key">
        <p className="text-muted text-xs font-mono">
          Use this key to authenticate CLI and programmatic access.
        </p>
        <div className="bg-[#0F0F1A] border border-[#2D3142] rounded px-4 py-3 flex items-center justify-between gap-3">
          <code className="text-[#00D9FF] text-xs font-mono">{maskedKey}</code>
          <button
            disabled
            title="Contact support to regenerate your API key"
            aria-label="Regenerate API key — contact support to enable"
            className="text-xs px-3 py-1.5 border border-[#2D3142] rounded text-muted font-mono cursor-not-allowed opacity-50"
          >
            Regenerate
          </button>
        </div>
        <p className="text-muted text-[10px] font-mono">
          Key regeneration is disabled.{' '}
          <a
            href="mailto:support@cashclaw.cc"
            className="text-[#00D9FF] hover:underline"
          >
            Contact support
          </a>{' '}
          to rotate your key.
        </p>
      </Card>

      {/* Billing */}
      <Card title="Billing">
        {tier === 'free' ? (
          <div className="flex items-center justify-between">
            <p className="text-muted text-xs font-mono">You're on the free plan.</p>
            <Link
              to="/pricing"
              className="bg-[#00D9FF] text-[#0F0F1A] font-bold text-xs px-4 py-2 rounded hover:bg-[#00D9FF]/80 transition-colors font-mono"
            >
              Upgrade
            </Link>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <p className="text-muted text-xs font-mono">
              Active <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${badgeClass}`}>{tierLabel}</span> subscription.
            </p>
            <Link
              to="/pricing"
              className="text-xs px-4 py-2 border border-[#2D3142] rounded text-[#00D9FF] hover:bg-[#00D9FF]/10 transition-colors font-mono"
            >
              Upgrade / Manage →
            </Link>
          </div>
        )}
      </Card>

      {/* Danger Zone */}
      <Card title="Danger Zone">
        <p className="text-muted text-xs font-mono">
          Permanently delete your account and all associated data.
        </p>
        <button
          disabled
          title="Contact support to delete your account"
          className="text-xs px-4 py-2 border border-[#FF3366]/30 rounded text-[#FF3366]/50 font-mono cursor-not-allowed opacity-50"
        >
          Delete Account
        </button>
      </Card>
    </div>
  );
}
