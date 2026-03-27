/**
 * Sidebar navigation for CashClaw app routes (/app/*).
 * Active state via React Router useLocation.
 */
import { ReactNode } from 'react';
import { useLocation, Link } from 'react-router-dom';
import { useTradingStore } from '../stores/trading-store';
import { useAuthStore } from '../stores/auth-store';

interface NavItem {
  label: string;
  path: string;
  icon: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: 'Dashboard',
    path: '/app',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    label: 'Strategies',
    path: '/app/strategies',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
      </svg>
    ),
  },
  {
    label: 'Backtests',
    path: '/app/backtests',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
      </svg>
    ),
  },
  {
    label: 'Licenses',
    path: '/app/licenses',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    ),
  },
  {
    label: 'Reporting',
    path: '/app/reporting',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
      </svg>
    ),
  },
  {
    label: 'Settings',
    path: '/app/settings',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
    ),
  },
  {
    label: 'Account',
    path: '/app/account',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
      </svg>
    ),
  },
  {
    label: 'Guide',
    path: '/app/guide',
    icon: (
      <svg width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      </svg>
    ),
  },
];

interface SidebarNavigationProps {
  onNavigate?: () => void;
}

export function SidebarNavigation({ onNavigate }: SidebarNavigationProps) {
  const { pathname } = useLocation();
  const connected = useTradingStore((s: any) => s.connected);
  const { email, tier, logout } = useAuthStore();

  const tierBadge: Record<string, string> = {
    free: 'text-[#8892B0] bg-[#2D3142]',
    pro: 'text-[#00D9FF] bg-[#00D9FF]/10',
    enterprise: 'text-[#FFD700] bg-[#FFD700]/10',
  };
  const badgeClass = tierBadge[tier] ?? tierBadge['free'];

  const isActive = (path: string) =>
    path === '/app' ? pathname === '/app' : pathname.startsWith(path);

  return (
    <nav className="flex flex-col h-full">
      <ul className="flex-1 py-2">
        {NAV_ITEMS.map(({ label, path, icon }) => {
          const active = isActive(path);
          return (
            <li key={path}>
              <Link
                to={path}
                onClick={onNavigate}
                className={`
                  flex items-center gap-3 px-4 py-2.5 text-sm font-mono transition-colors
                  ${active
                    ? 'text-accent bg-accent/10 border-l-2 border-accent'
                    : 'text-muted hover:text-white border-l-2 border-transparent'
                  }
                `}
              >
                <span className="flex-shrink-0">{icon}</span>
                {label}
              </Link>
            </li>
          );
        })}
      </ul>

      {/* User info + logout */}
      <div className="px-4 pb-2 border-t border-bg-border pt-3 space-y-2">
        {email && (
          <div className="flex items-center gap-2 min-w-0">
            <p className="text-muted text-xs font-mono truncate flex-1">{email}</p>
            <span className={`flex-shrink-0 text-[10px] font-bold font-mono px-1.5 py-0.5 rounded uppercase ${badgeClass}`}>
              {tier}
            </span>
          </div>
        )}
        <button
          onClick={logout}
          className="w-full text-left text-xs font-mono text-muted hover:text-loss transition-colors py-1"
        >
          Sign out
        </button>
      </div>

      {/* Connection status */}
      <div className="p-4 border-t border-bg-border">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              connected ? 'bg-profit shadow-[0_0_6px_#00FF41]' : 'bg-loss'
            }`}
          />
          <span className="text-xs font-mono text-muted">
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
      </div>
    </nav>
  );
}
