/**
 * Auth store — persisted login state for CashClaw.
 * Zustand + localStorage persist middleware.
 * Supports real API calls with fallback to local state.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? '';

interface AuthState {
  loggedIn: boolean;
  email: string;
  tier: 'free' | 'pro' | 'enterprise';
  token: string | null;
  tenantId: string | null;
  apiKey: string | null;
  loading: boolean;
  error: string | null;
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, tier: 'free' | 'pro' | 'enterprise') => Promise<void>;
  fetchMe: () => Promise<void>;
  logout: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      loggedIn: false,
      email: '',
      tier: 'free',
      token: null,
      tenantId: null,
      apiKey: null,
      loading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ loading: true, error: null });
        try {
          const res = await fetch(`${API_BASE}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
          });
          const ct = res.headers.get('content-type') ?? '';
          if (!ct.includes('application/json')) {
            set({ loading: false, error: 'Backend chưa được cấu hình. Liên hệ support@cashclaw.cc' });
            return;
          }
          const data = await res.json();
          if (res.ok) {
            set({ loggedIn: true, token: data.token, tenantId: data.tenantId, email: data.email, tier: data.tier ?? 'free', loading: false });
            return;
          }
          set({ loading: false, error: data.error ?? 'Đăng nhập thất bại' });
        } catch {
          set({ loading: false, error: 'Không thể kết nối server. Vui lòng thử lại.' });
        }
      },

      signup: async (email: string, password: string, tier: 'free' | 'pro' | 'enterprise') => {
        set({ loading: true, error: null });
        try {
          const res = await fetch(`${API_BASE}/api/auth/signup`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password, tier }),
          });
          const ct = res.headers.get('content-type') ?? '';
          if (!ct.includes('application/json')) {
            set({ loading: false, error: 'Backend chưa được cấu hình. Liên hệ support@cashclaw.cc' });
            return;
          }
          const data = await res.json();
          if (res.ok) {
            set({ loggedIn: true, token: data.token, tenantId: data.tenantId, email: data.email, tier: data.tier ?? tier, apiKey: data.apiKey, loading: false });
            return;
          }
          set({ loading: false, error: data.error ?? 'Đăng ký thất bại' });
        } catch {
          set({ loading: false, error: 'Không thể kết nối server. Vui lòng thử lại.' });
        }
      },

      fetchMe: async () => {
        const token = get().token;
        if (!token) return;
        try {
          const res = await fetch(`${API_BASE}/api/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.ok) {
            const data = await res.json();
            set({
              tenantId: data.tenantId,
              email: data.email,
              tier: data.tier ?? 'free',
            });
          }
        } catch {
          // silently ignore
        }
      },

      logout: () =>
        set({ loggedIn: false, email: '', tier: 'free', token: null, tenantId: null, apiKey: null, error: null }),
    }),
    { name: 'cashclaw-auth' }
  )
);
