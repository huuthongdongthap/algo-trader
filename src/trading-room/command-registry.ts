// Trading Room command registry — singleton for registering/discovering slash commands
// ClaudeKit-style: register definitions, get help, execute by input string

import { parseCommand, validateCommand, type ParsedCommand } from './command-parser.js';

export interface CommandDefinition {
  name: string;
  description: string;
  /** Allowed subcommands; if set, a subcommand is required */
  subcommands?: string[];
  /** Required flag names (e.g. ['strategy'] means --strategy is required) */
  requiredArgs: string[];
  /** Optional flags with description */
  optionalFlags?: Record<string, string>;
  /** Handler receives parsed command and returns a response string */
  handler: (parsed: ParsedCommand) => Promise<string>;
}

export class CommandRegistry {
  private static instance: CommandRegistry;
  private readonly commands = new Map<string, CommandDefinition>();

  private constructor() {}

  static getInstance(): CommandRegistry {
    if (!CommandRegistry.instance) {
      CommandRegistry.instance = new CommandRegistry();
    }
    return CommandRegistry.instance;
  }

  /** Register a command definition; throws if name already registered */
  register(definition: CommandDefinition): void {
    if (this.commands.has(definition.name)) {
      throw new Error(`Command "${definition.name}" is already registered`);
    }
    this.commands.set(definition.name, definition);
  }

  /** Retrieve a command definition by name; returns undefined if not found */
  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  /** List all registered commands with name + description */
  listAll(): Array<{ name: string; description: string }> {
    return [...this.commands.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }

  /**
   * Return formatted help text for a single command.
   * Includes subcommands, required args, and optional flags.
   */
  getHelp(name: string): string {
    const def = this.commands.get(name);
    if (!def) return `Unknown command: /${name}`;

    const lines: string[] = [
      `/${def.name} — ${def.description}`,
    ];

    if (def.subcommands && def.subcommands.length > 0) {
      lines.push(`  Subcommands : ${def.subcommands.join(' | ')}`);
    }
    if (def.requiredArgs.length > 0) {
      lines.push(`  Required    : ${def.requiredArgs.map((a) => `--${a}`).join(', ')}`);
    }
    if (def.optionalFlags && Object.keys(def.optionalFlags).length > 0) {
      const flagLines = Object.entries(def.optionalFlags)
        .map(([k, v]) => `    --${k.padEnd(16)} ${v}`)
        .join('\n');
      lines.push(`  Optional flags:\n${flagLines}`);
    }

    return lines.join('\n');
  }

  /**
   * Parse input → validate → execute handler.
   * Returns the handler's response string, or an error/help string.
   */
  async execute(input: string): Promise<string> {
    const parsed = parseCommand(input);
    if (!parsed) {
      return 'Commands must start with /. Type /help to list available commands.';
    }

    // Handle built-in /help
    if (parsed.command === 'help') {
      if (parsed.subcommand) return this.getHelp(parsed.subcommand);
      const list = this.listAll()
        .map(({ name, description }) => `  /${name.padEnd(18)} ${description}`)
        .join('\n');
      return `Available commands:\n${list}\n\nUsage: /help <command> for details.`;
    }

    const def = this.commands.get(parsed.command);
    if (!def) {
      return `Unknown command: /${parsed.command}. Type /help to list available commands.`;
    }

    const validation = validateCommand(parsed, def);
    if (!validation.ok) {
      return `Validation error: ${validation.message}\n\n${this.getHelp(parsed.command)}`;
    }

    return def.handler(parsed);
  }
}
