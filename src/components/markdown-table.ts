// Markdown table rendering support
// Handles GFM table parsing, column width calculation, and rendering

import { type Cell } from '../buffer.ts';
import { getThemeColor } from '../theme.ts';
import { getBorderChars } from '../types.ts';
import type { MarkdownRenderContext, Table, TableRow, ASTNode } from './markdown-types.ts';
import { getSpacing } from './markdown-types.ts';

/** Styled text span with optional link info */
export interface StyledSpan {
  text: string;
  style: Partial<Cell>;
  linkUrl?: string;
  linkTitle?: string;
}

/** Link region for click detection */
export interface TableLinkRegion {
  x: number;
  y: number;
  width: number;
  url: string;
  title?: string;
}

/** Helper functions passed from MarkdownElement */
export interface TableRenderHelpers {
  extractTextContent: (node: ASTNode) => string;
  flattenInlineElements: (nodes: ASTNode[], baseStyle: Partial<Cell>) => StyledSpan[];
  registerLinkRegion: (region: TableLinkRegion) => void;
}

/**
 * Find optimal break point in text for word wrapping
 */
function findBreakPoint(text: string, maxWidth: number): number {
  if (maxWidth <= 0) return maxWidth;

  const searchArea = text.substring(0, maxWidth + 1);
  const lastSpace = searchArea.lastIndexOf(' ');
  const lastComma = searchArea.lastIndexOf(',');

  let bestBreak = -1;
  if (lastSpace > 0 && lastSpace < maxWidth) {
    bestBreak = lastSpace;
  }
  if (lastComma > 0 && lastComma + 1 <= maxWidth) {
    if (lastComma + 1 > bestBreak) {
      bestBreak = lastComma + 1;
    }
  }

  return bestBreak > 0 ? bestBreak : maxWidth;
}

/**
 * Render a GFM table with borders and alignment
 */
export function renderTable(
  node: Table,
  ctx: MarkdownRenderContext,
  helpers: TableRenderHelpers
): number {
  if (!node.children || node.children.length === 0) {
    return 0;
  }

  let totalHeight = 0;
  const alignments = node.align || [];
  const spacing = getSpacing('table');

  // First pass: calculate column widths
  const columnWidths = calculateTableColumnWidths(node, helpers);
  const numColumns = columnWidths.length;

  if (numColumns === 0) {
    return 0;
  }

  // Use local y tracking - don't modify ctx.currentY (caller does that)
  let localY = ctx.currentY;

  // Add spacing before table
  totalHeight += spacing.before;
  localY += spacing.before;

  // Box-drawing characters for table borders (with ASCII fallback)
  const bc = getBorderChars('thin');
  const borderChars = {
    topLeft: bc.tl,
    topRight: bc.tr,
    bottomLeft: bc.bl,
    bottomRight: bc.br,
    horizontal: bc.h,
    vertical: bc.v,
    leftT: bc.lm,
    rightT: bc.rm,
    topT: bc.tm,
    bottomT: bc.bm,
    cross: bc.mm,
  };

  const borderStyle: Partial<Cell> = {
    ...ctx.style,
    foreground: getThemeColor('border')
  };

  // Create a local context with our local y position
  const localCtx = { ...ctx, currentY: localY };

  // Draw top border
  drawTableBorderLine(localCtx, columnWidths, borderChars.topLeft, borderChars.horizontal, borderChars.topT, borderChars.topRight, borderStyle);
  totalHeight += 1;
  localY += 1;
  localCtx.currentY = localY;

  // Render rows
  for (let rowIndex = 0; rowIndex < node.children.length; rowIndex++) {
    const row = node.children[rowIndex];
    const isHeader = rowIndex === 0;

    // Render the row content
    const rowHeight = renderTableRow(row, localCtx, columnWidths, alignments, isHeader, borderChars.vertical, borderStyle, helpers);
    totalHeight += rowHeight;
    localY += rowHeight;
    localCtx.currentY = localY;

    // Draw separator after header row
    if (isHeader && node.children.length > 1) {
      drawTableBorderLine(localCtx, columnWidths, borderChars.leftT, borderChars.horizontal, borderChars.cross, borderChars.rightT, borderStyle);
      totalHeight += 1;
      localY += 1;
      localCtx.currentY = localY;
    }
  }

  // Draw bottom border
  drawTableBorderLine(localCtx, columnWidths, borderChars.bottomLeft, borderChars.horizontal, borderChars.bottomT, borderChars.bottomRight, borderStyle);
  totalHeight += 1;
  localY += 1;

  // Add spacing after table
  totalHeight += spacing.after;

  return totalHeight;
}

