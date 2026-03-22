import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '../../src/plugins/plugin-registry.js';
import type { PluginModule } from '../../src/plugins/plugin-loader.js';

function makePlugin(name: string = 'test-plugin'): PluginModule {
  return {
    name,
    version: '1.0.0',
    description: `Plugin ${name}`,
    createStrategy: () => ({
      start: () => {},
      stop: () => {},
      getStatus: () => ({ state: 'stopped' }),
    }),
  } as PluginModule;
}

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('should register a valid plugin', () => {
    const result = registry.register(makePlugin());
    expect(result.valid).toBe(true);
  });

  it('should throw when registering duplicate name', () => {
    registry.register(makePlugin('dup'));
    expect(() => registry.register(makePlugin('dup'))).toThrow('already registered');
  });

  it('should list registered plugins', () => {
    registry.register(makePlugin('a'));
    registry.register(makePlugin('b'));
    const list = registry.listPlugins();
    expect(list).toHaveLength(2);
    expect(list.map(p => p.name)).toEqual(['a', 'b']);
  });

  it('should enable a valid plugin by default', () => {
    registry.register(makePlugin());
    const entry = registry.getPlugin('test-plugin');
    expect(entry?.enabled).toBe(true);
  });

  it('should disable and re-enable a plugin', () => {
    registry.register(makePlugin());
    registry.disable('test-plugin');
    expect(registry.getPlugin('test-plugin')?.enabled).toBe(false);
    registry.enable('test-plugin');
    expect(registry.getPlugin('test-plugin')?.enabled).toBe(true);
  });

  it('should throw when enabling unknown plugin', () => {
    expect(() => registry.enable('nonexistent')).toThrow('not found');
  });

  it('should throw when disabling unknown plugin', () => {
    expect(() => registry.disable('nonexistent')).toThrow('not found');
  });

  it('should create strategy from enabled plugin', () => {
    registry.register(makePlugin());
    const strategy = registry.createStrategy('test-plugin');
    expect(strategy).toBeDefined();
    expect(typeof strategy.start).toBe('function');
  });

  it('should throw when creating strategy from disabled plugin', () => {
    registry.register(makePlugin());
    registry.disable('test-plugin');
    expect(() => registry.createStrategy('test-plugin')).toThrow('disabled');
  });

  it('should return undefined for unknown plugin', () => {
    expect(registry.getPlugin('nope')).toBeUndefined();
  });

  it('should register invalid plugin with enabled=false and error', () => {
    const bad = {
      name: 'bad',
      version: '0.1.0',
      description: 'broken',
      createStrategy: () => { throw new Error('factory fail'); },
    } as PluginModule;
    const result = registry.register(bad);
    expect(result.valid).toBe(false);
    const entry = registry.getPlugin('bad');
    expect(entry?.enabled).toBe(false);
    expect(entry?.error).toBeDefined();
  });
});
