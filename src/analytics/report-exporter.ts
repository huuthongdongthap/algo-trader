// Export analytics reports in JSON, CSV, and HTML formats with email-ready templates

import type { PerformanceReport } from './performance-metrics.js';

export type ExportFormat = 'json' | 'csv' | 'html';

/** Generic column definition for CSV export */
export interface CsvColumn<T> {
  header: string;
  key: keyof T;
  format?: (value: unknown) => string;
}

// ─── JSON ──────────────────────────────────────────────────────────────────

/** Serialize a PerformanceReport to a formatted JSON string */
export function exportToJson(report: PerformanceReport): string {
  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const fin = (v: number) => (isFinite(v) ? parseFloat(v.toFixed(4)) : v > 0 ? 'Infinity' : '-Infinity');

  return JSON.stringify(
    {
      summary: {
        startEquity: report.startEquity,
        endEquity: report.endEquity,
        annualReturn: pct(report.annualReturn),
        sharpeRatio: fin(report.sharpeRatio),
        sortinoRatio: fin(report.sortinoRatio),
        calmarRatio: fin(report.calmarRatio),
        maxDrawdown: pct(report.maxDrawdown),
        avgDrawdown: pct(report.avgDrawdown),
        consecutiveWins: report.consecutiveWins,
        consecutiveLosses: report.consecutiveLosses,
        bestDay: { date: report.bestDay.date, return: pct(report.bestDay.return) },
        worstDay: { date: report.worstDay.date, return: pct(report.worstDay.return) },
      },
      weeklyReturns: report.weeklyReturns.map(r => pct(r)),
      monthlyReturns: report.monthlyReturns.map(r => pct(r)),
      dailyReturns: report.dailyReturns.map(d => ({
        date: d.date,
        return: pct(d.return),
        equity: d.equity.toFixed(2),
      })),
    },
    null,
    2,
  );
}

// ─── CSV ───────────────────────────────────────────────────────────────────

