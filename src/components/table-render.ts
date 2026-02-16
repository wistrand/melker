// Table rendering helpers — standalone functions extracted from TableElement

import { Element, Bounds, ComponentRenderContext, BorderChars, BORDER_CHARS, isRenderable } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { ViewportDualBuffer } from '../viewport-buffer.ts';
import type { TableRowElement } from './table-row.ts';
import type { TableCellElement } from './table-cell.ts';
import { renderScrollbar } from './scrollbar.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('Table');

/**
 * Mutable output object populated during render — tracks bounds for click/drag handling.
 */
export interface TableRenderOutput {
  rowBounds: Map<string, Bounds>;
  cellComponentBounds: Array<{ element: Element; bounds: Bounds }>;
  headerCellBounds: Array<{ cell: TableCellElement; columnIndex: number; bounds: Bounds }>;
  columnBorderPositions: Array<{ columnIndex: number; x: number; y: number; height: number }>;
}

/**
 * Draw a horizontal border line.
 */
export function drawHorizontalBorder(
  buffer: DualBuffer,
  x: number,
  y: number,
  columnWidths: number[],
  left: string,
  middle: string,
  right: string,
  horizontal: string,
  style: Partial<Cell>,
  showColumnBorders: boolean = true
): void {
  let currentX = x;

  // Left corner
  buffer.currentBuffer.setText(currentX, y, left, style);
  currentX++;

  // Draw columns with separators
  for (let i = 0; i < columnWidths.length; i++) {
    // Horizontal line for column width
    buffer.currentBuffer.setText(currentX, y, horizontal.repeat(columnWidths[i]), style);
    currentX += columnWidths[i];

    // Junction or right corner
    if (i < columnWidths.length - 1) {
      if (showColumnBorders) {
        buffer.currentBuffer.setText(currentX, y, middle, style);
        currentX++;
      }
    } else {
      buffer.currentBuffer.setText(currentX, y, right, style);
      currentX++;
    }
  }
}

/**
 * Calculate total cell width for a colspan, optionally including internal borders.
 */
export function calculateColspanWidth(
  colspan: number,
  colIndex: number,
  columnWidths: number[],
  includeBorders: boolean = false
): number {
  let cellWidth = 0;
  for (let i = 0; i < colspan && colIndex + i < columnWidths.length; i++) {
    cellWidth += columnWidths[colIndex + i];
    if (i > 0 && includeBorders) cellWidth++;
  }
  return cellWidth;
}

/**
 * Fast path to check if a cell is simple single-line text.
 */
export function isSingleLineTextCell(cell: TableCellElement): boolean {
  const children = cell.children;
  if (!children || children.length === 0) return true;
  if (children.length !== 1) return false;

  const child = children[0];
  if (child.type === 'text' && child.props.text !== undefined) {
    const text = String(child.props.text);
    // Check for text-wrap style - wrapped text is not single-line
    const textWrap = child.props.style?.textWrap;
    if (textWrap === 'wrap') return false;
    return !text.includes('\n');
  }
  return false;
}

/**
 * Calculate the height of a row based on its cells.
 */
export function calculateRowHeight(row: TableRowElement, columnWidths: number[], cellPadding: number): number {
  const cells = row.getCells();

  // Fast path: if all cells are simple single-line text, height is 1
  let allSimple = true;
  for (const cell of cells) {
    if (!isSingleLineTextCell(cell)) {
      allSimple = false;
      break;
    }
  }
  if (allSimple) return 1;

  // Slow path: calculate actual heights
  let maxHeight = 1;
  let colIndex = 0;

  for (const cell of cells) {
    // Skip simple cells in the slow path too
    if (isSingleLineTextCell(cell)) {
      colIndex += cell.getColspan();
      continue;
    }

    const colspan = cell.getColspan();
    const cellWidth = calculateColspanWidth(colspan, colIndex, columnWidths);

    const contentWidth = cellWidth - cellPadding * 2;
    const cellHeight = cell.intrinsicSize({ availableSpace: { width: contentWidth, height: 100 } }).height;
    maxHeight = Math.max(maxHeight, cellHeight);

    colIndex += colspan;
  }

  return maxHeight;
}

