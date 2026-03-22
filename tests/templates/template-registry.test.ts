import { describe, it, expect, beforeEach } from 'vitest';
import { TemplateRegistry, type StrategyTemplate } from '../../src/templates/template-registry.js';

function makeTemplate(id: string, category = 'grid', name = `Template ${id}`): StrategyTemplate {
  return {
    id,
    name,
    description: `Description for ${id}`,
    category,
    strategyName: 'grid-trading' as any,
    defaultParams: {},
    requiredParams: [],
    riskLevel: 'low',
  };
}

describe('TemplateRegistry', () => {
  let registry: TemplateRegistry;

  beforeEach(() => {
    registry = new TemplateRegistry();
  });

  it('should start empty', () => {
    expect(registry.listAll()).toHaveLength(0);
  });

  it('should register and retrieve by id', () => {
    registry.register(makeTemplate('t1'));
    expect(registry.getById('t1')).toBeDefined();
    expect(registry.getById('t1')?.name).toBe('Template t1');
  });

  it('should throw on empty id', () => {
    expect(() => registry.register(makeTemplate(''))).toThrow('empty');
  });

  it('should list all templates', () => {
    registry.register(makeTemplate('a'));
    registry.register(makeTemplate('b'));
    expect(registry.listAll()).toHaveLength(2);
  });

  it('should overwrite on duplicate id', () => {
    registry.register(makeTemplate('a', 'grid', 'V1'));
    registry.register(makeTemplate('a', 'grid', 'V2'));
    expect(registry.listAll()).toHaveLength(1);
    expect(registry.getById('a')?.name).toBe('V2');
  });

  it('should filter by category', () => {
    registry.register(makeTemplate('g1', 'grid'));
    registry.register(makeTemplate('a1', 'arb'));
    registry.register(makeTemplate('g2', 'grid'));
    expect(registry.listByCategory('grid')).toHaveLength(2);
    expect(registry.listByCategory('arb')).toHaveLength(1);
    expect(registry.listByCategory('dca')).toHaveLength(0);
  });

  it('should search by name substring (case-insensitive)', () => {
    registry.register(makeTemplate('t1', 'grid', 'Grid Scalper'));
    registry.register(makeTemplate('t2', 'arb', 'Arb Hunter'));
    expect(registry.search('grid')).toHaveLength(1);
    expect(registry.search('HUNTER')).toHaveLength(1);
  });

  it('should search by description substring', () => {
    registry.register(makeTemplate('t1'));
    expect(registry.search('Description')).toHaveLength(1);
  });

  it('should return all when search query is empty', () => {
    registry.register(makeTemplate('a'));
    registry.register(makeTemplate('b'));
    expect(registry.search('')).toHaveLength(2);
  });

  it('should return undefined for unknown id', () => {
    expect(registry.getById('nonexistent')).toBeUndefined();
  });
});
