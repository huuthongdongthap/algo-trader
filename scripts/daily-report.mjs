#!/usr/bin/env node
// Daily Performance Report — generates end-of-day report from paper_trades_v3 + ai_decisions
// Compares against DNA targets (Brier < 0.20, win rate > 55%, positive P&L, 5-20 trades/day)
// Usage: node scripts/daily-report.mjs [--date YYYY-MM-DD] [--db path] [--help]

import { existsSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── CLI args ────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`
Daily Performance Report Generator

Usage:
  node scripts/daily-report.mjs [options]

Options:
  --date YYYY-MM-DD   Report date (default: today)
  --db PATH           Path to SQLite database (default: data/algo-trade.db)
  --help, -h          Show this help message

Output:
  Writes markdown report to data/reports/daily-YYYY-MM-DD.md
  Prints summary to console

DNA Targets:
  - Brier score < 0.20
  - Win rate > 55%
  - Positive P&L
  - 5-20 trades/day
`);
  process.exit(0);
}

function getArg(flag, fallback) {
  const idx = args.indexOf(flag);
  return idx !== -1 && idx + 1 < args.length ? args[idx + 1] : fallback;
}

const today = new Date().toISOString().slice(0, 10);
const reportDate = getArg('--date', today);
const dbPath = resolve(getArg('--db', 'data/algo-trade.db'));

// Validate date format
if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) {
  console.error(`Error: Invalid date format "${reportDate}". Expected YYYY-MM-DD.`);
  process.exit(1);
}

// ── Database ────────────────────────────────────────────────────────────────────

if (!existsSync(dbPath)) {
  console.error(`Error: Database not found at ${dbPath}`);
  console.error('Use --db to specify the correct path.');
  process.exit(1);
}

const Database = (await import('better-sqlite3')).default;
const db = new Database(dbPath, { readonly: true });

// ── Query trades for the report date ────────────────────────────────────────────

// paper_trades_v3.timestamp is TEXT (ISO 8601). Filter by date prefix.
const dayStart = `${reportDate}T00:00:00`;
const dayEnd = `${reportDate}T23:59:59`;

const allTrades = db.prepare(`
  SELECT id, timestamp, condition_id, slug, category, market_question,
         market_prob, our_prob, edge, direction, confidence, reasoning,
         strategy, resolved, outcome, correct
  FROM paper_trades_v3
  WHERE timestamp >= ? AND timestamp <= ?
  ORDER BY id ASC
`).all(dayStart, dayEnd);

const actionableTrades = allTrades.filter(t => t.direction !== 'SKIP');
const resolvedTrades = allTrades.filter(t => t.resolved === 1);
const resolvedActionable = resolvedTrades.filter(t => t.direction !== 'SKIP');

// ai_decisions for the date (timestamp is epoch ms)
const epochStart = new Date(`${reportDate}T00:00:00`).getTime();
const epochEnd = new Date(`${reportDate}T23:59:59.999`).getTime();

const aiDecisions = db.prepare(`
  SELECT id, timestamp, type, input_summary, output_summary, model,
         tokens, latency_ms, applied, confidence
  FROM ai_decisions
  WHERE timestamp >= ? AND timestamp <= ?
  ORDER BY timestamp ASC
`).all(epochStart, epochEnd);

// ── Calculations ────────────────────────────────────────────────────────────────

// Brier score: mean squared error of ourProb vs actual outcome (on resolved trades)
function calcBrierScore(trades) {
  if (trades.length === 0) return null;
  const sum = trades.reduce((s, t) => {
    const actual = t.outcome === 'YES' ? 1 : 0;
    return s + (t.our_prob - actual) ** 2;
  }, 0);
  return sum / trades.length;
}

// Win rate: fraction of resolved actionable trades that were correct
function calcWinRate(trades) {
  if (trades.length === 0) return null;
  const wins = trades.filter(t => t.correct === 1).length;
  return wins / trades.length;
}

// Simulated P&L: $10 notional per trade
function calcPnL(trades) {
  let total = 0;
  for (const t of trades) {
    const dir = t.direction.toUpperCase();
    if (dir.includes('YES')) {
      total += (t.outcome === 'YES' ? 10 : 0) - (10 * t.market_prob);
    } else if (dir.includes('NO')) {
      total += (t.outcome === 'NO' ? 10 : 0) - (10 * (1 - t.market_prob));
    }
  }
  return total;
}

// Calibration buckets (same logic as CalibrationTuner)
const BUCKET_RANGES = [
  { label: '0-20%', min: 0, max: 0.2 },
  { label: '20-40%', min: 0.2, max: 0.4 },
  { label: '40-60%', min: 0.4, max: 0.6 },
  { label: '60-80%', min: 0.6, max: 0.8 },
  { label: '80-100%', min: 0.8, max: 1.0 },
];

