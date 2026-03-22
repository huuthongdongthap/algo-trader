import { describe, it, expect } from 'vitest';
import {
  extractJsonFromResponse,
  matchMarket,
  deriveCoversFromImplications,
  buildPortfoliosFromCovers,
  type ImplicationResult,
} from '../../src/polymarket/hedge-discovery.js';
import type { GammaMarket } from '../../src/polymarket/gamma-client.js';

function makeGammaMarket(overrides: Partial<GammaMarket> = {}): GammaMarket {
  return {
    id: 'm-1', question: 'Will event happen?', slug: 'event-happen',
    conditionId: 'cond-1', yesTokenId: 'yes-1', noTokenId: 'no-1',
    yesPrice: 0.8, noPrice: 0.2, volume: 100000, volume24h: 5000,
    liquidity: 50000, endDate: '2026-12-31', active: true, closed: false,
    resolved: false, outcome: null,
    ...overrides,
  };
}

describe('extractJsonFromResponse', () => {
  it('should parse raw JSON', () => {
    const result = extractJsonFromResponse('{"implied_by":[],"implies":[]}');
    expect(result).toEqual({ impliedBy: [], implies: [] });
  });

  it('should parse JSON in markdown code block', () => {
    const text = 'Here is the analysis:\n```json\n{"implied_by":[],"implies":[]}\n```\nDone.';
    const result = extractJsonFromResponse(text);
    expect(result).toEqual({ impliedBy: [], implies: [] });
  });

  it('should extract JSON from mixed text', () => {
    const text = 'Analysis: {"implied_by":[{"market_id":"m-1","market_question":"Q?","explanation":"test","counterexample_attempt":"none"}],"implies":[]}';
    const result = extractJsonFromResponse(text);
    expect(result?.impliedBy).toHaveLength(1);
    expect(result?.impliedBy[0].marketId).toBe('m-1');
  });

  it('should return null for non-JSON text', () => {
    expect(extractJsonFromResponse('no json here')).toBeNull();
  });

  it('should return null for empty string', () => {
    expect(extractJsonFromResponse('')).toBeNull();
  });

  it('should handle malformed JSON gracefully', () => {
    expect(extractJsonFromResponse('{broken json')).toBeNull();
  });
});

describe('matchMarket', () => {
  const markets = [
    makeGammaMarket({ id: 'abc', question: 'Will it rain tomorrow?' }),
    makeGammaMarket({ id: 'def', question: 'Will BTC hit 100k?' }),
  ];
  const byId = new Map(markets.map(m => [m.id, m]));
  const byQ = new Map(markets.map(m => [m.question.toLowerCase().trim(), m]));

  it('should match by exact ID', () => {
    const result = matchMarket('abc', '', byId, byQ);
    expect(result?.id).toBe('abc');
  });

  it('should match by exact question (case insensitive)', () => {
    const result = matchMarket('unknown', 'Will it rain tomorrow?', byId, byQ);
    expect(result?.id).toBe('abc');
  });

  it('should match by substring', () => {
    const result = matchMarket('unknown', 'rain tomorrow', byId, byQ);
    expect(result?.id).toBe('abc');
  });

  it('should return null for no match', () => {
    expect(matchMarket('nope', 'nothing matches', byId, byQ)).toBeNull();
  });
});

describe('deriveCoversFromImplications', () => {
  const target = makeGammaMarket({ id: 'target-1', question: 'City captured?' });
  const others = [
    makeGammaMarket({ id: 'other-1', question: 'Military operation in city?' }),
    makeGammaMarket({ id: 'other-2', question: 'Peace treaty signed?' }),
  ];

  it('should derive YES cover from implied_by', () => {
    const llm: ImplicationResult = {
      impliedBy: [{ marketId: 'other-1', marketQuestion: 'Military operation in city?', explanation: 'capture requires operation', counterexampleAttempt: 'impossible' }],
      implies: [],
    };
    const covers = deriveCoversFromImplications(llm, target, others);
    expect(covers).toHaveLength(1);
    expect(covers[0].targetPosition).toBe('YES');
    expect(covers[0].coverPosition).toBe('NO');
    expect(covers[0].coverMarket.id).toBe('other-1');
  });

  it('should derive NO cover from implies', () => {
    const llm: ImplicationResult = {
      impliedBy: [],
      implies: [{ marketId: 'other-2', marketQuestion: 'Peace treaty signed?', explanation: 'capture implies no treaty', counterexampleAttempt: 'impossible' }],
    };
    const covers = deriveCoversFromImplications(llm, target, others);
    expect(covers).toHaveLength(1);
    expect(covers[0].targetPosition).toBe('NO');
    expect(covers[0].coverPosition).toBe('YES');
  });

  it('should skip self-references', () => {
    const llm: ImplicationResult = {
      impliedBy: [{ marketId: 'target-1', marketQuestion: 'City captured?', explanation: 'self', counterexampleAttempt: 'n/a' }],
      implies: [],
    };
    const covers = deriveCoversFromImplications(llm, target, others);
    expect(covers).toHaveLength(0);
  });

  it('should skip unmatched markets', () => {
    const llm: ImplicationResult = {
      impliedBy: [{ marketId: 'nonexistent', marketQuestion: 'Unknown market?', explanation: 'test', counterexampleAttempt: 'n/a' }],
      implies: [],
    };
    const covers = deriveCoversFromImplications(llm, target, others);
    expect(covers).toHaveLength(0);
  });

  it('should handle empty implications', () => {
    const llm: ImplicationResult = { impliedBy: [], implies: [] };
    expect(deriveCoversFromImplications(llm, target, others)).toEqual([]);
  });
});

describe('buildPortfoliosFromCovers', () => {
  it('should build portfolios from valid covers', () => {
    const target = makeGammaMarket({ id: 't', yesPrice: 0.8, noPrice: 0.2 });
    const cover = makeGammaMarket({ id: 'c', yesPrice: 0.15, noPrice: 0.85 });
    const covers = [{
      targetPosition: 'YES' as const,
      coverMarket: cover,
      coverPosition: 'YES' as const,
      relationship: 'test',
      probability: 0.98,
    }];
    const portfolios = buildPortfoliosFromCovers(target, covers);
    expect(portfolios).toHaveLength(1);
    expect(portfolios[0].tier).toBe(1); // HIGH
    expect(portfolios[0].coverage).toBeGreaterThan(0.95);
  });

  it('should skip invalid portfolios', () => {
    const target = makeGammaMarket({ yesPrice: 0.3 });
    const cover = makeGammaMarket({ yesPrice: 0.3 });
    const covers = [{
      targetPosition: 'YES' as const,
      coverMarket: cover,
      coverPosition: 'YES' as const,
      relationship: 'weak',
      probability: 0.1,
    }];
    // coverage = 0.3 + 0.7*0.1 = 0.37 < 0.85 → filtered out
    const portfolios = buildPortfoliosFromCovers(target, covers);
    expect(portfolios).toHaveLength(0);
  });

  it('should handle empty covers', () => {
    const target = makeGammaMarket();
    expect(buildPortfoliosFromCovers(target, [])).toEqual([]);
  });
});
