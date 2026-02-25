// Markdown code block rendering support
// Handles code blocks, melker blocks, and mermaid diagrams

import { Element, Bounds, hasIntrinsicSize, isDisposable } from '../types.ts';
import { type Cell } from '../buffer.ts';
import { getThemeColor, getThemeManager } from '../theme.ts';
import { getStringWidth } from '../char-width.ts';
import { parseMelkerFile } from '../template.ts';
import { renderElementSubtree } from '../rendering.ts';
import { COLORS } from './color-utils.ts';
import { GraphElement } from './graph/mod.ts';
import type { MarkdownRenderContext, Code } from './markdown-types.ts';
import { getSpacing } from './markdown-types.ts';

/**
 * Pad a string to a target display width, accounting for wide characters
 */
function padEndDisplayWidth(str: string, targetWidth: number, padChar: string = ' '): string {
  const currentWidth = getStringWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + padChar.repeat(targetWidth - currentWidth);
}

/** Helper interface for path resolution */
export interface CodeRenderHelpers {
  resolveImagePath: (src: string) => string;
  getMarkdownSrc: () => string | undefined;
}

/**
 * Manages code block rendering for markdown content.
 * Handles melker blocks, mermaid diagrams, and regular code blocks.
 */
export class MarkdownCodeRenderer {
  /** Cache for parsed melker elements */
  private _melkerElements: Map<string, Element> = new Map();

  /** Cache for parsed mermaid graph elements */
  private _mermaidElements: Map<string, GraphElement> = new Map();

  /**
   * Get mermaid elements cache (for subtree access)
   */
  getMermaidElements(): Map<string, GraphElement> {
    return this._mermaidElements;
  }

  /**
   * Get melker elements cache (for subtree access)
   */
  getMelkerElements(): Map<string, Element> {
    return this._melkerElements;
  }

  /**
   * Dispose all cached melker elements and clear caches.
   * Recurses bottom-up so children (e.g. video inside a container) are disposed first.
   */
  reset(): void {
    for (const element of this._melkerElements.values()) {
      this._disposeRecursive(element);
    }
    this._melkerElements.clear();
  }

  private _disposeRecursive(element: Element): void {
    if (element.children) {
      for (const child of element.children) {
        this._disposeRecursive(child);
      }
    }
    if (isDisposable(element)) {
      element.dispose();
    }
  }

  /**
   * Pre-cache mermaid code blocks as GraphElements
   * Called before render to ensure graphs are available
   */
  cacheMermaidBlocks(mermaidBlocks: string[]): void {
    for (let i = 0; i < mermaidBlocks.length; i++) {
      const code = mermaidBlocks[i];
      const cacheKey = `mermaid:${code.trim()}`;

      // Only create if not already cached
      if (!this._mermaidElements.has(cacheKey)) {
        const graphElement = new GraphElement({
          id: `md-mermaid-${i}`,
          type: 'mermaid',
          text: code.trim(),
        }, []);
        // GraphElement generates children automatically when getGeneratedElement() is called
        this._mermaidElements.set(cacheKey, graphElement);
      }
    }
  }

