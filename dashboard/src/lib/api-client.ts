/**
 * API Client with error handling, timeout, and retry logic
 * Auto-attaches JWT Bearer token from auth-store
 */
import { useAuthStore } from '../stores/auth-store';
import type { ApiError } from '../types/api';

const BASE_URL = import.meta.env.VITE_API_URL ?? '';
const DEFAULT_TIMEOUT = 10000; // 10s
const MAX_RETRIES = 2;

export class ApiClientError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code?: string
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

async function fetchWithRetry<T>(
  path: string,
  options: RequestInit = {},
  token: string | null
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT);

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      };

      const response = await fetch(`${BASE_URL}/api${path}`, {
        ...options,
        headers,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({})) as ApiError;
        throw new ApiClientError(
          errorData.error || `HTTP ${response.status}`,
          response.status
        );
      }

      return await response.json() as T;
    } catch (error) {
      lastError = error as Error;

      // Don't retry on client errors (4xx)
      if (error instanceof ApiClientError && error.status && error.status >= 400 && error.status < 500) {
        throw error;
      }

      // Wait before retry (exponential backoff)
      if (attempt < MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt)));
      }
    }
  }

  throw lastError || new ApiClientError('Unknown error');
}

/**
 * Standalone API client (non-hook version for use outside components)
 */
export const apiClient = {
  async get<T>(endpoint: string): Promise<T> {
    const token = useAuthStore.getState().token;
    return fetchWithRetry<T>(endpoint, { method: 'GET' }, token);
  },

  async post<T>(endpoint: string, body?: unknown): Promise<T> {
    const token = useAuthStore.getState().token;
    return fetchWithRetry<T>(endpoint, {
      method: 'POST',
      body: body ? JSON.stringify(body) : undefined,
    }, token);
  },
};

/**
 * React hook version of API client
 */
export function useApiClient() {
  const token = useAuthStore((s) => s.token);

  const fetchApi = async <T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T | null> => {
    try {
      return await fetchWithRetry<T>(path, options, token);
    } catch (error) {
      console.error('[API Client] Request failed:', error);
      return null;
    }
  };

  return { fetchApi };
}