function calcCalibrationBuckets(trades) {
  return BUCKET_RANGES.map(range => {
    const inBucket = trades.filter(t => t.our_prob >= range.min && t.our_prob < range.max);
    const predicted = inBucket.length > 0
      ? inBucket.reduce((s, t) => s + t.our_prob, 0) / inBucket.length
      : (range.min + range.max) / 2;
    const actual = inBucket.length > 0
      ? inBucket.reduce((s, t) => s + (t.outcome === 'YES' ? 1 : 0), 0) / inBucket.length
      : 0;
    return {
      range: range.label,
      predicted: Math.round(predicted * 1000) / 1000,
      actual: Math.round(actual * 1000) / 1000,
      count: inBucket.length,
      gap: Math.round(Math.abs(predicted - actual) * 1000) / 1000,
    };
  });
}

const brierScore = calcBrierScore(resolvedActionable);
const winRate = calcWinRate(resolvedActionable);
const pnl = calcPnL(resolvedActionable);
const calibrationBuckets = calcCalibrationBuckets(resolvedActionable);
const tradeCount = actionableTrades.length;

// AI decision stats
const avgLatency = aiDecisions.length > 0
  ? aiDecisions.reduce((s, d) => s + d.latency_ms, 0) / aiDecisions.length
  : 0;
const avgConfidence = aiDecisions.length > 0
  ? aiDecisions.reduce((s, d) => s + d.confidence, 0) / aiDecisions.length
  : 0;
const modelBreakdown = {};
for (const d of aiDecisions) {
  modelBreakdown[d.model] = (modelBreakdown[d.model] || 0) + 1;
}
const typeBreakdown = {};
for (const d of aiDecisions) {
  typeBreakdown[d.type] = (typeBreakdown[d.type] || 0) + 1;
}

// ── DNA target checks ───────────────────────────────────────────────────────────

const targets = {
  brier: { target: '< 0.20', value: brierScore, pass: brierScore !== null && brierScore < 0.20 },
  winRate: { target: '> 55%', value: winRate, pass: winRate !== null && winRate > 0.55 },
  pnl: { target: '> $0', value: pnl, pass: pnl > 0 },
  tradeCount: { target: '5-20/day', value: tradeCount, pass: tradeCount >= 5 && tradeCount <= 20 },
};

function statusIcon(pass, hasData) {
  if (!hasData) return '[ ? ]';
  return pass ? '[ OK ]' : '[FAIL]';
}

// ── Check for recalibration flag (Brier > 0.25 for 3 consecutive days) ──────────

function checkRecalibrationNeeded() {
  const reportsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'reports');
  if (!existsSync(reportsDir)) return false;

  // Look at previous daily reports to find Brier scores
  const files = readdirSync(reportsDir)
    .filter(f => f.startsWith('daily-') && f.endsWith('.md'))
    .sort()
    .reverse()
    .slice(0, 3); // last 3 reports (including today once written)

  let consecutiveHighBrier = 0;

  // Check today first
  if (brierScore !== null && brierScore > 0.25) {
    consecutiveHighBrier++;
  } else {
    return false; // today is fine, no need to check further
  }

  // Check previous reports
  for (const file of files) {
    try {
      const content = readFileSync(resolve(reportsDir, file), 'utf8');
      const match = content.match(/Brier Score:\s*([\d.]+)/);
      if (match) {
        const prevBrier = parseFloat(match[1]);
        if (prevBrier > 0.25) {
          consecutiveHighBrier++;
        } else {
          break;
        }
      }
    } catch { break; }
  }

  return consecutiveHighBrier >= 3;
}

// ── Build report ────────────────────────────────────────────────────────────────

const fmtPct = (v) => v !== null ? `${(v * 100).toFixed(1)}%` : 'N/A';
const fmtNum = (v, decimals = 4) => v !== null ? v.toFixed(decimals) : 'N/A';

