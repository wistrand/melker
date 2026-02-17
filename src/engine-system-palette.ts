// System command palette logic for MelkerEngine
// Extracted from engine.ts to reduce file size

import { Element, isToggleable } from './types.ts';
import {
  createDefaultCommandPalette,
  createSystemGroup,
  SystemHandlers,
} from './system-command-palette.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';
import { createElement } from './element.ts';
import { discoverPaletteItems, buildShortcutMap, type PaletteItem } from './command-palette-components.ts';
import type { Document } from './document.ts';
import type { DevToolsManager } from './dev-tools.ts';
import type { AccessibilityDialogManager } from './ai/accessibility-dialog.ts';

/**
 * Context providing access to engine dependencies for system palette operations
 */
export interface SystemPaletteContext {
  document: Document;
  systemCommandPalette?: Element;
  devToolsManager?: DevToolsManager;
  getAccessibilityDialogManager: () => AccessibilityDialogManager | undefined;

  // Engine methods (callbacks)
  stop: () => Promise<void>;
  render: () => void;
  ensureAccessibilityDialogManager: () => void;
  setSystemCommandPalette: (palette: Element | undefined) => void;
}

/**
 * Get system command handlers for the command palette
 */
export function getSystemHandlers(ctx: SystemPaletteContext): SystemHandlers {
  return {
    exit: () => ctx.stop(),
    aiDialog: () => {
      ctx.ensureAccessibilityDialogManager();
      ctx.getAccessibilityDialogManager()!.toggle();
      ctx.render();
    },
    devTools: () => {
      ctx.devToolsManager?.toggle();
      ctx.render();
    },
    performance: () => {
      getGlobalPerformanceDialog().toggle();
      ctx.render();
    },
  };
}

/**
 * Find element by type in element tree
 */
