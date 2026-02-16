// Table column width calculation — standalone functions extracted from TableElement

import type { TableProps } from './table-types.ts';
import type { TableSectionElement } from './table-section.ts';
import type { TableCellElement } from './table-cell.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('Table');

/**
 * Context interface for column width calculation.
 */
export interface TableColumnContext {
  props: TableProps;
  getThead(): TableSectionElement | undefined;
  getTbody(): TableSectionElement | undefined;
  getTfoot(): TableSectionElement | undefined;
  getColumnCount(): number;
  sortCacheKey: string;
}

/**
 * Mutable column width cache — passed by reference so functions can update it.
 */
export interface ColumnWidthCache {
  cachedColumnWidths: number[];
  columnWidthsCacheKey: string;
}

/**
 * Fast path to get cell text width without full intrinsicSize overhead.
 */
export function getCellTextWidth(cell: TableCellElement): number {
  const children = cell.children;
  if (!children || children.length === 0) return 1;

  // Fast path: single child (text or container with text)
  if (children.length === 1) {
    const child = children[0];

    // Direct text child
    if (child.type === 'text' && child.props.text !== undefined) {
      const text = String(child.props.text);
      // For wrapped text, return minimal width so column doesn't expand to fit full text
      const textWrap = child.props.style?.textWrap;
      if (textWrap === 'wrap') {
        // Return length of longest word as minimum width
        const words = text.split(/\s+/);
        const longestWord = Math.max(1, ...words.map(w => w.length));
        return Math.min(longestWord, 20); // Cap at 20 to avoid very long words dominating
      }
      if (!text.includes('\n')) {
        return Math.max(1, text.length);
      }
    }

    // Container child - check for wrapped text inside
    if (child.type === 'container' && child.children) {
      let containerWidth = 0;
      // Account for container's border-left
      const borderLeft = child.props.style?.borderLeft;
      if (borderLeft && borderLeft !== 'none') {
        containerWidth += 1;
      }

      // Check container's children for wrapped text
      for (const containerChild of child.children) {
        if (containerChild.type === 'text' && containerChild.props.text !== undefined) {
          const text = String(containerChild.props.text);
          const textWrap = containerChild.props.style?.textWrap;
          if (textWrap === 'wrap') {
            // Return minimal width for wrapped text
            const words = text.split(/\s+/);
            const longestWord = Math.max(1, ...words.map(w => w.length));
            containerWidth += Math.min(longestWord, 20);
          } else if (!text.includes('\n')) {
            containerWidth += text.length;
          }
        }
      }

      if (containerWidth > 0) {
        return Math.max(1, containerWidth);
      }
    }
  }

  // Fallback to full intrinsicSize for complex cells
  return cell.intrinsicSize({ availableSpace: { width: 200, height: 100 } }).width;
}

/**
 * Calculate column widths based on content.
 * @param ctx - Table context for accessing sections and props
 * @param availableWidth - maximum width available for the table
 * @param expandToFill - if true, expand columns to fill available width (default: true for root tables)
 * @param cache - mutable cache object for storing results
 */
