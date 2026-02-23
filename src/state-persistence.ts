// State persistence for Melker apps
// Saves and restores element state (input values, checkbox states, etc.) across restarts

import { Element, isScrollingEnabled } from './types.ts';
import { Document } from './document.ts';
import { getStateDir, ensureDir } from './xdg.ts';
import { sha256Hex } from './utils/crypto.ts';
import { MelkerConfig } from './config/mod.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('StatePersistence');

/**
 * Check if persistence is enabled globally via config.
 * Default: false (persistence disabled)
 */
export function isPersistenceEnabled(): boolean {
  return MelkerConfig.get().persist;
}

/**
 * Defines which element types and properties to persist
 */
export interface PersistenceMapping {
  type: string;
  prop: string;
  condition?: (element: Element) => boolean;
}

/**
 * Persisted state structure: { category -> { elementId -> value } }
 */
export type PersistedState = Record<string, Record<string, unknown>>;

/**
 * Wrapper for state file with metadata
 */
export interface StateFile {
  version: number;
  timestamp: number;
  state: PersistedState;
}

const STATE_VERSION = 1;

/**
 * Default mappings for common element types
 */
export const DEFAULT_PERSISTENCE_MAPPINGS: PersistenceMapping[] = [
  { type: 'input', prop: 'value' },
  { type: 'textarea', prop: 'value' },
  { type: 'checkbox', prop: 'checked' },
  { type: 'radio', prop: 'checked' },
  { type: 'tabs', prop: 'activeTab' },
  { type: 'text', prop: 'text' },
  { type: 'button', prop: 'text' },
  { type: 'slider', prop: 'value' },
  { type: 'combobox', prop: 'selectedValue' },
  { type: 'select', prop: 'selectedValue' },
  { type: 'autocomplete', prop: 'selectedValue' },
  { type: 'container', prop: 'scrollY', condition: (el) => isScrollingEnabled(el) },
  { type: 'container', prop: 'scrollX', condition: (el) => isScrollingEnabled(el) },
];

/**
 * Read current state from document tree
 */
export function readState(document: Document, mappings: PersistenceMapping[], stateObject?: Record<string, unknown> | null): PersistedState {
  const state: PersistedState = {};

  // Initialize categories
  for (const mapping of mappings) {
    if (!state[mapping.type]) {
      state[mapping.type] = {};
    }
  }

  // Walk document tree
  function visit(element: Element): void {
    // Skip elements without ID, with persist="false", or password inputs (security)
    const isPasswordInput = element.type === 'input' && element.props.format === 'password';
    if (!element.id || element.props.persist === false || isPasswordInput) {
      // Still visit children
      if (element.children) {
        for (const child of element.children) {
          visit(child);
        }
      }
      return;
    }

    for (const mapping of mappings) {
      if (element.type === mapping.type) {
        if (!mapping.condition || mapping.condition(element)) {
          const value = element.props[mapping.prop];
          if (value !== undefined) {
            state[mapping.type][element.id] = value;
          }
        }
      }
    }

    // Recurse into children
    if (element.children) {
      for (const child of element.children) {
        visit(child);
      }
    }
  }

  visit(document.root);

  // Serialize state object into _bound category
  if (stateObject) {
    state['_bound'] = { ...stateObject };
  }

  return state;
}

/**
 * Merge persisted _bound values into a state object.
 * Only merges keys that exist in initial (the createState schema defines valid keys).
 */
export function mergePersistedBound(
  initial: Record<string, unknown>,
  persisted: PersistedState,
): void {
  const bound = persisted['_bound'];
  if (!bound || typeof bound !== 'object') return;
  for (const key in initial) {
    if (key in bound) {
      initial[key] = bound[key];
    }
  }
}

/**
 * Get value for a specific element from persisted state
 */
export function getPersistedValue(
  type: string,
  id: string,
  prop: string,
  state: PersistedState | null,
  mappings: PersistenceMapping[]
): unknown | undefined {
  if (!state) return undefined;

  for (const mapping of mappings) {
    if (mapping.type === type && mapping.prop === prop) {
      return state[type]?.[id];
    }
  }

  return undefined;
}

/**
 * Compute a simple hash of the state for change detection
 */
export function hashState(state: PersistedState): string {
  const json = JSON.stringify(state);
  let hash = 0;
  for (let i = 0; i < json.length; i++) {
    const char = json.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

/**
 * Get the state file path for an app.
 * Uses XDG Base Directory Specification.
 * Default: $XDG_STATE_HOME/melker/<appId>.json or ~/.local/state/melker/<appId>.json
 */
export function getStateFilePath(appId: string): string {
  return `${getStateDir()}/${appId}.json`;
}

/**
 * Ensure the state directory exists
 */
async function ensureStateDir(): Promise<void> {
  await ensureDir(getStateDir());
}

/**
 * Save state to file.
 * Does nothing if MELKER_PERSIST is not enabled.
 */
export async function saveToFile(appId: string, state: PersistedState): Promise<void> {
  // Skip if persistence is disabled globally
  if (!isPersistenceEnabled()) {
    return;
  }

  await ensureStateDir();

  const stateFile: StateFile = {
    version: STATE_VERSION,
    timestamp: Date.now(),
    state,
  };

  const filepath = getStateFilePath(appId);
  const json = JSON.stringify(stateFile, null, 2);
  await Deno.writeTextFile(filepath, json);
}

/**
 * Load state from file.
 * Returns null if MELKER_PERSIST is not enabled or if skipLoad is true.
 * @param appId The app identifier
 * @param skipLoad If true, skip loading even if persistence is enabled (--no-load)
 */
export async function loadFromFile(appId: string, skipLoad?: boolean): Promise<PersistedState | null> {
  // Skip if persistence is disabled globally
  if (!isPersistenceEnabled()) {
    return null;
  }

  // Skip if --no-load flag is set
  if (skipLoad) {
    return null;
  }

  const filepath = getStateFilePath(appId);

  try {
    const json = await Deno.readTextFile(filepath);
    const stateFile: StateFile = JSON.parse(json);

    if (stateFile.version !== STATE_VERSION) {
      // Version mismatch - start fresh
      return null;
    }

    return stateFile.state;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      // No saved state - that's fine
      return null;
    }
    // Log other errors but don't crash
    logger.warn('Failed to load state file', { error: String(error) });
    return null;
  }
}

/**
 * Generate an app ID from a file path
 */
export async function hashFilePath(filepath: string): Promise<string> {
  const fullHash = await sha256Hex(filepath);
  return fullHash.slice(0, 12);
}

// Re-export debounce from utils for backwards compatibility
export { debounce } from './utils/timing.ts';