/**
 * Calculate how many rows fit in the given height.
 */
export function calculateVisibleRowCount(rows: TableRowElement[], columnWidths: number[], cellPadding: number, availableHeight: number, startIndex: number = 0): number {
  let totalHeight = 0;
  let count = 0;

  // Start from the given index to handle variable-height rows correctly when scrolled
  for (let i = startIndex; i < rows.length; i++) {
    const rowHeight = calculateRowHeight(rows[i], columnWidths, cellPadding);
    if (totalHeight + rowHeight > availableHeight) {
      break;
    }
    totalHeight += rowHeight;
    count++;
  }

  return Math.max(1, count); // At least 1 row visible
}

/**
 * Estimate width of a container element.
 */
export function estimateContainerWidth(container: Element, availableWidth: number): number {
  let totalWidth = 0;

  // Account for border-left width
  const borderLeft = container.props.style?.borderLeft;
  if (borderLeft && borderLeft !== 'none') {
    totalWidth += 1;
  }

  if (!container.children || container.children.length === 0) return totalWidth;

  const gap = container.props.style?.gap || 0;

  for (const child of container.children) {
    if (isRenderable(child)) {
      const size = child.intrinsicSize({ availableSpace: { width: availableWidth, height: 1 } });
      totalWidth += size.width;
    } else if (child.type === 'text' && child.props.text) {
      totalWidth += String(child.props.text).length;
    }
  }

  // Add gaps between children
  if (container.children.length > 1) {
    totalWidth += gap * (container.children.length - 1);
  }

  return totalWidth;
}

/**
 * Get text content from a cell.
 */
export function getCellContent(cell: TableCellElement): string {
  if (!cell.children || cell.children.length === 0) {
    return '';
  }

  // Simple text extraction
  const texts: string[] = [];
  for (const child of cell.children) {
    if (child.type === 'text' && child.props.text) {
      texts.push(String(child.props.text));
    }
  }
  return texts.join('');
}

/**
 * Draw a scrollbar with pre-calculated thumb position and height.
 * Used for line-based scrolling where thumb is calculated externally.
 */
export function drawScrollbarLines(
  buffer: DualBuffer,
  x: number,
  y: number,
  trackHeight: number,
  thumbPosition: number,
  thumbHeight: number,
  style: Partial<Cell>
): void {
  if (trackHeight <= 0) return;

  renderScrollbar(buffer, x, y, trackHeight, {
    thumbPosition,
    thumbSize: thumbHeight,
    thumbStyle: style,
    trackStyle: style,
  });
}

/**
 * Render a header row with sort indicators and track cell bounds for click detection.
 */
