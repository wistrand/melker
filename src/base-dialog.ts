// Base dialog manager — shared lifecycle for alert, confirm, and prompt dialogs

import { Document } from './document.ts';
import { Element } from './types.ts';
import { FocusManager } from './focus.ts';

export interface DialogDependencies {
  document: Document;
  focusManager: FocusManager | null;
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  autoRender: boolean;
}

export class BaseDialogManager {
  protected _overlay?: Element;
  protected _deps: DialogDependencies;

  constructor(deps: DialogDependencies) {
    this._deps = deps;
  }

  isOpen(): boolean {
    return this._overlay !== undefined;
  }

  getOverlay(): Element | undefined {
    return this._overlay;
  }

  protected _openOverlay(overlay: Element, focusId: string): void {
    this._overlay = overlay;

    const root = this._deps.document.root;
    if (root.children) {
      root.children.push(this._overlay);
    }
    this._deps.registerElementTree(this._overlay);

    // Force complete redraw to ensure dialog borders are correctly aligned
    this._deps.forceRender();

    if (this._deps.focusManager) {
      this._deps.focusManager.focus(focusId);
    }
  }

  protected _closeOverlay(): void {
    if (!this._overlay) return;

    // Remove from document root's children
    const root = this._deps.document.root;
    if (root.children) {
      const index = root.children.indexOf(this._overlay);
      if (index !== -1) {
        root.children.splice(index, 1);
      }
    }

    // Unregister all elements from document registry
    this._deps.document.removeElement(this._overlay);

    this._overlay = undefined;

    // Force complete redraw since overlay covered the screen
    this._deps.forceRender();
  }
}
