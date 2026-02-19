// Auto-discovery of interactive elements for command palette integration
// Walks the document tree, collects qualifying elements, resolves labels,
// and returns PaletteItem[] for injection into command palettes.

import { Element, isToggleable, isClickable, hasSubtreeElements } from './types.ts';
import type { Document } from './document.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('PaletteComponents');

/**
 * A discovered element eligible for the command palette
 */
export interface PaletteItem {
  elementId: string;
  label: string;
  group: string;       // 'Actions', 'Navigation', 'Fields'
  action: () => void;
  shortcut?: string;   // From palette-shortcut prop — registered in global shortcut map
  hint?: string;       // Display-only key hint shown in palette (not registered as shortcut)
}

/** Internal item with element type for disambiguation */
interface InternalPaletteItem extends PaletteItem {
  _elementType: string;
  _globalKeys?: string[];  // All keys for global commands (registered in shortcut map)
}

/** Element types that qualify for auto-discovery */
const ACTION_TYPES = new Set(['button', 'checkbox', 'radio']);
const FIELD_TYPES = new Set(['input', 'textarea', 'slider', 'select', 'combobox', 'data-table', 'data-tree']);
const NAV_TYPES = new Set(['tab']);

const ALL_QUALIFYING_TYPES = new Set([...ACTION_TYPES, ...FIELD_TYPES, ...NAV_TYPES]);

/**
 * Resolve a human-readable label for an element.
 * Returns undefined if no usable label can be determined.
 */
function resolveLabel(element: Element): string | undefined {
  const props = element.props;

  // 1. Explicit palette label (string value of palette prop)
  if (typeof props.palette === 'string' && props.palette.length > 0) {
    return props.palette;
  }

  // 2. props.label (buttons)
  if (typeof props.label === 'string' && props.label.length > 0) {
    return props.label;
  }

  // 3. props.title (checkbox, radio, tab)
  if (typeof props.title === 'string' && props.title.length > 0) {
    return props.title;
  }

  // 4. aria-label
  if (typeof props['aria-label'] === 'string' && props['aria-label'].length > 0) {
    return props['aria-label'];
  }

  // 5. placeholder (input, textarea)
  if (typeof props.placeholder === 'string' && props.placeholder.length > 0) {
    return props.placeholder;
  }

  // 6. Humanize ID (my-submit-btn → My Submit Btn), skip auto-generated IDs
  if (typeof props.id === 'string' && props.id.length > 0 && !props.id.startsWith('el-')) {
    return humanizeId(props.id);
  }

  return undefined;
}

/**
 * Convert kebab-case or camelCase ID to Title Case label.
 * 'my-submit-btn' → 'My Submit Btn'
 * 'searchInput' → 'Search Input'
 */
function humanizeId(id: string): string {
  return id
    // camelCase → space-separated
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    // kebab/underscore → space
    .replace(/[-_]/g, ' ')
    // capitalize each word
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}

/**
 * Determine the palette group for an element type.
 */
function defaultGroup(type: string): string {
  if (ACTION_TYPES.has(type)) return 'Actions';
  if (NAV_TYPES.has(type)) return 'Navigation';
  return 'Fields';
}

/**
 * Create the action callback for a discovered element.
 */
function createAction(
  element: Element,
  document: Document,
  render: () => void,
): () => void {
  const type = element.type;

  if (type === 'checkbox' || type === 'radio') {
    return () => {
      if (isClickable(element)) {
        element.handleClick({
          type: 'click',
          target: element,
          position: { x: 0, y: 0 },
          timestamp: Date.now(),
        }, document);
      }
      render();
    };
  }

  if (type === 'button') {
    return () => {
      if (typeof element.props.onClick === 'function') {
        element.props.onClick({
          type: 'click',
          target: element,
          x: 0,
          y: 0,
          timestamp: Date.now(),
        });
      }
      render();
    };
  }

  if (type === 'select' || type === 'combobox') {
    return () => {
      document.focus(element.id);
      if (isToggleable(element)) {
        element.toggle();
      }
      render();
    };
  }

  if (type === 'tab') {
    return () => {
      // Find parent tabs element and switch to this tab
      const tabs = findParentOfType(element, 'tabs', document);
      if (tabs) {
        tabs.props.activeTab = element.id;
      }
      render();
    };
  }

  // Default: focus the element (input, textarea, slider, data-table, data-tree)
  return () => {
    document.focus(element.id);
    render();
  };
}

