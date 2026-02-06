// Split pane component implementation

import { Element, BaseProps, Style, Renderable, Focusable, Interactive, Draggable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { ViewportDualBuffer } from '../viewport-buffer.ts';
import { getThemeColor } from '../theme.ts';
import { getLogger } from '../logging.ts';
import { SeparatorElement } from './separator.ts';

const logger = getLogger('split-pane');

export interface SplitPaneResizeEvent {
  type: 'resize';
  sizes: number[];
  dividerIndex: number;
  targetId: string;
}

export interface SplitPaneProps extends BaseProps {
  sizes?: number[] | string;
  dividerTitles?: string[] | string;
  onResize?: (event: SplitPaneResizeEvent) => void;
}

// Internal divider element — subclasses SeparatorElement for line/label rendering,
// adds Focusable/Interactive/Draggable for split-pane resize interaction.
export class SplitPaneDivider extends SeparatorElement implements Focusable, Interactive, Draggable {
  private _splitPane: SplitPaneElement;
  private _dividerIndex: number;
  private _lastBounds: Bounds | null = null;
  private _dragging: boolean = false;

  constructor(splitPane: SplitPaneElement, dividerIndex: number, title?: string) {
    super({ label: title, tabIndex: 0 }, [], 'split-pane-divider');
    this._splitPane = splitPane;
    this._dividerIndex = dividerIndex;
  }

  // intrinsicSize inherited from SeparatorElement — detects orientation from parent flex-direction

  override render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer | ViewportDualBuffer, context: ComponentRenderContext): void {
    this._lastBounds = bounds;
    const direction = this._splitPane._getDirection();

    // Sync parent's divider styling into separator props before delegating
    const parentStyle = this._splitPane.props.style;
    const dividerStyleName = parentStyle?.dividerStyle || 'thin';
    const dividerColor = parentStyle?.dividerColor;

    this.props.style = {
      ...this.props.style,
      borderStyle: dividerStyleName as any,
      color: dividerColor,
    };

    // Default to theme border color when no explicit dividerColor
    if (dividerColor === undefined) {
      const borderColor = getThemeColor('border');
      if (borderColor !== undefined) {
        style = { ...style, foreground: borderColor };
      }
    }

    // Focus highlight
    if (context.focusedElementId === this.id) {
      style = { ...style, reverse: true };
    }

    // Clear full bounds so inset padding cells and stale focus-inverted cells
    // don't persist across redraws
    const buf = buffer as DualBuffer;
      if (direction === 'horizontal') {
      for (let y = 0; y < bounds.height; y++) {
        buf.currentBuffer.setText(bounds.x, bounds.y + y, ' ', style);
      }
    } else {
      for (let x = 0; x < bounds.width; x++) {
        buf.currentBuffer.setText(bounds.x + x, bounds.y, ' ', style);
      }
    }
    // Inset divider by 1 char at each end along its length
    const paddedBounds = { ...bounds };
    if (direction === 'horizontal' && bounds.height > 2) {
      paddedBounds.y += 1;
      paddedBounds.height -= 2;
    } else if (direction === 'vertical' && bounds.width > 2) {
      paddedBounds.x += 1;
      paddedBounds.width -= 2;
    }
    super.render(paddedBounds, style, buf, context);
  }

  canReceiveFocus(): boolean {
    return true;
  }

  isInteractive(): boolean {
    return true;
  }

  handleKeyInput(key: string, _ctrlKey: boolean = false, _altKey: boolean = false): boolean {
    const direction = this._splitPane._getDirection();

    if (direction === 'horizontal') {
      if (key === 'ArrowLeft') {
        return this._splitPane._handleDividerKeyboardMove(this._dividerIndex, -1);
      } else if (key === 'ArrowRight') {
        return this._splitPane._handleDividerKeyboardMove(this._dividerIndex, 1);
      }
    } else {
      if (key === 'ArrowUp') {
        return this._splitPane._handleDividerKeyboardMove(this._dividerIndex, -1);
      } else if (key === 'ArrowDown') {
        return this._splitPane._handleDividerKeyboardMove(this._dividerIndex, 1);
      }
    }

    return false;
  }

  // Draggable interface

  getDragZone(x: number, y: number): string | null {
    if (!this._lastBounds) return null;
    const b = this._lastBounds;
    if (x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height) {
      return 'divider';
    }
    return null;
  }

  handleDragStart(_zone: string, x: number, y: number): void {
    this._dragging = true;
    this._splitPane._handleDividerDrag(this._dividerIndex, x, y);
  }

  handleDragMove(_zone: string, x: number, y: number): void {
    if (!this._dragging) return;
    this._splitPane._handleDividerDrag(this._dividerIndex, x, y);
  }

  handleDragEnd(_zone: string, _x: number, _y: number): void {
    this._dragging = false;
  }
}

