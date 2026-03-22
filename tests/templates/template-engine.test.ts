import { describe, it, expect } from 'vitest';
import { TemplateEngine, ParamValidationError } from '../../src/templates/template-engine.js';
import type { StrategyTemplate } from '../../src/templates/template-registry.js';

function makeTemplate(overrides: Partial<StrategyTemplate> = {}): StrategyTemplate {
  return {
    id: 'grid-basic',
    name: 'Grid Basic',
    description: 'Basic grid strategy template',
    category: 'grid',
    strategyName: 'grid-trading' as any,
    defaultParams: { gridSpacing: 0.01, levels: 5 },
    requiredParams: ['marketId'],
    riskLevel: 'medium',
    ...overrides,
  };
}

describe('TemplateEngine', () => {
  const engine = new TemplateEngine();

  it('should instantiate with merged params', () => {
    const result = engine.instantiate(makeTemplate(), { marketId: 'BTC-USDC' });
    expect(result.templateId).toBe('grid-basic');
    expect(result.params['marketId']).toBe('BTC-USDC');
    expect(result.params['gridSpacing']).toBe(0.01); // default preserved
    expect(result.params['levels']).toBe(5);
  });

  it('should override default params', () => {
    const result = engine.instantiate(makeTemplate(), { marketId: 'ETH', gridSpacing: 0.05 });
    expect(result.params['gridSpacing']).toBe(0.05);
  });

  it('should throw ParamValidationError for missing required params', () => {
    expect(() => engine.instantiate(makeTemplate())).toThrow(ParamValidationError);
  });

  it('should report correct template id in error', () => {
    try {
      engine.instantiate(makeTemplate({ id: 'my-tmpl' }));
    } catch (e) {
      expect(e).toBeInstanceOf(ParamValidationError);
      expect((e as ParamValidationError).templateId).toBe('my-tmpl');
    }
  });

  it('should reject type mismatch against default param type', () => {
    expect(() => engine.instantiate(makeTemplate(), {
      marketId: 'BTC',
      gridSpacing: 'wide', // should be number
    })).toThrow(ParamValidationError);
  });

  it('should produce valid strategyConfig', () => {
    const result = engine.instantiate(makeTemplate(), { marketId: 'BTC' });
    expect(result.strategyConfig.name).toBe('grid-trading');
    expect(result.strategyConfig.enabled).toBe(true);
    expect(result.strategyConfig.capitalAllocation).toBe('0');
  });

  it('should use capitalAllocation from params', () => {
    const result = engine.instantiate(makeTemplate(), {
      marketId: 'BTC',
      capitalAllocation: 5000,
    });
    expect(result.strategyConfig.capitalAllocation).toBe('5000');
  });

  it('should allow extra params beyond required/default', () => {
    const result = engine.instantiate(makeTemplate(), { marketId: 'ETH', custom: true });
    expect(result.params['custom']).toBe(true);
  });
});
