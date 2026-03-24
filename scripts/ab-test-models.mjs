#!/usr/bin/env node
// A/B Test: DeepSeek-R1-Distill vs Qwen-32B on prediction markets
// Runs same 10 markets through both models, compares estimates
// Usage: node scripts/ab-test-models.mjs [llm-port]

const LLM_PORT = process.argv[2] || '11435';
const LLM_URL = `http://localhost:${LLM_PORT}/v1/chat/completions`;
const GAMMA_API = 'https://gamma-api.polymarket.com/markets';

const MODELS = [
  'mlx-community/Qwen2.5-Coder-32B-Instruct-4bit',
  'mlx-community/DeepSeek-R1-Distill-Qwen-32B-4bit',
];

const SYSTEM_PROMPT = [
  'You are a superforecaster with calibrated probability estimates.',
  'Estimate the TRUE probability of events using base rates, evidence, and reasoning.',
  'Do NOT ask for or assume any market price. Give your independent estimate.',
  'Respond ONLY with valid JSON — no markdown, no extra text.',
].join(' ');

function buildPrompt(question) {
  return [
    `Prediction market question: "${question}"`,
    '',
    'Estimate the probability this event occurs.',
    'Think step by step: base rate, recent evidence, key factors.',
    'Do NOT guess what the market thinks. Give YOUR independent estimate.',
    '',
    'Respond with ONLY this JSON:',
    '{"probability":0.0-1.0,"confidence":0.0-1.0,"reasoning":"3 sentences max"}',
  ].join('\n');
}

