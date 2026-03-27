/**
 * Signal Scorer
 * Scores and ranks arbitrage opportunities
 *
 * Scoring factors:
 * - Spread percentage (weight: 40%)
 * - Latency (weight: 25%)
 * - Volume available (weight: 20%)
 * - Exchange reliability (weight: 15%)
 */

import { ArbitrageOpportunity } from './spread-detector';

export interface SignalScore {
  opportunity: ArbitrageOpportunity;
  totalScore: number;
  breakdown: {
    spreadScore: number;
    latencyScore: number;
    volumeScore: number;
    reliabilityScore: number;
  };
  rank: number;
  recommendation: 'STRONG_BUY' | 'BUY' | 'HOLD' | 'SKIP';
}

export interface ScorerConfig {
  weights: {
    spread: number;
    latency: number;
    volume: number;
    reliability: number;
  };
  thresholds: {
    strongBuy: number;
    buy: number;
    hold: number;
  };
}

export class SignalScorer {
  private config: ScorerConfig;
  private exchangeReliability: Map<string, number>;

  constructor(config?: Partial<ScorerConfig>) {
    this.config = {
      weights: {
        spread: 0.4,
        latency: 0.25,
        volume: 0.2,
        reliability: 0.15,
      },
      thresholds: {
        strongBuy: 85,
        buy: 70,
        hold: 50,
      },
      ...config,
    };

    this.exchangeReliability = new Map([
      ['binance', 0.95],
      ['okx', 0.92],
      ['bybit', 0.90],
    ]);
  }

  /**
   * Score spread (0-100)
   * Higher spread = higher score
   */
  private scoreSpread(spreadPercent: number): number {
    // 0.1% = 20, 0.5% = 60, 1.0% = 100
    const normalized = Math.min(spreadPercent * 100, 100);
    return Math.min(normalized, 100);
  }

  /**
   * Score latency (0-100)
   * Lower latency = higher score
   */
  private scoreLatency(latencyMs: number): number {
    // 0ms = 100, 100ms = 80, 500ms = 20, 1000ms = 0
    const score = 100 - (latencyMs / 10);
    return Math.max(Math.min(score, 100), 0);
  }

  /**
   * Score volume (0-100)
   * Higher volume = higher score
   */
  private scoreVolume(volume: number): number {
    // 0.1 BTC = 20, 1 BTC = 60, 10 BTC = 100
    const normalized = Math.log10(volume + 1) * 25;
    return Math.min(Math.max(normalized, 0), 100);
  }

  /**
   * Get exchange reliability score (0-100)
   */
  private scoreReliability(exchange: string): number {
    const reliability = this.exchangeReliability.get(exchange.toLowerCase()) || 0.5;
    return reliability * 100;
  }

  /**
   * Calculate total score for an opportunity
   */
  private calculateTotalScore(breakdown: SignalScore['breakdown']): number {
    const { weights } = this.config;
    return (
      breakdown.spreadScore * weights.spread +
      breakdown.latencyScore * weights.latency +
      breakdown.volumeScore * weights.volume +
      breakdown.reliabilityScore * weights.reliability
    );
  }

  /**
   * Get recommendation based on score
   */
  private getRecommendation(score: number): SignalScore['recommendation'] {
    const { thresholds } = this.config;
    if (score >= thresholds.strongBuy) return 'STRONG_BUY';
    if (score >= thresholds.buy) return 'BUY';
    if (score >= thresholds.hold) return 'HOLD';
    return 'SKIP';
  }

  /**
   * Score single opportunity
   */
  score(opportunity: ArbitrageOpportunity, volume = 1.0): SignalScore {
    const breakdown = {
      spreadScore: this.scoreSpread(opportunity.spreadPercent),
      latencyScore: this.scoreLatency(opportunity.latency),
      volumeScore: this.scoreVolume(volume),
      reliabilityScore: this.scoreReliability(opportunity.buyExchange),
    };

    const totalScore = this.calculateTotalScore(breakdown);

    return {
      opportunity,
      totalScore: Math.round(totalScore * 100) / 100,
      breakdown,
      rank: 0,
      recommendation: this.getRecommendation(totalScore),
    };
  }

  /**
   * Score and rank multiple opportunities
   */
  scoreAll(opportunities: ArbitrageOpportunity[], volumes?: number[]): SignalScore[] {
    const scores = opportunities.map((opp, i) =>
      this.score(opp, volumes?.[i] || 1.0)
    );

    // Sort by score descending
    scores.sort((a, b) => b.totalScore - a.totalScore);

    // Assign ranks
    scores.forEach((score, i) => {
      score.rank = i + 1;
    });

    return scores;
  }

  /**
   * Filter to actionable signals only
   */
  filterActionable(scores: SignalScore[]): SignalScore[] {
    return scores.filter(
      s => s.recommendation === 'STRONG_BUY' || s.recommendation === 'BUY'
    );
  }

  /**
   * Update exchange reliability based on execution results
   */
  updateReliability(exchange: string, success: boolean): void {
    const current = this.exchangeReliability.get(exchange.toLowerCase()) || 0.5;
    const adjustment = success ? 0.01 : -0.02;
    const updated = Math.max(0.1, Math.min(0.99, current + adjustment));
    this.exchangeReliability.set(exchange.toLowerCase(), updated);
  }
}
