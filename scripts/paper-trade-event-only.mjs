#!/usr/bin/env node
// Paper Trade Batch 2 — Event-only markets (no stock/crypto price predictions)
// Stores conditionId + slug for reliable resolution tracking
// Usage: node scripts/paper-trade-event-only.mjs [count] [db-path]

const GAMMA_API = 'https://gamma-api.polymarket.com/markets';
const LLM_URL = 'http://localhost:11435/v1/chat/completions';
const LLM_MODEL = 'mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit';
const MIN_EDGE = 0.05;

// Price market patterns to exclude — LLM has 0% accuracy on these
const PRICE_PATTERN = /\b(above|below|close above|close below|dip to|price of|finish.*above|finish.*below|hit.*\$|O\/U\s+[\d.]+|Points O\/U|Kills O\/U|Total.*O\/U|spread|handicap)\b/i;
const EXCLUDE_CATEGORIES = new Set(['crypto', 'cryptocurrency', 'esports']);

async function fetchEventMarkets(limit = 500) {
  const url = `${GAMMA_API}?active=true&closed=false&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`Gamma API: ${res.status}`);
  const markets = await res.json();

  return markets.filter(m => {
    // Must be active binary market
    if (!m.active || m.closed) return false;

    // Parse outcomes — Gamma API returns JSON string, not array
    let outcomes;
    try {
      outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes;
    } catch { return false; }
    if (!Array.isArray(outcomes) || outcomes.length !== 2) return false;
    if (outcomes[0] !== 'Yes' || outcomes[1] !== 'No') return false;

    // Exclude price prediction markets
    const q = m.question || '';
    if (PRICE_PATTERN.test(q)) return false;

    // Exclude crypto/stock categories
    const cat = (m.category || '').toLowerCase();
    if (EXCLUDE_CATEGORIES.has(cat)) return false;

    // Must have some volume (lowered to 10 for long-tail)
    const vol = parseFloat(m.volume || '0');
    if (vol < 10) return false;

    // Parse YES price from outcomePrices (also JSON string)
    if (!m.outcomePrices) return false;
    try {
      const prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices;
      const yesPrice = parseFloat(prices[0]);
      if (isNaN(yesPrice) || yesPrice <= 0.01 || yesPrice >= 0.99) return false;
      m._yesPrice = yesPrice;
    } catch { return false; }

    return true;
  });
}

async function estimateBlind(question, resolutionCriteria) {
  const messages = [
    {
      role: 'system',
      content: 'You are a superforecaster with calibrated probability estimates. Estimate the TRUE probability of events using base rates, evidence, and reasoning. Do NOT ask for or assume any market price. Give your independent estimate. Respond ONLY with valid JSON — no markdown, no extra text.'
    },
    {
      role: 'user',
      content: [
        `Prediction market question: "${question}"`,
        resolutionCriteria ? `Resolution criteria: ${resolutionCriteria}` : '',
        '',
        'Estimate using this framework:',
        '1. BASE RATE: Out of 100 similar events in history, how many happened? (frequency format)',
        '2. INSIDE VIEW: What specific factors make THIS case different from the reference class?',
        '3. DE-BIAS: Are you anchored? Overconfident? Neglecting base rates? Adjust toward base rate.',
        '4. FINAL: Combine outside + inside views. State probability.',
        'Do NOT guess what the market thinks. Give YOUR independent estimate.',
        '',
        'Respond with ONLY this JSON:',
        '{"probability":0.0-1.0,"confidence":0.0-1.0,"reasoning":"base rate X/100, adjusted because..."}'
      ].filter(Boolean).join('\n')
    }
  ];

  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: LLM_MODEL, messages, max_tokens: 2000, temperature: 0.3 }),
    signal: AbortSignal.timeout(120000),
  });

  if (!res.ok) throw new Error(`LLM: ${res.status}`);
  const data = await res.json();
  // DeepSeek R1 may put chain-of-thought in content and JSON after </think>
  const msg = data.choices?.[0]?.message || {};
  const raw = (msg.content || '') + (msg.reasoning || '');

  try {
    // Strip think blocks, markdown fences, then find JSON with probability key
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/<think>[\s\S]*?<\/think>/g, '');
    const match = cleaned.match(/\{[\s\S]*?\}/g)?.find(m => m.includes('probability'));
    if (!match) throw new Error('No JSON');
    const parsed = JSON.parse(match);
    return {
      probability: Math.max(0.01, Math.min(0.99, parsed.probability ?? 0.5)),
      confidence: Math.max(0, Math.min(1, parsed.confidence ?? 0.5)),
      reasoning: (parsed.reasoning || 'No reasoning').slice(0, 200),
    };
  } catch {
    return { probability: 0.5, confidence: 0.3, reasoning: `Parse error: ${raw.slice(0, 80)}` };
  }
}

async function main() {
  const targetCount = parseInt(process.argv[2] || '50', 10);
  const dbPath = process.argv[3] || 'data/algo-trade.db';

  const Database = (await import('better-sqlite3')).default;
  const db = new Database(dbPath);

  // Create v3 table with conditionId and slug
  db.exec(`CREATE TABLE IF NOT EXISTS paper_trades_v3 (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp TEXT NOT NULL,
    condition_id TEXT,
    slug TEXT,
    category TEXT,
    market_question TEXT NOT NULL,
    market_prob REAL NOT NULL,
    our_prob REAL NOT NULL,
    edge REAL NOT NULL,
    direction TEXT NOT NULL,
    confidence REAL,
    reasoning TEXT,
    strategy TEXT DEFAULT 'blind_event_only',
    resolved INTEGER DEFAULT 0,
    outcome TEXT,
    correct INTEGER
  )`);

  const insert = db.prepare(`INSERT INTO paper_trades_v3
    (timestamp, condition_id, slug, category, market_question, market_prob, our_prob, edge, direction, confidence, reasoning, strategy)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'blind_event_only')`);

  console.log(`\nFetching event-only markets from Polymarket...\n`);
  const markets = await fetchEventMarkets(200);
  console.log(`Found ${markets.length} event-only markets (excluded price/crypto)\n`);

  if (markets.length === 0) {
    console.log('No qualifying markets found. Try expanding filters.');
    db.close();
    return;
  }

  let completed = 0, actionable = 0, totalEdge = 0;
  const shuffled = markets.sort(() => Math.random() - 0.5).slice(0, targetCount);

  for (const m of shuffled) {
    const yesPrice = m._yesPrice;
    const question = m.question;
    const conditionId = m.conditionId || m.condition_id || '';
    const slug = m.slug || '';
    const category = m.category || '';

    try {
      const est = await estimateBlind(question, m.description);
      const edge = est.probability - yesPrice;
      const absEdge = Math.abs(edge);
      const direction = edge > MIN_EDGE ? 'BUY_YES' : edge < -MIN_EDGE ? 'BUY_NO' : 'SKIP';

      const ts = new Date().toISOString();
      insert.run(ts, conditionId, slug, category, question, yesPrice, est.probability, edge, direction, est.confidence, est.reasoning);

      completed++;
      if (direction !== 'SKIP') {
        actionable++;
        totalEdge += absEdge;
      }

      const mark = direction === 'SKIP' ? '-' : direction === 'BUY_YES' ? '▲' : '▼';
      console.log(`${completed}/${targetCount} ${mark} edge:${edge.toFixed(3).padStart(7)} | our:${est.probability.toFixed(2)} mkt:${yesPrice.toFixed(2)} | ${question.slice(0, 55)}`);
    } catch (err) {
      console.log(`  ERR: ${err.message.slice(0, 60)} | ${question.slice(0, 40)}`);
    }
  }

  const avgEdge = actionable > 0 ? (totalEdge / actionable) : 0;
  console.log('\n' + '='.repeat(70));
  console.log('BATCH 2 — EVENT-ONLY PAPER TRADES');
  console.log('='.repeat(70));
  console.log(`Total:      ${completed}`);
  console.log(`Actionable: ${actionable} (${(actionable/completed*100).toFixed(1)}%)`);
  console.log(`Avg |edge|: ${(avgEdge*100).toFixed(1)}%`);
  console.log(`Strategy:   blind_event_only`);
  console.log(`Table:      paper_trades_v3`);
  console.log('='.repeat(70));

  db.close();
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
