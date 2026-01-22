// System command palette logic for MelkerEngine
// Extracted from engine.ts to reduce file size

import { Element, isToggleable } from './types.ts';
import {
  createDefaultCommandPalette,
  createSystemGroup,
  SystemHandlers,
} from './system-command-palette.ts';
import { getGlobalPerformanceDialog } from './performance-dialog.ts';
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
