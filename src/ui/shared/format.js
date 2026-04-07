/* CashClaw — Shared formatting utilities
 * All display formatting in one place. Used by dashboard and landing pages.
 */

/**
 * Format a number as USD currency.
 * formatUsd(123.456) → "$123.46"
 * formatUsd(-50) → "-$50.00"
 */
export function formatUsd(value) {
  const abs = Math.abs(value);
  const formatted = abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return value < 0 ? `-$${formatted}` : `$${formatted}`;
}

/**
 * Format a decimal as a percentage.
 * formatPct(0.1234) → "12.34%"
 */
export function formatPct(value) {
  return `${(value * 100).toFixed(2)}%`;
}

/**
 * Format P&L with sign and color class name.
 * Returns { text, className } for easy DOM insertion.
 * formatPnl(50.25) → { text: "+$50.25", className: "cc-pnl--positive" }
 * formatPnl(-12.30) → { text: "-$12.30", className: "cc-pnl--negative" }
 */
export function formatPnl(value) {
  if (value > 0) {
    return { text: `+${formatUsd(value)}`, className: 'cc-pnl--positive' };
  }
  if (value < 0) {
    return { text: formatUsd(value), className: 'cc-pnl--negative' };
  }
  return { text: '$0.00', className: 'cc-pnl--zero' };
}

/**
 * Format a Brier score to 3 decimal places.
 * formatBrier(0.182) → "0.182"
 */
export function formatBrier(value) {
  return value.toFixed(3);
}

/**
 * Relative time string from a timestamp.
 * timeAgo(Date.now() - 120000) → "2m ago"
 */
export function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