/** Escape a single CSV cell value */
function csvCell(value: unknown): string {
  const str = String(value ?? '');
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

/**
 * Generic CSV generator for any array of objects.
 * Columns define headers and field extraction/formatting.
 */
export function exportToCsv<T extends object>(data: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map(c => csvCell(c.header)).join(',');
  const rows = data.map(row =>
    columns
      .map(col => {
        const raw = row[col.key];
        const formatted = col.format ? col.format(raw) : raw;
        return csvCell(formatted);
      })
      .join(','),
  );
  return [header, ...rows].join('\n');
}

// ─── HTML ──────────────────────────────────────────────────────────────────

const STYLE = {
  body: 'font-family:Arial,sans-serif;max-width:600px;margin:0 auto;color:#222;',
  header: 'background:#1a1a2e;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;',
  title: 'margin:0;font-size:20px;',
  subtitle: 'margin:4px 0 0;font-size:12px;opacity:.7;',
  section: 'padding:16px 24px;border-bottom:1px solid #eee;',
  grid: 'display:grid;grid-template-columns:1fr 1fr;gap:8px;',
  metric: 'background:#f8f9fa;padding:12px;border-radius:6px;',
  label: 'font-size:11px;color:#666;margin:0;',
  value: 'font-size:18px;font-weight:bold;margin:4px 0 0;',
  positive: 'color:#16a34a;',
  negative: 'color:#dc2626;',
  neutral: 'color:#1a1a2e;',
  footer: 'padding:12px 24px;font-size:11px;color:#999;text-align:center;',
} as const;

function pct(v: number, decimals = 2): string {
  return `${(v * 100).toFixed(decimals)}%`;
}

function colorStyle(v: number): string {
  if (v > 0) return STYLE.positive;
  if (v < 0) return STYLE.negative;
  return STYLE.neutral;
}

function metricBlock(label: string, value: string, colorStyle_?: string): string {
  const valStyle = colorStyle_ ? `${STYLE.value}${colorStyle_}` : STYLE.value + STYLE.neutral;
  return `<div style="${STYLE.metric}"><p style="${STYLE.label}">${label}</p><p style="${valStyle}">${value}</p></div>`;
}

function finFmt(v: number): string {
  return isFinite(v) ? v.toFixed(2) : v > 0 ? '+∞' : '-∞';
}

/**
 * Generate an inline-styled HTML report suitable for email.
 * No external CSS dependencies — all styles are inline.
 */
export function exportToHtml(report: PerformanceReport): string {
  const generated = new Date().toUTCString();
  const equityChange = report.endEquity - report.startEquity;

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Performance Report</title></head>
<body style="${STYLE.body}">

  <div style="${STYLE.header}">
    <h1 style="${STYLE.title}">Performance Report</h1>
    <p style="${STYLE.subtitle}">Generated: ${generated}</p>
  </div>

  <div style="${STYLE.section}">
    <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#555;">Equity Summary</h2>
    <div style="${STYLE.grid}">
      ${metricBlock('Starting Equity', `$${report.startEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)}
      ${metricBlock('Ending Equity', `$${report.endEquity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, colorStyle(equityChange))}
      ${metricBlock('Annual Return', pct(report.annualReturn), colorStyle(report.annualReturn))}
      ${metricBlock('Max Drawdown', pct(report.maxDrawdown), report.maxDrawdown > 0 ? STYLE.negative : STYLE.neutral)}
    </div>
  </div>

  <div style="${STYLE.section}">
    <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#555;">Risk Metrics</h2>
    <div style="${STYLE.grid}">
      ${metricBlock('Sharpe Ratio', finFmt(report.sharpeRatio), colorStyle(report.sharpeRatio))}
      ${metricBlock('Sortino Ratio', finFmt(report.sortinoRatio), colorStyle(report.sortinoRatio))}
      ${metricBlock('Calmar Ratio', finFmt(report.calmarRatio), colorStyle(report.calmarRatio))}
      ${metricBlock('Avg Drawdown', pct(report.avgDrawdown), report.avgDrawdown > 0 ? STYLE.negative : STYLE.neutral)}
    </div>
  </div>

  <div style="${STYLE.section}">
    <h2 style="margin:0 0 12px;font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#555;">Streak & Extremes</h2>
    <div style="${STYLE.grid}">
      ${metricBlock('Best Day', `${report.bestDay.date} (${pct(report.bestDay.return)})`, STYLE.positive)}
      ${metricBlock('Worst Day', `${report.worstDay.date} (${pct(report.worstDay.return)})`, STYLE.negative)}
      ${metricBlock('Max Consec. Wins', String(report.consecutiveWins), STYLE.positive)}
      ${metricBlock('Max Consec. Losses', String(report.consecutiveLosses), STYLE.negative)}
    </div>
  </div>

  <div style="${STYLE.section}">
    <h2 style="margin:0 0 8px;font-size:14px;text-transform:uppercase;letter-spacing:.5px;color:#555;">Monthly Returns</h2>
    <div style="${STYLE.grid}">
      ${report.monthlyReturns
        .map((r, i) => metricBlock(`Month ${i + 1}`, pct(r), colorStyle(r)))
        .join('')}
    </div>
  </div>

  <div style="${STYLE.footer}">
    algo-trade platform &bull; Report auto-generated &bull; Not financial advice
  </div>

</body>
</html>`;
}

// ─── Daily/weekly email summary template ───────────────────────────────────

export interface EmailSummaryData {
  period: 'daily' | 'weekly';
  periodLabel: string; // e.g. "2024-01-15" or "Week of 2024-01-15"
  equity: number;
  periodReturn: number;
  totalReturn: number;
  tradeCount: number;
  topSymbol?: string;
}

/**
 * Minimal plain-text email summary for daily/weekly digests.
 * Intentionally compact for email notification systems.
 */
export function buildEmailSummary(data: EmailSummaryData): string {
  const sign = data.periodReturn >= 0 ? '+' : '';
  return [
    `algo-trade ${data.period.toUpperCase()} SUMMARY — ${data.periodLabel}`,
    '─'.repeat(45),
    `Equity        : $${data.equity.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
    `Period Return : ${sign}${pct(data.periodReturn)}`,
    `Total Return  : ${sign}${pct(data.totalReturn)}`,
    `Trades        : ${data.tradeCount}`,
    ...(data.topSymbol ? [`Top Symbol    : ${data.topSymbol}`] : []),
    '─'.repeat(45),
    'Reply STOP to unsubscribe.',
  ].join('\n');
}
