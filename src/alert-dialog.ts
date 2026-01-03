// Alert dialog management
// Shows a modal alert dialog when alert() is called in handlers

import { Document } from './document.ts';
import { melker } from './template.ts';
import { Element } from './types.ts';
import { FocusManager } from './focus.ts';

export interface AlertDialogDependencies {
  document: Document;
  focusManager: FocusManager | null;
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  autoRender: boolean;
}

export class AlertDialogManager {
  private _overlay?: Element;
  private _deps: AlertDialogDependencies;

  constructor(deps: AlertDialogDependencies) {
    this._deps = deps;
  }

  /**
   * Check if alert dialog is open
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
   * Show an alert dialog with the given message
   */
  show(message: string): void {
    // Close any existing alert first
    if (this._overlay) {
      this.close();
    }

    const onClose = () => this.close();

    this._overlay = melker`
      <dialog
        id="alert-dialog"
        title="Alert"
        open=${true}
        modal=${true}
        backdrop=${false}
        draggable=${true}
        width=${50}
        height=${7}
      >
        <container
          id="alert-main"
          style="display: flex; flex-direction: column; width: fill; height: fill"
        >
          <container
            id="alert-content"
            style="flex: 1; padding-left: 1; padding-top: 1; width: fill"
          >
            <text id="alert-message" text=${message} />
          </container>
          <container
            id="alert-footer"
            style="display: flex; flex-direction: row; justify-content: center; width: fill"
          >
            <button id="alert-ok" title="OK" onClick=${onClose} />
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
      this._deps.focusManager.focus('alert-ok');
    }
  }

  /**
   * Close the alert dialog
   */
  close(): void {
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
