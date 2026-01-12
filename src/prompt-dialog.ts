// Prompt dialog management
// Shows a modal prompt dialog when prompt() is called in handlers

import { Document } from './document.ts';
import { melker } from './template.ts';
import { Element } from './types.ts';
import { FocusManager } from './focus.ts';

export interface PromptDialogDependencies {
  document: Document;
  focusManager: FocusManager | null;
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  autoRender: boolean;
}

export class PromptDialogManager {
  private _overlay?: Element;
  private _deps: PromptDialogDependencies;
  private _resolvePromise?: (result: string | null) => void;

  constructor(deps: PromptDialogDependencies) {
    this._deps = deps;
  }

  /**
   * Check if prompt dialog is open
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
   * Show a prompt dialog with the given message
   * Returns a Promise that resolves to the input value or null if cancelled
   */
  show(message: string, defaultValue: string = ''): Promise<string | null> {
    // Close any existing prompt first
    if (this._overlay) {
      this.close(null);
    }

    return new Promise((resolve) => {
      this._resolvePromise = resolve;

      const onOk = () => {
        const inputElement = this._deps.document.getElementById('prompt-input');
        const value = inputElement?.props.value as string || '';
        this.close(value);
      };
      const onCancel = () => this.close(null);

      this._overlay = melker`
        <dialog
          id="prompt-dialog"
          title="Prompt"
          open=${true}
          modal=${true}
          backdrop=${false}
          draggable=${true}
          width=${50}
          height=${9}
        >
          <container
            id="prompt-main"
            style="display: flex; flex-direction: column; width: fill; height: fill"
          >
            <container
              id="prompt-content"
              style="flex: 1; padding-left: 1; padding-top: 1; padding-right: 1; width: fill; display: flex; flex-direction: column; gap: 1"
            >
              <text id="prompt-message" text=${message} />
              <input id="prompt-input" value=${defaultValue} style=${{ width: 'fill' }} />
            </container>
            <container
              id="prompt-footer"
              style="display: flex; flex-direction: row; justify-content: center; width: fill; gap: 2"
            >
              <button id="prompt-ok" label="OK" onClick=${onOk} />
              <button id="prompt-cancel" label="Cancel" onClick=${onCancel} />
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

      // Focus the input field
      if (this._deps.focusManager) {
        this._deps.focusManager.focus('prompt-input');
      }
    });
  }

  /**
   * Close the prompt dialog with a result
   */
  close(result: string | null): void {
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