export function renderHeaderRow(
  buffer: DualBuffer,
  x: number,
  y: number,
  row: TableRowElement,
  columnWidths: number[],
  style: Partial<Cell>,
  borderStyle: Partial<Cell>,
  chars: BorderChars | null,
  cellPadding: number,
  sortColumn: number | undefined,
  sortDirection: string | undefined,
  resizable: boolean | undefined,
  context: ComponentRenderContext | undefined,
  output: TableRenderOutput,
  showColumnBorders: boolean = true
): number {
  const cells = row.getCells();
  const hasBorder = chars !== null;
  const borderCount = showColumnBorders ? columnWidths.length + 1 : 2;
  const _tableWidth = columnWidths.reduce((sum, w) => sum + w, 0) + (hasBorder ? borderCount : 0);
  const rowHeight = 1; // Headers are single line

  // Sort indicators
  const SORT_ASC = ' ^';  // Use ^ for ascending (caret up alternative)
  const SORT_DESC = ' v'; // Use v for descending (caret down alternative)

  // Track content X position for cell rendering
  let contentX = x + (hasBorder ? 1 : 0);
  let colIndex = 0;

  for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
    const cell = cells[cellIdx];
    const colspan = cell.getColspan();
    // Calculate total cell width (including spanned columns)
    const cellWidth = calculateColspanWidth(colspan, colIndex, columnWidths, hasBorder && showColumnBorders);

    // Check both props.align and style.textAlign for alignment
    const styleTextAlign = cell.props.style?.textAlign || cell.props.style?.['text-align'];
    const align = cell.props.align || styleTextAlign || 'left';
    const cellContentWidth = cellWidth - cellPadding * 2;
    const cellContentX = contentX + cellPadding;

    // Track cell bounds for click detection (only for th cells that can be sorted)
    const isHeaderCell = cell.isHeader();
    const sortable = cell.props.sortable !== false;
    logger.debug(`_renderHeaderRow: cell=${cellIdx}, type=${cell.type}, isHeader=${isHeaderCell}, sortable=${sortable}`);
    if (isHeaderCell && sortable) {
      output.headerCellBounds.push({
        cell,
        columnIndex: colIndex,
        bounds: { x: contentX, y, width: cellWidth, height: rowHeight }
      });
      logger.debug(`_renderHeaderRow: added header cell bounds for column ${colIndex}`);
    }

    // Register cell bounds if cell has an ID (for connectors to find table cells)
    if (cell.id && context?.registerElementBounds) {
      context.registerElementBounds(cell.id, {
        x: contentX,
        y,
        width: cellWidth,
        height: rowHeight,
      });
    }

    // Get cell text content and add sort indicator if this column is sorted
    let content = cell.getTextContent();
    if (sortColumn === colIndex && sortDirection) {
      const indicator = sortDirection === 'asc' ? SORT_ASC : SORT_DESC;
      content = content + indicator;
    }

    // Calculate text position based on alignment
    let textX = cellContentX;
    const textLen = content.length;

    if (align === 'center') {
      textX += Math.floor((cellContentWidth - textLen) / 2);
    } else if (align === 'right') {
      textX += cellContentWidth - textLen;
    }

    // Truncate if too long
    const truncatedContent = content.substring(0, cellContentWidth);
    buffer.currentBuffer.setText(textX, y, truncatedContent, style);

    const isLastCell = cellIdx === cells.length - 1;
    contentX += cellWidth + (hasBorder && (showColumnBorders || isLastCell) ? 1 : 0);
    colIndex += colspan;
  }

  // Draw borders AFTER content and track column border positions for resize
  if (hasBorder && chars) {
    let borderX = x;

    // Left border
    buffer.currentBuffer.setText(borderX, y, chars.v, borderStyle);
    borderX++;

    // Column separators and right border
    colIndex = 0;
    for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
      const cell = cells[cellIdx];
      const colspan = cell.getColspan();
      const cellWidth = calculateColspanWidth(colspan, colIndex, columnWidths, showColumnBorders);
      borderX += cellWidth;

      // Only draw internal borders if showColumnBorders is true, always draw right border
      const isLastCell = cellIdx === cells.length - 1;
      if (isLastCell || showColumnBorders) {
        buffer.currentBuffer.setText(borderX, y, chars.v, borderStyle);

        // Track column border position for resize (not for the last column's right border)
        const lastColInSpan = colIndex + colspan - 1;
        if (resizable && lastColInSpan < columnWidths.length - 1 && showColumnBorders) {
          output.columnBorderPositions.push({
            columnIndex: lastColInSpan,
            x: borderX,
            y: y,
            height: rowHeight
          });
        }

        borderX++;
      }
      colIndex += colspan;
    }
  }

  return y + rowHeight;
}

/**
 * Render container children within a cell.
 * Tracks each child component for click handling.
 */
