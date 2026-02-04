// State persistence manager for Melker Engine
// Extracted from engine.ts to reduce file size

import { Document } from './document.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('StatePersistence');
import {
  PersistedState,
  PersistenceMapping,
  DEFAULT_PERSISTENCE_MAPPINGS,
  readState,
  hashState,
  saveToFile,
  loadFromFile,
  debounce,
  getStateFilePath,
} from './state-persistence.ts';
import {
  setPersistenceContext,
} from './element.ts';

export interface StatePersistenceManagerOptions {
  persistenceDebounceMs: number;
}

export interface StatePersistenceManagerDeps {
  document: Document;
}

/**
 * Manages state persistence for Melker applications
 */
export class StatePersistenceManager {
  private _options: StatePersistenceManagerOptions;
  private _deps: StatePersistenceManagerDeps;

  // State persistence
  private _persistenceEnabled = false;
  private _persistenceAppId: string | null = null;
  private _persistenceMappings: PersistenceMapping[] = DEFAULT_PERSISTENCE_MAPPINGS;
  private _lastPersistedHash: string = '';
  private _debouncedSaveState: (() => void) | null = null;
  private _loadedPersistedState: PersistedState | null = null;

  constructor(options: StatePersistenceManagerOptions, deps: StatePersistenceManagerDeps) {
    this._options = options;
    this._deps = deps;
  }

  /**
   * Enable state persistence for this app.
   * Must be called before the first render for proper state restoration.
   * @param appId Unique identifier for the app (used for state file naming)
   * @param mappings Optional custom persistence mappings
   */
  async enablePersistence(appId: string, mappings?: PersistenceMapping[]): Promise<void> {
    if (this._persistenceEnabled) {
      logger.warn('Persistence already enabled');
      return;
    }

    this._persistenceAppId = appId;
    this._persistenceMappings = mappings || DEFAULT_PERSISTENCE_MAPPINGS;

    // Load persisted state from file
    try {
      this._loadedPersistedState = await loadFromFile(appId);
      if (this._loadedPersistedState) {
        this._lastPersistedHash = hashState(this._loadedPersistedState);
        logger.info('Loaded persisted state', { appId, hash: this._lastPersistedHash });
      }
    } catch (error) {
      logger.warn('Failed to load persisted state', { appId, error });
    }

    // Set up persistence context for createElement
    setPersistenceContext({
      state: this._loadedPersistedState,
      document: this._deps.document,
      mappings: this._persistenceMappings,
    });

    // Create debounced save function
    this._debouncedSaveState = debounce(
      () => this._saveStateIfChanged(),
      this._options.persistenceDebounceMs
    );

    this._persistenceEnabled = true;
    const stateFilePath = getStateFilePath(appId);
    logger.info('State persistence enabled', { appId, stateFile: stateFilePath });
  }

  /**
   * Save state immediately (bypasses debounce).
   * Useful when you need to ensure state is saved before exit.
   */
  async saveState(): Promise<void> {
    if (!this._persistenceEnabled || !this._persistenceAppId) {
      return;
    }
    await this._saveStateIfChanged();
  }

  /**
   * Trigger debounced save (called from engine's render)
   */
  triggerDebouncedSave(): void {
    if (this._debouncedSaveState) {
      this._debouncedSaveState();
    }
  }

  /**
   * Save state before exit (called from engine's stop)
   */
  async saveBeforeExit(): Promise<void> {
    if (!this._persistenceEnabled) {
      return;
    }
    try {
      await this._saveStateIfChanged();
    } catch (error) {
      logger.warn('Failed to save state on exit', { error });
    }
  }

  /**
   * Check if persistence is enabled
   */
  isEnabled(): boolean {
    return this._persistenceEnabled;
  }

  /**
   * Internal method to save state if changed
   */
  private async _saveStateIfChanged(): Promise<void> {
    if (!this._persistenceEnabled || !this._persistenceAppId) {
      return;
    }

    try {
      const currentState = readState(this._deps.document, this._persistenceMappings);
      const currentHash = hashState(currentState);

      if (currentHash !== this._lastPersistedHash) {
        await saveToFile(this._persistenceAppId, currentState);
        this._lastPersistedHash = currentHash;
        logger.debug('State persisted', { appId: this._persistenceAppId, hash: currentHash });
      }
    } catch (error) {
      logger.warn('Failed to save state', { error });
    }
  }
}