export class SplitPaneElement extends Element implements Renderable {
  declare type: 'split-pane';
  declare props: SplitPaneProps;

  private _normalizedSizes: number[] = [];
  private _dividers: SplitPaneDivider[] = [];
  private _paneChildren: Element[] = [];
  private _lastBounds: Bounds | null = null;
  private _lastDirection: 'horizontal' | 'vertical' = 'horizontal';

  // Style prop accessors — read from this.props.style with fallbacks.
  // Props flow into style at construction time; style wins over prop.
  _getDirection(): 'horizontal' | 'vertical' {
    return (this.props.style as Style | undefined)?.direction || 'horizontal';
  }

  _getMinPaneSize(): number {
    const v = (this.props.style as Style | undefined)?.minPaneSize;
    return (v !== undefined && typeof v === 'number' && v >= 1) ? v : 3;
  }

  constructor(props: SplitPaneProps, children: Element[] = []) {
    const defaultProps: SplitPaneProps = {
      ...props,
      style: {
        display: 'flex',
        flexDirection: 'row',
        ...props.style,
      },
    };

    // Call super first with just the pane children; dividers added after
    super('split-pane', defaultProps, children.slice());

    // Store original pane children
    this._paneChildren = children.slice();

    // Parse divider titles
    const titles = this._parseDividerTitles();

    // Create dividers and interleave into this.children
    const dividers: SplitPaneDivider[] = [];
    const interleaved: Element[] = [];

    for (let i = 0; i < this._paneChildren.length; i++) {
      interleaved.push(this._paneChildren[i]);
      if (i < this._paneChildren.length - 1) {
        const divider = new SplitPaneDivider(this, i, titles[i]);
        dividers.push(divider);
        interleaved.push(divider);
      }
    }

    this.children = interleaved;
    this._dividers = dividers;
    this._lastDirection = this._getDirection();
    this._normalizedSizes = this._parseSizes(this._paneChildren.length);
    this._updateFlexProperties();
  }

  render(bounds: Bounds, _style: Partial<Cell>, _buffer: DualBuffer | ViewportDualBuffer, _context: ComponentRenderContext): void {
    this._lastBounds = bounds;
    // Sync divider flex properties when direction changes (e.g. via @media query)
    const direction = this._getDirection();
    if (direction !== this._lastDirection) {
      this._lastDirection = direction;
      this._updateFlexProperties();
    }
  }

  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    const direction = this._getDirection();
    const minPaneSize = this._getMinPaneSize();
    const paneCount = this._paneChildren.length;
    const dividerCount = this._dividers.length;

    if (paneCount === 0) {
      return { width: 0, height: 0 };
    }

