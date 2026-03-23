// Funding rate arbitrage scanner — fetches ALL Binance futures funding rates,
// filters significant opportunities, calculates PnL projections, runs every 8h.
// No external deps — uses fetch() only. Runnable: npx tsx scripts/funding-rate-monitor.ts

const BINANCE_FAPI = 'https://fapi.binance.com';
const CAPITAL_PER_PAIR = 10_000;    // USD per pair for daily PnL calc
const PORTFOLIO_CAPITAL = 50_000;   // for top-5 spread summary
const TOP_PAIRS = 5;
const TOP_DISPLAY = 20;
const MIN_RATE_ABS = 0.0005;        // 0.05% filter threshold
const HIGH_YIELD_THRESHOLD = 0.005; // 0.5% flagged as HIGH YIELD

/** Shape of Binance /fapi/v1/premiumIndex response per symbol */
interface PremiumIndex {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string;
  nextFundingTime: number;
  interestRate: string;
  time: number;
}

interface FundingOpportunity {
  symbol: string;
  rate: number;       // raw 8h rate (e.g. -0.0121 = -1.21%)
  ratePct: string;    // formatted
  dailyPnl: number;   // USD per CAPITAL_PER_PAIR
  aprPct: number;     // annualised %
  nextFunding: Date;
  highYield: boolean;
}

async function fetchFundingRates(): Promise<PremiumIndex[]> {
  const res = await fetch(`${BINANCE_FAPI}/fapi/v1/premiumIndex`);
  if (!res.ok) throw new Error(`Binance API error: ${res.status} ${res.statusText}`);
  return res.json() as Promise<PremiumIndex[]>;
}

function parseOpportunity(p: PremiumIndex): FundingOpportunity | null {
  const rate = parseFloat(p.lastFundingRate);
  if (Math.abs(rate) < MIN_RATE_ABS) return null;

  // 3 funding periods per day * |rate| * capital
  const dailyPnl = Math.abs(rate) * 3 * CAPITAL_PER_PAIR;
  // Annualise: 3 payments/day * 365 days * 100 for %
  const aprPct = Math.abs(rate) * 3 * 365 * 100;

  return {
    symbol: p.symbol,
    rate,
    ratePct: `${(rate * 100).toFixed(4)}%`,
    dailyPnl,
    aprPct,
    nextFunding: new Date(p.nextFundingTime),
    highYield: Math.abs(rate) >= HIGH_YIELD_THRESHOLD,
  };
}

function formatNextFunding(dt: Date): string {
  const diffMs = dt.getTime() - Date.now();
  if (diffMs < 0) return 'soon    ';
  const h = Math.floor(diffMs / 3_600_000);
  const m = Math.floor((diffMs % 3_600_000) / 60_000);
  return `${h}h ${m}m`;
}

function pad(s: string | number, n: number, right = false): string {
  const str = String(s);
  return right ? str.padEnd(n) : str.padStart(n);
}

function printTable(opps: FundingOpportunity[]): void {
  const now = new Date().toUTCString();
  console.log(`\n=== BINANCE FUNDING RATE SCANNER === ${now}`);
  console.log(`Filter: |rate| > ${(MIN_RATE_ABS * 100).toFixed(2)}%/8h  |  Capital: $${CAPITAL_PER_PAIR.toLocaleString()}/pair\n`);

  const header = [
    pad('#', 3),
    pad('SYMBOL', 16, true),
    pad('RATE/8H', 10),
    pad('DAILY PNL', 11),
    pad('APR', 9),
    pad('NEXT FUND', 10),
    '  NOTES',
  ].join(' ');
  const divider = '-'.repeat(72);

  console.log(header);
  console.log(divider);

  opps.slice(0, TOP_DISPLAY).forEach((o, i) => {
    const direction = o.rate < 0 ? 'shorts earn' : 'longs earn ';
    const flag = o.highYield ? ' *** HIGH YIELD ***' : '';
    console.log([
      pad(i + 1, 3),
      pad(o.symbol, 16, true),
      pad(o.ratePct, 10),
      pad(`$${o.dailyPnl.toFixed(2)}`, 11),
      pad(`${o.aprPct.toFixed(1)}%`, 9),
      pad(formatNextFunding(o.nextFunding), 10),
      `  ${direction}${flag}`,
    ].join(' '));
  });

  console.log(divider);
}

function printPortfolioSummary(opps: FundingOpportunity[]): void {
  const top = opps.slice(0, TOP_PAIRS);
  const capitalEach = PORTFOLIO_CAPITAL / TOP_PAIRS;
  const totalDailyPnl = top.reduce(
    (sum, o) => sum + Math.abs(o.rate) * 3 * capitalEach,
    0,
  );
  const blendedApr = (totalDailyPnl / PORTFOLIO_CAPITAL) * 365 * 100;

  console.log(
    `\n--- PORTFOLIO SPREAD: $${PORTFOLIO_CAPITAL.toLocaleString()} across top ${TOP_PAIRS} pairs ---`,
  );
  top.forEach((o, i) => {
    const pnl = Math.abs(o.rate) * 3 * capitalEach;
    console.log(
      `  ${i + 1}. ${pad(o.symbol, 16, true)} $${capitalEach.toLocaleString()}/pair  -> $${pnl.toFixed(2)}/day`,
    );
  });
  console.log(`\n  TOTAL DAILY PNL  : $${totalDailyPnl.toFixed(2)}`);
  console.log(`  TOTAL MONTHLY    : $${(totalDailyPnl * 30).toFixed(2)}`);
  console.log(`  TOTAL ANNUAL     : $${(totalDailyPnl * 365).toFixed(2)}`);
  console.log(`  BLENDED APR      : ${blendedApr.toFixed(1)}%`);
  console.log(`  STRATEGY         : delta-neutral (long spot + short perp)`);
  console.log(`  NOTE             : collect funding every 8h at 00:00/08:00/16:00 UTC`);
}

async function run(): Promise<void> {
  try {
    process.stdout.write('Fetching Binance futures funding rates...');
    const raw = await fetchFundingRates();
    process.stdout.write(` ${raw.length} symbols loaded.\n`);

    const opportunities = raw
      .map(parseOpportunity)
      .filter((o): o is FundingOpportunity => o !== null)
      .sort((a, b) => Math.abs(b.rate) - Math.abs(a.rate));

    console.log(
      `Significant opportunities (|rate| > ${(MIN_RATE_ABS * 100).toFixed(2)}%): ${opportunities.length}`,
    );

    printTable(opportunities);
    printPortfolioSummary(opportunities);

    console.log('\nNext funding: 00:00 / 08:00 / 16:00 UTC');
    console.log('Run with --watch flag to refresh every 8h automatically.');
  } catch (err) {
    console.error('Error:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}

async function scheduleLoop(intervalHours: number): Promise<void> {
  await run();
  if (process.argv.includes('--watch')) {
    console.log(`\n[watch mode] Refreshing every ${intervalHours}h — Ctrl+C to stop`);
    setInterval(() => { void run(); }, intervalHours * 3_600_000);
  }
}

void scheduleLoop(8);
