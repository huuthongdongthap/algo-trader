// Sentiment feed — multi-source sentiment aggregation
// Sources: NewsAPI, CoinGecko, Twitter/X, AlphaEar FinBERT (sidecar)
// AlphaEar provides deep FinBERT analysis when sidecar is available

import { alphaear } from '../intelligence/alphaear-client.js';

export type SentimentScore = 'positive' | 'negative' | 'neutral';

export interface SentimentSignal {
  source: 'twitter' | 'newsapi' | 'coingecko' | 'reddit' | 'finbert';
  keyword: string;
  score: SentimentScore;
  numericScore: number; // positive=1, neutral=0, negative=-1
  headline?: string;
  url?: string;
  timestamp: number;
}

export interface SentimentSummary {
  keyword: string;
  signals: SentimentSignal[];
  averageScore: number;
  dominantSentiment: SentimentScore;
  updatedAt: number;
}

// ---------------------------------------------------------------------------
// Simple word-list classifier (no external deps)
// ---------------------------------------------------------------------------

const POS = new Set(['bullish','surge','rally','gain','profit','rise','win','beat',
  'outperform','breakthrough','adoption','approval','launch','partnership']);
const NEG = new Set(['bearish','crash','drop','loss','fall','fail','hack','ban',
  'regulation','lawsuit','liquidation','fear','sell','dump','fraud']);

export function classifyText(text: string): SentimentScore {
  const words = text.toLowerCase().split(/\W+/);
  let pos = 0; let neg = 0;
  for (const w of words) {
    if (POS.has(w)) pos++;
    if (NEG.has(w)) neg++;
  }
  return pos > neg ? 'positive' : neg > pos ? 'negative' : 'neutral';
}

function toNumeric(s: SentimentScore): number {
  return s === 'positive' ? 1 : s === 'negative' ? -1 : 0;
}

function makeSig(
  source: SentimentSignal['source'],
  keyword: string, text: string,
  extra: Partial<Pick<SentimentSignal, 'headline' | 'url' | 'timestamp'>> = {}
): SentimentSignal {
  const score = classifyText(text);
  return { source, keyword, score, numericScore: toNumeric(score),
    timestamp: Date.now(), ...extra };
}

// ---------------------------------------------------------------------------
// NewsAPI stub (requires NEWSAPI_KEY)
// https://newsapi.org/docs/endpoints/everything
// ---------------------------------------------------------------------------

export async function fetchNewsSignals(keyword: string): Promise<SentimentSignal[]> {
  const apiKey = process.env['NEWSAPI_KEY'];
  if (!apiKey) return [];
  try {
    const url = new URL('https://newsapi.org/v2/everything');
    url.searchParams.set('q', keyword);
    url.searchParams.set('sortBy', 'publishedAt');
    url.searchParams.set('pageSize', '10');
    url.searchParams.set('language', 'en');
    url.searchParams.set('apiKey', apiKey);
    const res = await fetch(url.toString(), { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as {
      articles?: { title: string; description: string | null; url: string; publishedAt: string }[]
    };
    return (data.articles ?? []).map(a =>
      makeSig('newsapi', keyword, `${a.title} ${a.description ?? ''}`, {
        headline: a.title, url: a.url,
        timestamp: new Date(a.publishedAt).getTime(),
      })
    );
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// CoinGecko trending (public, no key)
// https://docs.coingecko.com/reference/trending-search
// ---------------------------------------------------------------------------

export async function fetchCoinGeckoTrending(): Promise<SentimentSignal[]> {
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/search/trending',
      { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return [];
    const data = await res.json() as {
      coins?: { item: { name: string; symbol: string } }[]
    };
    return (data.coins ?? []).map(c => ({
      source: 'coingecko' as const,
      keyword: c.item.symbol.toLowerCase(),
      score: 'positive' as const,
      numericScore: 1,
      headline: `${c.item.name} is trending on CoinGecko`,
      timestamp: Date.now(),
    }));
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Twitter/X stub (requires TWITTER_BEARER_TOKEN)
// https://developer.twitter.com/en/docs/twitter-api
// ---------------------------------------------------------------------------

export async function fetchTwitterSignals(keyword: string): Promise<SentimentSignal[]> {
  const token = process.env['TWITTER_BEARER_TOKEN'];
  if (!token) return [];
  try {
    const url = new URL('https://api.twitter.com/2/tweets/search/recent');
    url.searchParams.set('query', `${keyword} -is:retweet lang:en`);
    url.searchParams.set('max_results', '10');
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];
    const data = await res.json() as {
      data?: { text: string; created_at?: string }[]
    };
    return (data.data ?? []).map(t =>
      makeSig('twitter', keyword, t.text, {
        headline: t.text.slice(0, 120),
        timestamp: t.created_at ? new Date(t.created_at).getTime() : Date.now(),
      })
    );
  } catch { return []; }
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// AlphaEar FinBERT (deep sentiment via sidecar at :8100)
// Falls back gracefully if sidecar unavailable
// ---------------------------------------------------------------------------

export async function getFinBERTSentiment(text: string): Promise<SentimentSignal | null> {
  const result = await alphaear.analyzeSentiment(text);
  if (!result) return null;
  const score: SentimentScore =
    result.label === 'positive' ? 'positive' :
    result.label === 'negative' ? 'negative' : 'neutral';
  return {
    source: 'finbert',
    keyword: text.slice(0, 50),
    score,
    numericScore: result.score,
    timestamp: Date.now(),
  };
}

export async function batchFinBERTSentiment(texts: string[]): Promise<SentimentSignal[]> {
  const results = await alphaear.batchSentiment(texts);
  return results.map((r, i) => {
    const score: SentimentScore =
      r.label === 'positive' ? 'positive' :
      r.label === 'negative' ? 'negative' : 'neutral';
    return {
      source: 'finbert' as const,
      keyword: texts[i]!.slice(0, 50),
      score,
      numericScore: r.score,
      timestamp: Date.now(),
    };
  });
}

// ---------------------------------------------------------------------------
// Aggregator
// ---------------------------------------------------------------------------

export async function getSentimentSummary(keyword: string): Promise<SentimentSummary> {
  const [news, tweets, trending] = await Promise.all([
    fetchNewsSignals(keyword),
    fetchTwitterSignals(keyword),
    fetchCoinGeckoTrending(),
  ]);
  const relevant = trending.filter(s => s.keyword.includes(keyword.toLowerCase()));
  const signals = [...news, ...tweets, ...relevant];

  // Enhance with FinBERT if sidecar available and we have news headlines
  const headlines = signals.filter(s => s.headline).map(s => s.headline!);
  if (headlines.length > 0) {
    const finbert = await batchFinBERTSentiment(headlines);
    signals.push(...finbert);
  }

  const avg = signals.length
    ? signals.reduce((s, sig) => s + sig.numericScore, 0) / signals.length
    : 0;
  const dominantSentiment: SentimentScore =
    avg > 0.1 ? 'positive' : avg < -0.1 ? 'negative' : 'neutral';
  return { keyword, signals, averageScore: avg, dominantSentiment, updatedAt: Date.now() };
}
