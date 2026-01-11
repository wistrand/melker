// Table section components (thead, tbody, tfoot) implementation

import { Element, BaseProps, Renderable, IntrinsicSizeContext, Bounds, ComponentRenderContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { TableRowElement } from './table-row.ts';
import { ContainerElement, ContainerProps } from './container.ts';

export type TableSectionType = 'thead' | 'tbody' | 'tfoot';

export type TableSelectionMode = 'none' | 'single' | 'multi';

export interface SelectEvent {
  type: 'select';
  selectedIds: string[];
  rowId: string;
  action: 'add' | 'remove' | 'replace';
}

export interface ActivateEvent {
  type: 'activate';
  rowId: string;
}

export interface TableSectionProps extends ContainerProps {
  // For tbody
  maxHeight?: number;
  selectable?: TableSelectionMode;
  onSelect?: (event: SelectEvent) => void;
  onActivate?: (event: ActivateEvent) => void;
}

export class TableSectionElement extends ContainerElement implements Renderable {
  declare type: TableSectionType;
  declare props: TableSectionProps;

  // Internal state for selection
  private _selectedIds: Set<string> = new Set();
  private _focusedRowIndex: number = -1;

  // Actual content dimensions set by table during render (for scroll calculations)
  private _actualContentHeight: number = 0;
  private _actualViewportHeight: number = 0;
  private _actualBounds: { x: number; y: number; width: number; height: number } | null = null;

  constructor(type: TableSectionType, props: TableSectionProps = {}, children: Element[] = []) {
    const defaultProps: TableSectionProps = {
      scrollable: false,
      selectable: 'none',
      scrollY: 0,
      scrollX: 0,
      ...props,
    };
    // Call ContainerElement constructor, then override the type
    super(defaultProps, children);
    this.type = type;
  }

  /**
   * Get all rows in this section
   */
  getRows(): TableRowElement[] {
    if (!this.children) return [];
    return this.children.filter(
      (child): child is TableRowElement =>
        child instanceof TableRowElement || child.type === 'tr'
    );
  }

  /**
   * Get row by data-id
   */
  getRowById(id: string): TableRowElement | undefined {
    return this.getRows().find(row => row.getDataId() === id);
  }

  /**
   * Get selected row IDs
   */
  getSelectedIds(): string[] {
    return Array.from(this._selectedIds);
  }

  /**
   * Set selected row IDs
   */
  setSelectedIds(ids: string[]): void {
    this._selectedIds = new Set(ids);
    this._updateRowSelectionState();
  }

  /**
   * Clear selection
   */
  clearSelection(): void {
    this._selectedIds.clear();
    this._updateRowSelectionState();
  }

  /**
   * Select a row
   */
  selectRow(id: string, mode: 'replace' | 'add' | 'toggle' = 'replace'): void {
    const selectable = this.props.selectable || 'none';
    if (selectable === 'none') return;

    let action: 'add' | 'remove' | 'replace' = 'replace';

    if (mode === 'replace') {
      this._selectedIds.clear();
      this._selectedIds.add(id);
      action = 'replace';
    } else if (mode === 'add') {
      if (selectable === 'single') {
        this._selectedIds.clear();
      }
      this._selectedIds.add(id);
      action = 'add';
    } else if (mode === 'toggle') {
      if (this._selectedIds.has(id)) {
        this._selectedIds.delete(id);
        action = 'remove';
      } else {
        if (selectable === 'single') {
          this._selectedIds.clear();
        }
        this._selectedIds.add(id);
        action = 'add';
      }
    }

    this._updateRowSelectionState();

    // Fire event
    if (this.props.onSelect) {
      this.props.onSelect({
        type: 'select',
        selectedIds: this.getSelectedIds(),
        rowId: id,
        action,
      });
    }
  }

  /**
   * Activate a row (double-click or Enter)
   */
  activateRow(id: string): void {
    if (this.props.onActivate) {
      this.props.onActivate({
        type: 'activate',
        rowId: id,
      });
    }
  }

  /**
   * Update row selected props based on internal state
   */
  private _updateRowSelectionState(): void {
    for (const row of this.getRows()) {
      const id = row.getDataId();
      if (id) {
        row.setSelected(this._selectedIds.has(id));
      }
    }
  }

  /**
   * Get focused row index
   */
  getFocusedRowIndex(): number {
    return this._focusedRowIndex;
  }

  /**
   * Set focused row index
   */
  setFocusedRowIndex(index: number): void {
    this._focusedRowIndex = index;
  }

  /**
   * Get actual content height (set by table during render)
   */
  getActualContentHeight(): number {
    return this._actualContentHeight;
  }

  /**
   * Set actual content height (called by table during render)
   */
  setActualContentHeight(height: number): void {
    this._actualContentHeight = height;
  }

  /**
   * Get actual viewport height (set by table during render)
   */
  getActualViewportHeight(): number {
    return this._actualViewportHeight;
  }

  /**
   * Set actual viewport height (called by table during render)
   */
  setActualViewportHeight(height: number): void {
    this._actualViewportHeight = height;
  }

  /**
   * Get actual rendered bounds (set by table during render)
   */
  getActualBounds(): { x: number; y: number; width: number; height: number } | null {
    return this._actualBounds;
  }

  /**
   * Set actual rendered bounds (called by table during render)
   */
  setActualBounds(bounds: { x: number; y: number; width: number; height: number }): void {
    this._actualBounds = bounds;
  }

  /**
   * Render the section
   */
  override render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Section rendering is handled by the table component
  }

  /**
   * Calculate intrinsic size
   */
  override intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const rows = this.getRows();
    if (rows.length === 0) {
      return { width: 0, height: 0 };
    }

    let maxWidth = 0;
    let totalHeight = 0;

    for (const row of rows) {
      const size = row.intrinsicSize(context);
      maxWidth = Math.max(maxWidth, size.width);
      totalHeight += size.height;
    }

    // For scrollable tbody, cap height at maxHeight
    if (this.type === 'tbody' && this.props.scrollable && this.props.maxHeight) {
      totalHeight = Math.min(totalHeight, this.props.maxHeight);
    }

    return { width: maxWidth, height: totalHeight };
  }
}

