// Confirm dialog management
// Shows a modal confirm dialog when confirm() is called in handlers

import { Document } from './document.ts';
import { createElement } from './element.ts';
import { melker } from './template.ts';
import { Element } from './types.ts';
import { FocusManager } from './focus.ts';

export interface ConfirmDialogDependencies {
  document: Document;
  focusManager: FocusManager | null;
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  autoRender: boolean;
}

export class ConfirmDialogManager {
  private _overlay?: Element;
  private _deps: ConfirmDialogDependencies;
  private _resolvePromise?: (result: boolean) => void;

  constructor(deps: ConfirmDialogDependencies) {
    this._deps = deps;
  }

  /**
   * Check if confirm dialog is open
   */
  isOpen(): boolean {
    return this._overlay !== undefined;
  }

  /**
   * Get the overlay element
   */
  getOverlay(): Element | undefined {
    return this._overlay;
  }

  /**
   * Show a confirm dialog with the given message
   * Returns a Promise that resolves to true (OK) or false (Cancel)
   */
  show(message: string): Promise<boolean> {
    // Close any existing confirm first
    if (this._overlay) {
      this.close(false);
    }

    return new Promise((resolve) => {
      this._resolvePromise = resolve;

      const onOk = () => this.close(true);
      const onCancel = () => this.close(false);

      // Create text element for the message
      const messageElement = createElement('text', {
        id: 'confirm-message',
        text: message,
      });

      this._overlay = melker`
        <dialog
          id="confirm-dialog"
          title="Confirm"
          open=${true}
          modal=${true}
          backdrop=${true}
          width=${50}
          height=${7}
        >
          <container
            id="confirm-main"
            style="display: flex; flex-direction: column; width: fill; height: fill"
          >
            <container
              id="confirm-content"
              style="flex: 1; padding-left: 1; padding-top: 1; width: fill"
            >
              ${messageElement}
            </container>
            <container
              id="confirm-footer"
              style="display: flex; flex-direction: row; justify-content: center; width: fill; gap: 2"
            >
              <button id="confirm-ok" title="OK" onClick=${onOk} />
              <button id="confirm-cancel" title="Cancel" onClick=${onCancel} />
            </container>
          </container>
        </dialog>
      `;

      // Add to document and register all elements
      const root = this._deps.document.root;
      if (root.children) {
        root.children.push(this._overlay);
      }
      this._deps.registerElementTree(this._overlay);

      // Force complete redraw to ensure dialog borders are correctly aligned
      this._deps.forceRender();

      // Focus the OK button
      if (this._deps.focusManager) {
        this._deps.focusManager.focus('confirm-ok');
      }
    });
  }

  /**
   * Close the confirm dialog with a result
   */
  close(result: boolean): void {
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

    // Resolve the promise with the result
    if (this._resolvePromise) {
      this._resolvePromise(result);
      this._resolvePromise = undefined;
    }
  }
}
