// Data-driven tree component for hierarchical data display
// Supports expand/collapse, selection, keyboard navigation, multi-column, virtual scrolling

import {
  Element,
  BaseProps,
  Renderable,
  Focusable,
  Clickable,
  Interactive,
  TextSelectable,
  SelectableTextProvider,
  SelectionBounds,
  IntrinsicSizeContext,
  Bounds,
  ComponentRenderContext,
  ClickEvent,
  Style,
  KeyboardElement,
  BORDER_CHARS,
  getBorderChars,
  type BorderStyle,
} from '../types.ts';
import type { KeyPressEvent } from '../events.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { EMPTY_CHAR } from '../buffer.ts';
import type { DataTreeTooltipContext, TooltipProvider } from '../tooltip/types.ts';
import { Wheelable } from '../types.ts';
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { getLogger } from '../logging.ts';
import { renderScrollbar } from './scrollbar.ts';
import { parseColor } from './color-utils.ts';
import { formatValue, truncateText, alignText, type CellValue, parseJsonProps, parseInlineJsonData, boundsContain, isBwMode } from './utils/component-utils.ts';
import { isUnicodeSupported } from '../utils/terminal-detection.ts';
import { ScrollManager } from './utils/scroll-manager.ts';

const logger = getLogger('DataTree');

// ===== Type Definitions =====

export type { CellValue };

export interface TreeNode {
  id?: string;
  label: string;
  value?: CellValue;
  values?: CellValue[];
  icon?: string;
  children?: TreeNode[];
  expanded?: boolean;
  disabled?: boolean;
}

export interface TreeColumn {
  header: string;
  width?: number | `${number}%` | 'fill';
  align?: 'left' | 'center' | 'right';
}

interface FlatNode {
  node: TreeNode;
  depth: number;
  nodeId: string;
  isLastChild: boolean;
  ancestorIsLast: boolean[];
  parentId: string | null;
}

export interface TreeSelectEvent {
  nodeId: string;
  label: string;
  value?: CellValue;
  path: string[];
  selectedNodes: string[];
}

export interface TreeExpandEvent {
  nodeId: string;
  label: string;
  expanded: boolean;
  path: string[];
}

export interface TreeActivateEvent {
  nodeId: string;
  label: string;
  value?: CellValue;
  path: string[];
}

export interface DataTreeProps extends Omit<BaseProps, 'onChange'> {
  nodes: TreeNode[];
  showConnectors?: boolean;
  indent?: number;
  expandAll?: boolean;
  showValues?: boolean;
  border?: BorderStyle;
  columns?: TreeColumn[];
  showColumnBorders?: boolean;
  showHeader?: boolean;
  selectable?: 'none' | 'single' | 'multi';
  selectedNodes?: string[];
  onChange?: (event: TreeSelectEvent) => void;
  onActivate?: (event: TreeActivateEvent) => void;
  onExpand?: (event: TreeExpandEvent) => void;
  onCollapse?: (event: TreeExpandEvent) => void;
}

// ===== Connector Characters =====

// Color/Unicode mode
const CONNECTOR_PIPE = '\u2502';   // |
const CONNECTOR_TEE = '\u251C';    // |-
const CONNECTOR_ELBOW = '\u2514';  // L
const CONNECTOR_DASH = '\u2500';   // -
const ICON_EXPANDED = 'v';
const ICON_COLLAPSED = '>';

// BW/ASCII mode
const CONNECTOR_PIPE_BW = '|';
const CONNECTOR_TEE_BW = '+';
const CONNECTOR_ELBOW_BW = '`';
const CONNECTOR_DASH_BW = '-';

// ===== Connector/Border char types =====

interface ConnectorChars {
  pipe: string;
  tee: string;
  elbow: string;
  dash: string;
}

// ===== DataTreeElement Class =====