  /**
   * Render code block with syntax highlighting
   */
  renderCodeBlock(
    node: Code,
    ctx: MarkdownRenderContext,
    codeTheme: 'light' | 'dark' | 'auto' | undefined,
    helpers: CodeRenderHelpers
  ): number {
    const code = node.value;
    const language = node.lang;

    // Special handling for melker blocks - render as actual UI elements
    if (language === 'melker') {
      return this.renderMelkerBlock(code, ctx, helpers);
    }

    // Special handling for mermaid blocks - render as graph elements
    if (language === 'mermaid') {
      return this.renderMermaidBlock(code, ctx);
    }

    // Use local y tracking - don't modify ctx.currentY (caller does that)
    let localY = ctx.currentY;

    // No extra spacing before code block - paragraphs already add trailing spacing
    let totalHeight = 0;

    // Create code block style
    const codeStyle = this.getCodeBlockStyle(codeTheme, ctx.baseStyle);

    // Render language label outside the block on top-right (if present)
    // Label appears on the line just before the code content, right-aligned above the block
    if (language) {
      const langStyle: Partial<Cell> = {
        ...ctx.baseStyle,
        foreground: getThemeColor('textMuted'),
        dim: true
      };

      const langLabel = language;
      // Right-align to the block's right edge (bounds.x + bounds.width), offset 2 chars left
      const blockRightEdge = ctx.bounds.x + ctx.bounds.width;
      const labelX = blockRightEdge - langLabel.length - 2;
      ctx.buffer.currentBuffer.setText(labelX, localY, langLabel, langStyle);
      totalHeight += 1;
      localY += 1;
    }

    // Split code into lines and render each
    const lines = code.split('\n');
    const maxWidth = ctx.bounds.width - 4; // Leave some padding
    const fullWidth = ctx.bounds.width; // Full width for background fill

    for (const line of lines) {
      const lineDisplayWidth = getStringWidth(line);
      if (lineDisplayWidth <= maxWidth) {
        // Single line - pad to full width for background (use display width)
        const paddedLine = `  ${line}`;
        const fullLine = padEndDisplayWidth(paddedLine, fullWidth);
        ctx.buffer.currentBuffer.setText(ctx.currentX, localY, fullLine, codeStyle);
        totalHeight += 1;
        localY += 1;
      } else {
        // Wrap long lines - need to be more careful with wide chars
        // For now, use simple character-based wrapping (may split wide chars incorrectly)
        let remainingLine = line;
        while (remainingLine.length > 0) {
          // Find how many chars fit in maxWidth-2 display columns
          let chunkEnd = 0;
          let chunkWidth = 0;
          while (chunkEnd < remainingLine.length && chunkWidth < maxWidth - 2) {
            const charWidth = getStringWidth(remainingLine[chunkEnd]);
            if (chunkWidth + charWidth > maxWidth - 2) break;
            chunkWidth += charWidth;
            chunkEnd++;
          }
          if (chunkEnd === 0) chunkEnd = 1; // Ensure progress
          const chunk = remainingLine.substring(0, chunkEnd);
          const paddedChunk = `  ${chunk}`;
          const fullLine = padEndDisplayWidth(paddedChunk, fullWidth);
          ctx.buffer.currentBuffer.setText(ctx.currentX, localY, fullLine, codeStyle);
          remainingLine = remainingLine.substring(chunkEnd);
          totalHeight += 1;
          localY += 1;
        }
      }
    }

    // Add spacing after code block
    const spacing = getSpacing('code');
    totalHeight += spacing.after;

    return totalHeight;
  }

  /**
   * Render a melker code block as actual UI elements
   */
  renderMelkerBlock(code: string, ctx: MarkdownRenderContext, helpers: CodeRenderHelpers): number {
    // Use local y tracking
    let localY = ctx.currentY;
    let totalHeight = 1; // spacing before
    localY += 1;

    try {
      // Create a cache key from the code content and markdown src (for path resolution)
      const cacheKey = `${helpers.getMarkdownSrc() || ''}:${code.trim()}`;

      // Check if we have a cached element
      let element = this._melkerElements.get(cacheKey);

      if (!element) {
        // Parse the melker content
        const parseResult = parseMelkerFile(code);
        element = parseResult.element;

        // Resolve file paths for elements that have src props (img, canvas, video)
        // Recursively walk the tree so nested children get resolved too
        this._resolvePathsRecursive(element, helpers);

        // Cache the element
        this._melkerElements.set(cacheKey, element);
      }

      // Get element dimensions from props or style, falling back to intrinsicSize
      let elementWidth = ctx.bounds.width;
      let elementHeight = 15; // Default height
      let hasExplicitWidth = false;
      let hasExplicitHeight = false;

      const style = element.props.style as Record<string, unknown> | undefined;
      if (element.props.width && typeof element.props.width === 'number') {
        elementWidth = Math.min(element.props.width, ctx.bounds.width);
        hasExplicitWidth = true;
      } else if (style?.width && typeof style.width === 'number') {
        elementWidth = Math.min(style.width as number, ctx.bounds.width);
        hasExplicitWidth = true;
      }
      if (element.props.height && typeof element.props.height === 'number') {
        elementHeight = element.props.height;
        hasExplicitHeight = true;
      } else if (style?.height && typeof style.height === 'number') {
        elementHeight = style.height as number;
        hasExplicitHeight = true;
      }

      // Only use intrinsicSize as fallback when no explicit dimensions were set
      if ((!hasExplicitWidth || !hasExplicitHeight) && hasIntrinsicSize(element)) {
        try {
          const intrinsic = element.intrinsicSize({
            availableSpace: { width: ctx.bounds.width, height: 100 },
          });
          if (!hasExplicitWidth && intrinsic.width) {
            elementWidth = Math.min(intrinsic.width, ctx.bounds.width);
          }
          if (!hasExplicitHeight && intrinsic.height) {
            elementHeight = intrinsic.height;
          }
        } catch {
          // Use defaults
        }
      }

      // Create bounds for the element
      const elementBounds: Bounds = {
        x: ctx.currentX,
        y: localY,
        width: elementWidth,
        height: elementHeight,
      };

      // Use renderElementSubtree for full layout pipeline (flexbox, gap, etc.)
      renderElementSubtree(element, ctx.buffer, elementBounds, ctx.context);

      totalHeight += elementHeight;
      localY += elementHeight;
    } catch (error) {
      // Render error message
      const errorStyle: Partial<Cell> = {
        ...ctx.style,
        foreground: getThemeColor('error'),
      };
      const errorMsg = `[Melker error: ${error instanceof Error ? error.message : String(error)}]`;
      ctx.buffer.currentBuffer.setText(ctx.currentX, localY, errorMsg.substring(0, ctx.bounds.width), errorStyle);
      totalHeight += 1;
      localY += 1;
    }

    // Add spacing after
    totalHeight += 1;

    return totalHeight;
  }

