/**
 * Login page — centered card, calls auth-store login(), redirects to /app.
 */
import { useState, FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/auth-store';
import { PublicNavbar } from '../components/public-navbar';

export function LoginPage() {
  const navigate = useNavigate();
  const { login, loading, error: storeError } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');

  const displayError = localError || storeError;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setLocalError('');
    if (!email.trim() || !password.trim()) {
      setLocalError('Email and password are required.');
      return;
    }
    await login(email.trim(), password);
    // If no error in store after login, navigate
    const { error, loggedIn } = useAuthStore.getState();
    if (loggedIn && !error) {
      navigate('/app');
    }
  }

  return (
    <div className="min-h-screen bg-[#0F0F1A] font-mono flex flex-col">
      <PublicNavbar />

      <div className="flex-1 flex items-center justify-center px-4 pt-16">
        <div className="w-full max-w-sm">
          <div className="bg-[#1A1A2E] border border-[#2D3142] rounded-lg p-8">
            {/* Header */}
            <div className="mb-6">
              <p className="text-[#00D9FF] text-xs uppercase tracking-widest mb-2">Welcome back</p>
              <h1 className="text-white text-xl font-bold">Sign in to CashClaw</h1>
            </div>

            {displayError && (
              <div className="mb-4 px-3 py-2 bg-[#FF3366]/10 border border-[#FF3366]/30 rounded text-[#FF3366] text-xs">
                {displayError}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-[#8892B0] text-xs mb-1.5">Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  disabled={loading}
                  className="w-full bg-[#0F0F1A] border border-[#2D3142] rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#00D9FF] placeholder:text-[#8892B0]/50 transition-colors disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-[#8892B0] text-xs mb-1.5">Password</label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  disabled={loading}
                  className="w-full bg-[#0F0F1A] border border-[#2D3142] rounded px-3 py-2.5 text-white text-sm focus:outline-none focus:border-[#00D9FF] placeholder:text-[#8892B0]/50 transition-colors disabled:opacity-50"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-[#00D9FF] text-[#0F0F1A] font-bold text-sm py-2.5 rounded hover:bg-[#00D9FF]/80 transition-colors mt-2 disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            <p className="text-[#8892B0] text-xs text-center mt-6">
              No account?{' '}
              <Link to="/signup" className="text-[#00D9FF] hover:underline">
                Create one free
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