export class DataTreeElement extends Element
  implements Renderable, Focusable, Clickable, Interactive, KeyboardElement,
             TextSelectable, SelectableTextProvider, TooltipProvider, Wheelable {
  declare type: 'data-tree';
  declare props: DataTreeProps;

  private _expandedNodes = new Set<string>();
  private _selectedNodes = new Set<string>();
  private _focusedNodeId: string | null = null;
  private _focusedIndex = 0;
  private _flatVisibleNodes: FlatNode[] = [];
  private _nodeBounds = new Map<string, Bounds>();
  private _scroll = new ScrollManager();
  private _columnWidths: number[] = [];
  private _headerCellBounds: Array<{ colIndex: number; bounds: Bounds }> = [];
  private _scrollbarBounds: Bounds | null = null;
  private _bodyBounds: Bounds | null = null;
  private _elementBounds: Bounds | null = null;

  // Double-click detection
  private _lastClickTime = 0;
  private _lastClickNodeId: string | null = null;
  static readonly DOUBLE_CLICK_THRESHOLD_MS = 400;

  constructor(props: DataTreeProps = { nodes: [] }, children: Element[] = []) {
    const defaultProps: DataTreeProps = {
      showConnectors: true,
      indent: 2,
      expandAll: false,
      showValues: false,
      border: 'thin',
      selectable: 'none',
      showHeader: undefined, // auto: true when columns defined
      showColumnBorders: false,
      ...props,
    };
    super('data-tree', defaultProps, children);

    this._parseProps();
    this._parseInlineData();
    this._initExpandedState();

    // Initialize selection from props
    if (this.props.selectedNodes) {
      this._selectedNodes = new Set(this.props.selectedNodes);
    }

    this._rebuildFlatList();
  }

  // ===== Data Parsing =====

  private _parseProps(): void {
    parseJsonProps(this.props as unknown as Record<string, unknown>, ['nodes', 'columns', 'selectedNodes']);
  }

  private _parseInlineData(): void {
    if (!this.children || this.children.length === 0) return;

    const data = parseInlineJsonData(this.children);
    if (data) {
      if (data.nodes && Array.isArray(data.nodes)) {
        this.props.nodes = data.nodes as TreeNode[];
      }
      if (data.columns && Array.isArray(data.columns)) {
        this.props.columns = data.columns as TreeColumn[];
      }
      this.children = [];
    }
  }

  private _initExpandedState(): void {
    const nodes = this.props.nodes;
    if (!nodes || !Array.isArray(nodes)) return;

    if (this.props.expandAll) {
      this._expandAllRecursive(nodes, '');
    } else {
      this._initNodeExpandState(nodes, '');
    }
  }

  private _expandAllRecursive(nodes: TreeNode[], parentPath: string): void {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        const nodeId = this._generateNodeId(node, parentPath);
        this._expandedNodes.add(nodeId);
        this._expandAllRecursive(node.children, nodeId);
      }
    }
  }

  private _initNodeExpandState(nodes: TreeNode[], parentPath: string): void {
    for (const node of nodes) {
      if (node.children && node.children.length > 0) {
        const nodeId = this._generateNodeId(node, parentPath);
        if (node.expanded) {
          this._expandedNodes.add(nodeId);
        }
        this._initNodeExpandState(node.children, nodeId);
      }
    }
  }

  // ===== Node ID Generation =====

  private _generateNodeId(node: TreeNode, parentPath: string): string {
    if (node.id) return node.id;
    return parentPath ? `${parentPath}/${node.label}` : node.label;
  }

  // ===== Flat List Rebuild =====

  private _rebuildFlatList(): void {
    const nodes = this.props.nodes;
    if (!nodes || !Array.isArray(nodes)) {
      this._flatVisibleNodes = [];
      this._scroll.totalLines = 0;
      return;
    }

    // Capture anchor for scroll stability
    const anchorNodeId = this._flatVisibleNodes[this._scroll.scrollY]?.nodeId;
    const focusedId = this._focusedNodeId;

    // Rebuild
    const flat: FlatNode[] = [];
    this._buildFlatRecursive(nodes, 0, '', null, [], flat);
    this._flatVisibleNodes = flat;
    this._scroll.totalLines = flat.length;

    // Restore scroll position
    if (anchorNodeId) {
      const newIndex = flat.findIndex(n => n.nodeId === anchorNodeId);
      if (newIndex >= 0) {
        this._scroll.scrollY = newIndex;
      } else {
        this._scroll.scrollY = Math.min(this._scroll.scrollY, Math.max(0, flat.length - 1));
      }
    }

    // Restore focus
    if (focusedId) {
      const newFocusIndex = flat.findIndex(n => n.nodeId === focusedId);
      if (newFocusIndex >= 0) {
        this._focusedIndex = newFocusIndex;
        this._focusedNodeId = focusedId;
      } else {
        // Focus nearest surviving node
        this._focusedIndex = Math.min(this._focusedIndex, Math.max(0, flat.length - 1));
        this._focusedNodeId = flat[this._focusedIndex]?.nodeId ?? null;
      }
    } else if (flat.length > 0) {
      this._focusedIndex = 0;
      this._focusedNodeId = flat[0].nodeId;
    }

    // Prune stale IDs from selected and expanded sets
    const allNodeIds = new Set<string>();
    this._collectAllNodeIds(nodes, '', allNodeIds);

    for (const id of this._selectedNodes) {
      if (!allNodeIds.has(id)) this._selectedNodes.delete(id);
    }
    for (const id of this._expandedNodes) {
      if (!allNodeIds.has(id)) this._expandedNodes.delete(id);
    }
  }

  private _buildFlatRecursive(
    nodes: TreeNode[],
    depth: number,
    parentPath: string,
    parentId: string | null,
    ancestorIsLast: boolean[],
    out: FlatNode[]
  ): void {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const isLast = i === nodes.length - 1;
      const nodeId = this._generateNodeId(node, parentPath);

      out.push({
        node,
        depth,
        nodeId,
        isLastChild: isLast,
        ancestorIsLast: [...ancestorIsLast],
        parentId,
      });

      if (node.children && node.children.length > 0 && this._expandedNodes.has(nodeId)) {
        this._buildFlatRecursive(
          node.children,
          depth + 1,
          nodeId,
          nodeId,
          [...ancestorIsLast, isLast],
          out
        );
      }
    }
  }

  private _collectAllNodeIds(nodes: TreeNode[], parentPath: string, out: Set<string>): void {
    for (const node of nodes) {
      const nodeId = this._generateNodeId(node, parentPath);
      out.add(nodeId);
      if (node.children) {
        this._collectAllNodeIds(node.children, nodeId, out);
      }
    }
  }

  // ===== Path helpers =====

  private _getNodePath(nodeId: string): string[] {
    const path: string[] = [];
    this._findPathRecursive(this.props.nodes, '', nodeId, path);
    return path;
  }

  private _findPathRecursive(
    nodes: TreeNode[],
    parentPath: string,
    targetId: string,
    path: string[]
  ): boolean {
    for (const node of nodes) {
      const nid = this._generateNodeId(node, parentPath);
      if (nid === targetId) {
        path.push(node.label);
        return true;
      }
      if (node.children) {
        path.push(node.label);
        if (this._findPathRecursive(node.children, nid, targetId, path)) {
          return true;
        }
        path.pop();
      }
    }
    return false;
  }

  // ===== Column Width Calculation =====

  private _calculateColumnWidths(availableWidth: number): number[] {
    const { columns, showColumnBorders } = this.props;
    if (!columns || !Array.isArray(columns) || columns.length === 0) return [];

    // Tree column is implicit first column; total columns = 1 (tree) + columns.length (value cols)
    const totalCols = 1 + columns.length;
    const borderWidth = totalCols + 1; // left border + separators + right border
    const contentWidth = Math.max(0, availableWidth - borderWidth);

    let remainingWidth = contentWidth;
    let fillCount = 0;
    const widths: number[] = [];

    // Tree column defaults to fill
    widths.push(-1);
    fillCount++;

    // Value columns
    for (const col of columns) {
      if (typeof col.width === 'number') {
        widths.push(col.width);
        remainingWidth -= col.width;
      } else if (typeof col.width === 'string' && col.width.endsWith('%')) {
        const pct = parseFloat(col.width) / 100;
        const w = Math.floor(contentWidth * pct);
        widths.push(w);
        remainingWidth -= w;
      } else {
        widths.push(-1);
        fillCount++;
      }
    }

    // Distribute remaining to fill columns
    if (fillCount > 0) {
      const fillWidth = Math.max(1, Math.floor(remainingWidth / fillCount));
      for (let i = 0; i < widths.length; i++) {
        if (widths[i] === -1) {
          widths[i] = fillWidth;
        }
      }
    }

    return widths;
  }

  // ===== Intrinsic Size =====

  intrinsicSize(_context: IntrinsicSizeContext): { width: number; height: number } {
    const nodes = this.props.nodes;
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return { width: 0, height: 0 };
    }

    const indent = this.props.indent ?? 2;
    const hasColumns = this.props.columns && this.props.columns.length > 0;
    const showHeader = this.props.showHeader ?? !!hasColumns;

    // Calculate width from max label + indent
    let maxLabelWidth = 0;
    let maxDepth = 0;
    this._measureLabels(nodes, 0, '', (depth, label) => {
      maxLabelWidth = Math.max(maxLabelWidth, label.length);
      maxDepth = Math.max(maxDepth, depth);
    });

    let width = maxDepth * indent + 2 + maxLabelWidth + 2; // +2 for expand icon, +2 for borders

    if (hasColumns) {
      for (const col of this.props.columns!) {
        if (typeof col.width === 'number') {
          width += col.width + 1; // +1 for separator
        } else {
          width += 10 + 1; // default
        }
      }
    } else if (this.props.showValues) {
      width += 15; // value column
    }

    // Calculate height
    let height = 2; // top + bottom border
    if (showHeader) height += 2; // header + separator
    height += this._flatVisibleNodes.length;

    return { width, height };
  }

  private _measureLabels(
    nodes: TreeNode[],
    depth: number,
    parentPath: string,
    cb: (depth: number, label: string) => void
  ): void {
    for (const node of nodes) {
      cb(depth, node.label);
      if (node.children) {
        const nodeId = this._generateNodeId(node, parentPath);
        this._measureLabels(node.children, depth + 1, nodeId, cb);
      }
    }
  }

  // ===== Tree Prefix Rendering =====

  /**
   * Render the tree prefix (ancestor connectors, node connector, expand icon).
   * Returns the new cursor X position.
   */
  private _renderTreePrefix(
    buffer: DualBuffer,
    flatNode: FlatNode,
    startX: number,
    y: number,
    maxX: number,
    style: Partial<Cell>,
    dimStyle: Partial<Cell>,
    chars: ConnectorChars,
    showConnectors: boolean,
    indent: number,
  ): number {
    let cx = startX;

    // Ancestor connectors
    if (showConnectors) {
      for (let d = 0; d < flatNode.depth; d++) {
        if (cx >= maxX) break;
        if (d < flatNode.ancestorIsLast.length && flatNode.ancestorIsLast[d]) {
          for (let s = 0; s < indent && cx < maxX; s++) {
            buffer.currentBuffer.setCell(cx, y, { char: EMPTY_CHAR, ...style });
            cx++;
          }
        } else {
          buffer.currentBuffer.setCell(cx, y, { char: chars.pipe, ...dimStyle });
          cx++;
          for (let s = 1; s < indent && cx < maxX; s++) {
            buffer.currentBuffer.setCell(cx, y, { char: EMPTY_CHAR, ...style });
            cx++;
          }
        }
      }
    } else if (flatNode.depth > 0) {
      const indentChars = flatNode.depth * indent;
      for (let s = 0; s < indentChars && cx < maxX; s++) {
        buffer.currentBuffer.setCell(cx, y, { char: EMPTY_CHAR, ...style });
        cx++;
      }
    }

    // Node connector
    if (showConnectors && cx < maxX) {
      buffer.currentBuffer.setCell(cx, y, { char: flatNode.isLastChild ? chars.elbow : chars.tee, ...dimStyle });
      cx++;
      if (cx < maxX) {
        buffer.currentBuffer.setCell(cx, y, { char: chars.dash, ...dimStyle });
        cx++;
      }
    }

    // Expand/collapse icon
    const hasChildren = flatNode.node.children && flatNode.node.children.length > 0;
    if (hasChildren && cx < maxX) {
      const isExpanded = this._expandedNodes.has(flatNode.nodeId);
      const icon = isExpanded ? ICON_EXPANDED : ICON_COLLAPSED;
      buffer.currentBuffer.setCell(cx, y, { char: icon, ...dimStyle });
      cx++;
      if (cx < maxX) {
        buffer.currentBuffer.setCell(cx, y, { char: EMPTY_CHAR, ...style });
        cx++;
      }
    } else {
      for (let s = 0; s < 2 && cx < maxX; s++) {
        buffer.currentBuffer.setCell(cx, y, { char: EMPTY_CHAR, ...style });
        cx++;
      }
    }

    return cx;
  }

  // ===== Navigate helper for keyboard =====

  private _navigateTo(index: number): void {
    this._focusedIndex = index;
    this._focusedNodeId = this._flatVisibleNodes[this._focusedIndex]?.nodeId ?? null;
    if ((this.props.selectable ?? 'none') === 'single' && this._focusedNodeId) {
      this._selectNode(this._focusedNodeId, 'replace');
    }
    this._ensureFocusedVisible();
  }

  // ===== Render =====

  render(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext
  ): void {
    const nodes = this.props.nodes;
    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return;
    }

    this.setBounds(bounds);
    this._elementBounds = bounds;
    this._nodeBounds.clear();

    // Re-parse nodes in case they were updated as string
    this._parseProps();
    this._rebuildFlatList();

    const hasColumns = this.props.columns && this.props.columns.length > 0;
    const showHeader = this.props.showHeader ?? !!hasColumns;
    const borderStyle = this.props.border || 'thin';

    // Compute border and connector chars once
    const borderChars = getBorderChars(borderStyle !== 'none' ? borderStyle : 'thin');
    const bw = isBwMode() || !isUnicodeSupported();
    const connChars: ConnectorChars = {
      pipe: bw ? CONNECTOR_PIPE_BW : CONNECTOR_PIPE,
      tee: bw ? CONNECTOR_TEE_BW : CONNECTOR_TEE,
      elbow: bw ? CONNECTOR_ELBOW_BW : CONNECTOR_ELBOW,
      dash: bw ? CONNECTOR_DASH_BW : CONNECTOR_DASH,
    };

    // Compute color overrides from style props
    const rawBorderColor = (this.props.style as Style | undefined)?.borderColor;
    const rawConnectorColor = (this.props.style as Style | undefined)?.connectorColor ?? 'gray';
    const borderColorFg = rawBorderColor ? parseColor(rawBorderColor) : undefined;
    const connectorColorFg = parseColor(rawConnectorColor);
    const borderColorStyle: Partial<Cell> | undefined = borderColorFg != null
      ? { ...style, foreground: borderColorFg } : undefined;
    const connectorColorStyle: Partial<Cell> | undefined = connectorColorFg != null
      ? { ...style, foreground: connectorColorFg, dim: true } : undefined;

    // Terminal edge workaround
    const engine = globalThis.melkerEngine;
    const atTerminalEdge = engine && bounds.x + bounds.width >= engine.terminalSize?.width;
    const effectiveWidth = atTerminalEdge ? bounds.width - 1 : bounds.width;

    const headerHeight = showHeader && hasColumns ? 2 : 0; // header row + separator
    const bodyHeight = Math.max(0, bounds.height - headerHeight - 2); // -2 for top/bottom borders

    // Scroll calculations
    this._scroll.update(this._flatVisibleNodes.length, bodyHeight);

    const needsScrollbar = this._scroll.needsScrollbar;
    const availableWidth = needsScrollbar ? effectiveWidth - 1 : effectiveWidth;

    // Calculate column widths
    if (hasColumns) {
      this._columnWidths = this._calculateColumnWidths(availableWidth);
    } else {
      this._columnWidths = [];
    }

    const totalWidth = effectiveWidth;

    // scrollY already clamped by _scroll.update() above

    // Sync selection from props if controlled
    if (this.props.selectedNodes) {
      this._selectedNodes = new Set(this.props.selectedNodes);
    }

    let y = bounds.y;

    // Draw top border
    const bdrStyle = borderColorStyle ?? style;
    this._drawHorizontalBorder(buffer, bounds.x, y, 'top', bdrStyle, totalWidth, borderChars);
    y++;

    // Render header (multi-column mode only)
    if (showHeader && hasColumns) {
      this._renderHeaderRow(buffer, bounds.x, y, style, totalWidth, bdrStyle, borderChars);
      y++;
      this._drawHorizontalBorder(buffer, bounds.x, y, 'middle', bdrStyle, totalWidth, borderChars);
      y++;
    }

    // Render body
    const bodyStartY = y;
    this._bodyBounds = { x: bounds.x, y: bodyStartY, width: effectiveWidth, height: bodyHeight };

    const { start, end } = this._scroll.getVisibleRange();

    for (let i = start; i < end; i++) {
      const flatNode = this._flatVisibleNodes[i];
      const rowY = bodyStartY + (i - start);

      const isSelected = this._selectedNodes.has(flatNode.nodeId);
      const isFocused = i === this._focusedIndex && context.focusedElementId === this.id;

      let rowStyle = style;
      const highlighted = isSelected || isFocused;
      if (highlighted) {
        rowStyle = { ...style, reverse: true };
      }
      // On highlighted rows, use base style for borders so they match the selection
      const rowBdrStyle = highlighted ? style : bdrStyle;
      const rowConnStyle = highlighted ? undefined : connectorColorStyle;

      if (hasColumns) {
        this._renderMultiColumnRow(buffer, bounds.x, rowY, flatNode, rowStyle, totalWidth, needsScrollbar ? bounds.x + effectiveWidth - 1 : -1, rowBdrStyle, rowConnStyle, borderChars, connChars);
      } else {
        this._renderSingleColumnRow(buffer, bounds.x, rowY, flatNode, rowStyle, totalWidth, rowBdrStyle, rowConnStyle, borderChars, connChars);
      }

      this._nodeBounds.set(flatNode.nodeId, { x: bounds.x, y: rowY, width: effectiveWidth, height: 1 });
    }

    // Draw vertical borders for empty space below data
    const rightBorderX = bounds.x + effectiveWidth - 1;
    for (let emptyY = bodyStartY + (end - start); emptyY < bodyStartY + bodyHeight; emptyY++) {
      buffer.currentBuffer.setCell(bounds.x, emptyY, { char: borderChars.v, ...bdrStyle });
      // Draw column separators in empty rows
      if (hasColumns && this.props.showColumnBorders) {
        let sepX = bounds.x + 1 + (this._columnWidths[0] ?? 0);
        for (let ci = 0; ci < this.props.columns!.length; ci++) {
          buffer.currentBuffer.setCell(sepX, emptyY, { char: borderChars.v, ...bdrStyle });
          sepX += 1 + (this._columnWidths[ci + 1] ?? 0);
        }
      }
      buffer.currentBuffer.setCell(rightBorderX, emptyY, { char: borderChars.v, ...bdrStyle });
    }

    y = bodyStartY + bodyHeight;

    // Draw scrollbar
    if (needsScrollbar) {
      this._scrollbarBounds = { x: bounds.x + effectiveWidth - 1, y: bodyStartY, width: 1, height: bodyHeight };
      renderScrollbar(buffer, bounds.x + effectiveWidth - 1, bodyStartY, bodyHeight, {
        scrollTop: this._scroll.scrollY,
        totalItems: this._scroll.totalLines,
        visibleItems: this._scroll.viewportLines,
        thumbStyle: style,
        trackStyle: style,
      });
    } else {
      this._scrollbarBounds = null;
    }

    // Draw bottom border
    this._drawHorizontalBorder(buffer, bounds.x, y, 'bottom', bdrStyle, totalWidth, borderChars);
  }

  // ===== Single-column row rendering =====

  private _renderSingleColumnRow(
    buffer: DualBuffer,
    x: number,
    y: number,
    flatNode: FlatNode,
    style: Partial<Cell>,
    totalWidth: number,
    borderCellStyle: Partial<Cell>,
    connectorStyle: Partial<Cell> | undefined,
    borderChars: typeof BORDER_CHARS[keyof typeof BORDER_CHARS],
    connChars: ConnectorChars,
  ): void {
    const indent = this.props.indent ?? 2;
    const showConnectors = this.props.showConnectors ?? true;

    // Left border
    buffer.currentBuffer.setCell(x, y, { char: borderChars.v, ...borderCellStyle });

    const contentWidth = totalWidth - 2; // minus borders
    const maxX = x + 1 + contentWidth;
    const dimStyle = connectorStyle ?? { ...style, dim: true };

    // Draw tree prefix (ancestor connectors, node connector, expand icon)
    let cx = this._renderTreePrefix(buffer, flatNode, x + 1, y, maxX, style, dimStyle, connChars, showConnectors, indent);

    // Draw label
    const remainingWidth = maxX - cx;
    if (remainingWidth > 0) {
      let labelText = flatNode.node.label;

      // If showing values in single-column mode, append value
      if (this.props.showValues && flatNode.node.value !== undefined) {
        const valueStr = formatValue(flatNode.node.value);
        const labelArea = Math.max(1, remainingWidth - valueStr.length - 2);
        const truncLabel = truncateText(labelText, labelArea);
        const padded = truncLabel + ' '.repeat(Math.max(0, remainingWidth - truncLabel.length - valueStr.length));
        labelText = padded + valueStr;
      } else {
        labelText = truncateText(labelText, remainingWidth);
      }

      buffer.currentBuffer.setText(cx, y, labelText, style);
      cx += labelText.length;
    }

    // Fill remaining space
    const gap = x + totalWidth - 1 - cx;
    if (gap > 0) {
      buffer.currentBuffer.fillLine(cx, y, gap, style);
    }

    // Right border
    buffer.currentBuffer.setCell(x + totalWidth - 1, y, { char: borderChars.v, ...borderCellStyle });
  }

  // ===== Multi-column row rendering =====

  private _renderMultiColumnRow(
    buffer: DualBuffer,
    x: number,
    y: number,
    flatNode: FlatNode,
    style: Partial<Cell>,
    totalWidth: number,
    scrollbarX: number,
    borderCellStyle: Partial<Cell>,
    connectorStyle: Partial<Cell> | undefined,
    borderChars: typeof BORDER_CHARS[keyof typeof BORDER_CHARS],
    connChars: ConnectorChars,
  ): void {
    const { showColumnBorders } = this.props;
    const indent = this.props.indent ?? 2;
    const showConnectors = this.props.showConnectors ?? true;

    // Left border
    buffer.currentBuffer.setCell(x, y, { char: borderChars.v, ...borderCellStyle });

    let cx = x + 1;

    // Tree column (first column in _columnWidths)
    const treeColWidth = this._columnWidths[0] ?? 20;
    const treeColEnd = cx + treeColWidth;

    // Build tree cell content
    const dimStyle = connectorStyle ?? { ...style, dim: true };

    // Draw tree prefix (ancestor connectors, node connector, expand icon)
    let treeCx = this._renderTreePrefix(buffer, flatNode, cx, y, treeColEnd, style, dimStyle, connChars, showConnectors, indent);

    // Label in remaining tree column space
    const labelSpace = treeColEnd - treeCx;
    if (labelSpace > 0) {
      const label = truncateText(flatNode.node.label, labelSpace);
      buffer.currentBuffer.setText(treeCx, y, label, style);
      treeCx += label.length;
    }

    // Fill remaining tree column space
    if (treeCx < treeColEnd) {
      buffer.currentBuffer.fillLine(treeCx, y, treeColEnd - treeCx, style);
    }
    cx = treeColEnd;

    // Value columns
    const columns = this.props.columns!;
    for (let colIdx = 0; colIdx < columns.length; colIdx++) {
      const col = columns[colIdx];
      const width = this._columnWidths[colIdx + 1] ?? 10;

      // Column separator
      if (showColumnBorders) {
        buffer.currentBuffer.setCell(cx, y, { char: borderChars.v, ...borderCellStyle });
        cx++;
      } else {
        buffer.currentBuffer.setCell(cx, y, { char: EMPTY_CHAR, ...style });
        cx++;
      }

      // Cell value
      const value = flatNode.node.values?.[colIdx] ?? '';
      const text = formatValue(value);
      const displayText = truncateText(text, width);
      const aligned = alignText(displayText, width, col.align || 'left');
      buffer.currentBuffer.setText(cx, y, aligned.substring(0, width), style);
      cx += width;
    }

    // Right border or fill to scrollbar
    if (scrollbarX >= 0) {
      const gap = scrollbarX - cx;
      if (gap > 0) {
        buffer.currentBuffer.fillLine(cx, y, gap, style);
      }
      buffer.currentBuffer.setCell(scrollbarX, y, { char: borderChars.v, ...borderCellStyle });
    } else {
      const rightBorderX = x + totalWidth - 1;
      const gap = rightBorderX - cx;
      if (gap > 0) {
        buffer.currentBuffer.fillLine(cx, y, gap, style);
      }
      buffer.currentBuffer.setCell(rightBorderX, y, { char: borderChars.v, ...borderCellStyle });
    }
  }

  // ===== Header Row (multi-column) =====

  private _renderHeaderRow(
    buffer: DualBuffer,
    x: number,
    y: number,
    style: Partial<Cell>,
    totalWidth: number,
    borderCellStyle: Partial<Cell>,
    borderChars: typeof BORDER_CHARS[keyof typeof BORDER_CHARS],
  ): void {
    const { columns, showColumnBorders } = this.props;
    if (!columns) return;

    const bdrStyle = borderCellStyle ?? style;

    this._headerCellBounds = [];

    // Left border
    buffer.currentBuffer.setCell(x, y, { char: borderChars.v, ...bdrStyle });

    let cellX = x + 1;

    // Tree column header (implicit "Name" header)
    const treeWidth = this._columnWidths[0] ?? 20;
    const treeHeader = alignText('Name', treeWidth, 'left');
    const headerStyle = { ...style, bold: true };
    buffer.currentBuffer.setText(cellX, y, treeHeader.substring(0, treeWidth), headerStyle);
    cellX += treeWidth;

    // Value column headers
    for (let i = 0; i < columns.length; i++) {
      const col = columns[i];
      const width = this._columnWidths[i + 1] ?? 10;

      // Separator
      if (showColumnBorders) {
        buffer.currentBuffer.setCell(cellX, y, { char: borderChars.v, ...bdrStyle });
        cellX++;
      } else {
        buffer.currentBuffer.setCell(cellX, y, { char: EMPTY_CHAR, ...style });
        cellX++;
      }

      this._headerCellBounds.push({
        colIndex: i,
        bounds: { x: cellX, y, width, height: 1 },
      });

      const displayText = truncateText(col.header, width);
      const aligned = alignText(displayText, width, col.align || 'left');
      buffer.currentBuffer.setText(cellX, y, aligned.substring(0, width), headerStyle);
      cellX += width;
    }

    // Fill remaining + right border
    const remaining = x + totalWidth - 1 - cellX;
    if (remaining > 0) {
      buffer.currentBuffer.fillLine(cellX, y, remaining, style);
    }
    buffer.currentBuffer.setCell(x + totalWidth - 1, y, { char: borderChars.v, ...bdrStyle });
  }

  // ===== Border Drawing =====

  private _drawHorizontalBorder(
    buffer: DualBuffer,
    x: number,
    y: number,
    position: 'top' | 'middle' | 'bottom',
    style: Partial<Cell>,
    totalWidth: number,
    borderChars: typeof BORDER_CHARS[keyof typeof BORDER_CHARS],
  ): void {
    const borderStyle = this.props.border || 'thin';
    if (borderStyle === 'none') return;

    const { showColumnBorders } = this.props;

    let leftChar: string, middleChar: string, rightChar: string;
    switch (position) {
      case 'top':
        leftChar = borderChars.tl; middleChar = borderChars.tm; rightChar = borderChars.tr;
        break;
      case 'middle':
        leftChar = borderChars.lm; middleChar = borderChars.mm; rightChar = borderChars.rm;
        break;
      case 'bottom':
        leftChar = borderChars.bl; middleChar = borderChars.bm; rightChar = borderChars.br;
        break;
    }

    buffer.currentBuffer.setCell(x, y, { char: leftChar, ...style });

    let cellX = x + 1;

    // Tree column
    const treeWidth = this._columnWidths[0] ?? totalWidth - 2;
    buffer.currentBuffer.setText(cellX, y, borderChars.h.repeat(treeWidth), style);
    cellX += treeWidth;

    // Value columns
    const columns = this.props.columns;
    if (columns) {
      for (let i = 0; i < columns.length; i++) {
        const width = this._columnWidths[i + 1] ?? 10;

        buffer.currentBuffer.setCell(cellX, y, {
          char: showColumnBorders ? middleChar : borderChars.h,
          ...style,
        });
        cellX++;

        buffer.currentBuffer.setText(cellX, y, borderChars.h.repeat(width), style);
        cellX += width;
      }
    }

    // Fill remaining
    const remainingH = x + totalWidth - 1 - cellX;
    if (remainingH > 0) {
      buffer.currentBuffer.setText(cellX, y, borderChars.h.repeat(remainingH), style);
    }

    buffer.currentBuffer.setCell(x + totalWidth - 1, y, { char: rightChar, ...style });
  }

  // ===== Interface Implementations =====

  canReceiveFocus(): boolean {
    return this.props.selectable !== 'none';
  }

  isInteractive(): boolean {
    return !this.props.disabled;
  }

  handlesOwnKeyboard(): boolean {
    return this.props.selectable !== 'none';
  }

  // ===== Keyboard Handling =====

  onKeyPress(event: KeyPressEvent): boolean {
    const { selectable = 'none' } = this.props;
    if (this._flatVisibleNodes.length === 0) return false;

    switch (event.key) {
      case 'ArrowUp':
        if (this._focusedIndex > 0) {
          this._navigateTo(this._focusedIndex - 1);
        }
        return true;

      case 'ArrowDown':
        if (this._focusedIndex < this._flatVisibleNodes.length - 1) {
          this._navigateTo(this._focusedIndex + 1);
        }
        return true;

      case 'ArrowRight': {
        const focused = this._flatVisibleNodes[this._focusedIndex];
        if (!focused) return false;
        const hasChildren = focused.node.children && focused.node.children.length > 0;
        if (hasChildren) {
          if (!this._expandedNodes.has(focused.nodeId)) {
            this._doExpand(focused.nodeId);
          } else {
            // Move to first child
            if (this._focusedIndex + 1 < this._flatVisibleNodes.length) {
              this._navigateTo(this._focusedIndex + 1);
            }
          }
        }
        return true;
      }

      case 'ArrowLeft': {
        const focused = this._flatVisibleNodes[this._focusedIndex];
        if (!focused) return false;
        const hasChildren = focused.node.children && focused.node.children.length > 0;
        if (hasChildren && this._expandedNodes.has(focused.nodeId)) {
          this._doCollapse(focused.nodeId);
        } else if (focused.parentId) {
          // Move to parent
          const parentIdx = this._flatVisibleNodes.findIndex(n => n.nodeId === focused.parentId);
          if (parentIdx >= 0) {
            this._navigateTo(parentIdx);
          }
        }
        return true;
      }

      case 'Enter': {
        const focused = this._flatVisibleNodes[this._focusedIndex];
        if (!focused) return false;
        const path = this._getNodePath(focused.nodeId);
        this.props.onActivate?.({
          nodeId: focused.nodeId,
          label: focused.node.label,
          value: focused.node.value,
          path,
        });
        return true;
      }

      case ' ': // Space
        if (selectable === 'multi') {
          const focused = this._flatVisibleNodes[this._focusedIndex];
          if (focused) {
            this._selectNode(focused.nodeId, 'toggle');
          }
        } else if (selectable === 'none') {
          // Toggle expand
          const focused = this._flatVisibleNodes[this._focusedIndex];
          if (focused) {
            this._toggleExpand(focused.nodeId);
          }
        }
        return true;

      case 'Home':
        this._navigateTo(0);
        return true;

      case 'End':
        this._navigateTo(this._flatVisibleNodes.length - 1);
        return true;

      case 'PageUp': {
        const pageSize = Math.max(1, this._scroll.viewportLines);
        this._navigateTo(Math.max(0, this._focusedIndex - pageSize));
        return true;
      }

      case 'PageDown': {
        const pageSize = Math.max(1, this._scroll.viewportLines);
        this._navigateTo(Math.min(this._flatVisibleNodes.length - 1, this._focusedIndex + pageSize));
        return true;
      }
    }

    return false;
  }

  private _ensureFocusedVisible(): void {
    this._scroll.ensureVisible(this._focusedIndex);
  }

  // ===== Selection =====

  private _selectNode(nodeId: string, mode: 'replace' | 'add' | 'toggle'): void {
    const { selectable = 'none' } = this.props;
    if (selectable === 'none') return;

    // Find node to check disabled
    const flatNode = this._flatVisibleNodes.find(n => n.nodeId === nodeId);
    if (flatNode?.node.disabled) return;

    if (mode === 'replace' || selectable === 'single') {
      this._selectedNodes.clear();
      this._selectedNodes.add(nodeId);
    } else if (mode === 'add') {
      this._selectedNodes.add(nodeId);
    } else if (mode === 'toggle') {
      if (this._selectedNodes.has(nodeId)) {
        this._selectedNodes.delete(nodeId);
      } else {
        this._selectedNodes.add(nodeId);
      }
    }

    const node = flatNode?.node;
    const path = this._getNodePath(nodeId);
    this.props.onChange?.({
      nodeId,
      label: node?.label ?? '',
      value: node?.value,
      path,
      selectedNodes: [...this._selectedNodes],
    });
  }

  // ===== Expand/Collapse =====

  private _doExpand(nodeId: string): void {
    this._expandedNodes.add(nodeId);
    this._rebuildFlatList();

    const node = this._flatVisibleNodes.find(n => n.nodeId === nodeId)?.node;
    const path = this._getNodePath(nodeId);
    this.props.onExpand?.({
      nodeId,
      label: node?.label ?? '',
      expanded: true,
      path,
    });
  }

  private _doCollapse(nodeId: string): void {
    this._expandedNodes.delete(nodeId);

    // If focused node is a descendant of collapsed node, move focus to collapsed node
    if (this._focusedNodeId && this._focusedNodeId !== nodeId) {
      const focusedPath = this._getNodePath(this._focusedNodeId);
      const collapsedPath = this._getNodePath(nodeId);
      // Check if focused node is descendant
      if (focusedPath.length > collapsedPath.length) {
        let isDescendant = true;
        for (let i = 0; i < collapsedPath.length; i++) {
          if (focusedPath[i] !== collapsedPath[i]) {
            isDescendant = false;
            break;
          }
        }
        if (isDescendant) {
          this._focusedNodeId = nodeId;
        }
      }
    }

    this._rebuildFlatList();

    const node = this._flatVisibleNodes.find(n => n.nodeId === nodeId)?.node;
    const path = this._getNodePath(nodeId);
    this.props.onCollapse?.({
      nodeId,
      label: node?.label ?? '',
      expanded: false,
      path,
    });
  }

  private _toggleExpand(nodeId: string): void {
    if (this._expandedNodes.has(nodeId)) {
      this._doCollapse(nodeId);
    } else {
      this._doExpand(nodeId);
    }
  }

  // ===== Click Handling =====

  handleClick(event: ClickEvent, _document: unknown): boolean {
    const { x, y } = event.position;
    const { selectable = 'none' } = this.props;
    const indent = this.props.indent ?? 2;
    const showConnectors = this.props.showConnectors ?? true;

    const currentTime = Date.now();

    // Check node row clicks
    for (const [nodeId, bounds] of this._nodeBounds) {
      if (boundsContain(x, y, bounds)) {
        const flatNode = this._flatVisibleNodes.find(n => n.nodeId === nodeId);
        if (!flatNode) continue;

        // Calculate the expand icon position
        const leftBorder = 1;
        let iconX = bounds.x + leftBorder;
        if (showConnectors && flatNode.depth > 0) {
          iconX += flatNode.depth * indent + 2; // indent + connector chars
        } else {
          iconX += flatNode.depth * indent;
        }

        const hasChildren = flatNode.node.children && flatNode.node.children.length > 0;

        // Check for double-click
        const timeSinceLastClick = currentTime - this._lastClickTime;
        const isDoubleClick = (
          this._lastClickNodeId === nodeId &&
          timeSinceLastClick < DataTreeElement.DOUBLE_CLICK_THRESHOLD_MS
        );

        if (isDoubleClick) {
          // Double-click: activate
          const path = this._getNodePath(nodeId);
          this.props.onActivate?.({
            nodeId,
            label: flatNode.node.label,
            value: flatNode.node.value,
            path,
          });
          this._lastClickTime = 0;
          this._lastClickNodeId = null;
        } else {
          // Click on expand icon area
          if (hasChildren && x === iconX) {
            this._toggleExpand(nodeId);
          } else if (selectable !== 'none') {
            // Update focus
            const idx = this._flatVisibleNodes.findIndex(n => n.nodeId === nodeId);
            if (idx >= 0) {
              this._focusedIndex = idx;
              this._focusedNodeId = nodeId;
            }
            this._selectNode(nodeId, selectable === 'single' ? 'replace' : 'toggle');
          } else if (hasChildren) {
            // No selection mode: clicking anywhere toggles expand
            this._toggleExpand(nodeId);
          }
          this._lastClickTime = currentTime;
          this._lastClickNodeId = nodeId;
        }

        return true;
      }
    }

    // Check scrollbar clicks
    if (this._scrollbarBounds) {
      const sb = this._scrollbarBounds;
      if (boundsContain(x, y, sb)) {
        const clickRatio = (y - sb.y) / sb.height;
        this._scroll.scrollToRatio(clickRatio);
        return true;
      }
    }

    return false;
  }

  // ===== Wheel Handling =====

  canHandleWheel(x: number, y: number): boolean {
    if (!this._bodyBounds) return false;
    return boundsContain(x, y, this._bodyBounds);
  }

  handleWheel(deltaX: number, deltaY: number): boolean {
    return this._scroll.handleWheel(deltaY);
  }

  // ===== Public API =====

  getValue(): TreeNode[] {
    return this.props.nodes;
  }

  setValue(nodes: TreeNode[]): void {
    this.props.nodes = nodes;
    this._rebuildFlatList();
  }

  expandNode(nodeId: string): void {
    this._doExpand(nodeId);
  }

  collapseNode(nodeId: string): void {
    this._doCollapse(nodeId);
  }

  expandAll(): void {
    this._expandedNodes.clear();
    this._expandAllRecursive(this.props.nodes, '');
    this._scroll.scrollY = 0;
    this._rebuildFlatList();
  }

  collapseAll(): void {
    this._expandedNodes.clear();
    this._scroll.scrollY = 0;
    this._focusedIndex = 0;
    this._focusedNodeId = this._flatVisibleNodes[0]?.nodeId ?? null;
    this._rebuildFlatList();
  }

  toggleNode(nodeId: string): void {
    this._toggleExpand(nodeId);
  }

  setChildren(nodeId: string, children: TreeNode[]): void {
    const found = this._findNodeById(this.props.nodes, '', nodeId);
    if (found) {
      found.children = children;
      this._rebuildFlatList();
    }
  }

  private _findNodeById(nodes: TreeNode[], parentPath: string, targetId: string): TreeNode | null {
    for (const node of nodes) {
      const nid = this._generateNodeId(node, parentPath);
      if (nid === targetId) return node;
      if (node.children) {
        const found = this._findNodeById(node.children, nid, targetId);
        if (found) return found;
      }
    }
    return null;
  }

  getSelectedNodes(): string[] {
    return [...this._selectedNodes];
  }

  scrollToNode(nodeId: string): void {
    const idx = this._flatVisibleNodes.findIndex(n => n.nodeId === nodeId);
    if (idx >= 0) {
      this._focusedIndex = idx;
      this._focusedNodeId = nodeId;
      this._ensureFocusedVisible();
    }
  }

  // ===== Tooltip =====

  getTooltipContext(relX: number, relY: number): DataTreeTooltipContext | undefined {
    const bounds = this.getBounds();
    if (!bounds) return undefined;

    const screenX = bounds.x + relX;
    const screenY = bounds.y + relY;

    for (const [nodeId, b] of this._nodeBounds) {
      if (boundsContain(screenX, screenY, b)) {
        const flatNode = this._flatVisibleNodes.find(n => n.nodeId === nodeId);
        if (!flatNode) continue;

        return {
          type: 'data-tree',
          nodeId,
          label: flatNode.node.label,
          value: flatNode.node.value,
          values: flatNode.node.values,
          path: this._getNodePath(nodeId),
          depth: flatNode.depth,
          isExpanded: this._expandedNodes.has(nodeId),
          hasChildren: !!(flatNode.node.children && flatNode.node.children.length > 0),
        };
      }
    }

    return undefined;
  }

  getDefaultTooltip(context: DataTreeTooltipContext): string | undefined {
    if (context.type !== 'data-tree') return undefined;
    const { path, label, value, values } = context;

    // Path as header
    const pathStr = path.join(' / ');
    let tooltip = `**${pathStr}**`;

    // Show value (single-column) or column values (multi-column)
    if (values && values.length > 0 && this.props.columns) {
      for (let i = 0; i < this.props.columns.length; i++) {
        const colValue = values[i];
        if (colValue !== undefined && colValue !== null && colValue !== '') {
          tooltip += `\n${this.props.columns[i].header}: ${colValue}`;
        }
      }
    } else if (value !== undefined && value !== null) {
      tooltip += `\n${value}`;
    }

    return tooltip;
  }

  // ===== Text Selection =====

  isTextSelectable(): boolean {
    return true;
  }

  getSelectableText(_selectionBounds?: SelectionBounds): string {
    const lines: string[] = [];
    const indent = this.props.indent ?? 2;

    for (const flatNode of this._flatVisibleNodes) {
      const indentStr = ' '.repeat(flatNode.depth * indent);
      let line = indentStr + flatNode.node.label;
      if (this.props.showValues && flatNode.node.value !== undefined) {
        line += '  ' + formatValue(flatNode.node.value);
      }
      lines.push(line);
    }

    return lines.join('\n');
  }
}