export function renderContainerChildren(
  buffer: DualBuffer | ViewportDualBuffer,
  x: number,
  y: number,
  width: number,
  container: Element,
  style: Partial<Cell>,
  context: ComponentRenderContext,
  output: TableRenderOutput,
  height: number = 1
): void {
  const gap = container.props.style?.gap || 0;
  let currentX = x;

  // Draw container's border-left if specified
  const borderLeft = container.props.style?.borderLeft;
  if (borderLeft && borderLeft !== 'none') {
    const borderChars = BORDER_CHARS[borderLeft as keyof typeof BORDER_CHARS] || BORDER_CHARS['thin'];
    for (let i = 0; i < height; i++) {
      buffer.currentBuffer.setCell(x, y + i, { char: borderChars.v, ...style });
    }
    currentX = x + 1; // Offset content after border
  }

  if (!container.children || container.children.length === 0) return;

  // Calculate available width after border
  const availableWidth = width - (currentX - x);

  for (const child of container.children) {
    if (isRenderable(child)) {
      const size = child.intrinsicSize({ availableSpace: { width: availableWidth, height } });
      const childBounds: Bounds = { x: currentX, y, width: availableWidth, height };
      child.render(childBounds, style, buffer, context);
      // Track component bounds for click handling
      output.cellComponentBounds.push({ element: child, bounds: childBounds });
      currentX += size.width + gap;
    } else if (child.type === 'text' && child.props.text) {
      const text = String(child.props.text);
      buffer.currentBuffer.setText(currentX, y, text, style);
      currentX += text.length + gap;
    }
  }
}

/**
 * Render cell children with line clipping support.
 */
export function renderCellChildrenClipped(
  buffer: DualBuffer | ViewportDualBuffer,
  x: number,
  y: number,
  width: number,
  maxLines: number,
  cell: TableCellElement,
  align: 'left' | 'center' | 'right',
  style: Partial<Cell>,
  context: ComponentRenderContext,
  output: TableRenderOutput,
  skipLines: number = 0
): void {
  if (!cell.children || cell.children.length === 0) return;

  // Calculate total width of all children for alignment
  let totalChildWidth = 0;
  for (const child of cell.children) {
    if (child.type === 'container') {
      totalChildWidth += estimateContainerWidth(child, width);
    } else if (isRenderable(child)) {
      const size = child.intrinsicSize({ availableSpace: { width, height: maxLines + skipLines } });
      totalChildWidth += size.width;
    } else if (child.type === 'text' && child.props.text) {
      totalChildWidth += String(child.props.text).length;
    }
  }

  // Calculate starting X based on alignment
  let currentX = x;
  if (align === 'center') {
    currentX = x + Math.floor((width - totalChildWidth) / 2);
  } else if (align === 'right') {
    currentX = x + width - totalChildWidth;
  }

  // For renderable children (like nested tables), we need to render to a virtual position
  // and then copy only the visible lines
  logger.debug(`_renderCellChildrenClipped: cell has ${cell.children.length} children`);
  for (const child of cell.children) {
    logger.debug(`_renderCellChildrenClipped: child type=${child.type}, id=${child.id}, isRenderable=${isRenderable(child)}`);
    // Handle containers specially - render their children and track each for click handling
    if (child.type === 'container') {
      if (skipLines === 0) {
        const containerWidth = estimateContainerWidth(child, width);
        const containerBounds: Bounds = { x: currentX, y, width: containerWidth, height: maxLines };
        renderContainerChildren(buffer, currentX, y, containerWidth, child, style, context, output, maxLines);
        output.cellComponentBounds.push({ element: child, bounds: containerBounds });

        // Register bounds for containers with IDs (for connectors)
        if (child.id && context?.registerElementBounds) {
          logger.debug(`_renderCellChildrenClipped: registering container bounds for id=${child.id}, bounds=${JSON.stringify(containerBounds)}`);
          context.registerElementBounds(child.id, containerBounds);
        }
        currentX += containerWidth;
      }
    } else if (isRenderable(child)) {
      const size = child.intrinsicSize({ availableSpace: { width, height: maxLines + skipLines } });

      // For clipped rendering, we render the full component but offset the Y position
      // The component will render starting from (y - skipLines) conceptually,
      // but we only want lines [skipLines, skipLines + maxLines) to appear at y
      if (skipLines === 0) {
        // No clipping needed at top, just render with height limit
        const childBounds: Bounds = { x: currentX, y, width: size.width, height: Math.min(size.height, maxLines) };
        // Mark nested tables so they don't enable auto-scroll
        const nestedContext = { ...context, nestedInTable: true };
        child.render(childBounds, style, buffer, nestedContext);
        output.cellComponentBounds.push({ element: child, bounds: childBounds });

        // Register bounds for child elements with IDs (for connectors)
        if (child.id && context?.registerElementBounds) {
          logger.debug(`_renderCellChildrenClipped: registering bounds for id=${child.id}, bounds=${JSON.stringify(childBounds)}`);
          context.registerElementBounds(child.id, childBounds);
        }
      } else {
        // Need to clip top lines - render to a temporary offset and rely on buffer clipping
        // For now, render at adjusted Y and let component handle partial rendering
        // This requires components to support skipLines parameter - for now we'll skip rendering
        // the component if it would be partially clipped at top (simplified approach)
        if (skipLines < size.height) {
          // Component is partially visible - render what we can
          // For nested tables, the table itself would need to handle this recursively
          // For now, render at y with reduced height
          const visibleHeight = Math.min(size.height - skipLines, maxLines);
          const childBounds: Bounds = { x: currentX, y, width: size.width, height: visibleHeight };
          // Pass skipLines info via context or render partial
          // Simplified: render the component but it may show wrong lines
          // TODO: implement proper line-offset rendering for nested Renderables
          // Mark nested tables so they don't enable auto-scroll
          const nestedContext = { ...context, nestedInTable: true };
          child.render(childBounds, style, buffer, nestedContext);
          output.cellComponentBounds.push({ element: child, bounds: childBounds });

          // Register bounds for child elements with IDs (for connectors)
          if (child.id && context?.registerElementBounds) {
            context.registerElementBounds(child.id, childBounds);
          }
        }
      }
      currentX += size.width;
    } else if (child.type === 'text' && child.props.text) {
      // Text is single line - only show if not skipped
      if (skipLines === 0) {
        const text = String(child.props.text);
        const truncated = text.substring(0, width);
        buffer.currentBuffer.setText(currentX, y, truncated, style);

        // Register bounds for text elements with IDs (for connectors)
        if (child.id && context?.registerElementBounds) {
          context.registerElementBounds(child.id, {
            x: currentX,
            y,
            width: text.length,
            height: 1,
          });
        }

        currentX += text.length;
      }
    }
  }
}

