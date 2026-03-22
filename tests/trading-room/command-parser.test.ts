import { describe, it, expect } from 'vitest';
import { parseCommand, validateCommand, type CommandShape } from '../../src/trading-room/command-parser.js';

describe('parseCommand', () => {
  it('should return null for empty input', () => {
    expect(parseCommand('')).toBeNull();
  });

  it('should return null for non-slash input', () => {
    expect(parseCommand('hello world')).toBeNull();
  });

  it('should return null for just a slash', () => {
    expect(parseCommand('/')).toBeNull();
  });

  it('should parse simple command', () => {
    const result = parseCommand('/status');
    expect(result).not.toBeNull();
    expect(result!.command).toBe('status');
    expect(result!.subcommand).toBeUndefined();
    expect(result!.args).toEqual([]);
  });

  it('should parse command with subcommand', () => {
    const result = parseCommand('/trade start');
    expect(result!.command).toBe('trade');
    expect(result!.subcommand).toBe('start');
  });

  it('should parse flags with values', () => {
    const result = parseCommand('/trade start --strategy arb --capital 5000');
    expect(result!.flags['strategy']).toBe('arb');
    expect(result!.flags['capital']).toBe('5000');
  });

  it('should parse boolean flags', () => {
    const result = parseCommand('/arb scan --verbose');
    expect(result!.flags['verbose']).toBe(true);
  });

  it('should handle quoted values', () => {
    const result = parseCommand('/set --label "my strategy name"');
    expect(result!.flags['label']).toBe('my strategy name');
  });

  it('should collect positional args after subcommand', () => {
    const result = parseCommand('/trade start BTC ETH');
    expect(result!.subcommand).toBe('start');
    expect(result!.args).toEqual(['BTC', 'ETH']);
  });

  it('should lowercase command and subcommand', () => {
    const result = parseCommand('/TRADE Start');
    expect(result!.command).toBe('trade');
    expect(result!.subcommand).toBe('start');
  });
});

describe('validateCommand', () => {
  it('should pass with no requirements', () => {
    const parsed = parseCommand('/status')!;
    const shape: CommandShape = { requiredArgs: [] };
    const result = validateCommand(parsed, shape);
    expect(result.ok).toBe(true);
  });

  it('should fail when subcommand is required but missing', () => {
    const parsed = parseCommand('/trade')!;
    const shape: CommandShape = { requiredArgs: [], subcommands: ['start', 'stop'] };
    const result = validateCommand(parsed, shape);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('requires a subcommand');
  });

  it('should fail on invalid subcommand', () => {
    const parsed = parseCommand('/trade invalid')!;
    const shape: CommandShape = { requiredArgs: [], subcommands: ['start', 'stop'] };
    const result = validateCommand(parsed, shape);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('Unknown subcommand');
  });

  it('should pass with valid subcommand', () => {
    const parsed = parseCommand('/trade start')!;
    const shape: CommandShape = { requiredArgs: [], subcommands: ['start', 'stop'] };
    expect(validateCommand(parsed, shape).ok).toBe(true);
  });

  it('should fail when required arg missing', () => {
    const parsed = parseCommand('/trade start')!;
    const shape: CommandShape = { requiredArgs: ['strategy'], subcommands: ['start', 'stop'] };
    const result = validateCommand(parsed, shape);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('--strategy');
  });

  it('should pass when required arg in flags', () => {
    const parsed = parseCommand('/trade start --strategy arb')!;
    const shape: CommandShape = { requiredArgs: ['strategy'], subcommands: ['start', 'stop'] };
    expect(validateCommand(parsed, shape).ok).toBe(true);
  });
});