let report = `# Daily Performance Report: ${reportDate}

Generated: ${new Date().toISOString()}
Database: ${dbPath}

---

## Summary

| Metric | Value | DNA Target | Status |
|--------|-------|------------|--------|
| Brier Score | ${fmtNum(brierScore)} | < 0.20 | ${statusIcon(targets.brier.pass, brierScore !== null)} |
| Win Rate | ${fmtPct(winRate)} | > 55% | ${statusIcon(targets.winRate.pass, winRate !== null)} |
| P&L (simulated) | $${pnl.toFixed(2)} | > $0 | ${statusIcon(targets.pnl.pass, true)} |
| Trades/Day | ${tradeCount} | 5-20 | ${statusIcon(targets.tradeCount.pass, true)} |

## Trade Breakdown

- **Total predictions:** ${allTrades.length}
- **Actionable (non-SKIP):** ${actionableTrades.length}
- **Resolved:** ${resolvedTrades.length}
- **Resolved & actionable:** ${resolvedActionable.length}
- **Correct:** ${resolvedActionable.filter(t => t.correct === 1).length}
- **Incorrect:** ${resolvedActionable.filter(t => t.correct === 0).length}

### Direction Distribution
- BUY_YES: ${actionableTrades.filter(t => t.direction.toUpperCase().includes('YES')).length}
- BUY_NO: ${actionableTrades.filter(t => t.direction.toUpperCase().includes('NO')).length}

### Average Edge
- Mean |edge|: ${actionableTrades.length > 0 ? (actionableTrades.reduce((s, t) => s + Math.abs(t.edge), 0) / actionableTrades.length * 100).toFixed(1) : 'N/A'}%
- Mean confidence: ${actionableTrades.length > 0 ? (actionableTrades.reduce((s, t) => s + (t.confidence || 0), 0) / actionableTrades.length * 100).toFixed(1) : 'N/A'}%

## Calibration Curve

| Bucket | Predicted | Actual | Count | Gap |
|--------|-----------|--------|-------|-----|
${calibrationBuckets.map(b => `| ${b.range} | ${fmtPct(b.predicted)} | ${fmtPct(b.actual)} | ${b.count} | ${fmtPct(b.gap)} |`).join('\n')}

## AI Decisions (from ai_decisions table)

- **Total decisions:** ${aiDecisions.length}
- **Average latency:** ${avgLatency.toFixed(0)}ms
- **Average confidence:** ${fmtPct(avgConfidence)}

### By Type
${Object.entries(typeBreakdown).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- (none)'}

### By Model
${Object.entries(modelBreakdown).map(([k, v]) => `- ${k}: ${v}`).join('\n') || '- (none)'}
`;

// Category breakdown if available
const categories = {};
for (const t of actionableTrades) {
  const cat = t.category || 'unknown';
  categories[cat] = (categories[cat] || 0) + 1;
}
if (Object.keys(categories).length > 0) {
  report += `\n## Category Breakdown\n\n`;
  for (const [cat, count] of Object.entries(categories).sort((a, b) => b[1] - a[1])) {
    report += `- ${cat}: ${count}\n`;
  }
}

// Recalibration check
const needsRecalibration = checkRecalibrationNeeded();
if (needsRecalibration) {
  report += `\n## RECALIBRATION FLAG\n\n`;
  report += `Brier score has exceeded 0.25 for 3 consecutive days.\n`;
  report += `Action required: Run calibration tuner to adjust temperature scaler.\n`;
  report += `\`\`\`\nRecommendation: Review CalibrationTuner.analyzeFromDb() output and adjust TemperatureScaler params.\n\`\`\`\n`;
}

// Top trades detail
if (resolvedActionable.length > 0) {
  report += `\n## Resolved Trades Detail\n\n`;
  report += `| # | Market | Direction | Edge | OurProb | MarketProb | Outcome | Correct |\n`;
  report += `|---|--------|-----------|------|---------|------------|---------|--------|\n`;
  for (const t of resolvedActionable) {
    const q = (t.market_question || '').slice(0, 50) + ((t.market_question || '').length > 50 ? '...' : '');
    report += `| ${t.id} | ${q} | ${t.direction} | ${(t.edge * 100).toFixed(1)}% | ${(t.our_prob * 100).toFixed(1)}% | ${(t.market_prob * 100).toFixed(1)}% | ${t.outcome || 'N/A'} | ${t.correct === 1 ? 'Yes' : 'No'} |\n`;
  }
}

report += `\n---\n*Report generated by scripts/daily-report.mjs*\n`;

// ── Write report file ───────────────────────────────────────────────────────────

const reportsDir = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'reports');
if (!existsSync(reportsDir)) {
  mkdirSync(reportsDir, { recursive: true });
}

const reportPath = resolve(reportsDir, `daily-${reportDate}.md`);
writeFileSync(reportPath, report, 'utf8');

db.close();

// ── Console summary ─────────────────────────────────────────────────────────────

console.log(`\n=== Daily Performance Report: ${reportDate} ===\n`);
console.log(`Trades:       ${tradeCount} actionable (${allTrades.length} total, ${resolvedActionable.length} resolved)`);
console.log(`Brier Score:  ${fmtNum(brierScore)}  ${statusIcon(targets.brier.pass, brierScore !== null)}`);
console.log(`Win Rate:     ${fmtPct(winRate)}  ${statusIcon(targets.winRate.pass, winRate !== null)}`);
console.log(`P&L:          $${pnl.toFixed(2)}  ${statusIcon(targets.pnl.pass, true)}`);
console.log(`Trade Count:  ${tradeCount}  ${statusIcon(targets.tradeCount.pass, true)}`);
console.log(`AI Decisions: ${aiDecisions.length} (avg latency: ${avgLatency.toFixed(0)}ms)`);

if (needsRecalibration) {
  console.log(`\n*** RECALIBRATION NEEDED: Brier > 0.25 for 3 consecutive days ***`);
}

const passCount = Object.values(targets).filter(t => t.pass).length;
const totalTargets = Object.keys(targets).length;
console.log(`\nDNA Targets:  ${passCount}/${totalTargets} passing`);
console.log(`Report saved: ${reportPath}\n`);
