import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from './components/error-boundary';
import { LayoutShell } from './components/layout-shell';
import { AuthGuard } from './components/auth-guard';
import { DashboardPage } from './pages/dashboard-page';
import { BacktestsPage } from './pages/backtests-page';
import { MarketplacePage } from './pages/marketplace-page';
import { SettingsPage } from './pages/settings-page';
import { ReportingPage } from './pages/reporting-page';
import { LicensePage } from './pages/license-page';
import { LandingPage } from './pages/landing-page';
import { PricingPage } from './pages/pricing-page';
import { LoginPage } from './pages/login-page';
import { SignupPage } from './pages/signup-page';
import { DocsPage } from './pages/docs-page';
import { GuidePage } from './pages/guide-page';
import { AccountPage } from './pages/account-page';

/**
 * Handle uncaught errors in the app.
 * Logs to console and can be extended to send to Sentry/etc.
 */
function handleGlobalError(error: Error): void {
  console.error('[App] Uncaught error:', error);
  // Future: Send to Sentry or other error tracking service
}

export function App() {
  return (
    <ErrorBoundary onError={handleGlobalError}>
      <Routes>
        {/* Public routes - full page, no sidebar */}
        <Route path="/" element={<LandingPage />} />
        <Route path="/pricing" element={<PricingPage />} />
        <Route path="/docs" element={<DocsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* App routes - sidebar layout, auth required */}
        <Route path="/app" element={<AuthGuard><LayoutShell><DashboardPage /></LayoutShell></AuthGuard>} />
        <Route path="/app/strategies" element={<AuthGuard><LayoutShell><MarketplacePage /></LayoutShell></AuthGuard>} />
        <Route path="/app/backtests" element={<AuthGuard><LayoutShell><BacktestsPage /></LayoutShell></AuthGuard>} />
        <Route path="/app/licenses" element={<AuthGuard><LayoutShell><LicensePage /></LayoutShell></AuthGuard>} />
        <Route path="/app/reporting" element={<AuthGuard><LayoutShell><ReportingPage /></LayoutShell></AuthGuard>} />
        <Route path="/app/settings" element={<AuthGuard><LayoutShell><SettingsPage /></LayoutShell></AuthGuard>} />
        <Route path="/app/guide" element={<AuthGuard><LayoutShell><GuidePage /></LayoutShell></AuthGuard>} />
        <Route path="/app/account" element={<AuthGuard><LayoutShell><AccountPage /></LayoutShell></AuthGuard>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}
