import { describe, it, expect, vi } from 'vitest';
import { PerformanceAnalyzer } from '../../src/openclaw/performance-analyzer.js';
import type { AiRouter } from '../../src/openclaw/ai-router.js';
import type { TradeSnapshot } from '../../src/openclaw/trade-observer.js';

function makeMockRouter(response: string): AiRouter {
  return {
    chat: vi.fn().mockResolvedValue({ content: response, model: 'test-model' }),
  } as unknown as AiRouter;
}

function makeSnapshot(overrides: Partial<TradeSnapshot> = {}): TradeSnapshot {
  return {
    timestamp: Date.now(),
    recentTrades: [],
    winRate: 0.6,
    avgReturn: 0.003,
    drawdown: 0.05,
    activeStrategies: ['grid-dca'],
    ...overrides,
  } as TradeSnapshot;
}

describe('PerformanceAnalyzer', () => {
  describe('analyzeSnapshot', () => {
    it('should parse valid AI response', async () => {
      const resp = JSON.stringify({
        assessment: 'healthy',
        insights: ['Good win rate', 'Low drawdown'],
        suggestions: ['Increase position size'],
        confidence: 0.85,
      });
      const analyzer = new PerformanceAnalyzer(makeMockRouter(resp));
      const result = await analyzer.analyzeSnapshot(makeSnapshot());
      expect(result.assessment).toBe('healthy');
      expect(result.insights).toHaveLength(2);
      expect(result.suggestions).toHaveLength(1);
      expect(result.confidence).toBe(0.85);
    });

    it('should fallback on unparseable response', async () => {
      const analyzer = new PerformanceAnalyzer(makeMockRouter('not json'));
      const result = await analyzer.analyzeSnapshot(makeSnapshot());
      expect(result.assessment).toBe('warning');
      expect(result.confidence).toBe(0.3);
      expect(result.suggestions[0]).toContain('Unable to parse');
    });

    it('should clamp confidence to [0,1]', async () => {
      const resp = JSON.stringify({ assessment: 'healthy', insights: [], suggestions: [], confidence: 10 });
      const analyzer = new PerformanceAnalyzer(makeMockRouter(resp));
      const result = await analyzer.analyzeSnapshot(makeSnapshot());
      expect(result.confidence).toBe(1);
    });

    it('should default assessment to warning on invalid value', async () => {
      const resp = JSON.stringify({ assessment: 'excellent', insights: [], suggestions: [], confidence: 0.5 });
      const analyzer = new PerformanceAnalyzer(makeMockRouter(resp));
      const result = await analyzer.analyzeSnapshot(makeSnapshot());
      expect(result.assessment).toBe('warning');
    });
  });

  describe('detectAnomalies', () => {
    it('should parse valid anomaly response', async () => {
      const resp = JSON.stringify({
        detected: true,
        anomalies: ['Unusual volume spike', 'Price deviation'],
        severity: 'medium',
      });
      const analyzer = new PerformanceAnalyzer(makeMockRouter(resp));
      const report = await analyzer.detectAnomalies(makeSnapshot());
      expect(report.detected).toBe(true);
      expect(report.anomalies).toHaveLength(2);
      expect(report.severity).toBe('medium');
    });

    it('should return safe defaults on parse failure', async () => {
      const analyzer = new PerformanceAnalyzer(makeMockRouter('broken'));
      const report = await analyzer.detectAnomalies(makeSnapshot());
      expect(report.detected).toBe(false);
      expect(report.anomalies).toEqual([]);
      expect(report.severity).toBe('none');
    });

    it('should default severity on invalid value', async () => {
      const resp = JSON.stringify({ detected: false, anomalies: [], severity: 'extreme' });
      const analyzer = new PerformanceAnalyzer(makeMockRouter(resp));
      const report = await analyzer.detectAnomalies(makeSnapshot());
      expect(report.severity).toBe('none');
    });
  });

  describe('generateDailyReport', () => {
    it('should parse valid daily report', async () => {
      const resp = JSON.stringify({
        date: '2026-03-22',
        summary: 'Good day',
        topPerformingStrategies: ['grid-dca'],
        riskFlags: [],
        recommendations: ['Keep going'],
        overallScore: 85,
      });
      const analyzer = new PerformanceAnalyzer(makeMockRouter(resp));
      const report = await analyzer.generateDailyReport([makeSnapshot()]);
      expect(report.date).toBe('2026-03-22');
      expect(report.summary).toBe('Good day');
      expect(report.overallScore).toBe(85);
      expect(report.topPerformingStrategies).toContain('grid-dca');
    });

    it('should clamp overallScore to [0,100]', async () => {
      const resp = JSON.stringify({
        date: '2026-03-22', summary: 'test',
        topPerformingStrategies: [], riskFlags: [],
        recommendations: [], overallScore: 150,
      });
      const analyzer = new PerformanceAnalyzer(makeMockRouter(resp));
      const report = await analyzer.generateDailyReport([makeSnapshot()]);
      expect(report.overallScore).toBe(100);
    });

    it('should fallback on parse failure', async () => {
      const analyzer = new PerformanceAnalyzer(makeMockRouter('not json'));
      const report = await analyzer.generateDailyReport([makeSnapshot()]);
      expect(report.overallScore).toBe(0);
      expect(report.riskFlags).toContain('Could not parse structured AI response.');
    });
  });
});
