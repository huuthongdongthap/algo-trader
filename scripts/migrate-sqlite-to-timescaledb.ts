/**
 * SQLite → TimescaleDB Migration Script
 *
 * Reads time-series data from local SQLite databases (data/*.db)
 * and inserts into TimescaleDB hypertables.
 *
 * Usage:
 *   TIMESCALE_HOST=localhost TIMESCALE_PORT=5433 \
 *   TIMESCALE_DB=algotrader TIMESCALE_USER=algotrader TIMESCALE_PASSWORD=secret \
 *   npx ts-node scripts/migrate-sqlite-to-timescaledb.ts [--dry-run]
 *
 * Requires: node >= 22.5 (native node:sqlite), pg (already in package.json)
 */

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import { Client } from 'pg';
import * as path from 'path';
import * as fs from 'fs';

const DATA_DIR = path.resolve(__dirname, '../data');
const DRY_RUN = process.argv.includes('--dry-run');
const BATCH_SIZE = 500;

const TSDB = new Client({
  host: process.env.TIMESCALE_HOST || 'localhost',
  port: parseInt(process.env.TIMESCALE_PORT || '5433', 10),
  database: process.env.TIMESCALE_DB || 'algotrader',
  user: process.env.TIMESCALE_USER || 'algotrader',
  password: process.env.TIMESCALE_PASSWORD || '',
});

type Row = Record<string, unknown>;

const log = (msg: string) =>
  console.log(`${DRY_RUN ? '[DRY-RUN] ' : ''}${new Date().toISOString()} ${msg}`);

// ─── Row Transformers ─────────────────────────────────────────────────────────

function toIso(ts: unknown): string {
  if (!ts) throw new Error('missing timestamp');
  return new Date(typeof ts === 'number' ? ts * 1000 : String(ts)).toISOString();
}

function transformTrade(r: Row): Row {
  return {
    time: toIso(r.timestamp ?? r.created_at ?? r.time),
    trade_id: r.trade_id ?? r.id ?? `legacy-${Date.now()}-${Math.random()}`,
    order_id: r.order_id ?? null,
    token_id: r.token_id ?? r.tokenId ?? 'unknown',
    market_id: r.market_id ?? r.marketId ?? 'unknown',
    side: String(r.side ?? 'BUY').toUpperCase(),
    price: Number(r.price ?? 0),
    size: Number(r.size ?? r.amount ?? 0),
    fee_usdc: Number(r.fee ?? r.fee_usdc ?? 0),
    pnl_usdc: r.pnl != null ? Number(r.pnl) : null,
    strategy: r.strategy ?? null,
    status: r.status ?? 'FILLED',
    tx_hash: r.tx_hash ?? null,
    nonce: r.nonce != null ? Number(r.nonce) : null,
  };
}

function transformSignal(r: Row): Row {
  return {
    time: toIso(r.timestamp ?? r.created_at ?? r.time),
    signal_id: r.signal_id ?? r.id ?? `legacy-${Date.now()}-${Math.random()}`,
    token_id: r.token_id ?? r.tokenId ?? 'unknown',
    market_id: r.market_id ?? r.marketId ?? 'unknown',
    signal_type: r.signal_type ?? r.type ?? 'UNKNOWN',
    direction: String(r.direction ?? r.side ?? 'LONG').toUpperCase(),
    confidence: Math.min(1, Math.max(0, Number(r.confidence ?? 0.5))),
    edge_bps: r.edge_bps != null ? Number(r.edge_bps) : null,
    acted_on: Boolean(r.acted_on ?? r.executed),
    strategy: r.strategy ?? null,
    metadata: r.metadata ?? '{}',
  };
}

// ─── Batch Insert ─────────────────────────────────────────────────────────────

async function insertBatch(target: string, rows: Row[]): Promise<number> {
  if (rows.length === 0 || DRY_RUN) return rows.length;

  // Whitelist table names to prevent SQL injection
  const ALLOWED_TABLES = ['market_prices', 'order_book_snapshots', 'trade_history', 'signal_events'];
  if (!ALLOWED_TABLES.includes(target)) {
    throw new Error(`[Migration] Table "${target}" not in whitelist`);
  }

  const cols = Object.keys(rows[0]);
  // Validate column names: only allow alphanumeric + underscore
  for (const col of cols) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
      throw new Error(`[Migration] Invalid column name: "${col}"`);
    }
  }

  const placeholders = rows.map(
    (_, i) => `(${cols.map((__, c) => `$${i * cols.length + c + 1}`).join(', ')})`
  );
  const values = rows.flatMap((r) => cols.map((c) => r[c]));
  const quotedCols = cols.map((c) => `"${c}"`).join(', ');
  const sql = `INSERT INTO "${target}" (${quotedCols}) VALUES ${placeholders.join(', ')} ON CONFLICT DO NOTHING`;

  const res = await TSDB.query(sql, values);
  return res.rowCount ?? 0;
}

// ─── Table Migration ──────────────────────────────────────────────────────────

async function migrateTable(
  db: InstanceType<typeof DatabaseSync>,
  srcTable: string,
  dstTable: string,
  transform: (r: Row) => Row
): Promise<{ read: number; inserted: number; errors: number }> {
  const tables = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table'"
  ).all() as Row[]).map((r) => r.name as string);

  if (!tables.includes(srcTable)) return { read: 0, inserted: 0, errors: 0 };

  const rows = db.prepare(`SELECT * FROM ${srcTable}`).all() as Row[];
  let inserted = 0, errors = 0;

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch: Row[] = [];
    for (const r of rows.slice(i, i + BATCH_SIZE)) {
      try { batch.push(transform(r)); } catch { errors++; }
    }
    inserted += await insertBatch(dstTable, batch);
  }

  log(`  ${srcTable} → ${dstTable}: read=${rows.length} inserted=${inserted} errors=${errors}`);
  return { read: rows.length, inserted, errors };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log(`Migration start (dataDir=${DATA_DIR})`);

  if (!DRY_RUN) {
    await TSDB.connect();
    log('Connected to TimescaleDB');
  }

  const dbFiles = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.db'));
  log(`Found ${dbFiles.length} SQLite databases: ${dbFiles.join(', ')}`);

  let totalErrors = 0;

  for (const file of dbFiles) {
    const db = new DatabaseSync(path.join(DATA_DIR, file), { open: true });
    log(`\nProcessing ${file}`);

    for (const name of ['trades', 'trade_history', 'orders']) {
      const r = await migrateTable(db, name, 'trade_history', transformTrade);
      totalErrors += r.errors;
      if (r.read > 0) break; // Only one trades table per db
    }

    for (const name of ['signals', 'signal_events']) {
      const r = await migrateTable(db, name, 'signal_events', transformSignal);
      totalErrors += r.errors;
      if (r.read > 0) break;
    }

    db.close();
  }

  if (!DRY_RUN) await TSDB.end();

  log(`\nMigration ${totalErrors > 0 ? `completed with ${totalErrors} errors` : 'completed successfully'}`);
  if (totalErrors > 0) process.exit(1);
}

main().catch((err) => { console.error('Fatal:', err); process.exit(1); });
