// State persistence & crash recovery - saves snapshots to disk for restart recovery
import { readFileSync, writeFileSync, unlinkSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { logger } from '../core/logger.js';
import type { StrategyConfig, Position } from '../core/types.js';

const RECOVERY_FILE_DEFAULT = 'data/recovery-state.json';
/** Maximum age (ms) of a recovery snapshot to be considered valid */
const MAX_SNAPSHOT_AGE_MS = 60 * 60 * 1000; // 1 hour

export interface RecoveryState {
  strategies: StrategyConfig[];
  positions: Position[];
  lastEquity: string;
  timestamp: number;
}

export class RecoveryManager {
  private autoSaveTimer: ReturnType<typeof setInterval> | null = null;
  private readonly filePath: string;

  constructor(filePath: string = RECOVERY_FILE_DEFAULT) {
    this.filePath = filePath;
  }

  /** Persist state snapshot to JSON file */
  saveState(state: RecoveryState): void {
    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      const payload: RecoveryState = { ...state, timestamp: Date.now() };
      writeFileSync(this.filePath, JSON.stringify(payload, null, 2), 'utf8');
      logger.debug('Recovery state saved', 'RecoveryManager', { file: this.filePath });
    } catch (err) {
      logger.error('Failed to save recovery state', 'RecoveryManager', {
        error: String(err),
        file: this.filePath,
      });
    }
  }

  /** Load last saved state from disk. Returns null if missing or unreadable. */
  loadState(): RecoveryState | null {
    if (!existsSync(this.filePath)) return null;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as RecoveryState;
      logger.info('Recovery state loaded', 'RecoveryManager', {
        file: this.filePath,
        timestamp: new Date(parsed.timestamp).toISOString(),
      });
      return parsed;
    } catch (err) {
      logger.error('Failed to load recovery state', 'RecoveryManager', {
        error: String(err),
        file: this.filePath,
      });
      return null;
    }
  }

  /**
   * Start periodic auto-save.
   * @param intervalMs - Save interval in milliseconds
   * @param stateProvider - Callback that returns current state to snapshot
   */
  startAutoSave(intervalMs: number, stateProvider: () => RecoveryState): void {
    if (this.autoSaveTimer !== null) {
      logger.warn('Auto-save already running, stopping previous timer', 'RecoveryManager');
      this.stopAutoSave();
    }
    this.autoSaveTimer = setInterval(() => {
      try {
        const state = stateProvider();
        this.saveState(state);
      } catch (err) {
        logger.error('Auto-save state provider threw', 'RecoveryManager', { error: String(err) });
      }
    }, intervalMs);
    logger.info('Auto-save started', 'RecoveryManager', { intervalMs });
  }

  /** Stop periodic auto-save */
  stopAutoSave(): void {
    if (this.autoSaveTimer !== null) {
      clearInterval(this.autoSaveTimer);
      this.autoSaveTimer = null;
      logger.info('Auto-save stopped', 'RecoveryManager');
    }
  }

  /**
   * Returns true if a valid, recent recovery snapshot exists.
   * "Recent" = saved within the last hour.
   */
  shouldRecover(): boolean {
    const state = this.loadState();
    if (!state) return false;
    const age = Date.now() - state.timestamp;
    const isRecent = age < MAX_SNAPSHOT_AGE_MS;
    if (!isRecent) {
      logger.warn('Recovery state exists but is too old', 'RecoveryManager', {
        ageMinutes: Math.round(age / 60000),
      });
    }
    return isRecent;
  }

  /** Delete recovery file on clean shutdown to prevent false recovery on next start */
  clearState(): void {
    if (!existsSync(this.filePath)) return;
    try {
      unlinkSync(this.filePath);
      logger.info('Recovery state cleared', 'RecoveryManager', { file: this.filePath });
    } catch (err) {
      logger.error('Failed to clear recovery state', 'RecoveryManager', { error: String(err) });
    }
  }

  isAutoSaveRunning(): boolean {
    return this.autoSaveTimer !== null;
  }
}

/** Default singleton instance */
export const recoveryManager = new RecoveryManager();
