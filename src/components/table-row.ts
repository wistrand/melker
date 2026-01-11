// Table row component (tr) implementation

import { Element, BaseProps, Renderable, IntrinsicSizeContext, Bounds, ComponentRenderContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { TableCellElement } from './table-cell.ts';

export interface TableRowProps extends BaseProps {
  'data-id'?: string;
  selected?: boolean;
}

export class TableRowElement extends Element implements Renderable {
  declare type: 'tr';
  declare props: TableRowProps;

  constructor(props: TableRowProps = {}, children: Element[] = []) {
    super('tr', props, children);
  }

  /**
   * Get the data-id for selection
   */
  getDataId(): string | undefined {
    return this.props['data-id'];
  }

  /**
   * Check if row is selected
   */
  isSelected(): boolean {
    return this.props.selected === true;
  }

  /**
   * Set selected state
   */
  setSelected(selected: boolean): void {
    this.props.selected = selected;
  }

  /**
   * Get all cells in this row
   */
  getCells(): TableCellElement[] {
    if (!this.children) return [];
    return this.children.filter(
      (child): child is TableCellElement =>
        child instanceof TableCellElement || child.type === 'td' || child.type === 'th'
    );
  }

  /**
   * Get cell at index (accounting for colspan)
   */
  getCellAtIndex(index: number): TableCellElement | undefined {
    const cells = this.getCells();
    let currentIndex = 0;

    for (const cell of cells) {
      const colspan = cell.getColspan();
      if (index >= currentIndex && index < currentIndex + colspan) {
        return cell;
      }
      currentIndex += colspan;
    }

    return undefined;
  }

  /**
   * Get the total column count (accounting for colspan)
   */
  getColumnCount(): number {
    const cells = this.getCells();
    return cells.reduce((sum, cell) => sum + cell.getColspan(), 0);
  }

  /**
   * Render the row
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Row rendering is handled by the table component
  }

  /**
   * Calculate intrinsic size
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    if (!this.children || this.children.length === 0) {
      return { width: 0, height: 1 };
    }

    let totalWidth = 0;
    let maxHeight = 1;

    // Iterate directly over children instead of getCells() to avoid array allocation
    for (const child of this.children) {
      // Only process td/th cells
      if (child.type !== 'td' && child.type !== 'th') continue;

      // Fast path: if cell has single text child, calculate directly
      if (child.children && child.children.length === 1) {
        const textChild = child.children[0];
        if (textChild.type === 'text' && textChild.props.text !== undefined) {
          const text = String(textChild.props.text);
          if (!text.includes('\n')) {
            totalWidth += Math.max(1, text.length);
            continue; // height is 1, maxHeight already 1
          }
        }
      }

      // Fall back to intrinsicSize for complex cells
      if ('intrinsicSize' in child && typeof child.intrinsicSize === 'function') {
        const size = child.intrinsicSize(context);
        totalWidth += size.width;
        maxHeight = Math.max(maxHeight, size.height);
      }
    }

    return { width: totalWidth, height: maxHeight };
  }
}

// Factory function
export function createTr(props: TableRowProps = {}, children: Element[] = []): TableRowElement {
  return new TableRowElement(props, children);
}

// Register component
registerComponent({
  type: 'tr',
  componentClass: TableRowElement as any,
  defaultProps: {},
});

// Lint schema
export const trSchema: ComponentSchema = {
  description: 'Table row',
  props: {
    'data-id': { type: 'string', description: 'Unique row identifier for selection' },
    selected: { type: 'boolean', description: 'Whether row is selected' },
  },
};

registerComponentSchema('tr', trSchema);
