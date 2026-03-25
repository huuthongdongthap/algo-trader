#!/usr/bin/env node
// AlgoTrade Bot — Customer VPS entry point
// Validates license → starts PredictionLoop → executes trades via CLOB
//
// Usage:
//   node scripts/start-trading-bot.mjs --license-key=KEY --private-key=0x... --capital=500
//   node scripts/start-trading-bot.mjs --license-key=KEY --dry-run  (paper mode, no wallet needed)
//
// Env vars (alternative to flags):
//   LICENSE_KEY, LICENSE_SECRET, POLY_PRIVATE_KEY, CAPITAL_USDC, LLM_URL

import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Arg parsing ──────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
function getArg(name) {
  const flag = args.find(a => a.startsWith(`--${name}=`));
  if (flag) return flag.split('=').slice(1).join('=');
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : null;
}
const hasFlag = (name) => args.includes(`--${name}`);

const licenseKey  = getArg('license-key') || process.env.LICENSE_KEY;
const secret      = getArg('secret')      || process.env.LICENSE_SECRET;
const privateKey  = getArg('private-key') || process.env.POLY_PRIVATE_KEY;
const capitalUsdc = parseFloat(getArg('capital') || process.env.CAPITAL_USDC || '500');
const llmUrl      = getArg('llm-url')    || process.env.LLM_URL || 'http://localhost:11435/v1';
const dryRun      = hasFlag('dry-run');
const intervalMin = parseInt(getArg('interval') || '15', 10);

// ── Validation ───────────────────────────────────────────────────────────────

if (!licenseKey) {
  console.error('ERROR: --license-key=KEY required (or set LICENSE_KEY env var)');
  console.error('Get your key from admin or https://algotrade.openclaw.ai');
  process.exit(1);
}

if (!secret) {
  console.error('ERROR: --secret=SECRET or LICENSE_SECRET env var required');
  process.exit(1);
}

if (!dryRun && !privateKey) {
  console.error('ERROR: --private-key=0x... required for live trading (or use --dry-run)');
  process.exit(1);
}

// ── License validation (inline, no TS import needed) ─────────────────────────

function toBase64Url(input) {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4;
  return Buffer.from(pad === 0 ? padded : padded + '='.repeat(4 - pad), 'base64');
}

function validateLicense(key, licSecret) {
  const dotIdx = key.lastIndexOf('.');
  if (dotIdx === -1) return { valid: false, error: 'Malformed key' };

  const payloadPart = key.slice(0, dotIdx);
  const sigPart = key.slice(dotIdx + 1);
  const expectedSig = toBase64Url(createHmac('sha256', licSecret).update(payloadPart).digest());

  const a = Buffer.from(expectedSig, 'utf8');
  const b = Buffer.from(sigPart, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { valid: false, error: 'Invalid signature — key tampered or wrong secret' };
  }

  const payload = JSON.parse(fromBase64Url(payloadPart).toString('utf8'));
  if (Date.now() > payload.expiresAt) {
    return { valid: false, payload, error: `License expired ${new Date(payload.expiresAt).toISOString().slice(0, 10)}` };
  }

  return { valid: true, payload };
}

const lic = validateLicense(licenseKey, secret);
if (!lic.valid) {
  console.error(`❌ License validation failed: ${lic.error}`);
  process.exit(1);
}

const payload = lic.payload;
const daysLeft = Math.floor((payload.expiresAt - Date.now()) / 86400000);

console.log(`
╔══════════════════════════════════════════╗
║         AlgoTrade Prediction Bot         ║
╠══════════════════════════════════════════╣
║  License:  ✅ Valid                       ║
║  User:     ${payload.userId.padEnd(28)} ║
║  Tier:     ${payload.tier.padEnd(28)} ║
║  Expires:  ${daysLeft} days remaining${' '.repeat(Math.max(0, 17 - String(daysLeft).length))}║
║  Capital:  $${capitalUsdc} USDC${' '.repeat(Math.max(0, 22 - String(capitalUsdc).length))}║
║  Mode:     ${dryRun ? 'DRY RUN (paper)' : 'LIVE TRADING'}${' '.repeat(dryRun ? 13 : 16)}║
║  LLM:      ${llmUrl.slice(0, 26).padEnd(28)} ║
║  Interval: ${intervalMin}min${' '.repeat(Math.max(0, 25 - String(intervalMin).length))}║
╚══════════════════════════════════════════╝
`);

if (!dryRun) {
  console.log('⚠️  LIVE MODE — Real money will be used. Ctrl+C to abort.\n');
  await new Promise(r => setTimeout(r, 5000)); // 5s grace period
}

// ── Dynamic imports (ES module) ──────────────────────────────────────────────

const { MarketScanner } = await import('../dist/polymarket/market-scanner.js');
const { PredictionProbabilityEstimator } = await import('../dist/openclaw/prediction-probability-estimator.js');
const { PredictionLoop } = await import('../dist/polymarket/prediction-loop.js');
const { PredictionExecutor } = await import('../dist/polymarket/prediction-executor.js');
const { ClobClient } = await import('../dist/polymarket/clob-client.js');

// ── Initialize components ────────────────────────────────────────────────────

const clobClient = new ClobClient(dryRun ? '' : privateKey, 137);
const scanner = new MarketScanner(clobClient);
const estimator = new PredictionProbabilityEstimator();

const loop = new PredictionLoop(scanner, estimator, {
  scanOptions: {
    minVolume: 1000,
    maxVolume: 200000,
    minResolutionDays: 3,
    maxResolutionDays: 90,
    limit: 50,
    excludePriceMarkets: true,
  },
  minEdge: 0.05,
  maxEstimates: payload.maxMarkets === -1 ? 20 : payload.maxMarkets,
  intervalMs: intervalMin * 60 * 1000,
});

const executor = new PredictionExecutor(clobClient, payload, {
  capitalUsdc,
  kellyFraction: 0.5,
  maxPositionFraction: 0.05,
  minTradeUsdc: 5,
  dryRun,
  onTrade: (trade) => {
    const mode = trade.dryRun ? '[DRY]' : '[LIVE]';
    console.log(`${mode} ${trade.direction} | $${trade.sizeUsdc.toFixed(2)} | edge:${trade.edge.toFixed(3)} | ${trade.description.slice(0, 50)}`);
  },
});

// ── Start loop ───────────────────────────────────────────────────────────────

console.log('🚀 Starting prediction loop...\n');

const stop = loop.start(async (signals) => {
  console.log(`\n📊 Cycle complete: ${signals.length} actionable signals`);

  if (signals.length === 0) return;

  // Show top signals
  for (const s of signals.slice(0, 5)) {
    console.log(`  #${s.rank} ${s.direction} | edge:${s.edge.toFixed(3)} | conf:${s.confidence.toFixed(2)} | ${s.description.slice(0, 50)}`);
  }

  // Execute
  const trades = await executor.executeSignals(signals);
  console.log(`  → Executed ${trades.length} trades\n`);
});

// ── Graceful shutdown ────────────────────────────────────────────────────────

process.on('SIGINT', () => {
  console.log('\n\n⏹  Shutting down...');
  stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  stop();
  process.exit(0);
});

// Bot must never die from unhandled errors — log and continue
process.on('unhandledRejection', (reason) => {
  console.error(`[WATCHDOG] Unhandled rejection caught (bot stays alive): ${reason}`);
});

process.on('uncaughtException', (err) => {
  console.error(`[WATCHDOG] Uncaught exception caught (bot stays alive): ${err.message}`);
});

// Keep alive — bot never sleeps
setInterval(() => {}, 60000);
