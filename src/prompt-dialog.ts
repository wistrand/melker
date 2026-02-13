// Prompt dialog management
// Shows a modal prompt dialog when prompt() is called in handlers

import { melker } from './template.ts';
import { BaseDialogManager } from './base-dialog.ts';

export class PromptDialogManager extends BaseDialogManager {
  private _resolvePromise?: (result: string | null) => void;

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

      const overlay = melker`
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

      this._openOverlay(overlay, 'prompt-input');
    });
  }

  /**
   * Close the prompt dialog with a result
   */
  close(result: string | null): void {
    this._closeOverlay();

    if (this._resolvePromise) {
      this._resolvePromise(result);
      this._resolvePromise = undefined;
    }
  }
}
