// Hedge discovery — ported from PolyClaw (chainstacklabs/polyclaw)
// Uses LLM to find logically necessary implications between Polymarket markets,
// then builds covering portfolios from those implications.

import type { GammaMarket } from './gamma-client.js';
import type { AiRouter } from '../openclaw/ai-router.js';
import {
  buildPortfolio,
  NECESSARY_PROBABILITY,
  type HedgePortfolio,
  type MarketPrices,
  type PositionSide,
} from './hedge-coverage.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ImplicationItem {
  marketId: string;
  marketQuestion: string;
  explanation: string;
  counterexampleAttempt: string;
}

export interface ImplicationResult {
  impliedBy: ImplicationItem[];
  implies: ImplicationItem[];
}

export interface CoverRelation {
  targetPosition: PositionSide;
  coverMarket: GammaMarket;
  coverPosition: PositionSide;
  relationship: string;
  probability: number;
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

export const IMPLICATION_PROMPT = `Find ONLY logically necessary relationships between prediction market events.

## TARGET EVENT:
"{targetQuestion}"

## AVAILABLE EVENTS:
{marketListText}

## WHAT IS "NECESSARY"?
A **NECESSARY** implication (A -> B) means: "If A is true, B MUST be true BY DEFINITION OR PHYSICAL LAW."
There must be ZERO possible scenarios where A=YES and B=NO. Not "unlikely" - IMPOSSIBLE.

## VALID NECESSARY RELATIONSHIPS (include these):
- "election held" -> "election called" (DEFINITION: can't hold without calling)
- "city captured" -> "military operation in city" (PHYSICAL: can't capture without entering)

## NOT NECESSARY - DO NOT INCLUDE:
- "war started" -> "peace talks failed" (WRONG: war can start without talks)
- "candidate wins primary" -> "candidate wins general" (WRONG: can lose general)

## YOUR TASK
Find relationships where events GUARANTEE each other:
### 1. implied_by (OTHER -> TARGET): What GUARANTEES the target?
### 2. implies (TARGET -> OTHER): What does the target GUARANTEE?

## STRICT COUNTEREXAMPLE TEST (REQUIRED)
For EACH relationship: try to construct a scenario that violates it. Only include if LOGICALLY IMPOSSIBLE.

## OUTPUT FORMAT (JSON only):
\`\`\`json
{
  "implied_by": [{"market_id":"...","market_question":"...","explanation":"...","counterexample_attempt":"..."}],
  "implies": [{"market_id":"...","market_question":"...","explanation":"...","counterexample_attempt":"..."}]
}
\`\`\`

## CRITICAL RULES:
1. QUALITY OVER QUANTITY - empty lists are fine, false positives are NOT
2. "Likely" or "usually" means DO NOT INCLUDE
3. Correlations are NOT implications
4. When in doubt, LEAVE IT OUT`;

// ---------------------------------------------------------------------------
// JSON extraction
// ---------------------------------------------------------------------------

/** Extract JSON object from LLM response (handles markdown code blocks). */
export function extractJsonFromResponse(text: string): ImplicationResult | null {
  let cleaned = text.trim();

  // Remove markdown code blocks
  if (cleaned.includes('```json')) cleaned = cleaned.split('```json')[1] ?? cleaned;
  if (cleaned.includes('```')) cleaned = cleaned.split('```')[0] ?? cleaned;
  cleaned = cleaned.trim();

  // Try direct parse
  try { return JSON.parse(cleaned) as ImplicationResult; } catch { /* continue */ }

  // Try regex extraction
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try { return JSON.parse(match[0]) as ImplicationResult; } catch { /* continue */ }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Market matching
// ---------------------------------------------------------------------------

/** Match LLM-referenced market to actual market list (ID → question → fuzzy). */
export function matchMarket(
  marketId: string,
  marketQuestion: string,
  marketsById: Map<string, GammaMarket>,
  marketsByQuestion: Map<string, GammaMarket>,
): GammaMarket | null {
  // Direct ID match
  if (marketsById.has(marketId)) return marketsById.get(marketId)!;

  // Question match (case insensitive)
  const qLower = marketQuestion.toLowerCase().trim();
  if (marketsByQuestion.has(qLower)) return marketsByQuestion.get(qLower)!;

  // Fuzzy: substring match
  for (const [q, market] of marketsByQuestion) {
    if (qLower.includes(q) || q.includes(qLower)) return market;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Cover derivation
// ---------------------------------------------------------------------------

/**
 * Derive cover relationships from LLM implications.
 *
 * For target event T:
 * - "implied_by" (other→target): contrapositive → YES cover (buy NO on other)
 * - "implies" (target→other): direct → NO cover (buy YES on other)
 */
export function deriveCoversFromImplications(
  llmResult: ImplicationResult,
  targetMarket: GammaMarket,
  otherMarkets: GammaMarket[],
): CoverRelation[] {
  const marketsById = new Map(otherMarkets.map(m => [m.id, m]));
  const marketsByQuestion = new Map(otherMarkets.map(m => [m.question.toLowerCase().trim(), m]));

  const covers: CoverRelation[] = [];

  // "implied_by": other→target (contrapositive: target=NO → other=NO)
  for (const item of llmResult.impliedBy ?? []) {
    const matched = matchMarket(item.marketId, item.marketQuestion, marketsById, marketsByQuestion);
    if (!matched || matched.id === targetMarket.id) continue;
    covers.push({
      targetPosition: 'YES',
      coverMarket: matched,
      coverPosition: 'NO',
      relationship: `necessary (contrapositive): ${item.explanation}`,
      probability: NECESSARY_PROBABILITY,
    });
  }

  // "implies": target→other (direct: buy target=NO, covered by other=YES)
  for (const item of llmResult.implies ?? []) {
    const matched = matchMarket(item.marketId, item.marketQuestion, marketsById, marketsByQuestion);
    if (!matched || matched.id === targetMarket.id) continue;
    covers.push({
      targetPosition: 'NO',
      coverMarket: matched,
      coverPosition: 'YES',
      relationship: `necessary (direct): ${item.explanation}`,
      probability: NECESSARY_PROBABILITY,
    });
  }

  return covers;
}

// ---------------------------------------------------------------------------
// Portfolio building from covers
// ---------------------------------------------------------------------------

/** Convert GammaMarket to MarketPrices for coverage calculator. */
function toMarketPrices(m: GammaMarket): MarketPrices {
  return { id: m.id, question: m.question, slug: m.slug, yesPrice: m.yesPrice, noPrice: m.noPrice };
}

/** Build hedge portfolios from cover relations. */
export function buildPortfoliosFromCovers(
  targetMarket: GammaMarket,
  covers: CoverRelation[],
): HedgePortfolio[] {
  const portfolios: HedgePortfolio[] = [];
  const targetPrices = toMarketPrices(targetMarket);

  for (const cover of covers) {
    const coverPrices = toMarketPrices(cover.coverMarket);
    const portfolio = buildPortfolio(
      targetPrices,
      coverPrices,
      cover.targetPosition,
      cover.coverPosition,
      cover.probability,
      cover.relationship,
    );
    if (portfolio) portfolios.push(portfolio);
  }

  return portfolios;
}

// ---------------------------------------------------------------------------
// High-level scan (requires AI router)
// ---------------------------------------------------------------------------

/**
 * Scan markets for hedge opportunities using AI-powered implication discovery.
 *
 * @param targetMarket - Market to find hedges for
 * @param otherMarkets - Pool of potential cover markets
 * @param ai - OpenClaw AI router for LLM calls
 */
export async function scanForHedges(
  targetMarket: GammaMarket,
  otherMarkets: GammaMarket[],
  ai: AiRouter,
): Promise<HedgePortfolio[]> {
  const marketListText = otherMarkets
    .filter(m => m.id !== targetMarket.id)
    .map(m => `- ID: ${m.id}, Question: ${m.question}`)
    .join('\n');

  const prompt = IMPLICATION_PROMPT
    .replace('{targetQuestion}', targetMarket.question)
    .replace('{marketListText}', marketListText);

  const response = await ai.chat({
    prompt,
    systemPrompt: 'You are a logic expert analyzing prediction market implications. Respond with valid JSON only.',
    complexity: 'complex',
    maxTokens: 1024,
  });

  const parsed = extractJsonFromResponse(response.content);
  if (!parsed) return [];

  const covers = deriveCoversFromImplications(parsed, targetMarket, otherMarkets);
  return buildPortfoliosFromCovers(targetMarket, covers);
}