/**
 * Render a single row (supports multi-line rows for nested tables).
 * @param skipLines - Number of lines to skip at top (for partial row rendering)
 * @param maxLines - Maximum lines to render (for clipping at bottom)
 * @param showColumnBorders - Whether to show internal column borders
 */
export function renderRow(
  buffer: DualBuffer | ViewportDualBuffer,
  x: number,
  y: number,
  row: TableRowElement,
  columnWidths: number[],
  style: Partial<Cell>,
  borderStyle: Partial<Cell>,
  chars: BorderChars | null,
  cellPadding: number,
  isSelected: boolean,
  isFocused: boolean,
  context: ComponentRenderContext | undefined,
  output: TableRenderOutput,
  skipLines: number = 0,
  maxLines?: number,
  showColumnBorders: boolean = true
): number {
  const cells = row.getCells();
  const hasBorder = chars !== null;
  const borderCount = showColumnBorders ? columnWidths.length + 1 : 2;
  const tableWidth = columnWidths.reduce((sum, w) => sum + w, 0) + (hasBorder ? borderCount : 0);

  // Calculate row height based on tallest cell
  const fullRowHeight = calculateRowHeight(row, columnWidths, cellPadding);

  // Calculate actual lines to render after clipping
  const availableLines = fullRowHeight - skipLines;
  const linesToRender = maxLines !== undefined ? Math.min(availableLines, maxLines) : availableLines;

  if (linesToRender <= 0) return y;

  // Track row bounds for click detection (use actual rendered position and height)
  const rowId = row.getDataId();
  if (rowId) {
    output.rowBounds.set(rowId, { x, y, width: tableWidth, height: linesToRender });
  }

  // First pass: Fill backgrounds for selected rows
  if (isSelected) {
    for (let line = 0; line < linesToRender; line++) {
      let currentX = x + (hasBorder ? 1 : 0);
      let colIdx = 0;
      for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
        const cell = cells[cellIdx];
        const colspan = cell.getColspan();
        const cellWidth = calculateColspanWidth(colspan, colIdx, columnWidths, hasBorder && showColumnBorders);
        buffer.currentBuffer.fillLine(currentX, y + line, cellWidth, style);
        const isLastCell = cellIdx === cells.length - 1;
        currentX += cellWidth + (hasBorder && (showColumnBorders || isLastCell) ? 1 : 0);
        colIdx += colspan;
      }
    }
  }

  // Second pass: Render cell content with line clipping
  let contentX = x + (hasBorder ? 1 : 0);
  let colIndex = 0;
  for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
    const cell = cells[cellIdx];
    const colspan = cell.getColspan();
    // Calculate total cell width (including spanned columns)
    const cellWidth = calculateColspanWidth(colspan, colIndex, columnWidths, hasBorder && showColumnBorders);

    // Check both props.align and style.textAlign for alignment
    const styleTextAlign = cell.props.style?.textAlign || cell.props.style?.['text-align'];
    const align = cell.props.align || styleTextAlign || 'left';
    const cellContentWidth = cellWidth - cellPadding * 2;
    const cellContentX = contentX + cellPadding;

    // Register cell bounds if cell has an ID (for connectors to find table cells)
    if (cell.id && context?.registerElementBounds) {
      context.registerElementBounds(cell.id, {
        x: contentX,
        y,
        width: cellWidth,
        height: linesToRender,
      });
    }

    // Render cell children with clipping
    logger.debug(`_renderRow: cell.children=${cell.children?.length || 0}, context=${!!context}, hasRegister=${!!context?.registerElementBounds}`);
    if (cell.children && cell.children.length > 0) {
      logger.debug(`_renderRow: first child type=${cell.children[0]?.type}, id=${cell.children[0]?.id}`);
    }
    if (cell.children && cell.children.length > 0 && context) {
      renderCellChildrenClipped(buffer, cellContentX, y, cellContentWidth, linesToRender, cell, align, style, context, output, skipLines);
    } else {
      // Fallback to text content for cells without proper children
      // Only render if the text line is visible (not skipped)
      logger.debug(`_renderRow: using fallback path for cell`);
      if (skipLines === 0) {
        const content = getCellContent(cell);
        let textX = cellContentX;

        // Apply alignment for text
        const textLen = content.length;
        if (align === 'center') {
          textX += Math.floor((cellContentWidth - textLen) / 2);
        } else if (align === 'right') {
          textX += cellContentWidth - textLen;
        }

        const truncatedContent = content.substring(0, cellContentWidth);
        buffer.currentBuffer.setText(textX, y, truncatedContent, style);
      }
    }

    const isLastCell = cellIdx === cells.length - 1;
    contentX += cellWidth + (hasBorder && (showColumnBorders || isLastCell) ? 1 : 0);
    colIndex += colspan;
  }

  // Third pass: Draw borders AFTER all content (so they're not overwritten by nested tables)
  if (hasBorder && chars) {
    for (let line = 0; line < linesToRender; line++) {
      let borderX = x;

      // Left border
      buffer.currentBuffer.setText(borderX, y + line, chars.v, borderStyle);
      borderX++;

      // Column separators and right border
      colIndex = 0;
      for (let cellIdx = 0; cellIdx < cells.length; cellIdx++) {
        const cell = cells[cellIdx];
        const colspan = cell.getColspan();
        const cellWidth = calculateColspanWidth(colspan, colIndex, columnWidths, showColumnBorders);
        borderX += cellWidth;

        // Only draw internal borders if showColumnBorders is true, always draw right border
        const isLastCell = cellIdx === cells.length - 1;
        if (isLastCell || showColumnBorders) {
          buffer.currentBuffer.setText(borderX, y + line, chars.v, borderStyle);
          borderX++;
        }
        colIndex += colspan;
      }
    }
  }

  return y + linesToRender;
}