    if (direction === 'horizontal') {
      return {
        width: paneCount * minPaneSize + dividerCount,
        height: 1,
      };
    }
    return {
      width: minPaneSize,
      height: paneCount * minPaneSize + dividerCount,
    };
  }

  _handleDividerDrag(index: number, x: number, y: number): void {
    if (!this._lastBounds || this._paneChildren.length < 2) return;

    const direction = this._getDirection();
    const minPaneSize = this._getMinPaneSize();

    // Total available space minus divider space
    const totalSpace = direction === 'horizontal'
      ? this._lastBounds.width - this._dividers.length
      : this._lastBounds.height - this._dividers.length;

    if (totalSpace <= 0) return;

    // Calculate the position of the drag relative to the split-pane start
    const relPos = direction === 'horizontal'
      ? x - this._lastBounds.x
      : y - this._lastBounds.y;

    // Calculate cumulative space before this divider (panes 0..index)
    // and after (panes index+1..N-1)
    const beforeDividerPanes = index + 1;
    const afterDividerPanes = this._paneChildren.length - beforeDividerPanes;

    // Space consumed by dividers before this one
    const dividersBefore = index;

    // The divider is at position: sum of pane sizes before it + dividers before it
    // We want to set pane sizes such that they fit the new divider position
    const targetBeforeSpace = relPos - dividersBefore;

    // Clamp to minimum sizes
    const minBefore = beforeDividerPanes * minPaneSize;
    const minAfter = afterDividerPanes * minPaneSize;
    const maxBefore = totalSpace - minAfter;

    const clampedBefore = Math.max(minBefore, Math.min(maxBefore, targetBeforeSpace));

    // Distribute the before-space proportionally among panes 0..index
    const oldBeforeTotal = this._normalizedSizes.slice(0, beforeDividerPanes).reduce((a, b) => a + b, 0);
    const oldAfterTotal = this._normalizedSizes.slice(beforeDividerPanes).reduce((a, b) => a + b, 0);

    const newBeforeTotal = clampedBefore / totalSpace;
    const newAfterTotal = 1 - newBeforeTotal;

    // Scale existing proportions within each group
    for (let i = 0; i < beforeDividerPanes; i++) {
      this._normalizedSizes[i] = oldBeforeTotal > 0
        ? (this._normalizedSizes[i] / oldBeforeTotal) * newBeforeTotal
        : newBeforeTotal / beforeDividerPanes;
    }
    for (let i = beforeDividerPanes; i < this._paneChildren.length; i++) {
      this._normalizedSizes[i] = oldAfterTotal > 0
        ? (this._normalizedSizes[i] / oldAfterTotal) * newAfterTotal
        : newAfterTotal / afterDividerPanes;
    }

    this._renormalize();
    this._updateFlexProperties();
    this._requestForceRender();
    this._fireOnResize(index);
  }

  _handleDividerKeyboardMove(index: number, charDelta: number): boolean {
    if (!this._lastBounds || this._paneChildren.length < 2) return false;

    const direction = this._getDirection();
    const minPaneSize = this._getMinPaneSize();

    const totalSpace = direction === 'horizontal'
      ? this._lastBounds.width - this._dividers.length
      : this._lastBounds.height - this._dividers.length;

    if (totalSpace <= 0) return false;

    // Convert char delta to proportion delta
    const proportionDelta = charDelta / totalSpace;

    // Adjust adjacent panes
    const leftIndex = index;
    const rightIndex = index + 1;

    const newLeft = this._normalizedSizes[leftIndex] + proportionDelta;
    const newRight = this._normalizedSizes[rightIndex] - proportionDelta;

    // Check minimum size constraints
    const minProportion = minPaneSize / totalSpace;
    if (newLeft < minProportion || newRight < minProportion) {
      return false;
    }

    this._normalizedSizes[leftIndex] = newLeft;
    this._normalizedSizes[rightIndex] = newRight;

    this._renormalize();
    this._updateFlexProperties();
    this._requestForceRender();
    this._fireOnResize(index);
    return true;
  }

  private _parseDividerTitles(): (string | undefined)[] {
    const raw = this.props.dividerTitles;
    if (!raw) return [];
    if (typeof raw === 'string') {
      return raw.split(',').map(s => s.trim());
    }
    if (Array.isArray(raw)) {
      return raw.map(String);
    }
    return [];
  }

  private _parseSizes(paneCount: number): number[] {
    if (paneCount === 0) return [];

    let sizes: number[] | undefined;
    const rawSizes = this.props.sizes;

    if (rawSizes !== undefined) {
      if (typeof rawSizes === 'string') {
        sizes = rawSizes.split(',').map(s => Number(s.trim())).filter(n => !isNaN(n));
        if (sizes.length === 0) sizes = undefined;
      } else if (Array.isArray(rawSizes)) {
        sizes = rawSizes.map(Number);
      }
    }

    if (!sizes || sizes.length !== paneCount) {
      if (sizes && sizes.length !== paneCount) {
        logger.warn(`sizes array length (${sizes.length}) doesn't match children count (${paneCount}), falling back to equal distribution`);
      }
      sizes = new Array(paneCount).fill(1);
    }

    // Normalize to sum = 1.0
    const total = sizes.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      return new Array(paneCount).fill(1 / paneCount);
    }
    return sizes.map(s => s / total);
  }

  private _renormalize(): void {
    const total = this._normalizedSizes.reduce((a, b) => a + b, 0);
    if (total > 0 && Math.abs(total - 1.0) > 0.0001) {
      this._normalizedSizes = this._normalizedSizes.map(s => s / total);
    }
  }

  private _updateFlexProperties(): void {
    const direction = this._getDirection();

    for (let i = 0; i < this._paneChildren.length; i++) {
      const pane = this._paneChildren[i];
      const size = this._normalizedSizes[i] || (1 / this._paneChildren.length);
      pane.props.style = {
        ...pane.props.style,
        flexGrow: size,
        flexShrink: 1,
        flexBasis: 0,
        // Prevent panes from overflowing
        overflow: pane.props.style?.overflow || 'hidden',
      };
    }

    for (const divider of this._dividers) {
      if (direction === 'horizontal') {
        divider.props.style = {
          ...divider.props.style,
          width: 1,
          height: undefined,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 'auto',
        };
      } else {
        divider.props.style = {
          ...divider.props.style,
          width: undefined,
          height: 1,
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: 'auto',
        };
      }
    }
  }

  private _requestForceRender(): void {
    // Resizing panes changes layout for all children — request a full redraw
    // to avoid stale content from previous positions of dividers and panes.
    globalThis.melkerEngine?.requestForceRender();
  }

  private _fireOnResize(dividerIndex: number): void {
    if (typeof this.props.onResize === 'function') {
      this.props.onResize({
        type: 'resize',
        sizes: [...this._normalizedSizes],
        dividerIndex,
        targetId: this.id,
      });
    }
  }

  static validate(props: SplitPaneProps): boolean {
    const direction = (props.style as Style | undefined)?.direction;
    if (direction !== undefined && !['horizontal', 'vertical'].includes(direction)) {
      return false;
    }
    const minPaneSize = (props.style as Style | undefined)?.minPaneSize;
    if (minPaneSize !== undefined && (typeof minPaneSize !== 'number' || minPaneSize < 1)) {
      return false;
    }
    return true;
  }
}

// Registration
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const splitPaneSchema: ComponentSchema = {
  description: 'Resizable split pane container with draggable dividers',
  props: {
    sizes: { type: 'string', description: 'Comma-separated proportions, e.g. "1,2,1" for 25%/50%/25%' },
    dividerTitles: { type: 'string', description: 'Comma-separated divider titles, e.g. "Nav,Info"' },
    onResize: { type: 'handler', description: 'Called when panes are resized. Event: { sizes: number[], dividerIndex, targetId }' },
  },
};

registerComponentSchema('split-pane', splitPaneSchema);

registerComponent({
  type: 'split-pane',
  componentClass: SplitPaneElement,
  defaultProps: {},
  validate: (props) => SplitPaneElement.validate(props as any),
});
