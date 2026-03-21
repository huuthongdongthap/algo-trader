// Trading Room command parser — ClaudeKit-style slash command syntax
// Parses: /command subcommand arg1 arg2 --flag value --bool-flag

export interface ParsedCommand {
  /** Primary command name (without slash) */
  command: string;
  /** Optional subcommand (second token if not a flag) */
  subcommand?: string;
  /** Positional arguments after subcommand */
  args: string[];
  /** Named flags: --key value or --bool-flag → true */
  flags: Record<string, string | boolean>;
}

export interface ValidationError {
  ok: false;
  message: string;
}

export interface ValidationOk {
  ok: true;
}

export type ValidationResult = ValidationOk | ValidationError;

// Minimal CommandDefinition interface for validation — full definition lives in command-registry.ts
export interface CommandShape {
  requiredArgs: string[];
  subcommands?: string[];
}

/**
 * Parse a slash command string into structured form.
 * Returns null for empty/non-slash input.
 *
 * Examples:
 *   "/trade start --strategy arb --capital 5000"
 *   "/arb scan --verbose"
 *   "/status engine"
 */
export function parseCommand(input: string): ParsedCommand | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith('/')) return null;

  // Tokenise respecting quoted strings (e.g. --label "my label")
  const tokens = tokenise(trimmed.slice(1)); // strip leading slash
  if (tokens.length === 0) return null;

  const command = tokens[0].toLowerCase();
  const flags: Record<string, string | boolean> = {};
  const args: string[] = [];
  let subcommand: string | undefined;
  let subcommandClaimed = false;

  let i = 1;
  while (i < tokens.length) {
    const token = tokens[i];

    if (token.startsWith('--')) {
      const key = token.slice(2);
      const next = tokens[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i += 2;
      } else {
        flags[key] = true;
        i += 1;
      }
    } else {
      // First non-flag token after command = subcommand candidate
      if (!subcommandClaimed) {
        subcommand = token.toLowerCase();
        subcommandClaimed = true;
      } else {
        args.push(token);
      }
      i += 1;
    }
  }

  return { command, subcommand, args, flags };
}

/**
 * Validate a parsed command against a registry shape.
 * Checks: command exists, required args present, subcommand valid (if subcommands defined).
 */
export function validateCommand(
  parsed: ParsedCommand,
  definition: CommandShape,
): ValidationResult {
  // Validate subcommand if registry lists allowed subcommands
  if (definition.subcommands && definition.subcommands.length > 0) {
    if (!parsed.subcommand) {
      return {
        ok: false,
        message: `/${parsed.command} requires a subcommand: ${definition.subcommands.join(' | ')}`,
      };
    }
    if (!definition.subcommands.includes(parsed.subcommand)) {
      return {
        ok: false,
        message: `Unknown subcommand "${parsed.subcommand}" for /${parsed.command}. Valid: ${definition.subcommands.join(' | ')}`,
      };
    }
  }

  // Validate required positional args (mapped from flags or args)
  for (const req of definition.requiredArgs) {
    const inFlags = req in parsed.flags;
    const inArgs = parsed.args.length > 0;
    if (!inFlags && !inArgs) {
      return {
        ok: false,
        message: `/${parsed.command} requires argument: --${req}`,
      };
    }
  }

  return { ok: true };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Split input into tokens, honouring double-quoted strings */
function tokenise(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;

  for (const ch of input) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === ' ' && !inQuote) {
      if (current.length > 0) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current.length > 0) tokens.push(current);
  return tokens;
}
