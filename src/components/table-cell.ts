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

    let maxWidth = 0;
    let totalHeight = 0;

    for (const child of this.children) {
      if ('intrinsicSize' in child && typeof child.intrinsicSize === 'function') {
        const size = child.intrinsicSize(context);
        maxWidth = Math.max(maxWidth, size.width);
        totalHeight += size.height;
      } else if (child.type === 'text' && child.props.text) {
        const text = String(child.props.text);
        maxWidth = Math.max(maxWidth, text.length);
        totalHeight += 1;
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
