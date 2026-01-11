// Table cell component (td/th) implementation

import { Element, BaseProps, Renderable, IntrinsicSizeContext, Bounds, ComponentRenderContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export interface TableCellProps extends BaseProps {
  colspan?: number;
  rowspan?: number;
  align?: 'left' | 'center' | 'right';
  valign?: 'top' | 'center' | 'bottom';
  // For th elements
  sortable?: boolean;
  onCompare?: (a: string, b: string) => number;
  // Explicit column width hint (avoids expensive intrinsic size calculation)
  // - number: fixed character width (content only, padding added automatically)
  // - 'fill': take remaining space after fixed/percentage columns
  // - 'NN%': percentage of available table width
  // Note: named 'colWidth' to avoid conflict with inherited 'width' from LayoutProps
  colWidth?: number | 'fill' | `${number}%`;
}

export class TableCellElement extends Element implements Renderable {
  declare type: 'td' | 'th';
  declare props: TableCellProps;

  constructor(type: 'td' | 'th', props: TableCellProps = {}, children: Element[] = []) {
    const defaultProps: TableCellProps = {
      colspan: 1,
      rowspan: 1,
      align: 'left',
      valign: 'top',
      ...props,
    };
    super(type, defaultProps, children);
  }

  /**
   * Check if this is a header cell
   */
  isHeader(): boolean {
    return this.type === 'th';
  }

  /**
   * Get the colspan value
   */
  getColspan(): number {
    return this.props.colspan || 1;
  }

  /**
   * Get the rowspan value
   */
  getRowspan(): number {
    return this.props.rowspan || 1;
  }

  /**
   * Get explicit column width if set
   * Falls back to style.width if colWidth is not set, allowing percentage widths via style
   */
  getColWidth(): number | 'fill' | `${number}%` | undefined {
    // Explicit colWidth takes precedence
    if (this.props.colWidth !== undefined) {
      return this.props.colWidth;
    }
    // Fall back to style.width for percentage/fill support
    const styleWidth = this.props.style?.width;
    if (styleWidth === 'fill' || typeof styleWidth === 'number') {
      return styleWidth;
    }
    if (typeof styleWidth === 'string' && styleWidth.endsWith('%')) {
      return styleWidth as `${number}%`;
    }
    return undefined;
  }

  /**
   * Render the cell content
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Cell rendering is handled by the table component
    // This satisfies the Renderable interface
  }

  /**
   * Calculate intrinsic size based on content
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    if (!this.children || this.children.length === 0) {
      return { width: 1, height: 1 };
    }

    // Fast path: single text child (most common case for table cells)
    if (this.children.length === 1) {
      const child = this.children[0];
      if (child.type === 'text' && child.props.text !== undefined) {
        const text = String(child.props.text);
        // Simple single-line text
        if (!text.includes('\n')) {
          return { width: Math.max(1, text.length), height: 1 };
        }
      }
    }

    let maxWidth = 0;
    let totalHeight = 0;

    for (const child of this.children) {
      // Fast path for text elements (avoid 'in' operator overhead)
      if (child.type === 'text' && child.props.text !== undefined) {
        const text = String(child.props.text);
        maxWidth = Math.max(maxWidth, text.length);
        totalHeight += 1;
      } else if ('intrinsicSize' in child && typeof child.intrinsicSize === 'function') {
        const size = child.intrinsicSize(context);
        maxWidth = Math.max(maxWidth, size.width);
        totalHeight += size.height;
      }
    }

    return { width: Math.max(1, maxWidth), height: Math.max(1, totalHeight) };
  }

  /**
   * Get text content for sorting
   */
  getTextContent(): string {
    if (!this.children || this.children.length === 0) {
      return '';
    }

    const texts: string[] = [];
    for (const child of this.children) {
      if (child.type === 'text' && child.props.text) {
        texts.push(String(child.props.text));
      } else if ('getTextContent' in child && typeof child.getTextContent === 'function') {
        texts.push((child as any).getTextContent());
      }
    }
    return texts.join('');
  }
}

// Wrapper classes for proper createElement registration
class TdElement extends TableCellElement {
  constructor(props: TableCellProps = {}, children: Element[] = []) {
    super('td', props, children);
  }
}

class ThElement extends TableCellElement {
  constructor(props: TableCellProps = {}, children: Element[] = []) {
    super('th', props, children);
  }
}

// Factory functions
export function createTd(props: TableCellProps = {}, children: Element[] = []): TableCellElement {
  return new TdElement(props, children);
}

export function createTh(props: TableCellProps = {}, children: Element[] = []): TableCellElement {
  return new ThElement(props, children);
}

// Register components
registerComponent({
  type: 'td',
  componentClass: TdElement as any,
  defaultProps: { colspan: 1, rowspan: 1, align: 'left', valign: 'top' },
});

registerComponent({
  type: 'th',
  componentClass: ThElement as any,
  defaultProps: { colspan: 1, rowspan: 1, align: 'left', valign: 'top' },
});

// Lint schemas
const cellSchema: ComponentSchema = {
  description: 'Table cell',
  props: {
    colspan: { type: 'number', description: 'Number of columns to span' },
    rowspan: { type: 'number', description: 'Number of rows to span' },
    align: { type: 'string', enum: ['left', 'center', 'right'], description: 'Horizontal alignment' },
    valign: { type: 'string', enum: ['top', 'center', 'bottom'], description: 'Vertical alignment' },
    colWidth: { type: ['number', 'string'], description: 'Explicit column width (number, "NN%" percentage, or "fill" for remaining space)' },
  },
};

const thSchema: ComponentSchema = {
  ...cellSchema,
  description: 'Table header cell',
  props: {
    ...cellSchema.props,
    sortable: { type: 'boolean', description: 'Enable sorting by this column' },
    onCompare: { type: 'function', description: 'Custom comparison function for sorting' },
  },
};

registerComponentSchema('td', cellSchema);
registerComponentSchema('th', thSchema);