  /**
   * Render a mermaid code block inline (similar to melker blocks)
   * Uses the graph element and renders it at the current position
   */
  /**
   * Recursively resolve relative file paths on elements and their children
   */
  private _resolvePathsRecursive(element: Element, helpers: CodeRenderHelpers): void {
    if (element.props.src && typeof element.props.src === 'string') {
      element.props.src = helpers.resolveImagePath(element.props.src);
    }
    if (element.props.subtitle && typeof element.props.subtitle === 'string') {
      element.props.subtitle = helpers.resolveImagePath(element.props.subtitle);
    }
    if (element.props.poster && typeof element.props.poster === 'string') {
      element.props.poster = helpers.resolveImagePath(element.props.poster);
    }
    if (element.children) {
      for (const child of element.children) {
        this._resolvePathsRecursive(child, helpers);
      }
    }
  }

  renderMermaidBlock(code: string, ctx: MarkdownRenderContext): number {
    // Use local y tracking
    let localY = ctx.currentY;
    let totalHeight = 1; // spacing before
    localY += 1;

    try {
      // Find the cached graph element for this code
      const cacheKey = `mermaid:${code.trim()}`;
      const graphElement = this._mermaidElements.get(cacheKey);

      if (!graphElement) {
        // Graph not found - show error
        const errorStyle: Partial<Cell> = { ...ctx.style, foreground: getThemeColor('error') };
        ctx.buffer.currentBuffer.setText(ctx.currentX, localY, '[Mermaid: graph not found]', errorStyle);
        return totalHeight + 2;
      }

      // Get intrinsic size of the graph
      // For flex containers with wrapping, intrinsic size may be smaller than rendered size
      // Use available width for proper layout calculation
      const availableWidth = Math.max(ctx.bounds.width, 80);
      const intrinsicSize = graphElement.intrinsicSize({
        availableSpace: { width: availableWidth, height: 200 },
      });

      // Use the available width for the graph so flex layout works correctly
      const graphWidth = availableWidth;

      // Calculate height based on content wrapping
      // For horizontal flowcharts with flex-wrap, content wraps vertically when it doesn't fit
      // Estimate: if content is Nx wider than available space, it will wrap to N rows
      const widthRatio = Math.max(1, Math.ceil(intrinsicSize.width / availableWidth));
      // Each row needs the intrinsic height plus gap space for wrapping
      // Add minimal padding for borders
      const rowHeight = intrinsicSize.height + 2;
      const graphHeight = rowHeight * widthRatio;

      // Create bounds for the graph
      const graphBounds: Bounds = {
        x: ctx.currentX,
        y: localY,
        width: graphWidth,
        height: graphHeight,
      };

      // Get the generated element (container with nodes)
      const generatedElement = graphElement.getGeneratedElement();
      if (generatedElement) {
        // Render the graph subtree using the standalone render helper
        // The helper registers element bounds with the main renderer for hit testing
        renderElementSubtree(generatedElement, ctx.buffer, graphBounds, ctx.context);
      }

      totalHeight += graphHeight;
      localY += graphHeight;
    } catch (error) {
      // Render error message
      const errorStyle: Partial<Cell> = { ...ctx.style, foreground: getThemeColor('error') };
      const errorMsg = `[Mermaid error: ${error instanceof Error ? error.message : String(error)}]`;
      ctx.buffer.currentBuffer.setText(ctx.currentX, localY, errorMsg.substring(0, ctx.bounds.width), errorStyle);
      totalHeight += 1;
      localY += 1;
    }

    // Add spacing after
    totalHeight += 1;

    return totalHeight;
  }

  /**
   * Get code block style based on theme
   */
  getCodeBlockStyle(theme: string | undefined, baseStyle: Partial<Cell>): Partial<Cell> {
    const themeType = getThemeManager().getThemeType();
    const isDarkMode = getThemeManager().isDarkMode();

    // For 16-color themes (color-std, color-dark), use high-contrast combinations
    // because surface and textSecondary may have poor contrast
    if (themeType === 'color') {
      if (isDarkMode) {
        // color-dark: use black bg with cyan text for good contrast
        return {
          ...baseStyle,
          background: COLORS.black,
          foreground: COLORS.cyan
        };
      } else {
        // color-std: use brightBlack bg with white text for good contrast
        return {
          ...baseStyle,
          background: COLORS.brightBlack,
          foreground: COLORS.white
        };
      }
    }

    // For other themes (bw, gray, fullcolor), use standard palette colors
    return {
      ...baseStyle,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textSecondary')
    };
  }
}
