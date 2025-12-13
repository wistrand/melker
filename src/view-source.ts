// View Source overlay management
// Shows source content in a modal dialog when F12 is pressed

import { Document } from './document.ts';
import { createElement } from './element.ts';
import { melker } from './template.ts';
import { Element } from './types.ts';
import { FocusManager } from './focus.ts';

export interface ViewSourceDependencies {
  document: Document;
  focusManager: FocusManager | null;
  registerElementTree: (element: Element) => void;
  render: () => void;
  forceRender: () => void;
  autoRender: boolean;
}

export interface ViewSourceState {
  content: string;
  filePath: string;
  type: 'melker' | 'md';
}

export class ViewSourceManager {
  private _overlay?: Element;
  private _state?: ViewSourceState;
  private _deps: ViewSourceDependencies;

  constructor(deps: ViewSourceDependencies) {
    this._deps = deps;
  }

  /**
   * Set the source content to display
   */
  setSource(content: string, filePath: string, type: 'melker' | 'md'): void {
    this._state = { content, filePath, type };
  }

  /**
   * Check if view source overlay is open
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
   * Toggle View Source overlay (F12)
   */
  toggle(): void {
    if (this._overlay) {
      this.close();
      return;
    }

    if (!this._state?.content) {
      return;
    }

    this._open();
  }

  /**
   * Open View Source overlay
   */
  private _open(): void {
    if (!this._state) return;

    const filename = this._state.filePath
      ? this._state.filePath.split('/').pop() || 'source'
      : 'source';

    const contentType = this._state.type === 'md' ? 'markdown' : 'text';
    const contentElement = createElement(contentType, {
      id: 'view-source-content',
      text: this._state.content,
    });
    const onClose = () => this.close();

    this._overlay = melker`
      <dialog
        id="view-source-dialog"
        title="Source: ${filename}"
        open=${true}
        modal=${true}
        backdrop=${true}
        width=${0.9}
        height=${0.85}
      >
        <container
          id="view-source-main"
          style="display: flex; flex-direction: column; width: fill; height: fill"
        >
          <container
            id="view-source-scroll"
            scrollable=${true}
            focusable=${true}
            style="flex: 1; padding: 1; overflow: scroll"
          >
            ${contentElement}
          </container>
          <container
            id="view-source-footer"
            style="display: flex; flex-direction: row; justify-content: flex-end; width: fill"
          >
            <button id="view-source-close" title="Close" style="width: 10" onClick=${onClose} />
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

    // Re-render
    if (this._deps.autoRender) {
      this._deps.render();
    }

    // Focus the scroll container for arrow key navigation
    if (this._deps.focusManager) {
      this._deps.focusManager.focus('view-source-scroll');
    }
  }

  /**
   * Close View Source overlay
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
