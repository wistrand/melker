// Dialog coordinator — manages alert, confirm, prompt, and accessibility dialogs
// Extracted from engine.ts to group dialog lifecycle and lazy initialization

import { AlertDialogManager } from './alert-dialog.ts';
import { ConfirmDialogManager } from './confirm-dialog.ts';
import { PromptDialogManager } from './prompt-dialog.ts';
import { AccessibilityDialogManager } from './ai/accessibility-dialog.ts';
import type { Document } from './document.ts';
import type { Element } from './types.ts';
import type { FocusManager } from './focus.ts';

export interface DialogCoordinatorDeps {
  document: Document;
  focusManager: FocusManager;
  autoRender: boolean;

  // Engine callbacks
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  exitProgram: () => Promise<void>;
  scrollToBottom: (containerId: string) => void;
  getSelectedText: () => string | undefined;
}

/**
 * Coordinates all dialog managers (alert, confirm, prompt, accessibility).
 * Handles lazy initialization — managers are created on first use.
 */
export class DialogCoordinator {
  private _alertDialogManager?: AlertDialogManager;
  private _confirmDialogManager?: ConfirmDialogManager;
  private _promptDialogManager?: PromptDialogManager;
  private _accessibilityDialogManager?: AccessibilityDialogManager;
  private _deps: DialogCoordinatorDeps;

  constructor(deps: DialogCoordinatorDeps) {
    this._deps = deps;
  }

  /**
   * Show an alert dialog with the given message.
   * This is the melker equivalent of window.alert().
   */
  showAlert(message: string): void {
    if (!this._alertDialogManager) {
      this._alertDialogManager = new AlertDialogManager({
        document: this._deps.document,
        focusManager: this._deps.focusManager,
        registerElementTree: this._deps.registerElementTree,
        render: this._deps.render,
        forceRender: this._deps.forceRender,
        autoRender: this._deps.autoRender,
      });
    }
    this._alertDialogManager.show(message);
  }

  /**
   * Show a confirm dialog with the given message.
   * Returns a Promise that resolves to true (OK) or false (Cancel).
   */
  showConfirm(message: string): Promise<boolean> {
    if (!this._confirmDialogManager) {
      this._confirmDialogManager = new ConfirmDialogManager({
        document: this._deps.document,
        focusManager: this._deps.focusManager,
        registerElementTree: this._deps.registerElementTree,
        render: this._deps.render,
        forceRender: this._deps.forceRender,
        autoRender: this._deps.autoRender,
      });
    }
    return this._confirmDialogManager.show(message);
  }

  /**
   * Show a prompt dialog with the given message.
   * Returns a Promise that resolves to the input value or null if cancelled.
   */
  showPrompt(message: string, defaultValue?: string): Promise<string | null> {
    if (!this._promptDialogManager) {
      this._promptDialogManager = new PromptDialogManager({
        document: this._deps.document,
        focusManager: this._deps.focusManager,
        registerElementTree: this._deps.registerElementTree,
        render: this._deps.render,
        forceRender: this._deps.forceRender,
        autoRender: this._deps.autoRender,
      });
    }
    return this._promptDialogManager.show(message, defaultValue);
  }

  /**
   * Ensure the accessibility dialog manager is initialized (lazy init).
   */
  ensureAccessibilityDialogManager(): void {
    if (!this._accessibilityDialogManager) {
      this._accessibilityDialogManager = new AccessibilityDialogManager({
        document: this._deps.document,
        focusManager: this._deps.focusManager,
        registerElementTree: this._deps.registerElementTree,
        render: this._deps.render,
        forceRender: this._deps.forceRender,
        autoRender: this._deps.autoRender,
        exitProgram: this._deps.exitProgram,
        scrollToBottom: this._deps.scrollToBottom,
        getSelectedText: this._deps.getSelectedText,
      });
    }
  }

  // Getters for individual managers (used by keyboard handler context, system palette, etc.)

  get alertDialogManager(): AlertDialogManager | undefined {
    return this._alertDialogManager;
  }

  get confirmDialogManager(): ConfirmDialogManager | undefined {
    return this._confirmDialogManager;
  }

  get promptDialogManager(): PromptDialogManager | undefined {
    return this._promptDialogManager;
  }

  get accessibilityDialogManager(): AccessibilityDialogManager | undefined {
    return this._accessibilityDialogManager;
  }
}