// ===== Component Schema =====

export const dataTreeSchema: ComponentSchema = {
  description: 'Hierarchical tree view with expand/collapse, selection, and multi-column support. Supports inline JSON content.',
  props: {
    nodes: { type: 'array', description: 'Tree node data (required unless in content JSON)' },
    showConnectors: { type: 'boolean', description: 'Show branch connector lines (default: true)' },
    indent: { type: 'number', description: 'Characters per indent level (default: 2)' },
    expandAll: { type: 'boolean', description: 'Start fully expanded (default: false)' },
    showValues: { type: 'boolean', description: 'Show value column in single-column mode (default: false)' },
    border: {
      type: 'string',
      enum: ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'ascii', 'ascii-rounded'],
      description: 'Border style (default: thin)',
    },
    columns: { type: 'array', description: 'Additional value columns (tree column is implicit first)' },
    showColumnBorders: { type: 'boolean', description: 'Show column separators (default: false)' },
    showHeader: { type: 'boolean', description: 'Show column headers (default: true when columns defined)' },
    selectable: { type: 'string', enum: ['none', 'single', 'multi'], description: 'Selection mode (default: none)' },
    selectedNodes: { type: 'array', description: 'Selected node IDs (controlled)' },
    onChange: { type: 'handler', description: 'Selection change handler' },
    onActivate: { type: 'handler', description: 'Node activation handler (Enter/double-click)' },
    onExpand: { type: 'handler', description: 'Node expand handler' },
    onCollapse: { type: 'handler', description: 'Node collapse handler' },
  },
  styles: {
    borderColor: { type: 'string', description: 'Border color' },
    connectorColor: { type: 'string', description: 'Tree connector line color (default: gray)' },
  },
};

registerComponentSchema('data-tree', dataTreeSchema);

registerComponent({
  type: 'data-tree',
  componentClass: DataTreeElement,
  defaultProps: {
    showConnectors: true,
    indent: 2,
    expandAll: false,
    showValues: false,
    border: 'thin',
    selectable: 'none',
    showColumnBorders: false,
  },
});