async function estimate(model, question) {
  const start = Date.now();
  const res = await fetch(LLM_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: buildPrompt(question) },
      ],
      max_tokens: model.includes('DeepSeek') ? 2000 : 300,
      temperature: 0.3,
    }),
    signal: AbortSignal.timeout(120000),
  });

  const latency = Date.now() - start;
  if (!res.ok) return { error: `HTTP ${res.status}`, latency };

  const data = await res.json();
  // DeepSeek R1 may put chain-of-thought in content and JSON after </think>
  const msg = data.choices?.[0]?.message || {};
  const raw = (msg.content || '') + (msg.reasoning || '');

  try {
    // Strip think blocks, markdown fences, then find JSON
    const cleaned = raw.replace(/```(?:json)?\n?/g, '').replace(/<think>[\s\S]*?<\/think>/g, '');
    const match = cleaned.match(/\{[\s\S]*?\}/g)?.find(m => m.includes('probability'));
    if (!match) return { error: 'No JSON', raw: raw.slice(-100), latency };
    const parsed = JSON.parse(match);
    return {
      probability: Math.max(0.01, Math.min(0.99, parsed.probability ?? 0.5)),
      confidence: parsed.confidence ?? 0.5,
      reasoning: (parsed.reasoning || '').slice(0, 120),
      latency,
    };
  } catch {
    return { error: 'Parse fail', raw: raw.slice(0, 100), latency };
  }
}

async function fetchTestMarkets(count = 10) {
  const res = await fetch(`${GAMMA_API}?active=true&closed=false&limit=200`);
  const markets = await res.json();

  // Filter for good event-based binary markets
  const pricePattern = /\b(above|below|close above|dip to|price of|O\/U|Points|Kills|spread|handicap)\b/i;
  const excludeCats = new Set(['crypto', 'cryptocurrency', 'esports']);

  return markets.filter(m => {
    if (!m.active || m.closed) return false;
    let outcomes;
    try { outcomes = typeof m.outcomes === 'string' ? JSON.parse(m.outcomes) : m.outcomes; } catch { return false; }
    if (!Array.isArray(outcomes) || outcomes.length !== 2 || outcomes[0] !== 'Yes') return false;
    if (pricePattern.test(m.question || '')) return false;
    if (excludeCats.has((m.category || '').toLowerCase())) return false;
    let prices;
    try { prices = typeof m.outcomePrices === 'string' ? JSON.parse(m.outcomePrices) : m.outcomePrices; } catch { return false; }
    const yp = parseFloat(prices[0]);
    if (isNaN(yp) || yp <= 0.05 || yp >= 0.95) return false;
    m._yesPrice = yp;
    return true;
  }).slice(0, count);
}

async function main() {
  console.log('Fetching 10 event markets for A/B test...\n');
  const markets = await fetchTestMarkets(10);
  console.log(`Got ${markets.length} markets\n`);

  const results = [];

  for (const m of markets) {
    const q = m.question;
    const mktPrice = m._yesPrice;
    console.log(`--- ${q.slice(0, 65)} (mkt: ${mktPrice.toFixed(3)}) ---`);

    for (const model of MODELS) {
      const shortName = model.includes('DeepSeek') ? 'DeepSeek' : 'Qwen';
      console.log(`  ${shortName}: estimating...`);

      const r = await estimate(model, q);
      if (r.error) {
        console.log(`  ${shortName}: ERROR ${r.error} (${r.latency}ms)`);
        results.push({ question: q, model: shortName, mktPrice, error: r.error, latency: r.latency });
      } else {
        const edge = r.probability - mktPrice;
        console.log(`  ${shortName}: prob=${r.probability.toFixed(3)} edge=${edge.toFixed(3)} conf=${r.confidence.toFixed(2)} (${r.latency}ms)`);
        console.log(`    → ${r.reasoning}`);
        results.push({ question: q, model: shortName, mktPrice, prob: r.probability, edge, confidence: r.confidence, latency: r.latency, reasoning: r.reasoning });
      }
    }
    console.log('');
  }

  // Summary comparison
  console.log('='.repeat(70));
  console.log('A/B TEST SUMMARY');
  console.log('='.repeat(70));

  for (const model of ['Qwen', 'DeepSeek']) {
    const mr = results.filter(r => r.model === model && !r.error);
    const avgEdge = mr.reduce((s, r) => s + Math.abs(r.edge), 0) / (mr.length || 1);
    const avgLatency = mr.reduce((s, r) => s + r.latency, 0) / (mr.length || 1);
    const avgConf = mr.reduce((s, r) => s + r.confidence, 0) / (mr.length || 1);
    const actionable = mr.filter(r => Math.abs(r.edge) > 0.05).length;

    console.log(`\n${model}:`);
    console.log(`  Successful: ${mr.length}/${results.filter(r => r.model === model).length}`);
    console.log(`  Avg |edge|: ${(avgEdge * 100).toFixed(1)}%`);
    console.log(`  Avg confidence: ${avgConf.toFixed(2)}`);
    console.log(`  Avg latency: ${(avgLatency / 1000).toFixed(1)}s`);
    console.log(`  Actionable (>5% edge): ${actionable}`);
  }

  // Agreement analysis
  console.log('\nAgreement Analysis:');
  const paired = [];
  for (const m of markets) {
    const qwen = results.find(r => r.question === m.question && r.model === 'Qwen' && !r.error);
    const ds = results.find(r => r.question === m.question && r.model === 'DeepSeek' && !r.error);
    if (qwen && ds) {
      const agree = (qwen.edge > 0) === (ds.edge > 0);
      paired.push({ q: m.question.slice(0, 50), qwen: qwen.prob, ds: ds.prob, agree });
    }
  }
  const agreeCount = paired.filter(p => p.agree).length;
  console.log(`  Direction agreement: ${agreeCount}/${paired.length} (${(agreeCount/paired.length*100).toFixed(0)}%)`);
  console.log(`  Avg prob diff: ${(paired.reduce((s,p)=>s+Math.abs(p.qwen-p.ds),0)/paired.length*100).toFixed(1)}%`);

  console.log('\n' + '='.repeat(70));
}

main().catch(err => { console.error('Error:', err.message); process.exit(1); });
