// CLI command: algo-trade hedge-scan
// Scans Polymarket trending markets for hedge opportunities using PolyClaw AI
// Usage: algo-trade hedge-scan [--limit N] [--tier N] [--slug <slug>]

import { Command } from 'commander';
import { HedgeScanner } from '../../polymarket/hedge-scanner.js';
import { AiRouter } from '../../openclaw/ai-router.js';
import { logger } from '../../core/logger.js';

interface HedgeScanOptions {
  limit: string;
  tier: string;
  slug?: string;
}

export const hedgeScanCommand = new Command('hedge-scan')
  .description('Scan Polymarket markets for PolyClaw hedge opportunities')
  .option('-l, --limit <n>', 'max target markets to scan', '10')
  .option('-t, --tier <n>', 'max tier to include (1=HIGH, 2=GOOD, 3=MODERATE)', '2')
  .option('-s, --slug <slug>', 'scan a specific market by slug')
  .action(async (opts: HedgeScanOptions) => {
    const limit = parseInt(opts.limit, 10);
    const maxTier = parseInt(opts.tier, 10);

    logger.info('PolyClaw Hedge Scanner', 'CLI');
    console.log('');
    console.log('  ╔══════════════════════════════════════╗');
    console.log('  ║      POLYCLAW HEDGE SCANNER          ║');
    console.log('  ╚══════════════════════════════════════╝');
    console.log(`  Max tier : T${maxTier}`);
    console.log(`  Limit    : ${limit} markets`);
    console.log('');

    const ai = new AiRouter();
    const scanner = new HedgeScanner(ai, { maxTier });

    if (opts.slug) {
      console.log(`  Scanning market: ${opts.slug}...`);
      const result = await scanner.scanBySlug(opts.slug);
      printResult(result);
    } else {
      console.log(`  Scanning top ${limit} trending markets...`);
      const results = await scanner.scanTopMarkets(limit);
      if (results.length === 0) {
        console.log('  No hedge opportunities found.');
        return;
      }
      for (const result of results) {
        printResult(result);
      }
      console.log(`  Total: ${results.length} markets with hedges`);
    }
  });

function printResult(result: Awaited<ReturnType<HedgeScanner['scanBySlug']>>): void {
  console.log(`\n  Target: ${result.targetMarket.question}`);
  console.log(`  Markets scanned: ${result.marketsScanned} | Cached: ${result.cached}`);

  if (result.portfolios.length === 0) {
    console.log('  No hedge portfolios found.');
    return;
  }

  console.log('  ┌──────────┬──────────┬──────────┬─────────────────────────────────────┐');
  console.log('  │ Coverage │   Tier   │ Profit % │ Cover Market                        │');
  console.log('  ├──────────┼──────────┼──────────┼─────────────────────────────────────┤');

  for (const p of result.portfolios.slice(0, 10)) {
    const cov = (p.coverage * 100).toFixed(1).padStart(6) + '%';
    const tier = `T${p.tier}`.padStart(6);
    const profit = p.profitPct.toFixed(1).padStart(6) + '%';
    const cover = p.coverMarket.question.slice(0, 35).padEnd(35);
    console.log(`  │ ${cov} │ ${tier}   │ ${profit} │ ${cover} │`);
  }

  console.log('  └──────────┴──────────┴──────────┴─────────────────────────────────────┘');
}