/**
 * Find the parent element of a given type by searching the tree.
 */
function findParentOfType(child: Element, parentType: string, document: Document): Element | null {
  // Walk the full tree looking for a parent that contains this child
  return _findParentInTree(document.root, child, parentType);
}

function _findParentInTree(current: Element, target: Element, parentType: string): Element | null {
  if (!current.children) return null;
  for (const ch of current.children) {
    if (ch === target || ch.id === target.id) {
      return current.type === parentType ? current : null;
    }
    const found = _findParentInTree(ch, target, parentType);
    if (found) return found;
  }
  return null;
}

/**
 * Discover all interactive elements eligible for the command palette.
 * Walks the document tree, skipping invisible branches and opted-out elements.
 */
export function discoverPaletteItems(
  document: Document,
  render: () => void,
): PaletteItem[] {
  const items: InternalPaletteItem[] = [];

  if (!document.root) return items;

  _walkTree(document.root, items, document, render);

  return items;
}

function _walkTree(
  element: Element,
  items: InternalPaletteItem[],
  document: Document,
  render: () => void,
): void {
  // Skip invisible branches
  if (element.props.visible === false) return;
  // Skip closed dialogs (children not accessible)
  if (element.type === 'dialog' && element.props.open !== true) return;
  // Skip command palettes themselves
  if (element.type === 'command-palette') return;

  // Check for <command> elements (declarative shortcuts)
  if (element.type === 'command' && element.props.label && typeof element.props.key === 'string') {
    if (!element.props.disabled && element.props.palette !== false) {
      const group = element.props.group || 'Commands';
      const keys = parseCommandKeys(element.props.key);
      const action = () => {
        if (typeof element.props.onExecute === 'function') {
          element.props.onExecute();
        }
        render();
      };

      if (element.props.global) {
        // Global: single palette entry with hint, keys registered via _globalKeys
        items.push({
          elementId: element.id,
          label: element.props.label,
          group,
          action,
          hint: element.props.key,
          _globalKeys: keys,
          _elementType: 'command',
        });
      } else {
        // Non-global: single palette entry, show original key string as hint
        items.push({
          elementId: element.id,
          label: element.props.label,
          group,
          action,
          hint: element.props.key,
          _elementType: 'command',
        });
      }
    }
  }

  // Check if this element qualifies
  if (ALL_QUALIFYING_TYPES.has(element.type)) {
    // Opt-out check
    if (element.props.palette !== false && element.props.palette !== 'false') {
      const label = resolveLabel(element);
      if (label) {
        const group = (typeof element.props['palette-group'] === 'string')
          ? element.props['palette-group']
          : defaultGroup(element.type);

        const shortcut = typeof element.props['palette-shortcut'] === 'string'
          ? element.props['palette-shortcut']
          : undefined;

        items.push({
          elementId: element.id,
          label: `${label} (${element.type})`,
          group,
          action: createAction(element, document, render),
          shortcut,
          _elementType: element.type,
        });
      }
    }
  }

  // Recurse into subtree elements (e.g., mermaid graphs in markdown)
  if (hasSubtreeElements(element)) {
    for (const subtreeRoot of element.getSubtreeElements()) {
      _walkTree(subtreeRoot, items, document, render);
    }
  }

  // Recurse into children
  if (element.children) {
    for (const child of element.children) {
      _walkTree(child, items, document, render);
    }
  }
}


// ── Keyboard Shortcuts ──────────────────────────────────────────────────

/** System keys that cannot be overridden by palette shortcuts */
const SYSTEM_KEYS = new Set([
  'ctrl+c', 'tab', 'shift+tab',
  'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'shift+f12', 'ctrl+shift+p',
  'ctrl+k', 'escape',
  'ctrl+/', 'alt+/', 'ctrl+?', 'alt+?', 'ctrl+h', 'alt+h',
  'alt+n', 'alt+c',
]);

/**
 * Parse a command key prop into individual key strings.
 * Supports comma-separated lists, literal "," as a single key,
 * and the word "comma" as an alias for ",".
 *
 *   ","       → [","]
 *   "comma"   → [","]
 *   "a,b"     → ["a", "b"]
 *   "a,comma" → ["a", ","]
 */
