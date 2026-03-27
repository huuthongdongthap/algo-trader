/**
 * Dashboard layout: sidebar navigation + main content area.
 * Dark theme, mobile-first responsive design.
 * - Sidebar: Hidden on mobile, slide-in with overlay
 * - Main: Full width on mobile, constrained on desktop
 * - Touch-friendly: 44px min tap targets
 */
import { ReactNode, useState } from 'react';
import { SidebarNavigation } from './sidebar-navigation';

export function LayoutShell({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-bg">
      {/* Mobile overlay - darkened backdrop when sidebar open */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm md:hidden transition-opacity"
          onClick={() => setSidebarOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - Fixed on mobile, static on desktop */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-bg-card border-r border-bg-border
          transform transition-transform duration-300 ease-in-out
          md:relative md:translate-x-0 md:z-auto
          ${sidebarOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:shadow-none'}
        `}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between h-14 px-4 border-b border-bg-border">
          <div>
            <h1 className="text-accent font-bold text-base tracking-tight">CashClaw</h1>
            <p className="text-muted text-[10px] mt-0.5">Polymarket MM</p>
          </div>
          {/* Close button - mobile only */}
          <button
            onClick={() => setSidebarOpen(false)}
            className="md:hidden p-2 text-muted hover:text-white rounded-lg hover:bg-bg-border transition-colors"
            aria-label="Close sidebar"
          >
            <svg width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-4">
          <SidebarNavigation onNavigate={() => setSidebarOpen(false)} />
        </nav>

        {/* Sidebar footer - version info */}
        <div className="p-4 border-t border-bg-border">
          <p className="text-[10px] text-muted">
            v5.6.0 • Beta
          </p>
        </div>
      </aside>

      {/* Main content area */}
      <main className="flex-1 overflow-y-auto flex flex-col min-w-0">
        {/* Mobile header - sticky top */}
        <header className="sticky top-0 z-30 md:hidden bg-bg/95 backdrop-blur supports-[backdrop-filter]:bg-bg/80 border-b border-bg-border">
          <div className="flex items-center justify-between h-14 px-4">
            <button
              onClick={() => setSidebarOpen(true)}
              className="p-2 -ml-2 text-muted hover:text-white rounded-lg hover:bg-bg-border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
              aria-label="Open menu"
            >
              <svg width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5" />
              </svg>
            </button>
            <span className="text-accent font-bold text-base">CashClaw</span>
            <div className="w-10" /> {/* Spacer for visual balance */}
          </div>
        </header>

        {/* Page content */}
        <div className="flex-1 p-4 sm:p-6 lg:p-8 overflow-y-auto">
          {children}
        </div>

        {/* Footer - desktop only */}
        <footer className="hidden md:block border-t border-bg-border py-3 px-8">
          <p className="text-xs text-muted text-center">
            Algo Trader v5.6.0 Beta • Real-time trading dashboard
          </p>
        </footer>
      </main>
    </div>
  );
}
