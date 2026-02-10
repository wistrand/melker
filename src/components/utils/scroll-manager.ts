// Shared scroll state management for scrollable components

/**
 * Manages vertical scroll state for components with virtual scrolling.
 * Encapsulates scroll position, clamping, visibility, and wheel handling.
 *
 * Used by data-tree, data-table, and similar components that share
 * the same scroll pattern: scrollY + totalLines + viewportLines.
 */
export class ScrollManager {
  /** Current scroll offset (first visible row/line index) */
  scrollY = 0;
  /** Total number of content lines/rows */
  totalLines = 0;
  /** Number of visible lines in the viewport */
  viewportLines = 0;

  /** Maximum valid scroll position */
  get maxScroll(): number {
    return Math.max(0, this.totalLines - this.viewportLines);
  }

  /** Whether content exceeds viewport (scrollbar needed) */
  get needsScrollbar(): boolean {
    return this.totalLines > this.viewportLines;
  }

  /** Clamp scrollY to valid range */
  clamp(): void {
    this.scrollY = Math.max(0, Math.min(this.scrollY, this.maxScroll));
  }

  /**
   * Update total and viewport lines, then clamp.
   */
  update(totalLines: number, viewportLines: number): void {
    this.totalLines = totalLines;
    this.viewportLines = viewportLines;
    this.clamp();
  }

  /**
   * Ensure a row/line index is visible in the viewport.
   * For single-line rows, pass the row index directly.
   * For multi-line rows, pass the start line and end line.
   * Adjusts scrollY if needed.
   */
  ensureVisible(startLine: number, endLine?: number): void {
    const end = endLine ?? startLine + 1;
    if (startLine < this.scrollY) {
      this.scrollY = startLine;
    } else if (end > this.scrollY + this.viewportLines) {
      this.scrollY = end - this.viewportLines;
    }
    this.clamp();
  }

  /**
   * Handle mouse wheel scroll. Returns true if scroll position changed.
   */
  handleWheel(deltaY: number): boolean {
    if (this.totalLines <= this.viewportLines) return false;
    const old = this.scrollY;
    this.scrollY = Math.max(0, Math.min(this.maxScroll, this.scrollY + deltaY));
    return this.scrollY !== old;
  }

  /**
   * Scroll to a position based on a ratio (0-1), e.g., from scrollbar click.
   */
  scrollToRatio(ratio: number): void {
    this.scrollY = Math.floor(ratio * this.maxScroll);
    this.clamp();
  }

  /** Get the visible range [start, end) for iteration */
  getVisibleRange(): { start: number; end: number } {
    const start = this.scrollY;
    const end = Math.min(start + this.viewportLines, this.totalLines);
    return { start, end };
  }
}
