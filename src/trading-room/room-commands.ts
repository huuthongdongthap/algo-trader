// Trading Room command registration entry point.
// Imports all CommandDefinition stubs from room-command-definitions.ts
// and registers them into the singleton CommandRegistry.
// Call registerRoomCommands() once at application startup.

import { CommandRegistry } from './command-registry.js';
import {
  tradeCmd,
  arbCmd,
  scanCmd,
  statusCmd,
  tuneCmd,
  reportCmd,
  stealthCmd,
  riskCmd,
  alertCmd,
  exportCmd,
} from './room-command-definitions.js';

/** Register all 10 Trading Room slash commands into the singleton registry. */
export function registerRoomCommands(): void {
  const registry = CommandRegistry.getInstance();

  for (const def of [
    tradeCmd,
    arbCmd,
    scanCmd,
    statusCmd,
    tuneCmd,
    reportCmd,
    stealthCmd,
    riskCmd,
    alertCmd,
    exportCmd,
  ]) {
    registry.register(def);
  }
}