// Wrapper classes for proper createElement registration
class TheadElement extends TableSectionElement {
  constructor(props: TableSectionProps = {}, children: Element[] = []) {
    super('thead', props, children);
  }
}

class TbodyElement extends TableSectionElement {
  constructor(props: TableSectionProps = {}, children: Element[] = []) {
    super('tbody', props, children);
  }
}

class TfootElement extends TableSectionElement {
  constructor(props: TableSectionProps = {}, children: Element[] = []) {
    super('tfoot', props, children);
  }
}

// Factory functions
export function createThead(props: TableSectionProps = {}, children: Element[] = []): TableSectionElement {
  return new TheadElement(props, children);
}

export function createTbody(props: TableSectionProps = {}, children: Element[] = []): TableSectionElement {
  return new TbodyElement(props, children);
}

export function createTfoot(props: TableSectionProps = {}, children: Element[] = []): TableSectionElement {
  return new TfootElement(props, children);
}

// Register components
registerComponent({
  type: 'thead',
  componentClass: TheadElement as any,
  defaultProps: {},
});

registerComponent({
  type: 'tbody',
  componentClass: TbodyElement as any,
  defaultProps: { scrollable: false, selectable: 'none', scrollY: 0 },
});

registerComponent({
  type: 'tfoot',
  componentClass: TfootElement as any,
  defaultProps: {},
});

// Lint schemas
const theadSchema: ComponentSchema = {
  description: 'Table header section',
  props: {},
};

const tbodySchema: ComponentSchema = {
  description: 'Table body section',
  props: {
    scrollable: { type: 'boolean', description: 'Enable scrolling' },
    maxHeight: { type: 'number', description: 'Maximum visible rows when scrollable' },
    selectable: { type: 'string', enum: ['none', 'single', 'multi'], description: 'Row selection mode' },
    onSelect: { type: 'function', description: 'Selection change handler' },
    onActivate: { type: 'function', description: 'Row activation handler (double-click or Enter)' },
  },
};

const tfootSchema: ComponentSchema = {
  description: 'Table footer section',
  props: {},
};

registerComponentSchema('thead', theadSchema);
registerComponentSchema('tbody', tbodySchema);
registerComponentSchema('tfoot', tfootSchema);
