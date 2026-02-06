// Dialog utility functions for MelkerEngine
// Extracted from engine.ts to reduce file size

import type { Element } from './types.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('DialogUtils');
import {
  hasElement,
  collectElements,
  isDescendant,
  findElement,
  isOpenDialog,
  isOpenModalDialog,
} from './utils/tree-traversal.ts';

// Re-export for backwards compatibility
export { isDescendant as isDescendantOf } from './utils/tree-traversal.ts';

/**
 * Options for focus trapping (matches FocusManager.trapFocus signature)
 */
export interface FocusTrapOptions {
  containerId: string;
  initialFocus?: string;
  restoreFocus?: boolean;
}

/**
 * Interface for focus manager operations needed by dialog utils
 */
export interface FocusManagerOps {
  trapFocus: (options: FocusTrapOptions) => void;
  releaseFocusTrap: (containerId: string, restoreFocus: boolean) => void;
}

/**
 * Context for modal focus trap operations
 */
export interface ModalFocusTrapContext {
  root: Element | undefined;
  trappedModalDialogIds: Set<string>;
  focusManager: FocusManagerOps;
}

/**
 * Find if any open dialog exists in element tree (recursive)
 */
export function findOpenDialog(element: Element): boolean {
  return hasElement(element, isOpenDialog);
}

/**
 * Check if there are any open dialogs in the document
 */
export function hasOpenDialogInDocument(root: Element | undefined): boolean {
  if (!root) return false;
  return findOpenDialog(root);
}

/**
 * Collect all open dialogs from element tree
 */
export function collectOpenDialogs(element: Element, result: Element[]): void {
  collectElements(element, isOpenDialog, result);
}

// isDescendantOf is re-exported from tree-traversal.ts above

/**
 * Check if there's an open dialog that's NOT an ancestor of the given element
 * (i.e., a dialog overlay that would be drawn on top of the element)
 */
export function hasOverlayDialogFor(element: Element, root: Element | undefined): boolean {
  if (!root) return false;

  // Find all open dialogs and check if element is inside any of them
  const openDialogs: Element[] = [];
  collectOpenDialogs(root, openDialogs);

  if (openDialogs.length === 0) return false;

  // Check if element is a descendant of any open dialog
  for (const dialog of openDialogs) {
    if (isDescendant(element, dialog)) {
      // Element is inside this dialog - this dialog is not an overlay for it
      // But there might be OTHER open dialogs that are overlays
      continue;
    }
    // This dialog doesn't contain the element - it's an overlay
    return true;
  }
  return false;
}

/**
 * Collect IDs of all currently open dialogs (for change detection)
 */
export function collectOpenDialogIds(root: Element | undefined): Set<string> {
  const dialogs: Element[] = [];
  if (root) {
    collectOpenDialogs(root, dialogs);
  }
  const ids = new Set<string>();
  for (const dialog of dialogs) {
    // Use id if available, otherwise create a stable identifier from the element
    const id = dialog.props?.id || dialog.id || `dialog-${dialogs.indexOf(dialog)}`;
    ids.add(id);
  }
  return ids;
}

/**
 * Collect all open modal dialogs from element tree
 */
export function collectOpenModalDialogs(element: Element, result: Element[]): void {
  collectElements(element, isOpenModalDialog, result);
}

/**
 * Find first focusable element inside a container
 */
function findFirstFocusable(element: Element): string | undefined {
  const focusable = findElement(element, (el) => {
    if (!el.id) return false;
    const canFocus = (el as unknown as { canReceiveFocus?: () => boolean }).canReceiveFocus;
    return typeof canFocus === 'function' && canFocus.call(el);
  });
  return focusable?.id;
}

/**
 * Update focus traps for modal dialogs
 * Called after each render to ensure focus is trapped when modals open/close
 */
export function updateModalFocusTraps(ctx: ModalFocusTrapContext): void {
  if (!ctx.root) return;

  // Collect all open modal dialogs
  const openModalDialogs: Element[] = [];
  collectOpenModalDialogs(ctx.root, openModalDialogs);

  const currentOpenIds = new Set(openModalDialogs.map(d => d.id).filter(Boolean) as string[]);

  // Release traps for dialogs that closed
  for (const dialogId of ctx.trappedModalDialogIds) {
    if (!currentOpenIds.has(dialogId)) {
      logger.debug(`Releasing focus trap for closed modal: ${dialogId}`);
      ctx.focusManager.releaseFocusTrap(dialogId, true);
      ctx.trappedModalDialogIds.delete(dialogId);
    }
  }

  // Set up traps for newly opened dialogs
  for (const dialog of openModalDialogs) {
    if (dialog.id && !ctx.trappedModalDialogIds.has(dialog.id)) {
      logger.debug(`Setting up focus trap for modal: ${dialog.id}`);

      // Find the first focusable element inside the dialog
      const initialFocus = findFirstFocusable(dialog);

      ctx.focusManager.trapFocus({
        containerId: dialog.id,
        initialFocus,
        restoreFocus: true,
      });
      ctx.trappedModalDialogIds.add(dialog.id);
    }
  }
}
