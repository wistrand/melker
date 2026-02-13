// Alert dialog management
// Shows a modal alert dialog when alert() is called in handlers

import { melker } from './template.ts';
import { BaseDialogManager } from './base-dialog.ts';

export class AlertDialogManager extends BaseDialogManager {
  /**
   * Show an alert dialog with the given message
   */
  show(message: string): void {
    // Close any existing alert first
    if (this._overlay) {
      this.close();
    }

    const onClose = () => this.close();

    // Calculate dialog size based on message content
    const lines = message.split('\n');
    const maxLineWidth = Math.max(...lines.map(l => l.length));
    const width = Math.max(Math.min(maxLineWidth + 6, 80), 30); // padding + border, clamped 30-80
    const contentHeight = lines.length;
    const height = contentHeight + 6; // border (2) + title + separator (2) + content padding (1) + button row (1)

    const overlay = melker`
      <dialog
        id="alert-dialog"
        title="Alert"
        open=${true}
        modal=${true}
        backdrop=${false}
        draggable=${true}
        width=${width}
        height=${height}
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
            <button id="alert-ok" label="OK" onClick=${onClose} />
          </container>
        </container>
      </dialog>
    `;

    this._openOverlay(overlay, 'alert-ok');
  }

  /**
   * Close the alert dialog
   */
  close(): void {
    this._closeOverlay();
  }
}
