// Dialog component implementation

import { Element, BaseProps, Renderable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import { DualBuffer, Cell } from '../buffer.ts';
import { getThemeColor } from '../theme.ts';

export interface DialogProps extends BaseProps {
  title?: string;
  modal?: boolean;
  backdrop?: boolean;
  open?: boolean;
}

export class DialogElement extends Element implements Renderable {
  declare type: 'dialog';
  declare props: DialogProps;

  constructor(props: DialogProps = {}, children: Element[] = []) {
    const defaultProps: DialogProps = {
      modal: true,
      backdrop: true,
      open: false,
      disabled: false,
      ...props,
      style: {
        // Default styles would go here (none currently)
        ...props.style
      },
    };

    super('dialog', defaultProps, children);
  }

  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Closed dialogs should not take any space (they render as overlays when open)
    if (!this.props.open) {
      return { width: 0, height: 0 };
    }

    // Open dialog takes full available space for backdrop
    return {
      width: context.availableSpace.width || 80,
      height: context.availableSpace.height || 24
    };
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

    // Render backdrop if enabled
    if (this.props.backdrop) {
      this._renderBackdrop(bounds, buffer);
    }

    // Calculate centered dialog position
    const dialogWidth = Math.min(Math.floor(bounds.width * 0.8), 60);
    const dialogHeight = Math.min(Math.floor(bounds.height * 0.7), 20);
    const dialogX = Math.floor((bounds.width - dialogWidth) / 2);
    const dialogY = Math.floor((bounds.height - dialogHeight) / 2);

    const dialogBounds: Bounds = {
      x: bounds.x + dialogX,
      y: bounds.y + dialogY,
      width: dialogWidth,
      height: dialogHeight
    };

    this._renderDialog(dialogBounds, style, buffer, context);
  }

  private _renderBackdrop(bounds: Bounds, buffer: DualBuffer): void {
    const backdropStyle: Cell = {
      char: ' ',
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
        buffer.currentBuffer.setCell(x, contentY, { ...titleStyle, char: ' ' });
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
        buffer.currentBuffer.setCell(x, y, { ...modalStyle, char: ' ' });
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
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, { ...borderStyle, char: '┘' });

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
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const dialogSchema: ComponentSchema = {
  description: 'Modal or non-modal dialog overlay',
  props: {
    title: { type: 'string', description: 'Dialog title bar text' },
    modal: { type: 'boolean', description: 'Block interaction with background' },
    backdrop: { type: 'boolean', description: 'Show dimmed background' },
    open: { type: 'boolean', description: 'Whether dialog is visible' },
  },
};

registerComponentSchema('dialog', dialogSchema);