// AI Signal Generator: OpenClaw generates trade signals from market analysis
// Signals are stored in-memory (rotated) and exposed via API + WebSocket
// Uses AI to analyze market conditions and generate buy/sell/hold signals

import { AiRouter } from './ai-router.js';
import { logger } from '../core/logger.js';

export type SignalAction = 'buy' | 'sell' | 'hold';
export type SignalStrength = 'strong' | 'moderate' | 'weak';

export interface TradeSignal {
  id: string;
  timestamp: number;
  market: string;
  action: SignalAction;
  strength: SignalStrength;
  confidence: number; // 0-1
  reasoning: string;
  model: string;
  strategy: string;
}

interface RawSignalJson {
  action?: string;
  strength?: string;
  confidence?: number;
  reasoning?: string;
}

const MAX_SIGNALS = 200;

export class AiSignalGenerator {
  private readonly router: AiRouter;
  private readonly signals: TradeSignal[] = [];
  private signalCounter = 0;

  constructor(router: AiRouter) {
    this.router = router;
  }

  /** Generate a trade signal for a given market using AI analysis */
  async generateSignal(
    market: string,
    strategy: string,
    marketData: Record<string, unknown>,
  ): Promise<TradeSignal> {
    const prompt = [
      `Analyze the ${market} market for the "${strategy}" strategy.`,
      'Based on the data below, generate a trading signal.',
      'Respond ONLY with valid JSON:',
      '{"action":"buy|sell|hold","strength":"strong|moderate|weak","confidence":0.0-1.0,"reasoning":"brief explanation"}',
      '',
      `Market data: ${JSON.stringify(marketData)}`,
    ].join('\n');

    const res = await this.router.chat({
      prompt,
      systemPrompt: 'You are a quantitative trading signal generator. Respond with valid JSON only.',
      complexity: 'standard',
      maxTokens: 256,
    });

    const parsed = this.parseSignal(res.content);
    const signal: TradeSignal = {
      id: `sig_${++this.signalCounter}_${Date.now()}`,
      timestamp: Date.now(),
      market,
      action: parsed.action,
      strength: parsed.strength,
      confidence: parsed.confidence,
      reasoning: parsed.reasoning,
      model: res.model,
      strategy,
    };

    this.signals.push(signal);
    if (this.signals.length > MAX_SIGNALS) {
      this.signals.splice(0, this.signals.length - MAX_SIGNALS);
    }

    logger.debug('AI signal generated', 'OpenClaw', {
      market, action: signal.action, confidence: signal.confidence,
    });

    return signal;
  }

  /** Get recent signals, optionally filtered by market */
  getSignals(market?: string, limit = 50): TradeSignal[] {
    let result = this.signals;
    if (market) {
      result = result.filter((s) => s.market === market);
    }
    return result.slice(-limit).reverse();
  }

  /** Get latest signal for a specific market */
  getLatestSignal(market: string): TradeSignal | undefined {
    for (let i = this.signals.length - 1; i >= 0; i--) {
      if (this.signals[i].market === market) return this.signals[i];
    }
    return undefined;
  }

  /** Get signal stats summary */
  getStats(): {
    totalSignals: number;
    actionBreakdown: Record<SignalAction, number>;
    avgConfidence: number;
    markets: string[];
  } {
    const actionBreakdown: Record<SignalAction, number> = { buy: 0, sell: 0, hold: 0 };
    let totalConf = 0;
    const marketSet = new Set<string>();

    for (const s of this.signals) {
      actionBreakdown[s.action]++;
      totalConf += s.confidence;
      marketSet.add(s.market);
    }

    return {
      totalSignals: this.signals.length,
      actionBreakdown,
      avgConfidence: this.signals.length > 0 ? totalConf / this.signals.length : 0,
      markets: [...marketSet],
    };
  }

  private parseSignal(raw: string): {
    action: SignalAction;
    strength: SignalStrength;
    confidence: number;
    reasoning: string;
  } {
    try {
      const cleaned = raw.replace(/```(?:json)?\n?/g, '').trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON found');

      const data = JSON.parse(match[0]) as RawSignalJson;

      const validActions: SignalAction[] = ['buy', 'sell', 'hold'];
      const validStrengths: SignalStrength[] = ['strong', 'moderate', 'weak'];

      return {
        action: validActions.includes(data.action as SignalAction)
          ? (data.action as SignalAction) : 'hold',
        strength: validStrengths.includes(data.strength as SignalStrength)
          ? (data.strength as SignalStrength) : 'moderate',
        confidence: typeof data.confidence === 'number'
          ? Math.max(0, Math.min(1, data.confidence)) : 0.5,
        reasoning: typeof data.reasoning === 'string'
          ? data.reasoning : 'No reasoning provided',
      };
    } catch {
      return {
        action: 'hold',
        strength: 'weak',
        confidence: 0.3,
        reasoning: `Could not parse AI response: ${raw.slice(0, 100)}`,
      };
    }
  }
}