export function findElementByType(element: Element, type: string): Element | null {
  if (element.type === type) return element;
  if (element.children) {
    for (const child of element.children) {
      const found = findElementByType(child, type);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Find any command palette in the document (open or closed)
 */
export function findCommandPalette(ctx: SystemPaletteContext): Element | null {
  if (!ctx.document?.root) return null;
  return findElementByType(ctx.document.root, 'command-palette');
}

/**
 * Find open command palette in the document
 */
export function findOpenCommandPalette(ctx: SystemPaletteContext): Element | null {
  if (!ctx.document?.root) return null;
  return findOpenCommandPaletteInElement(ctx.document.root);
}

/**
 * Recursively search for an open command palette
 */
function findOpenCommandPaletteInElement(element: Element): Element | null {
  // Command palettes have an `open` prop when visible
  if (element.type === 'command-palette' && element.props?.open === true) {
    return element;
  }
  if (element.children) {
    for (const child of element.children) {
      const found = findOpenCommandPaletteInElement(child);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Toggle the command palette (opens system palette if no custom one exists)
 */
export function toggleCommandPalette(ctx: SystemPaletteContext): void {
  // Discover and inject component commands before opening so the palette is fresh
  injectComponentCommands(ctx);

  // First check for custom command palette
  const customPalette = findOpenCommandPalette(ctx) || findCommandPalette(ctx);
  if (customPalette && isToggleable(customPalette)) {
    customPalette.toggle();
    ctx.render();
    return;
  }

  // Fall back to system command palette
  if (ctx.systemCommandPalette && isToggleable(ctx.systemCommandPalette)) {
    ctx.systemCommandPalette.toggle();
    ctx.render();
  }
}

/**
 * Inject system command palette if no command palette exists in document
 */
export function injectSystemCommandPalette(ctx: SystemPaletteContext): void {
  // Check if document already has a command palette
  if (findCommandPalette(ctx)) {
    ctx.setSystemCommandPalette(undefined);
    return;
  }

  // Create system command palette with direct handlers
  const palette = createDefaultCommandPalette(getSystemHandlers(ctx));
  ctx.setSystemCommandPalette(palette);

  // Add to root element's children (document will register when traversing tree)
  if (ctx.document?.root) {
    if (!ctx.document.root.children) {
      ctx.document.root.children = [];
    }
    ctx.document.root.children.push(palette);
  }
}

/**
 * Inject system commands into all command palettes
 * System commands are added by default, opt-out with system={false}
 */
export function injectSystemCommands(ctx: SystemPaletteContext): void {
  if (!ctx.document?.root) return;
  injectSystemCommandsInElement(ctx.document.root, ctx);
}

/**
 * Recursively inject system commands into command palettes
 */
function injectSystemCommandsInElement(element: Element, ctx: SystemPaletteContext): void {
  if (element.type === 'command-palette') {
    // Opt-out: skip if system={false}
    if (element.props?.system === false) {
      // Recurse into children
      if (element.children) {
        for (const child of element.children) {
          injectSystemCommandsInElement(child, ctx);
        }
      }
      return;
    }

    if (!element.children) {
      element.children = [];
    }

    // Check if system group already exists (from <group system="true" /> marker)
    let hasSystemGroup = false;
    const handlers = getSystemHandlers(ctx);
    for (let i = 0; i < element.children.length; i++) {
      const child = element.children[i];
      if (child.type === 'group' && child.props?.system === true) {
        // Replace marker with actual system group
        element.children[i] = createSystemGroup(handlers);
        hasSystemGroup = true;
      }
    }

    // If no system group marker, append system group at the end
    if (!hasSystemGroup) {
      element.children.push(createSystemGroup(handlers));
    }

    // Refresh the cached options from updated children
    if (typeof (element as any).refreshChildOptions === 'function') {
      (element as any).refreshChildOptions();
    }
  }

  // Recurse into children
  if (element.children) {
    for (const child of element.children) {
      injectSystemCommandsInElement(child, ctx);
    }
  }
}

/** Marker prop to identify injected component groups */
const COMPONENT_GROUP_MARKER = '__melker_components_group__';

/**
 * Inject discovered component commands into all command palettes.
 * Discovers interactive elements, groups them, creates group/option elements,
 * and injects before the System group. Replaces previous injection on re-render.
 */
export function injectComponentCommands(ctx: SystemPaletteContext): void {
  if (!ctx.document?.root) return;

  const items = discoverPaletteItems(ctx.document, ctx.render);

  // Build shortcut map (even if no items — clears previous map)
  buildShortcutMap(items);

  if (items.length === 0) {
    // Remove any previously injected component groups
    _removeComponentGroups(ctx.document.root);
    return;
  }

  // Build group elements from discovered items
  const groupElements = _buildGroupElements(items);

  // Inject into all command palettes
  _injectComponentGroupsInElement(ctx.document.root, groupElements);
}

/**
 * Rebuild only the palette shortcut map (no palette injection).
 * Called from updateUI() so shortcuts work immediately without waiting for palette open.
 */
export function rebuildPaletteShortcuts(ctx: SystemPaletteContext): void {
  if (!ctx.document?.root) return;
  const items = discoverPaletteItems(ctx.document, ctx.render);
  buildShortcutMap(items);
}

/**
 * Build group elements from palette items, grouped by their group name.
 * Preserves order: Actions, Navigation, Fields, then any custom groups.
 */
function _buildGroupElements(items: PaletteItem[]): Element[] {
  // Collect items by group
  const groups = new Map<string, PaletteItem[]>();
  for (const item of items) {
    let list = groups.get(item.group);
    if (!list) {
      list = [];
      groups.set(item.group, list);
    }
    list.push(item);
  }

  // Order: Actions, Navigation, Fields first, then alphabetical custom groups
  const standardOrder = ['Actions', 'Navigation', 'Fields'];
  const orderedKeys: string[] = [];
  for (const key of standardOrder) {
    if (groups.has(key)) orderedKeys.push(key);
  }
  for (const key of [...groups.keys()].sort()) {
    if (!standardOrder.includes(key)) orderedKeys.push(key);
  }

  const elements: Element[] = [];
  for (const groupName of orderedKeys) {
    const groupItems = groups.get(groupName)!;
    const optionChildren: Element[] = [];

    for (const item of groupItems) {
      const optionProps: Record<string, unknown> = {
        value: item.elementId,
        label: item.label,
        onSelect: item.action,
      };
      if (item.shortcut) {
        optionProps.shortcut = item.shortcut;
      }
      optionChildren.push(createElement('option', optionProps));
    }

    elements.push(createElement('group', {
      label: groupName,
      [COMPONENT_GROUP_MARKER]: true,
    }, ...optionChildren));
  }

  return elements;
}

/**
 * Remove previously injected component groups from all command palettes.
 */
function _removeComponentGroups(element: Element): void {
  if (element.type === 'command-palette' && element.children) {
    element.children = element.children.filter(
      ch => !(ch.type === 'group' && ch.props?.[COMPONENT_GROUP_MARKER] === true)
    );
    if (typeof (element as any).refreshChildOptions === 'function') {
      (element as any).refreshChildOptions();
    }
  }
  if (element.children) {
    for (const child of element.children) {
      _removeComponentGroups(child);
    }
  }
}

/**
 * Inject component groups into command palettes.
 * Inserts before the System group (last group), replacing any previous injection.
 */
function _injectComponentGroupsInElement(element: Element, groupElements: Element[]): void {
  if (element.type === 'command-palette') {
    if (!element.children) {
      element.children = [];
    }

    // Remove previously injected component groups
    element.children = element.children.filter(
      ch => !(ch.type === 'group' && ch.props?.[COMPONENT_GROUP_MARKER] === true)
    );

    // Find the System group index to insert before it
    let systemIdx = -1;
    for (let i = 0; i < element.children.length; i++) {
      if (element.children[i].type === 'group' && element.children[i].props?.system === true) {
        systemIdx = i;
        break;
      }
    }

    // Also check for system groups by label (the created ones don't have system=true marker)
    if (systemIdx === -1) {
      for (let i = element.children.length - 1; i >= 0; i--) {
        if (element.children[i].type === 'group' && element.children[i].props?.label === 'System') {
          systemIdx = i;
          break;
        }
      }
    }

    if (systemIdx >= 0) {
      // Insert before System group
      element.children.splice(systemIdx, 0, ...groupElements);
    } else {
      // No System group — append at end
      element.children.push(...groupElements);
    }

    // Refresh cached options
    if (typeof (element as any).refreshChildOptions === 'function') {
      (element as any).refreshChildOptions();
    }
  }

  // Recurse into children
  if (element.children) {
    for (const child of element.children) {
      _injectComponentGroupsInElement(child, groupElements);
    }
  }
}