/**
 * Calculate column widths for a table
 */
function calculateTableColumnWidths(node: Table, helpers: TableRenderHelpers): number[] {
  const columnWidths: number[] = [];
  const maxColumnWidth = 30; // Max width before wrapping

  // Find max width for each column (capped at maxColumnWidth)
  for (const row of node.children) {
    for (let colIndex = 0; colIndex < row.children.length; colIndex++) {
      const cell = row.children[colIndex];
      const cellText = helpers.extractTextContent(cell);
      // Use actual text length but cap at maxColumnWidth
      const cellWidth = Math.min(cellText.length, maxColumnWidth);

      if (columnWidths.length <= colIndex) {
        columnWidths.push(cellWidth);
      } else {
        columnWidths[colIndex] = Math.max(columnWidths[colIndex], cellWidth);
      }
    }
  }

  // Ensure minimum column width of 3
  return columnWidths.map(w => Math.max(w, 3));
}

/**
 * Draw a horizontal border line for the table
 */
function drawTableBorderLine(
  ctx: MarkdownRenderContext,
  columnWidths: number[],
  leftChar: string,
  fillChar: string,
  separatorChar: string,
  rightChar: string,
  style: Partial<Cell>
): void {
  let line = leftChar;

  for (let i = 0; i < columnWidths.length; i++) {
    line += fillChar.repeat(columnWidths[i] + 2); // +2 for padding
    if (i < columnWidths.length - 1) {
      line += separatorChar;
    }
  }

  line += rightChar;
  ctx.buffer.currentBuffer.setText(ctx.currentX, ctx.currentY, line, style);
}

/**
 * Render a table row with multi-line cell support and inline formatting
 */
function renderTableRow(
  row: TableRow,
  ctx: MarkdownRenderContext,
  columnWidths: number[],
  alignments: ('left' | 'center' | 'right' | null)[],
  isHeader: boolean,
  verticalChar: string,
  borderStyle: Partial<Cell>,
  helpers: TableRenderHelpers
): number {
  // First, collect styled spans for each cell and wrap them
  const wrappedCells: StyledSpan[][][] = [];
  let maxLines = 1;

  // Base style for cells
  const baseCellStyle: Partial<Cell> = isHeader
    ? { ...ctx.style, bold: true, foreground: getThemeColor('primary') }
    : { ...ctx.style };

  for (let colIndex = 0; colIndex < columnWidths.length; colIndex++) {
    const cell = row.children[colIndex];
    const width = columnWidths[colIndex];

    if (!cell) {
      wrappedCells.push([[{ text: ' '.repeat(width), style: baseCellStyle }]]);
      continue;
    }

    // Get styled spans from cell content
    const spans = helpers.flattenInlineElements(cell.children, baseCellStyle);

    // Wrap styled spans into lines
    const lines = wrapStyledSpans(spans, width);
    wrappedCells.push(lines);
    maxLines = Math.max(maxLines, lines.length);
  }

  // Render each line of the row
  for (let lineIndex = 0; lineIndex < maxLines; lineIndex++) {
    let x = ctx.currentX;
    const y = ctx.currentY + lineIndex;

    // Draw left border
    ctx.buffer.currentBuffer.setText(x, y, verticalChar, borderStyle);
    x += 1;

    // Render each cell for this line
    for (let colIndex = 0; colIndex < columnWidths.length; colIndex++) {
      const width = columnWidths[colIndex];
      const alignment = alignments[colIndex] || 'left';
      const cellLines = wrappedCells[colIndex];

      // Get the line spans (or empty if this cell has fewer lines)
      const lineSpans = lineIndex < cellLines.length ? cellLines[lineIndex] : [];

      // Calculate total text length for alignment
      const totalLength = lineSpans.reduce((sum, span) => sum + span.text.length, 0);
      const padding = width - totalLength;

      // Calculate alignment padding
      let leftPad = 0;
      let rightPad = 0;
      if (padding > 0) {
        switch (alignment) {
          case 'right':
            leftPad = padding;
            break;
          case 'center':
            leftPad = Math.floor(padding / 2);
            rightPad = padding - leftPad;
            break;
          case 'left':
          default:
            rightPad = padding;
            break;
        }
      }

      // Draw cell content with padding
      ctx.buffer.currentBuffer.setText(x, y, ' ', ctx.style); // left cell padding
      x += 1;

      // Left alignment padding
      if (leftPad > 0) {
        ctx.buffer.currentBuffer.setText(x, y, ' '.repeat(leftPad), baseCellStyle);
        x += leftPad;
      }

      // Render styled spans and register link regions
      for (const span of lineSpans) {
        ctx.buffer.currentBuffer.setText(x, y, span.text, span.style);
        // Register link region if this span is a link
        if (span.linkUrl) {
          helpers.registerLinkRegion({
            x: x,
            y: y,
            width: span.text.length,
            url: span.linkUrl,
            title: span.linkTitle
          });
        }
        x += span.text.length;
      }

      // Right alignment padding
      if (rightPad > 0) {
        ctx.buffer.currentBuffer.setText(x, y, ' '.repeat(rightPad), baseCellStyle);
        x += rightPad;
      }

      ctx.buffer.currentBuffer.setText(x, y, ' ', ctx.style); // right cell padding
      x += 1;

      // Draw column separator
      ctx.buffer.currentBuffer.setText(x, y, verticalChar, borderStyle);
      x += 1;
    }
  }

  return maxLines; // Return actual row height
}