export function parseCommandKeys(keyProp: string): string[] {
  // Single comma character means the comma key
  if (keyProp.trim() === ',') return [','];
  // Single space character means the space key
  if (keyProp === ' ') return [' '];

  const parts = keyProp.split(',');
  const keys: string[] = [];
  for (const p of parts) {
    const trimmed = p.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (lower === 'comma') keys.push(',');
    else if (lower === 'space') keys.push(' ');
    else if (lower === 'plus') keys.push('+');
    else keys.push(trimmed);
  }
  return keys;
}

/**
 * Normalize a shortcut string to a canonical form.
 * 'Ctrl+S' → 'ctrl+s', 'Alt+Ctrl+S' → 'alt+ctrl+s' (sorted modifiers)
 */
export function normalizeShortcut(shortcut: string): string {
  const parts = shortcut.toLowerCase().split('+').map(p => p.trim());
  let key = parts.pop()!;
  // Handle '+' as a literal key: "+" splits to ["",""], "Ctrl++" splits to ["ctrl","",""]
  if (key === '' && shortcut.endsWith('+')) {
    key = '+';
    // Remove the extra empty part created by splitting the literal '+'
    if (parts.length > 0 && parts[parts.length - 1] === '') parts.pop();
  }
  // Restore space key that was trimmed away; also accept "space" alias
  if (key === '' && shortcut.includes(' ')) key = ' ';
  if (key === 'space') key = ' ';
  if (key === 'plus') key = '+';
  let modifiers = parts.filter(m => m !== '');
  // Strip shift for single printable characters — the case already carries shift info
  if (key.length === 1 && key >= 'a' && key <= 'z') {
    modifiers = modifiers.filter(m => m !== 'shift');
  }
  modifiers.sort(); // alphabetical: alt, ctrl, meta, shift
  return [...modifiers, key].join('+');
}

/**
 * Convert a RawKeyEvent to a normalized shortcut string for matching.
 */
export function eventToShortcut(event: { key: string; ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean }): string {
  const mods: string[] = [];
  if (event.altKey) mods.push('alt');
  if (event.ctrlKey) mods.push('ctrl');
  if (event.metaKey) mods.push('meta');
  // Include shift only for non-printable keys (arrows, function keys, etc.)
  // For single printable characters, shift is implicit in the character case
  const key = event.key.toLowerCase();
  if (event.shiftKey && !(key.length === 1 && key >= 'a' && key <= 'z')) {
    mods.push('shift');
  }
  mods.sort();
  mods.push(key);
  return mods.join('+');
}

/** Global shortcut map, rebuilt each render cycle by buildShortcutMap() */
let _shortcutMap = new Map<string, () => void>();

/**
 * Build the shortcut map from discovered palette items.
 * First item in tree order wins for duplicate shortcuts.
 * Returns the map (also stored globally for keyboard handler access).
 */
export function buildShortcutMap(items: PaletteItem[]): Map<string, () => void> {
  const map = new Map<string, () => void>();
  const conflicts: string[] = [];

  for (const item of items) {
    // Global commands use _globalKeys; palette-shortcut elements use shortcut
    const internal = item as InternalPaletteItem;
    const keysToRegister = internal._globalKeys
      ?? (item.shortcut ? [item.shortcut] : []);
    if (keysToRegister.length === 0) continue;

    for (const key of keysToRegister) {
      const normalized = normalizeShortcut(key);

      // Check system key conflict
      if (SYSTEM_KEYS.has(normalized)) {
        conflicts.push(`${key} on '${item.label}' conflicts with system key`);
        continue;
      }

      // Check duplicate component shortcut (first in tree order wins)
      if (map.has(normalized)) {
        conflicts.push(`${key} on '${item.label}' ignored (already bound)`);
        continue;
      }

      map.set(normalized, item.action);
    }
  }

  // Emit one summary warning if there were conflicts
  if (conflicts.length > 0) {
    logger.warn(`Palette shortcut conflicts: ${conflicts.join('; ')}`);
  }

  _shortcutMap = map;
  return map;
}

/**
 * Get the current palette shortcut map (for keyboard handler).
 */
export function getPaletteShortcutMap(): Map<string, () => void> {
  return _shortcutMap;
}
