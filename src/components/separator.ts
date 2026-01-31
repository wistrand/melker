/**
 * Separator Component
 *
 * A horizontal or vertical line with optional centered label text.
 * Orientation is automatic based on parent's flex-direction:
 * - column flex (default): horizontal separator
 * - row flex: vertical separator
 */

import {
  Element,
  BORDER_CHARS,
  type Style,
  type Bounds,
  type Renderable,
  type ComponentRenderContext,
  type BorderStyle,
  type IntrinsicSizeContext,
} from '../types.ts';
import { parseColor } from './color-utils.ts';
import type { DualBuffer, Cell } from '../buffer.ts';

export interface SeparatorProps {
  /** Optional text centered in the line (vertical when in row flex) */
  label?: string;
  /** Standard style object */
  style?: Style;
}

export class SeparatorElement extends Element implements Renderable {
  static readonly type = 'separator';
  declare type: 'separator';
  declare props: SeparatorProps;

  // Cached orientation from parent flex-direction (set during layout)
  private _isVertical: boolean = false;

  constructor(props: SeparatorProps = {}, _children: Element[] = []) {
    super('separator', props);
  }

  /**
   * Intrinsic size depends on orientation.
   * Horizontal: width fills, height 1
   * Vertical: width 1, height fills
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Check parent's flex-direction to determine orientation
    const parentStyle = context.parentStyle;
    const parentDirection = parentStyle?.flexDirection
      || parentStyle?.['flex-direction']
      || 'column';
    this._isVertical = parentDirection === 'row' || parentDirection === 'row-reverse';

    if (this._isVertical) {
      return {
        width: 1,
        height: 0,  // Will stretch to fill available height
      };
    } else {
      return {
        width: 0,   // Will stretch to fill available width
        height: 1,
      };
    }
  }

  /**
   * Check if separator is in vertical mode (in row flex parent)
   */
  isVertical(): boolean {
    return this._isVertical;
  }

  /**
   * Render the separator line with optional label
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, _context: ComponentRenderContext): void {
    const propStyle = this.props.style || {};
    const label = this.props.label;

    // Get border style (default to thin)
    const borderStyle = (propStyle.borderStyle || propStyle['border-style'] || 'thin') as BorderStyle;
    if (borderStyle === 'none') return;

    const borderChars = BORDER_CHARS[borderStyle as Exclude<BorderStyle, 'none'>] || BORDER_CHARS.thin;

    // Get color from style
    const color = propStyle.color ? parseColor(propStyle.color) : style.foreground;
    const cellStyle: Partial<Cell> = { ...style };
    if (color !== undefined) {
      cellStyle.foreground = color;
    }

    if (this._isVertical) {
      // Vertical separator (in row flex)
      // Draw vertical line
      for (let y = 0; y < bounds.height; y++) {
        buffer.currentBuffer.setCell(bounds.x, bounds.y + y, {
          char: borderChars.v,
          ...cellStyle
        });
      }

      // Draw vertical label (one char per row, centered)
      if (label && bounds.height >= 3) {
        const labelLen = label.length;
        const availableHeight = bounds.height;

        if (labelLen <= availableHeight - 2) {  // Leave 1 cell padding top/bottom
          const startY = bounds.y + Math.floor((availableHeight - labelLen) / 2);

          for (let i = 0; i < labelLen; i++) {
            buffer.currentBuffer.setCell(bounds.x, startY + i, {
              char: label[i],
              ...cellStyle
            });
          }
        }
      }
    } else {
      // Horizontal separator (in column flex, default)
      // Draw horizontal line across full width
      for (let x = 0; x < bounds.width; x++) {
        buffer.currentBuffer.setCell(bounds.x + x, bounds.y, {
          char: borderChars.h,
          ...cellStyle
        });
      }

      // Draw centered label if provided
      if (label && bounds.width >= 5) {  // Minimum width for label
        const title = ` ${label} `;
        const titleLen = title.length;

        if (titleLen <= bounds.width) {
          const startX = bounds.x + Math.floor((bounds.width - titleLen) / 2);

          for (let i = 0; i < titleLen; i++) {
            buffer.currentBuffer.setCell(startX + i, bounds.y, {
              char: title[i],
              ...cellStyle
            });
          }
        }
      }
    }
  }

  /**
   * Prevent adding children - separators are leaf elements
   */
  appendChild(): void {
    throw new Error('Separator elements cannot have children');
  }

  /**
   * Validate separator props
   */
  static validate(props: SeparatorProps): boolean {
    if (props.label !== undefined && typeof props.label !== 'string') {
      return false;
    }
    return true;
  }
}

// Register separator component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const separatorSchema: ComponentSchema = {
  description: 'Horizontal or vertical line with optional centered label. Orientation is automatic based on parent flex-direction.',
  props: {
    label: { type: 'string', description: 'Optional text centered in the line' },
  },
};

registerComponentSchema('separator', separatorSchema);

registerComponent({
  type: 'separator',
  componentClass: SeparatorElement,
  defaultProps: {},
  validate: (props) => SeparatorElement.validate(props as any),
});
