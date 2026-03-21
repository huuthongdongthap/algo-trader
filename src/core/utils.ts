// Shared utilities: retry, sleep, formatting helpers

/** Sleep for specified milliseconds */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Retry async function with exponential backoff */
export async function retry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 1000,
): Promise<T> {
  let lastError: Error | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        await sleep(delay);
      }
    }
  }
  throw lastError;
}

/** Format price to fixed decimals, removing trailing zeros */
export function formatPrice(price: string | number, decimals: number = 6): string {
  const num = typeof price === 'string' ? parseFloat(price) : price;
  return num.toFixed(decimals).replace(/\.?0+$/, '') || '0';
}

/** Calculate percentage change between two values */
export function percentChange(from: string | number, to: string | number): number {
  const fromNum = typeof from === 'string' ? parseFloat(from) : from;
  const toNum = typeof to === 'string' ? parseFloat(to) : to;
  if (fromNum === 0) return 0;
  return ((toNum - fromNum) / fromNum) * 100;
}

/** Format USDC amount (6 decimals) to human-readable string */
export function formatUsdc(amount: string | number): string {
  const num = typeof amount === 'string' ? parseFloat(amount) : amount;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Generate unique ID */
export function generateId(prefix: string = ''): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).substring(2, 8);
  return prefix ? `${prefix}_${ts}_${rand}` : `${ts}_${rand}`;
}

/** Clamp value between min and max */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Parse decimal string safely, return 0 on invalid */
export function safeParseFloat(value: string): number {
  const num = parseFloat(value);
  return isNaN(num) ? 0 : num;
}