export function calculateColumnWidths(
  ctx: TableColumnContext,
  availableWidth: number,
  expandToFill: boolean,
  cache: ColumnWidthCache
): number[] {
  const columnCount = ctx.getColumnCount();
  if (columnCount === 0) return [];

  const cellPadding = ctx.props.cellPadding || 1;
  const hasBorder = ctx.props.border !== 'none';
  const showColumnBorders = ctx.props.columnBorders ?? true;
  const borderWidth = hasBorder ? (showColumnBorders ? columnCount + 1 : 2) : 0;

  // Check cache - use row count and sort cache key to detect data changes
  // Use children.length directly (O(1)) instead of getRows().length (O(n))
  const tbody = ctx.getTbody();
  const tbodyChildCount = tbody?.children?.length ?? 0;
  // IMPORTANT: Include showColumnBorders in cache key - it affects borderWidth which affects all width calculations
  const cacheKey = `${availableWidth}:${expandToFill}:${columnCount}:${tbodyChildCount}:${cellPadding}:${hasBorder}:${showColumnBorders}:${ctx.sortCacheKey}`;
  if (cache.columnWidthsCacheKey === cacheKey && cache.cachedColumnWidths.length === columnCount) {
    return cache.cachedColumnWidths;
  }

  // Fast path: Check if all headers have explicit widths
  // This completely avoids sampling body rows
  const thead = ctx.getThead();
  if (thead) {
    const headerRows = thead.getRows();
    if (headerRows.length > 0) {
      const headerCells = headerRows[0].getCells();
      let allExplicit = true;
      let fillIndex = -1;
      const explicitWidths: number[] = [];
      const percentageIndices: number[] = [];
      const percentageValues: number[] = [];

      // Available width for content (excluding borders)
      const contentAvailable = availableWidth - borderWidth;

      let colIndex = 0;
      for (const cell of headerCells) {
        const colWidth = cell.getColWidth();
        if (colWidth === undefined) {
          allExplicit = false;
          break;
        }
        if (colWidth === 'fill') {
          fillIndex = colIndex;
          explicitWidths.push(0); // Placeholder, will calculate
        } else if (typeof colWidth === 'string' && colWidth.endsWith('%')) {
          // Percentage width
          const percent = parseFloat(colWidth) / 100;
          percentageIndices.push(colIndex);
          percentageValues.push(percent);
          explicitWidths.push(0); // Placeholder, will calculate
        } else if (typeof colWidth === 'number') {
          explicitWidths.push(colWidth + cellPadding * 2);
        }
        colIndex++;
      }

      if (allExplicit && explicitWidths.length === columnCount) {
        // All headers have explicit widths - skip all sampling!

        // Calculate percentage widths first
        for (let i = 0; i < percentageIndices.length; i++) {
          const idx = percentageIndices[i];
          const percent = percentageValues[i];
          explicitWidths[idx] = Math.max(cellPadding * 2 + 1, Math.floor(contentAvailable * percent));
        }

        if (fillIndex >= 0) {
          // Calculate 'fill' column width from remaining space
          const fixedTotal = explicitWidths.reduce((sum, w) => sum + w, 0);
          const fillWidth = Math.max(cellPadding * 2 + 1, contentAvailable - fixedTotal);
          explicitWidths[fillIndex] = fillWidth;
          logger.debug(`Fast path fill column: availableWidth=${availableWidth}, borderWidth=${borderWidth}, contentAvailable=${contentAvailable}, fixedTotal=${fixedTotal}, fillWidth=${fillWidth}, total=${explicitWidths.reduce((s, w) => s + w, 0)}`);
        } else if (expandToFill && percentageIndices.length === 0) {
          // Distribute extra space evenly (only if no percentages used)
          const totalNeeded = explicitWidths.reduce((sum, w) => sum + w, 0);
          if (totalNeeded < contentAvailable) {
            const extra = contentAvailable - totalNeeded;
            const perColumn = Math.floor(extra / columnCount);
            const remainder = extra % columnCount;
            for (let i = 0; i < columnCount; i++) {
              explicitWidths[i] += perColumn;
              if (i < remainder) explicitWidths[i]++;
            }
          }
        }

        cache.cachedColumnWidths = explicitWidths;
        cache.columnWidthsCacheKey = cacheKey;
        return explicitWidths;
      }
    }
  }

  // Slow path: Calculate intrinsic widths for each column
  const intrinsicWidths: number[] = new Array(columnCount).fill(0);

  // Step 1: Get header widths first (headers define minimum widths and rarely change)
  if (thead) {
    for (const row of thead.getRows()) {
      let colIndex = 0;
      for (const cell of row.getCells()) {
        const colspan = cell.getColspan();
        if (colspan === 1) {
          // Use explicit width if set, otherwise calculate
          const explicitWidth = cell.getColWidth();
          if (typeof explicitWidth === 'number') {
            intrinsicWidths[colIndex] = Math.max(intrinsicWidths[colIndex], explicitWidth);
          } else {
            const cellWidth = getCellTextWidth(cell);
            intrinsicWidths[colIndex] = Math.max(intrinsicWidths[colIndex], cellWidth);
          }
        }
        colIndex += colspan;
      }
    }
  }

  // Step 2: Sample body rows for large tables (optimization for 50+ rows)
  // For smaller tables, check all rows
  const SAMPLE_THRESHOLD = 50;

  if (tbody) {
    const rows = tbody.getRows();
    const rowCount = rows.length;

    if (rowCount <= SAMPLE_THRESHOLD) {
      // Small table: check all rows
      for (const row of rows) {
        let colIndex = 0;
        for (const cell of row.getCells()) {
          const colspan = cell.getColspan();
          if (colspan === 1) {
            const cellWidth = getCellTextWidth(cell);
            intrinsicWidths[colIndex] = Math.max(intrinsicWidths[colIndex], cellWidth);
          }
          colIndex += colspan;
        }
      }
    } else {
      // Large table: sample rows (first 10, last 5, 5 evenly distributed)
      const sampleIndices = new Set<number>();

      // First 10 rows
      for (let i = 0; i < Math.min(10, rowCount); i++) {
        sampleIndices.add(i);
      }

      // Last 5 rows
      for (let i = Math.max(0, rowCount - 5); i < rowCount; i++) {
        sampleIndices.add(i);
      }

      // 5 evenly distributed middle rows
      if (rowCount > 15) {
        const step = Math.floor((rowCount - 15) / 6);
        for (let i = 1; i <= 5; i++) {
          sampleIndices.add(10 + i * step);
        }
      }

      for (const idx of sampleIndices) {
        const row = rows[idx];
        let colIndex = 0;
        for (const cell of row.getCells()) {
          const colspan = cell.getColspan();
          if (colspan === 1) {
            const cellWidth = getCellTextWidth(cell);
            intrinsicWidths[colIndex] = Math.max(intrinsicWidths[colIndex], cellWidth);
          }
          colIndex += colspan;
        }
      }
    }
  }

  // Step 3: Check tfoot if present
  const tfoot = ctx.getTfoot();
  if (tfoot) {
    for (const row of tfoot.getRows()) {
      let colIndex = 0;
      for (const cell of row.getCells()) {
        const colspan = cell.getColspan();
        if (colspan === 1) {
          const cellWidth = getCellTextWidth(cell);
          intrinsicWidths[colIndex] = Math.max(intrinsicWidths[colIndex], cellWidth);
        }
        colIndex += colspan;
      }
    }
  }

  // Add padding to each column
  const widths = intrinsicWidths.map(w => w + cellPadding * 2);

  // Calculate total width needed
  const totalNeeded = widths.reduce((sum, w) => sum + w, 0) + borderWidth;

  // If we have more space and expansion is enabled, distribute evenly
  if (expandToFill && totalNeeded < availableWidth) {
    const extra = availableWidth - totalNeeded;
    const perColumn = Math.floor(extra / columnCount);
    const remainder = extra % columnCount;
    for (let i = 0; i < columnCount; i++) {
      widths[i] += perColumn;
      // Distribute remainder to first columns (1 extra char each)
      if (i < remainder) {
        widths[i] += 1;
      }
    }
  }

  // Cache result
  cache.cachedColumnWidths = widths;
  cache.columnWidthsCacheKey = cacheKey;

  return widths;
}
