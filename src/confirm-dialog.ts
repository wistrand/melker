// Confirm dialog management
// Shows a modal confirm dialog when confirm() is called in handlers

import { melker } from './template.ts';
import { BaseDialogManager } from './base-dialog.ts';

export class ConfirmDialogManager extends BaseDialogManager {
  private _resolvePromise?: (result: boolean) => void;

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

      const overlay = melker`
        <dialog
          id="confirm-dialog"
          title="Confirm"
          open=${true}
          modal=${true}
          backdrop=${false}
          draggable=${true}
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
              <text id="confirm-message" text=${message} />
            </container>
            <container
              id="confirm-footer"
              style="display: flex; flex-direction: row; justify-content: center; width: fill; gap: 2"
            >
              <button id="confirm-ok" label="OK" onClick=${onOk} />
              <button id="confirm-cancel" label="Cancel" onClick=${onCancel} />
            </container>
          </container>
        </dialog>
      `;

      this._openOverlay(overlay, 'confirm-ok');
    });
  }

  /**
   * Close the confirm dialog with a result
   */
  close(result: boolean): void {
    this._closeOverlay();

    if (this._resolvePromise) {
      this._resolvePromise(result);
      this._resolvePromise = undefined;
    }
  }
}