/**
 * Wrap styled spans into lines that fit within a given width
 */
function wrapStyledSpans(spans: StyledSpan[], width: number): StyledSpan[][] {
  const lines: StyledSpan[][] = [];
  let currentLine: StyledSpan[] = [];
  let currentLineWidth = 0;

  for (const span of spans) {
    let remainingText = span.text;

    while (remainingText.length > 0) {
      const availableWidth = width - currentLineWidth;

      if (remainingText.length <= availableWidth) {
        // Whole text fits on current line - preserve link info
        currentLine.push({ text: remainingText, style: span.style, linkUrl: span.linkUrl, linkTitle: span.linkTitle });
        currentLineWidth += remainingText.length;
        break;
      }

      // Need to wrap - find a good break point
      const breakPoint = availableWidth > 0 ? findBreakPoint(remainingText, availableWidth) : availableWidth;

      if (breakPoint > 0 && availableWidth > 0) {
        // Add portion to current line - preserve link info
        const chunk = remainingText.substring(0, breakPoint).trimEnd();
        if (chunk.length > 0) {
          currentLine.push({ text: chunk, style: span.style, linkUrl: span.linkUrl, linkTitle: span.linkTitle });
        }
        remainingText = remainingText.substring(breakPoint).trimStart();
      }

      // Start new line
      if (currentLine.length > 0) {
        lines.push(currentLine);
      }
      currentLine = [];
      currentLineWidth = 0;
    }
  }

  // Don't forget the last line
  if (currentLine.length > 0) {
    lines.push(currentLine);
  }

  // Ensure at least one line (even if empty)
  if (lines.length === 0) {
    lines.push([]);
  }

  return lines;
}

/**
 * Align text within a given width
 */
export function alignText(text: string, width: number, alignment: 'left' | 'center' | 'right' | null): string {
  const padding = width - text.length;
  if (padding <= 0) return text;

  switch (alignment) {
    case 'right':
      return ' '.repeat(padding) + text;
    case 'center': {
      const leftPad = Math.floor(padding / 2);
      const rightPad = padding - leftPad;
      return ' '.repeat(leftPad) + text + ' '.repeat(rightPad);
    }
    case 'left':
    default:
      return text + ' '.repeat(padding);
  }
}
