// Dialog component implementation

import { Element, BaseProps, Renderable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import { DualBuffer, Cell, EMPTY_CHAR } from '../buffer.ts';
import { getThemeColor } from '../theme.ts';
import { parseDimension } from '../utils/dimensions.ts';

export interface DialogProps extends Omit<BaseProps, 'width' | 'height'> {
  title?: string;
  modal?: boolean;
  backdrop?: boolean;
  open?: boolean;
  /** Dialog width: number (absolute), decimal 0<v<1 (percentage), "50%" (percentage string), or "fill" */
  width?: number | string;
  /** Dialog height: number (absolute), decimal 0<v<1 (percentage), "50%" (percentage string), or "fill" */
  height?: number | string;
  /** Enable dragging by title bar */
  draggable?: boolean;
  /** Enable resizing from bottom-right corner */
  resizable?: boolean;
  /** X offset from center (set by dragging) */
  offsetX?: number;
  /** Y offset from center (set by dragging) */
  offsetY?: number;
}

export class DialogElement extends Element implements Renderable {
  declare type: 'dialog';
  declare props: DialogProps;

  // Drag state
  private _isDragging = false;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragStartOffsetX = 0;
  private _dragStartOffsetY = 0;
  // Resize state
  private _isResizing = false;
  private _resizeStartX = 0;
  private _resizeStartY = 0;
  private _resizeStartWidth = 0;
  private _resizeStartHeight = 0;
  // Fixed top-left position during resize (absolute screen coordinates)
  private _resizeFixedTopLeftX = 0;
  private _resizeFixedTopLeftY = 0;
  // Last calculated dialog bounds (for title bar hit testing)
  private _lastDialogBounds: Bounds | null = null;
  private _lastViewportBounds: Bounds | null = null;

  constructor(props: DialogProps = {}, children: Element[] = []) {
    const defaultProps: DialogProps = {
      modal: true,
      backdrop: true,
      open: false,
      disabled: false,
      draggable: false,
      resizable: false,
      offsetX: 0,
      offsetY: 0,
      ...props,
      style: {
        // Default styles would go here (none currently)
        ...props.style
      },
    };

    super('dialog', defaultProps, children);
  }

  /**
   * Set dialog visibility
   */
  setVisible(visible: boolean): void {
    this.props.open = visible;
  }

  /**
   * Check if dialog is visible
   */
  isVisible(): boolean {
    return this.props.open === true;
  }

  /**
   * Show the dialog (alias for setVisible(true))
   */
  show(): void {
    this.setVisible(true);
  }

  /**
   * Hide the dialog (alias for setVisible(false))
   */
  hide(): void {
    this.setVisible(false);
  }

  /**
   * Check if a point is on the title bar (for drag initiation)
   */
  isOnTitleBar(x: number, y: number): boolean {
    if (!this.props.draggable || !this.props.title || !this._lastDialogBounds) {
      return false;
    }
    const bounds = this._lastDialogBounds;
    // Title bar is the first row inside the dialog (y = bounds.y + 1)
    // and spans the full width inside the borders
    return (
      y === bounds.y + 1 &&
      x > bounds.x &&
      x < bounds.x + bounds.width - 1
    );
  }

  /**
   * Start dragging the dialog
   */
  startDrag(mouseX: number, mouseY: number): void {
    if (!this.props.draggable) return;
    this._isDragging = true;
    this._dragStartX = mouseX;
    this._dragStartY = mouseY;
    this._dragStartOffsetX = this.props.offsetX || 0;
    this._dragStartOffsetY = this.props.offsetY || 0;
  }

  /**
   * Update drag position
   */
  updateDrag(mouseX: number, mouseY: number): boolean {
    if (!this._isDragging || !this._lastViewportBounds) return false;

    const deltaX = mouseX - this._dragStartX;
    const deltaY = mouseY - this._dragStartY;

    // Calculate new offset
    let newOffsetX = this._dragStartOffsetX + deltaX;
    let newOffsetY = this._dragStartOffsetY + deltaY;

    // Constrain to viewport bounds (keep at least title bar visible)
    if (this._lastDialogBounds && this._lastViewportBounds) {
      const vp = this._lastViewportBounds;
      const dialogWidth = this._lastDialogBounds.width;
      const dialogHeight = this._lastDialogBounds.height;

      // Calculate center position
      const centerX = Math.floor((vp.width - dialogWidth) / 2);
      const centerY = Math.floor((vp.height - dialogHeight) / 2);

      // Constrain so dialog stays mostly visible
      const minX = -centerX + 2;  // Leave 2 chars visible on left
      const maxX = vp.width - centerX - dialogWidth + dialogWidth - 2;  // Leave 2 chars visible on right
      const minY = -centerY;  // Can go to top
      const maxY = vp.height - centerY - 3;  // Keep title bar visible

      newOffsetX = Math.max(minX, Math.min(maxX, newOffsetX));
      newOffsetY = Math.max(minY, Math.min(maxY, newOffsetY));
    }

    this.props.offsetX = newOffsetX;
    this.props.offsetY = newOffsetY;

    return true;
  }

  /**
   * End dragging
   */
  endDrag(): void {
    this._isDragging = false;
  }

  /**
   * Check if currently dragging
   */
  isDragging(): boolean {
    return this._isDragging;
  }

  /**
   * Check if a point is on the resize corner (bottom-right)
   */
  isOnResizeCorner(x: number, y: number): boolean {
    if (!this.props.resizable || !this._lastDialogBounds) {
      return false;
    }
    const bounds = this._lastDialogBounds;
    // Resize corner is the bottom-right corner (2x1 area)
    return (
      y === bounds.y + bounds.height - 1 &&
      x >= bounds.x + bounds.width - 3 &&
      x <= bounds.x + bounds.width - 1
    );
  }

  /**
   * Start resizing the dialog
   */
  startResize(mouseX: number, mouseY: number): void {
    if (!this.props.resizable || !this._lastDialogBounds) return;
    this._isResizing = true;
    this._resizeStartX = mouseX;
    this._resizeStartY = mouseY;
    this._resizeStartWidth = this._lastDialogBounds.width;
    this._resizeStartHeight = this._lastDialogBounds.height;
    // Store the current top-left position to keep it fixed during resize
    this._resizeFixedTopLeftX = this._lastDialogBounds.x;
    this._resizeFixedTopLeftY = this._lastDialogBounds.y;
  }

  /**
   * Update resize dimensions
   */
  updateResize(mouseX: number, mouseY: number): boolean {
    if (!this._isResizing || !this._lastViewportBounds) return false;

    const deltaX = mouseX - this._resizeStartX;
    const deltaY = mouseY - this._resizeStartY;

    // Calculate new dimensions
    let newWidth = this._resizeStartWidth + deltaX;
    let newHeight = this._resizeStartHeight + deltaY;

    // Minimum size constraints
    const minWidth = 20;
    const minHeight = 8;

    // Maximum size constraints (viewport bounds)
    const vp = this._lastViewportBounds;
    const maxWidth = vp.width - 4;
    const maxHeight = vp.height - 4;

    newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
    newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

    // Calculate offset to keep top-left corner at fixed position
    // Dialog position formula: dialogX = vpX + floor((vpWidth - dialogWidth) / 2) + offsetX
    // We want dialogX = fixedTopLeftX, so:
    // offsetX = fixedTopLeftX - vpX - floor((vpWidth - newWidth) / 2)
    const centerBasedX = Math.floor((vp.width - newWidth) / 2);
    const centerBasedY = Math.floor((vp.height - newHeight) / 2);
    this.props.offsetX = this._resizeFixedTopLeftX - vp.x - centerBasedX;
    this.props.offsetY = this._resizeFixedTopLeftY - vp.y - centerBasedY;

    // Update props with absolute values (not percentages)
    this.props.width = newWidth;
    this.props.height = newHeight;

    return true;
  }

  /**
   * End resizing
   */
  endResize(): void {
    this._isResizing = false;
  }

  /**
   * Check if currently resizing
   */
  isResizing(): boolean {
    return this._isResizing;
  }

  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    // Dialogs are rendered as overlays (separately from normal layout flow)
    // They should never take layout space
    return { width: 0, height: 0 };
  }

  static validate(props: DialogProps): boolean {
    if (props.title !== undefined && typeof props.title !== 'string') {
      return false;
    }
    if (props.modal !== undefined && typeof props.modal !== 'boolean') {
      return false;
    }
    if (props.backdrop !== undefined && typeof props.backdrop !== 'boolean') {
      return false;
    }
    if (props.open !== undefined && typeof props.open !== 'boolean') {
      return false;
    }
    return true;
  }

  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Only render if dialog is open
    if (!this.props.open) {
      return;
    }

    // Store viewport bounds for drag constraints
    this._lastViewportBounds = bounds;

    // Render backdrop if enabled
    if (this.props.backdrop) {
      this._renderBackdrop(bounds, buffer);
    }

    // Calculate centered dialog position
    // Use shared dimension parser (supports number, decimal 0-1, "50%", "fill")
    // Cap dimensions to leave margin around dialog
    const defaultWidth = Math.min(Math.floor(bounds.width * 0.8), 60);
    const defaultHeight = Math.min(Math.floor(bounds.height * 0.7), 20);
    const dialogWidth = Math.min(
      parseDimension(this.props.width, bounds.width, defaultWidth),
      bounds.width - 4
    );
    const dialogHeight = Math.min(
      parseDimension(this.props.height, bounds.height, defaultHeight),
      bounds.height - 4
    );

    // Apply drag offset to centered position
    const offsetX = this.props.offsetX || 0;
    const offsetY = this.props.offsetY || 0;
    const dialogX = Math.floor((bounds.width - dialogWidth) / 2) + offsetX;
    const dialogY = Math.floor((bounds.height - dialogHeight) / 2) + offsetY;

    const dialogBounds: Bounds = {
      x: bounds.x + dialogX,
      y: bounds.y + dialogY,
      width: dialogWidth,
      height: dialogHeight
    };

    // Store bounds for title bar hit testing
    this._lastDialogBounds = dialogBounds;

    this._renderDialog(dialogBounds, style, buffer, context);
  }

  private _renderBackdrop(bounds: Bounds, buffer: DualBuffer): void {
    const backdropStyle: Cell = {
      char: EMPTY_CHAR,
      background: getThemeColor('modalBackground'),
      foreground: getThemeColor('modalForeground'),
    };

    // Fill entire viewport with backdrop
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        buffer.currentBuffer.setCell(bounds.x + x, bounds.y + y, backdropStyle);
      }
    }
  }

  private _renderDialog(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    const modalStyle: Partial<Cell> = {
      background: getThemeColor('surface'),
      foreground: getThemeColor('textPrimary'),
    };

    // Draw dialog border
    this._drawBorder(bounds, modalStyle, buffer);

    // Render title if provided
    let contentY = bounds.y + 1;
    if (this.props.title) {
      const titleStyle: Partial<Cell> = {
        ...modalStyle,
        background: getThemeColor('headerBackground'),
        foreground: getThemeColor('headerForeground'),
        bold: true,
      };

      // Clear title area
      for (let x = bounds.x + 1; x < bounds.x + bounds.width - 1; x++) {
        buffer.currentBuffer.setCell(x, contentY, { ...titleStyle, char: EMPTY_CHAR });
      }

      // Center the title
      const titleText = ` ${this.props.title} `;
      const titleX = bounds.x + Math.floor((bounds.width - titleText.length) / 2);
      buffer.currentBuffer.setText(titleX, contentY, titleText, titleStyle);

      contentY += 2; // Skip title and separator
    }

    // Render content area for children
    const contentBounds: Bounds = {
      x: bounds.x + 1,
      y: contentY,
      width: bounds.width - 2,
      height: bounds.height - (contentY - bounds.y) - 1
    };

    // Clear content area
    for (let y = contentBounds.y; y < contentBounds.y + contentBounds.height; y++) {
      for (let x = contentBounds.x; x < contentBounds.x + contentBounds.width; x++) {
        buffer.currentBuffer.setCell(x, y, { ...modalStyle, char: EMPTY_CHAR });
      }
    }

    // The dialog component uses the normal rendering pipeline for its children
    // Children are rendered by the normal layout engine when the dialog element
    // is processed in the main rendering loop. This is just for custom dialog styling.
  }

  private _drawBorder(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const borderStyle = {
      ...style,
      foreground: style.foreground,
    };

    // Draw corners
    buffer.currentBuffer.setCell(bounds.x, bounds.y, { ...borderStyle, char: '┌' });
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y, { ...borderStyle, char: '┐' });
    buffer.currentBuffer.setCell(bounds.x, bounds.y + bounds.height - 1, { ...borderStyle, char: '└' });

    // Bottom-right corner: show resize indicator if resizable
    if (this.props.resizable) {
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, { ...borderStyle, char: '┛' });
    } else {
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, { ...borderStyle, char: '┘' });
    }

    // Draw horizontal borders
    for (let x = bounds.x + 1; x < bounds.x + bounds.width - 1; x++) {
      buffer.currentBuffer.setCell(x, bounds.y, { ...borderStyle, char: '─' });
      buffer.currentBuffer.setCell(x, bounds.y + bounds.height - 1, { ...borderStyle, char: '─' });
    }

    // Draw vertical borders
    for (let y = bounds.y + 1; y < bounds.y + bounds.height - 1; y++) {
      buffer.currentBuffer.setCell(bounds.x, y, { ...borderStyle, char: '│' });
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, y, { ...borderStyle, char: '│' });
    }

    // Draw title separator if title exists
    if (this.props.title) {
      const separatorY = bounds.y + 2;
      buffer.currentBuffer.setCell(bounds.x, separatorY, { ...borderStyle, char: '├' });
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, separatorY, { ...borderStyle, char: '┤' });
      for (let x = bounds.x + 1; x < bounds.x + bounds.width - 1; x++) {
        buffer.currentBuffer.setCell(x, separatorY, { ...borderStyle, char: '─' });
      }
    }
  }
}

// Lint schema for dialog component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const dialogSchema: ComponentSchema = {
  description: 'Modal or non-modal dialog overlay',
  props: {
    title: { type: 'string', description: 'Dialog title bar text' },
    modal: { type: 'boolean', description: 'Block interaction with background' },
    backdrop: { type: 'boolean', description: 'Show dimmed background' },
    open: { type: 'boolean', description: 'Whether dialog is visible' },
    draggable: { type: 'boolean', description: 'Enable dragging by title bar' },
    resizable: { type: 'boolean', description: 'Enable resizing from bottom-right corner' },
  },
};

registerComponentSchema('dialog', dialogSchema);

// Register dialog component
registerComponent({
  type: 'dialog',
  componentClass: DialogElement,
  defaultProps: {
    modal: true,
    backdrop: true,
    disabled: false,
  },
  validate: (props) => DialogElement.validate(props as any),
});