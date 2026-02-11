// Markdown component implementation
// Phase 1: Basic AST parsing and simple text rendering
// Phase 2: Heading, paragraph, and basic inline formatting
// Phase 3: Lists, code blocks, and blockquotes

import { Element, Renderable, Interactive, TextSelectable, Bounds, ComponentRenderContext, IntrinsicSizeContext, hasIntrinsicSize } from '../types.ts';
import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { fromMarkdown, gfm, gfmFromMarkdown } from '../deps.ts';
import { getThemeColor, getThemeManager } from '../theme.ts';
import { type SixelOutputData, type KittyOutputData } from './canvas-render.ts';
import { GraphElement } from './graph/mod.ts';
import { getLogger } from '../logging.ts';
import { getStringWidth } from '../char-width.ts';
import { MelkerConfig } from '../config/mod.ts';
import { COLORS, parseColor } from './color-utils.ts';
import { MarkdownImageRenderer } from './markdown-image.ts';
import { renderTable as renderTableHelper, type TableRenderHelpers } from './markdown-table.ts';
import { MarkdownCodeRenderer, type CodeRenderHelpers } from './markdown-code.ts';
import { isUrl } from '../utils/content-loader.ts';

// Types
import {
  type Position,
  type SpacingRule,
  type NodeType,
  DEFAULT_SPACING,
  getSpacing,
  type MarkdownStyleConfig,
  DEFAULT_STYLES,
  type ASTNode,
  type Root,
  type Paragraph,
  type Heading,
  type Text,
  type Strong,
  type Emphasis,
  type InlineCode,
  type List,
  type ListItem,
  type Code,
  type Blockquote,
  type Table,
  type TableRow,
  type TableCell,
  type Html,
  type Image,
  type Link,
  type LinkRegion,
  type LinkEvent,
  type MarkdownProps,
  type MarkdownRenderContext,
} from './markdown-types.ts';

// Re-export public types
export type { MarkdownStyleConfig, LinkEvent, MarkdownProps } from './markdown-types.ts';

// ============================================================================
// Text Utilities - display width calculation and text wrapping
// ============================================================================

/**
 * Pad a string to a target display width, accounting for wide characters
 */
function padEndDisplayWidth(str: string, targetWidth: number, padChar: string = ' '): string {
  const currentWidth = getStringWidth(str);
  if (currentWidth >= targetWidth) return str;
  return str + padChar.repeat(targetWidth - currentWidth);
}

/**
 * Find optimal break point in text for word wrapping
 * Prefers breaking at spaces or after commas within the maxWidth limit
 * @returns Break index, or maxWidth if no good break point found
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
 * Wrap text into lines that fit within a given width
 * Attempts to break at word boundaries (spaces or commas)
 */
function wrapTextToLines(text: string, width: number): string[] {
  if (text.length <= width) {
    return [text];
  }

  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= width) {
      lines.push(remaining);
      break;
    }

    const breakPoint = findBreakPoint(remaining, width);

    lines.push(remaining.substring(0, breakPoint).trimEnd());
    remaining = remaining.substring(breakPoint).trimStart();
  }

  return lines.length > 0 ? lines : [''];
}

// ============================================================================

const logger = getLogger('Markdown');

// Debug mode check - enabled via prop or config (fallback)
function isMarkdownDebugEnabledFromEnv(): boolean {
  try {
    return MelkerConfig.get().markdownDebug;
  } catch {
    return false;
  }
}

export class MarkdownElement extends Element implements Renderable, Interactive, TextSelectable {
  declare type: 'markdown';
  declare props: MarkdownProps;

  private _parsedAst: Root | null = null;
  private _lastParsedText: string | null = null; // Track text that was parsed for cache invalidation
  private _srcContent: string | null = null;
  private _lastSrc: string | null = null;
  private _hasLoadedContent: boolean = false;
  // Error message to display when content loading fails
  private _loadError: string | null = null;
  // Image rendering (handles canvas caching, aspect ratios, path resolution)
  private _imageRenderer: MarkdownImageRenderer = new MarkdownImageRenderer();
  // Code block rendering (handles melker blocks, mermaid diagrams, code blocks)
  private _codeRenderer: MarkdownCodeRenderer = new MarkdownCodeRenderer();
  // Link regions for click detection (rebuilt on each render)
  private _linkRegions: LinkRegion[] = [];
  // Last render bounds for click coordinate mapping
  private _lastRenderBounds: Bounds | null = null;
  // Last scroll offset for click coordinate translation
  private _lastScrollOffset: { x: number; y: number } = { x: 0, y: 0 };
  // Actual rendered content height (set during render)
  private _lastRenderedHeight: number = 0;

  constructor(props: MarkdownProps, children: Element[] = []) {
    const defaultProps: MarkdownProps = {
      disabled: false,
      enableGfm: true,
      listIndent: 2,
      codeTheme: 'auto',
      ...props,
      style: {
        // Default styles would go here (none currently)
        ...props.style
      },
    };

    super('markdown', defaultProps, children);
  }

  /**
   * Get the markdown content (either from text prop, children, or loaded from src)
   */
  getContent(): string | null {
    // Prefer inline text prop
    if (this.props.text) {
      return this.props.text;
    }

    // Check for text children (from <markdown>content</markdown> syntax)
    if (this.children && this.children.length > 0) {
      const textContent = this.children
        .filter(child => child.type === 'text')
        .map(child => child.props.text ?? '')
        .join('');
      if (textContent) {
        return textContent;
      }
    }

    // Fall back to loaded src content
    return this._srcContent;
  }

  /**
   * Get the markdown text value (alias for getContent for API consistency)
   */
  getValue(): string {
    return this.getContent() ?? '';
  }

  /**
   * Set the markdown text value
   */
  setValue(text: string): void {
    this.props.text = text;
    // Invalidate the parsed AST cache
    this._parsedAst = null;
    this._lastParsedText = null;
  }

  /**
   * Fetch content from src URL if specified
   */
  private async _fetchSrcContent(): Promise<string | null> {
    const { src } = this.props;
    if (!src) return null;

    // Check if we already have this content cached
    if (this._lastSrc === src && this._srcContent !== null) {
      return this._srcContent;
    }

    let resolvedUrl = '';
    try {
      // Get engine instance to resolve URL
      const engine = globalThis.melkerEngine;
      if (!engine || typeof engine.resolveUrl !== 'function') {
        logger.error('Engine not available for URL resolution');
        return null;
      }


      resolvedUrl = engine.resolveUrl(src);

      // For relative paths (not starting with / or protocol), try cwd first
      // This handles command-line arguments like "examples/foo.md"
      if (!src.startsWith('/') && !src.startsWith('http://') && !src.startsWith('https://') && !src.startsWith('file://')) {
        const cwdPath = `${Deno.cwd()}/${src}`;
        try {
          await Deno.stat(cwdPath);
          // File exists at cwd-relative path, use it
          resolvedUrl = `file://${cwdPath}`;
        } catch {
          // File doesn't exist at cwd, fall through to use baseUrl-resolved path
        }
      }

      if (resolvedUrl.startsWith('file://')) {
        // Local file access - use URL.pathname for proper parsing
        const filePath = new URL(resolvedUrl).pathname;
        this._srcContent = await Deno.readTextFile(filePath);
      } else if (isUrl(resolvedUrl)) {
        // HTTP/HTTPS URL
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        this._srcContent = await response.text();
      } else {
        throw new Error(`Unsupported URL scheme: ${resolvedUrl}`);
      }

      this._lastSrc = src;
      this._imageRenderer.setResolvedSrcUrl(resolvedUrl); // Store the actual resolved URL for image path resolution
      this._hasLoadedContent = true;
      return this._srcContent;
    } catch (error) {
      logger.warn("Failed to load " + src + " " + resolvedUrl, { error: String(error) });
      // Set error message for UI display
      const errorName = (error as any)?.name || 'Error';
      if (errorName === 'NotFound') {
        this._loadError = `File not found: ${src}`;
      } else {
        this._loadError = `Failed to load: ${src} ${resolvedUrl}` + error;
      }
      this._srcContent = null;
      this._lastSrc = src; // Mark this src as attempted to prevent retry loops
      this._hasLoadedContent = true; // Mark as "loaded" to stop retrying
      return null;
    }
  }

  /**
   * Render the markdown content to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    let { text, src } = this.props;

    // Clear link regions from previous render and store bounds
    this._linkRegions = [];
    this._lastRenderBounds = bounds;

    // Store scroll offset for click coordinate translation (from render context)
    this._lastScrollOffset = context.scrollOffset || { x: 0, y: 0 };

    // If src is specified, handle async content loading
    if (src) {
      // Trigger async fetch if we don't have content AND haven't already tried this src
      // The _hasLoadedContent flag prevents infinite loops when file doesn't exist
      if ((!this._srcContent && !this._hasLoadedContent) || this._lastSrc !== src) {
        // Clear error and loaded flag when starting a new fetch for a different src
        if (this._lastSrc !== src) {
          this._loadError = null;
          this._hasLoadedContent = false;
          this._imageRenderer.reset(); // Reset for new content
          this._lastRenderedHeight = 0;
        }
        this._fetchSrcContent().then(content => {
          if (content !== null) {
            // Clear cached AST to force re-parsing of new content
            this._parsedAst = null;
            this._lastParsedText = null;
            this._loadError = null; // Clear any previous error
            this._imageRenderer.reset(); // Reset for new content
            this._lastRenderedHeight = 0;
            // Try to trigger a full re-render with layout recalculation
            const engine = globalThis.melkerEngine;
            if (engine && typeof engine.forceRender === 'function') {
              engine.forceRender();
              // Force another render after a short delay to ensure layout recalculation
              setTimeout(() => {
                if (engine && typeof engine.forceRender === 'function') {
                  engine.forceRender();
                }
              }, 10);
            }
          } else {
            // Content is null - either error or still loading, trigger re-render to show error
            const engine = globalThis.melkerEngine;
            if (engine && typeof engine.forceRender === 'function') {
              engine.forceRender();
            }
          }
        }).catch(error => {
          logger.error('Error fetching markdown content', error instanceof Error ? error : new Error(String(error)));
        });
      }

      // Priority: Show error first, then loaded content, then loading message
      if (this._loadError) {
        // Display error message in markdown format (bold red)
        text = `**Error:** ${this._loadError}`;
      } else if (this._srcContent) {
        text = this._srcContent;
      } else if (text) {
        // Keep existing text while loading
      } else {
        text = `*Loading content from: ${src}...*`;
      }
    }

    if (!text) return;

    // Ensure we have valid bounds before rendering
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    // Clear the rendering area first to prevent garbage characters
    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, bounds.height, {
      char: EMPTY_CHAR,
      foreground: style.foreground,
      background: style.background
    });



    // Parse markdown if text changed (cache invalidation)
    if (text !== this._lastParsedText) {
      this._parseMarkdown(text, this.props.enableGfm);
      this._lastParsedText = text;
    }

    if (!this._parsedAst) {
      // Fallback to plain text if parsing failed
      buffer.currentBuffer.setText(bounds.x, bounds.y, text, style);
      return;
    }

    // Check if debug mode is enabled (prop takes precedence over env var)
    const debugEnabled = this.props.debug ?? isMarkdownDebugEnabledFromEnv();
    const debugOverlay = debugEnabled ? new Map<number, { inputLine: number; renderedLine: number }>() : undefined;

    // Create render context
    const renderContext: MarkdownRenderContext = {
      bounds,
      style,
      buffer,
      context,
      currentY: bounds.y,
      currentX: bounds.x,
      baseStyle: style,
      debugEnabled,
      inputLine: 1,
      renderedLine: 1,
      debugOverlay
    };

    // Render the AST and store the actual rendered height
    const previousHeight = this._lastRenderedHeight;
    this._lastRenderedHeight = this._renderNode(this._parsedAst, renderContext);

    // If height changed and not yet stabilized, request re-layout to update scroll dimensions
    // This implements the "two-pass" layout: first render determines actual height,
    // then re-layout updates scrollable parent containers with correct dimensions
    const heightDiff = Math.abs(this._lastRenderedHeight - previousHeight);
    if (heightDiff > 0 && !this._imageRenderer.isHeightStabilized()) {
      // Mark as stabilized to prevent infinite loops
      this._imageRenderer.setHeightStabilized(true);

      // Use forceRender from engine if available for full layout recalculation
      const engine = globalThis.melkerEngine;
      if (engine && typeof engine.forceRender === 'function') {
        // Schedule with small delay to allow current render to complete
        setTimeout(() => {
          engine.forceRender();
        }, 10);
      } else if (context.requestRender) {
        setTimeout(() => {
          context.requestRender?.();
        }, 10);
      }
    } else if (heightDiff === 0 && previousHeight > 0) {
      // Height has stabilized
      this._imageRenderer.setHeightStabilized(true);
    }

    // Debug overlay: show line counters on right side if enabled
    if (debugEnabled && debugOverlay) {
      this._renderDebugOverlay(bounds, buffer, debugOverlay);
    }

  }

  /**
   * Render debug overlay showing line counters on each line
   * Format: "CCC/RRR" (content line / rendered line) on the right side
   * Content lines increment sequentially for each line with content
   */
  private _renderDebugOverlay(
    bounds: Bounds,
    buffer: DualBuffer,
    debugOverlay: Map<number, { inputLine: number; renderedLine: number }>
  ): void {
    const lineNumStyle: Partial<Cell> = {
      foreground: COLORS.cyan,
      background: COLORS.black
    };
    const spacingStyle: Partial<Cell> = {
      foreground: COLORS.brightBlack,
      background: COLORS.black
    };

    // Overlay width: "999/999" = 7 chars, plus 8 chars offset to avoid scrollbar
    const overlayWidth = 7;
    const overlayX = bounds.x + bounds.width - overlayWidth - 8;

    // Count content lines sequentially
    let contentLineNum = 0;

    // Iterate over all y positions in bounds
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      const renderedLineNum = y - bounds.y + 1;
      const info = debugOverlay.get(y);

      if (info) {
        // Content line - increment counter
        contentLineNum++;
        const label = String(contentLineNum).padStart(3) + '/' + String(renderedLineNum).padStart(3);
        buffer.currentBuffer.setText(overlayX, y, label, lineNumStyle);
      } else {
        // Spacing line - show dash for content, rendered line number
        const label = '  -/' + String(renderedLineNum).padStart(3);
        buffer.currentBuffer.setText(overlayX, y, label, spacingStyle);
      }
    }
  }

  /**
   * Parse markdown text into AST
   */
  private _parseMarkdown(text : string, enableGfm? : boolean): void {

    try {
      if (enableGfm) {
        // Parse with GitHub Flavored Markdown support
        this._parsedAst = fromMarkdown(text, {
          extensions: [gfm()],
          mdastExtensions: [gfmFromMarkdown()]
        });
      } else {
        // Standard markdown parsing
        this._parsedAst = fromMarkdown(text);
      }

      // Note: Mermaid blocks are rendered inline via _renderMermaidBlock
      // They are cached in the code renderer for reuse but NOT added as children
      // This allows them to flow naturally with markdown content
      this._cacheMermaidElements();
    } catch (error) {
      logger.error('Failed to parse markdown', error instanceof Error ? error : new Error(String(error)));
      this._parsedAst = null;
    }
  }

  /**
   * Cache mermaid code blocks as GraphElements for rendering
   * Elements are NOT added as children (that causes double rendering)
   * Hit testing is handled via getSubtreeElements() which the hit tester checks
   */
  private _cacheMermaidElements(): void {
    if (!this._parsedAst) return;

    // Find all mermaid code blocks in the AST and cache them in the code renderer
    const mermaidBlocks = this._findMermaidBlocks(this._parsedAst);
    this._codeRenderer.cacheMermaidBlocks(mermaidBlocks);
  }

  /**
   * Get subtree elements for hit testing and focus management
   * Subtree elements are rendered inline but not as children (e.g., mermaid graphs)
   * Called by Document and HitTester to find interactive elements
   */
  getSubtreeElements(): Element[] {
    const elements: Element[] = [];
    for (const graphElement of this._codeRenderer.getMermaidElements().values()) {
      const generated = graphElement.getGeneratedElement();
      if (generated) {
        elements.push(generated);
      }
    }
    return elements;
  }

  /**
   * Recursively find all mermaid code blocks in AST
   */
  private _findMermaidBlocks(node: ASTNode): string[] {
    const blocks: string[] = [];

    if (node.type === 'code' && (node as Code).lang === 'mermaid') {
      blocks.push((node as Code).value);
    }

    // Check children
    if ('children' in node && Array.isArray(node.children)) {
      for (const child of node.children) {
        blocks.push(...this._findMermaidBlocks(child));
      }
    }

    return blocks;
  }

  /**
   * Render a single AST node
   */
  private _renderNode(node: ASTNode, ctx: MarkdownRenderContext): number {
    // Track source line from AST position info
    const nodePosition = node.position;
    const startY = ctx.currentY;

    // Update input line tracking from AST position
    if (nodePosition?.start?.line && ctx.debugEnabled) {
      ctx.inputLine = nodePosition.start.line;
    }

    // Return height consumed by this node
    let height = 0;
    switch (node.type) {
      case 'root':
        height = this._renderRoot(node as Root, ctx);
        break;
      case 'paragraph':
        height = this._renderParagraph(node as Paragraph, ctx);
        break;
      case 'heading':
        height = this._renderHeading(node as Heading, ctx);
        break;
      case 'text':
        height = this._renderText(node as Text, ctx);
        break;
      case 'strong':
        height = this._renderStrong(node as Strong, ctx);
        break;
      case 'emphasis':
        height = this._renderEmphasis(node as Emphasis, ctx);
        break;
      case 'inlineCode':
        height = this._renderInlineCode(node as InlineCode, ctx);
        break;
      // Phase 3: New node types
      case 'list':
        height = this._renderList(node as List, ctx);
        break;
      case 'listItem':
        // ListItems are rendered through _renderList with proper context
        // This case handles orphan listItems (shouldn't happen in valid markdown)
        if (ctx.listDepth && ctx.listType && (ctx as { listMarkerWidth?: number }).listMarkerWidth) {
          height = this._renderListItem(node as ListItem, ctx as MarkdownRenderContext & { listDepth: number; listType: 'ordered' | 'unordered'; listMarkerWidth: number });
        } else {
          // Fallback: render children directly
          height = this._renderChildren((node as ListItem).children, ctx);
        }
        break;
      case 'code':
        height = this._renderCodeBlock(node as Code, ctx);
        break;
      case 'blockquote':
        height = this._renderBlockquote(node as Blockquote, ctx);
        break;
      // Table support (GFM extension)
      case 'table':
        height = this._renderTable(node as Table, ctx);
        break;
      // Image support
      case 'html':
        height = this._renderHtml(node as Html, ctx);
        break;
      case 'image':
        height = this._renderImage(node as Image, ctx);
        break;
      default:
        // Unsupported node types - render children if any
        if ('children' in node && Array.isArray(node.children)) {
          height = this._renderChildren(node.children, ctx);
        }
        break;
    }

    // Record debug info for all lines rendered by this node (except root which is just a container)
    if (ctx.debugEnabled && ctx.debugOverlay && node.type !== 'root' && height > 0) {
      const inputLine = nodePosition?.start?.line || ctx.inputLine || 0;
      for (let i = 0; i < height; i++) {
        const y = startY + i;
        if (!ctx.debugOverlay.has(y)) {
          ctx.debugOverlay.set(y, {
            inputLine,
            renderedLine: (ctx.renderedLine || 1) + i
          });
        }
      }
      if (ctx.renderedLine !== undefined) {
        ctx.renderedLine += height;
      }
    }

    return height;
  }

  /**
   * Render root node (document root)
   */
  private _renderRoot(node: Root, ctx: MarkdownRenderContext): number {
    let totalHeight = 0;

    // Render ALL content - let container handle clipping and scrolling
    for (const child of node.children) {
      const height = this._renderNode(child, ctx);
      totalHeight += height;
      ctx.currentY += height;
      ctx.currentX = ctx.bounds.x; // Reset X position for each block
    }

    return totalHeight;
  }

  /**
   * Render paragraph node
   */
  private _renderParagraph(node: Paragraph, ctx: MarkdownRenderContext): number {
    // For image-only paragraphs, convert to <img> tag and use exact same path as HTML img
    if (node.children.length === 1 && node.children[0].type === 'image') {
      const img = node.children[0] as Image;
      const alt = img.alt ? ` alt="${img.alt}"` : '';
      const htmlNode = { type: 'html', value: `<img src="${img.url}"${alt} width="100%">` } as Html;
      return this._renderHtml(htmlNode, ctx);
    }

    const height = this._renderInlineElements(node.children, ctx);

    // Add spacing after paragraph only if not inside a list item
    const isInsideListItem = ctx.listDepth && ctx.listDepth > 0;
    const spacing = getSpacing('paragraph');
    return isInsideListItem ? height : height + spacing.after;
  }

  /**
   * Render heading node with appropriate styling
   */
  private _renderHeading(node: Heading, ctx: MarkdownRenderContext): number {
    // Create heading style based on level
    const headingStyle = this._getHeadingStyle(node.depth, ctx.baseStyle);
    const headingContext = { ...ctx, style: headingStyle };
    const spacing = getSpacing('heading');

    // For H1, render text then pad with underlined spaces to full width
    if (node.depth === 1) {
      // Get the heading text content
      const textContent = this._extractTextContent(node);
      const fullWidth = ctx.bounds.width;
      const paddedText = textContent.padEnd(fullWidth);
      ctx.buffer.currentBuffer.setText(ctx.currentX, ctx.currentY, paddedText, headingStyle);
      return 1 + spacing.after; // heading + spacing
    }

    const height = this._renderInlineElements(node.children, headingContext);

    // Add spacing after heading
    return height + spacing.after;
  }

  /**
   * Render text node
   */
  private _renderText(node: Text, ctx: MarkdownRenderContext): number {
    return this._renderTextContent(node.value, ctx);
  }

  /**
   * Render strong (bold) text
   */
  private _renderStrong(node: Strong, ctx: MarkdownRenderContext): number {
    // This method is only called for block-level strong elements
    // Most strong elements are handled by _renderInlineElement
    const boldContext = { ...ctx, style: this._getBoldStyle(ctx.style) };
    return this._renderInlineElements(node.children, boldContext);
  }

  /**
   * Render emphasis (italic) text
   */
  private _renderEmphasis(node: Emphasis, ctx: MarkdownRenderContext): number {
    // This method is only called for block-level emphasis elements
    // Most emphasis elements are handled by _renderInlineElement
    const emphasisContext = { ...ctx, style: this._getEmphasisStyle(ctx.style) };
    return this._renderInlineElements(node.children, emphasisContext);
  }

  /**
   * Render inline code
   */
  private _renderInlineCode(node: InlineCode, ctx: MarkdownRenderContext): number {
    const codeStyle = this._getInlineCodeStyle(ctx.style);
    return this._renderTextContent(node.value, { ...ctx, style: codeStyle });
  }

  /**
   * Render multiple child nodes and collect their content
   */
  private _renderChildren(children: ASTNode[], ctx: MarkdownRenderContext): number {
    let totalHeight = 0;

    for (const child of children) {
      const height = this._renderNode(child, ctx);
      totalHeight += height;
      ctx.currentY += height;
    }

    return totalHeight;
  }

  /**
   * Render inline elements with proper styling and word wrapping
   */
  private _renderInlineElements(children: ASTNode[], ctx: MarkdownRenderContext): number {
    if (!children.length) return 0;

    // Check if wrapping is enabled
    const elementStyle = this.props.style || {};
    const textWrap = elementStyle.textWrap || 'wrap';

    // Flatten all inline elements into styled spans for easier wrapping
    const spans = this._flattenInlineElements(children, ctx.style);

    if (textWrap === 'nowrap') {
      // No wrapping - render on single line, truncate if needed
      let currentX = ctx.currentX;
      const maxX = ctx.bounds.x + ctx.bounds.width;
      for (const span of spans) {
        if (currentX >= maxX) break;
        const availableWidth = maxX - currentX;
        const text = span.text.substring(0, availableWidth);
        if (text.length > 0) {
          ctx.buffer.currentBuffer.setText(currentX, ctx.currentY, text, span.style);
          // Register link regions if this span is a link
          if (span.linkUrl) {
            this._linkRegions.push({
              x: currentX,
              y: ctx.currentY,
              width: text.length,
              url: span.linkUrl,
              title: span.linkTitle
            });
          }
          currentX += text.length;
        }
      }
      ctx.currentX = currentX;
      return 1;
    }

    // Wrapping mode - render with word wrapping
    let currentX = ctx.currentX;
    let currentY = ctx.currentY;
    const startY = currentY;
    const maxX = ctx.bounds.x + ctx.bounds.width;
    const maxY = ctx.bounds.y + ctx.bounds.height;

    for (const span of spans) {
      // Split span text into words for wrapping
      const words = span.text.split(/(\s+)/); // Keep whitespace as separate entries

      for (const word of words) {
        if (word.length === 0) continue;

        // Check if word fits on current line
        if (currentX + word.length > maxX && currentX > ctx.bounds.x) {
          // Word doesn't fit, wrap to next line
          currentY++;
          currentX = ctx.bounds.x;
          if (currentY >= maxY) break;
        }

        // Skip leading whitespace at start of line
        if (currentX === ctx.bounds.x && word.trim().length === 0) {
          continue;
        }

        // Render the word (may need to split if very long)
        let remaining = word;
        while (remaining.length > 0 && currentY < maxY) {
          const availableWidth = maxX - currentX;
          const chunk = remaining.substring(0, availableWidth);
          if (chunk.length > 0) {
            ctx.buffer.currentBuffer.setText(currentX, currentY, chunk, span.style);
            // Register link regions if this span is a link
            if (span.linkUrl) {
              this._linkRegions.push({
                x: currentX,
                y: currentY,
                width: chunk.length,
                url: span.linkUrl,
                title: span.linkTitle
              });
            }
            currentX += chunk.length;
          }
          remaining = remaining.substring(availableWidth);
          if (remaining.length > 0) {
            // More text to render, wrap to next line
            currentY++;
            currentX = ctx.bounds.x;
          }
        }
      }
      if (currentY >= maxY) break;
    }

    ctx.currentX = currentX;
    // Don't update ctx.currentY - callers are responsible for that based on returned height
    return currentY - startY + 1;
  }

  /**
   * Flatten inline elements into styled text spans for easier wrapping
   */
  private _flattenInlineElements(nodes: ASTNode[], baseStyle: Partial<Cell>): Array<{text: string, style: Partial<Cell>, linkUrl?: string, linkTitle?: string}> {
    const spans: Array<{text: string, style: Partial<Cell>, linkUrl?: string, linkTitle?: string}> = [];

    for (const node of nodes) {
      this._collectSpans(node, baseStyle, spans);
    }

    return spans;
  }

  /**
   * Recursively collect text spans with their styles
   */
  private _collectSpans(node: ASTNode, style: Partial<Cell>, spans: Array<{text: string, style: Partial<Cell>, linkUrl?: string, linkTitle?: string}>, linkUrl?: string, linkTitle?: string): void {
    switch (node.type) {
      case 'text':
        spans.push({ text: (node as Text).value, style, linkUrl, linkTitle });
        break;

      case 'strong':
        for (const child of (node as Strong).children) {
          this._collectSpans(child, this._getBoldStyle(style), spans, linkUrl, linkTitle);
        }
        break;

      case 'emphasis':
        for (const child of (node as Emphasis).children) {
          this._collectSpans(child, this._getEmphasisStyle(style), spans, linkUrl, linkTitle);
        }
        break;

      case 'inlineCode': {
        const codeValue = (node as InlineCode).value;
        const codeStyle = this._getInlineCodeStyle(style);
        // Auto-link .md file references (e.g., `path/to/file.md`)
        const mdLinkUrl = codeValue.endsWith('.md') ? codeValue : undefined;
        if (mdLinkUrl) {
          // Apply link style + code style for .md file links
          const linkedCodeStyle = { ...codeStyle, underline: true, link: mdLinkUrl };
          spans.push({ text: codeValue, style: linkedCodeStyle, linkUrl: mdLinkUrl, linkTitle: codeValue });
        } else {
          spans.push({ text: codeValue, style: codeStyle, linkUrl, linkTitle });
        }
        break;
      }

      case 'link': {
        const linkNode = node as Link;
        const linkStyle = { ...this._getLinkStyle(style), link: linkNode.url };
        for (const child of linkNode.children) {
          this._collectSpans(child, linkStyle, spans, linkNode.url, linkNode.title);
        }
        break;
      }

      default:
        if ('children' in node && Array.isArray(node.children)) {
          for (const child of node.children as ASTNode[]) {
            this._collectSpans(child, style, spans, linkUrl, linkTitle);
          }
        }
        break;
    }
  }

  /**
   * Render a single inline element and return its width
   */
  private _renderInlineElement(node: ASTNode, x: number, y: number, ctx: MarkdownRenderContext): number {
    switch (node.type) {
      case 'text': {
        const text = (node as Text).value;
        ctx.buffer.currentBuffer.setText(x, y, text, ctx.style);
        return text.length;
      }

      case 'strong': {
        const boldStyle = this._getBoldStyle(ctx.style);
        let boldWidth = 0;
        for (const child of (node as Strong).children) {
          boldWidth += this._renderInlineElement(child, x + boldWidth, y, { ...ctx, style: boldStyle });
        }
        return boldWidth;
      }

      case 'emphasis': {
        const emphasisStyle = this._getEmphasisStyle(ctx.style);
        let emphasisWidth = 0;
        for (const child of (node as Emphasis).children) {
          emphasisWidth += this._renderInlineElement(child, x + emphasisWidth, y, { ...ctx, style: emphasisStyle });
        }
        return emphasisWidth;
      }

      case 'inlineCode': {
        const inlineCodeStyle = this._getInlineCodeStyle(ctx.style);
        const codeText = (node as InlineCode).value;
        ctx.buffer.currentBuffer.setText(x, y, codeText, inlineCodeStyle);
        return codeText.length;
      }

      case 'link': {
        const linkNode = node as Link;
        // Style for links: underline and use primary color, with OSC 8 hyperlink
        const inlineLinkStyle = { ...this._getLinkStyle(ctx.style), link: linkNode.url };
        // Get link text from children
        let linkWidth = 0;
        for (const child of linkNode.children) {
          linkWidth += this._renderInlineElement(child, x + linkWidth, y, { ...ctx, style: inlineLinkStyle });
        }
        // Register this link region for click detection
        this._linkRegions.push({
          x,
          y,
          width: linkWidth,
          url: linkNode.url,
          title: linkNode.title
        });
        logger.debug(`Registered link region: x=${x}, y=${y}, width=${linkWidth}, url=${linkNode.url}`);
        return linkWidth;
      }

      default: {
        // For unknown inline elements, try to render children
        if ('children' in node && Array.isArray(node.children)) {
          let width = 0;
          for (const child of node.children as ASTNode[]) {
            width += this._renderInlineElement(child, x + width, y, ctx);
          }
          return width;
        }
        return 0;
      }
    }
  }

  /**
   * Render inline content and return concatenated string
   */
  private _renderInlineContent(children: ASTNode[], ctx: MarkdownRenderContext): string {
    let content = '';

    for (const child of children) {
      switch (child.type) {
        case 'text':
          content += (child as Text).value;
          break;
        case 'strong':
          content += this._renderInlineContent((child as Strong).children, ctx);
          break;
        case 'emphasis':
          content += this._renderInlineContent((child as Emphasis).children, ctx);
          break;
        case 'inlineCode':
          content += (child as InlineCode).value;
          break;
        case 'link':
          content += this._renderInlineContent((child as Link).children, ctx);
          break;
        default:
          if ('children' in child && Array.isArray(child.children)) {
            content += this._renderInlineContent(child.children, ctx);
          }
          break;
      }
    }

    return content;
  }

  /**
   * Render text content with wrapping support
   */
  private _renderTextContent(text: string, ctx: MarkdownRenderContext): number {
    if (!text) return 0;

    // Get textWrap from style (default to 'wrap' for markdown content)
    const elementStyle = this.props.style || {};
    const textWrap = elementStyle.textWrap || 'wrap';
    const availableWidth = ctx.bounds.x + ctx.bounds.width - ctx.currentX;

    if (textWrap === 'nowrap' || text.length <= availableWidth) {
      // Single line rendering
      const displayText = text.length > availableWidth ?
        text.substring(0, availableWidth) : text;

      ctx.buffer.currentBuffer.setText(ctx.currentX, ctx.currentY, displayText, ctx.style);
      ctx.currentX += displayText.length;
      return displayText.length > 0 ? 1 : 0;
    } else {
      // Multi-line rendering with wrapping
      return this._renderWrappedText(text, ctx);
    }
  }

  /**
   * Render wrapped text across multiple lines
   */
  private _renderWrappedText(text: string, ctx: MarkdownRenderContext): number {
    let linesUsed = 0;
    let remainingText = text;
    let currentY = ctx.currentY;
    let currentX = ctx.currentX;

    while (remainingText.length > 0 && currentY < ctx.bounds.y + ctx.bounds.height) {
      const availableWidth = ctx.bounds.width - (currentX - ctx.bounds.x);

      if (availableWidth <= 0) {
        currentY++;
        currentX = ctx.bounds.x;
        linesUsed++;
        continue;
      }

      const breakPoint = findBreakPoint(remainingText, availableWidth);

      const line = remainingText.substring(0, breakPoint).trimEnd();
      if (line.length > 0) {
        ctx.buffer.currentBuffer.setText(currentX, currentY, line, ctx.style);
      }

      remainingText = remainingText.substring(breakPoint).trimStart();
      currentY++;
      currentX = ctx.bounds.x;
      linesUsed++;
    }

    // Update context position
    ctx.currentY = currentY - 1; // Subtract 1 because we incremented after last line
    ctx.currentX = ctx.bounds.x;

    return linesUsed;
  }

  /**
   * Get heading style based on level
   */
  private _getHeadingStyle(depth: number, baseStyle: Partial<Cell>): Partial<Cell> {
    // Use custom styles from props, fall back to defaults
    const customHeadingStyles = this.props.styles?.heading || {};
    const defaultHeadingStyles = DEFAULT_STYLES.heading;

    const levelStyle = customHeadingStyles[depth] || defaultHeadingStyles[depth] || {};
    return { ...baseStyle, ...levelStyle };
  }

  // Phase 3: New rendering methods for lists, code blocks, and blockquotes

  /**
   * Render list node (ordered or unordered)
   */
  private _renderList(node: List, ctx: MarkdownRenderContext): number {
    let totalHeight = 0;

    // Use local Y tracking to avoid double-counting
    // (caller will update ctx.currentY by returned height)
    let localY = ctx.currentY;

    // Calculate max marker width based on actual list content
    const depth = (ctx.listDepth || 0) + 1;
    const itemCount = node.children.length;
    const lastItemNum = (node.start || 1) + itemCount - 1;
    let maxMarkerWidth = 1; // Default for unordered lists (single bullet char)

    if (node.ordered) {
      if (depth === 1) {
        // Arabic numerals: "1." to "N."
        maxMarkerWidth = String(lastItemNum).length + 1;
      } else if (depth === 2) {
        // Roman numerals: calculate width of largest
        maxMarkerWidth = this._toRoman(lastItemNum).length + 1;
      } else {
        // Alphabetical: calculate width of largest
        maxMarkerWidth = this._toAlpha(lastItemNum).length + 1;
      }
    }

    // Create list context with indentation
    const listType: 'ordered' | 'unordered' = node.ordered ? 'ordered' : 'unordered';
    const listContext = {
      ...ctx,
      currentX: ctx.bounds.x,
      listDepth: depth,
      listType,
      listStart: node.start || 1,
      listMarkerWidth: maxMarkerWidth
    };

    for (let i = 0; i < node.children.length; i++) {
      const listItem = node.children[i];
      const itemNumber = node.ordered ? (node.start || 1) + i : undefined;

      const height = this._renderListItem(listItem, {
        ...listContext,
        currentY: localY,  // Pass the local Y position to each item
        itemNumber,
        itemIndex: i
      });

      totalHeight += height;
      localY += height;
    }

    // Add spacing after list (only for top-level lists, not nested)
    if ((ctx.listDepth || 0) === 0) {
      const spacing = getSpacing('list');
      totalHeight += spacing.after;
    }

    return totalHeight;
  }

  /**
   * Render list item with appropriate bullet/number
   */
  private _renderListItem(node: ListItem, ctx: MarkdownRenderContext & { listDepth: number; listType: 'ordered' | 'unordered'; listMarkerWidth: number; itemNumber?: number; itemIndex?: number }): number {
    // Add base indent of 2 for top-level lists only
    const indent = ctx.listDepth === 1 ? 2 : 0;

    // Generate list marker
    let marker: string;
    // Use pre-calculated marker width from list context
    const markerWidth = ctx.listMarkerWidth || 2;

    if (ctx.listType === 'ordered') {
      const num = ctx.itemNumber || 1;
      const depth = ctx.listDepth || 1;
      if (depth === 1) {
        // Level 1: Arabic numerals (1. 2. 3.)
        marker = `${num}.`;
      } else if (depth === 2) {
        // Level 2: Roman numerals (i. ii. iii.)
        marker = `${this._toRoman(num)}.`;
      } else {
        // Level 3+: Alphabetical (a. b. c.)
        marker = `${this._toAlpha(num)}.`;
      }
      // Right-align marker by padding on the left
      marker = marker.padStart(markerWidth);
    } else {
      // Use different bullets for different nesting levels
      const bullets = ['•', '◦', '▪', '‣'];
      const bulletIndex = Math.min((ctx.listDepth - 1), bullets.length - 1);
      marker = bullets[bulletIndex];
    }

    // Calculate positions
    const markerX = ctx.bounds.x + indent;
    const contentX = markerX + markerWidth + 1; // +1 for space after marker
    const availableWidth = ctx.bounds.width - (contentX - ctx.bounds.x);

    if (availableWidth <= 0) {
      return 1; // Minimal height if no space
    }

    // Render the marker
    const markerStyle = {
      ...ctx.style,
      foreground: getThemeColor('textSecondary')
    };

    ctx.buffer.currentBuffer.setText(markerX, ctx.currentY, marker, markerStyle);

    // Create context for list item content
    const itemContext = {
      ...ctx,
      currentX: contentX,
      bounds: {
        ...ctx.bounds,
        x: contentX,
        width: availableWidth
      }
    };

    // Render list item children
    // Use local tracking to avoid double-counting when nested lists update ctx.currentY
    let totalHeight = 0;
    let localY = ctx.currentY;

    for (const child of node.children) {
      // Create a fresh context for each child with correct currentY
      const childCtx = { ...itemContext, currentY: localY };
      const height = this._renderNode(child, childCtx);
      totalHeight += height;
      localY += height;
    }

    // If no content was rendered, ensure at least one line
    if (totalHeight === 0) {
      totalHeight = 1;
    }

    return totalHeight;
  }

  /**
   * Convert number to lowercase Roman numeral
   */
  private _toRoman(num: number): string {
    const romanNumerals: [number, string][] = [
      [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
      [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
      [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
    ];
    let result = '';
    let remaining = num;
    for (const [value, symbol] of romanNumerals) {
      while (remaining >= value) {
        result += symbol;
        remaining -= value;
      }
    }
    return result || 'i';
  }

  /**
   * Convert number to lowercase alphabetical (a, b, c, ... z, aa, ab, ...)
   */
  private _toAlpha(num: number): string {
    let result = '';
    let n = num;
    while (n > 0) {
      n--;
      result = String.fromCharCode(97 + (n % 26)) + result;
      n = Math.floor(n / 26);
    }
    return result || 'a';
  }

  /**
   * Render code block with syntax highlighting
   * Delegates to MarkdownCodeRenderer
   */
  private _renderCodeBlock(node: Code, ctx: MarkdownRenderContext): number {
    const helpers: CodeRenderHelpers = {
      resolveImagePath: (src) => this._imageRenderer.resolveImagePath(src),
      getMarkdownSrc: () => this.props.src,
    };
    return this._codeRenderer.renderCodeBlock(node, ctx, this.props.codeTheme, helpers);
  }

  /**
   * Render blockquote with left border
   */
  private _renderBlockquote(node: Blockquote, ctx: MarkdownRenderContext): number {
    let totalHeight = 0;
    const spacing = getSpacing('blockquote');

    // Use local y tracking - don't modify ctx.currentY (caller does that)
    let localY = ctx.currentY;

    // Add spacing before blockquote
    totalHeight += spacing.before;
    localY += spacing.before;

    // Create blockquote style
    const quoteStyle = this._getBlockquoteStyle(ctx.baseStyle);
    const borderChar = '▎'; // Left border character

    // Create context for blockquote content with left padding
    const quoteContext = {
      ...ctx,
      style: quoteStyle,
      currentX: ctx.bounds.x + 2, // Indent for border + space
      currentY: localY,
      bounds: {
        ...ctx.bounds,
        x: ctx.bounds.x + 2,
        width: ctx.bounds.width - 2
      }
    };

    const startY = localY;

    // Render blockquote children
    for (const child of node.children) {
      const height = this._renderNode(child, quoteContext);
      totalHeight += height;
      quoteContext.currentY += height;
    }

    // Render left border for all lines of the blockquote
    const contentHeight = totalHeight - 1; // Subtract initial spacing
    const endY = startY + contentHeight;
    const borderStyle = {
      ...ctx.style,
      foreground: getThemeColor('info')
    };

    for (let y = Math.floor(startY); y < Math.floor(endY); y++) {
      if (y >= 0 && y < ctx.buffer.currentBuffer.height) {
        ctx.buffer.currentBuffer.setText(ctx.bounds.x, y, borderChar, borderStyle);
      }
    }

    // Add spacing after blockquote
    totalHeight += spacing.after;

    return totalHeight;
  }

  /**
   * Render table (GFM extension)
   */
  private _renderTable(node: Table, ctx: MarkdownRenderContext): number {
    const helpers: TableRenderHelpers = {
      extractTextContent: (n) => this._extractTextContent(n),
      flattenInlineElements: (nodes, style) => this._flattenInlineElements(nodes, style),
      registerLinkRegion: (region) => this._linkRegions.push(region),
    };
    return renderTableHelper(node, ctx, helpers);
  }

  /**
   * Render HTML node (handles <img> tags)
   */
  private _renderHtml(node: Html, ctx: MarkdownRenderContext): number {
    const html = node.value || '';
    logger.debug('Rendering HTML node', { html });

    // Check for img tag (supports both <img ...> and <img ... />)
    const imgMatch = html.match(/<img\s+([^>]*?)\s*\/?>/i);
    if (imgMatch) {
      logger.debug('Found img tag', { attributes: imgMatch[1] });
      return this._renderImgTag(imgMatch[1], ctx);
    }

    // For other HTML, just show placeholder text
    logger.debug('No img tag found in HTML');
    return 0;
  }

  /**
   * Render markdown image node ![alt](url)
   */
  private _renderImage(node: Image, ctx: MarkdownRenderContext): number {
    return this._imageRenderer.renderImage(node, ctx);
  }

  /**
   * Parse and render an <img> tag
   */
  private _renderImgTag(attributes: string, ctx: MarkdownRenderContext): number {
    return this._imageRenderer.renderImgTag(attributes, ctx);
  }

  /**
   * Get bold (strong) style
   */
  private _getBoldStyle(baseStyle: Partial<Cell>): Partial<Cell> {
    return { ...baseStyle, bold: true };
  }

  /**
   * Get emphasis (italic) style
   */
  private _getEmphasisStyle(baseStyle: Partial<Cell>): Partial<Cell> {
    return { ...baseStyle, italic: true, dim: true };
  }

  /**
   * Get inline code style
   */
  private _getInlineCodeStyle(baseStyle: Partial<Cell>): Partial<Cell> {
    const customStyle = this.props.styles?.inlineCode || {};
    return {
      ...baseStyle,
      background: parseColor(customStyle.background) ?? getThemeColor('surface'),
      foreground: parseColor(customStyle.foreground) ?? getThemeColor('info')
    };
  }

  /**
   * Get link style
   */
  private _getLinkStyle(baseStyle: Partial<Cell>): Partial<Cell> {
    const customStyle = this.props.styles?.link || {};
    const defaultStyle = DEFAULT_STYLES.link;
    return {
      ...baseStyle,
      underline: customStyle.underline ?? defaultStyle.underline,
      foreground: parseColor(customStyle.foreground) ?? getThemeColor('primary')
    };
  }

  /**
   * Get blockquote style
   */
  private _getBlockquoteStyle(baseStyle: Partial<Cell>): Partial<Cell> {
    const customStyle = this.props.styles?.blockquote || {};
    const defaultStyle = DEFAULT_STYLES.blockquote;

    return {
      ...baseStyle,
      foreground: parseColor(customStyle.foreground) ?? getThemeColor('textMuted'),
      italic: customStyle.italic ?? defaultStyle.italic
    };
  }

  /**
   * Calculate intrinsic size for the markdown component
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { text, src } = this.props;

    // Use loaded content if available, otherwise use provided text
    let content = text;
    if (src && this._srcContent) {
      content = this._srcContent;
    } else if (!content && src) {
      // No content loaded yet, reserve space for loading
      return {
        width: context.availableSpace.width || 80,
        height: 5  // Reserve space for loading content
      };
    }

    if (!content) return { width: 0, height: 0 };

    const availableWidth = context.availableSpace.width || 80;

    // Use actual rendered height if available (most accurate)
    // Note: This includes mermaid blocks which are rendered inline
    if (this._lastRenderedHeight > 0) {
      return {
        width: availableWidth,
        height: this._lastRenderedHeight
      };
    }

    // Fallback: estimate based on content for initial render
    // Parse markdown to get accurate estimate
    if (!this._parsedAst) {
      this._parseMarkdown(content, this.props.enableGfm);
    }

    if (this._parsedAst) {
      let height = this._estimateContentHeight(this._parsedAst, availableWidth);
      // Add estimated height for mermaid blocks (from cached elements)
      for (const graphElement of this._codeRenderer.getMermaidElements().values()) {
        if (hasIntrinsicSize(graphElement)) {
          const graphSize = graphElement.intrinsicSize(context);
          height += graphSize.height + 2; // +2 for spacing before/after
        }
      }
      return {
        width: availableWidth,
        height
      };
    }

    // Last fallback: count raw lines
    const lines = content.split('\n');
    return {
      width: availableWidth,
      height: lines.length
    };
  }

  /**
   * Estimate content height - keep it simple to avoid overestimation
   */
  private _estimateContentHeight(ast: Root, availableWidth: number): number {
    // Simple line-based calculation - render and count actual output
    if (!this._parsedAst) return 0;

    // Create a mock render context to count lines
    let lineCount = 0;
    const mockContext: MarkdownRenderContext = {
      bounds: { x: 0, y: 0, width: availableWidth, height: 1000 },
      style: {},
      buffer: null as any, // Won't be used for counting
      context: null as any,
      currentY: 0,
      currentX: 0,
      baseStyle: {}
    };

    // Count lines by simulating render
    for (const child of ast.children) {
      lineCount += this._estimateNodeLines(child, availableWidth);
    }

    return lineCount;
  }

  /**
   * Estimate lines for a node - recursive for nested structures
   */
  private _estimateNodeLines(node: ASTNode, availableWidth: number): number {
    switch (node.type) {
      case 'heading':
        return 2; // Title + blank line
      case 'paragraph': {
        const text = this._extractTextContent(node);
        return Math.max(1, Math.ceil(text.length / Math.max(1, availableWidth - 4))) + 1;
      }
      case 'list': {
        let listLines = 0;
        for (const item of node.children || []) {
          listLines += this._estimateNodeLines(item, availableWidth - 2);
        }
        return listLines;
      }
      case 'listItem': {
        // List items can contain nested content (paragraphs, nested lists)
        let itemLines = 0;
        for (const child of node.children || []) {
          itemLines += this._estimateNodeLines(child, availableWidth - 2);
        }
        // At minimum, a list item takes 1 line
        return Math.max(1, itemLines);
      }
      case 'code':
        return (node.value?.split('\n') || []).length + 3; // code lines + lang label + spacing before/after
      case 'blockquote': {
        // Blockquotes contain nested content
        let quoteLines = 2; // spacing before/after
        for (const child of node.children || []) {
          quoteLines += this._estimateNodeLines(child, availableWidth - 2);
        }
        return quoteLines;
      }
      case 'table': {
        // Table: top border + header + separator + rows + bottom border + spacing
        const numRows = (node.children || []).length;
        return numRows + 4; // rows + top/bottom borders + header separator + spacing
      }
      case 'root': {
        let rootLines = 0;
        for (const child of node.children || []) {
          rootLines += this._estimateNodeLines(child, availableWidth);
        }
        return rootLines;
      }
      default:
        return 1;
    }
  }

  private _extractTextContent(node: ASTNode): string {
    // Handle nodes with direct value (text, inlineCode)
    if (node.type === 'text' || node.type === 'inlineCode') {
      return node.value || '';
    }
    // Recursively process children
    if (node.children) {
      return node.children.map((child: ASTNode) => this._extractTextContent(child)).join('');
    }
    return '';
  }


  /**
   * Check if this markdown is interactive
   */
  isInteractive(): boolean {
    return !this.props.disabled;
  }

  /**
   * Check if this markdown supports text selection
   */
  isTextSelectable(): boolean {
    return true;
  }

  /**
   * Validate markdown props
   */
  static validate(props: MarkdownProps): boolean {
    // Either text or src must be provided
    if (!props.text && !props.src) {
      return false;
    }
    if (props.text !== undefined && typeof props.text !== 'string') {
      return false;
    }
    if (props.src !== undefined && typeof props.src !== 'string') {
      return false;
    }
    if (props.maxWidth !== undefined && typeof props.maxWidth !== 'number') {
      return false;
    }
    if (props.enableGfm !== undefined && typeof props.enableGfm !== 'boolean') {
      return false;
    }
    if (props.listIndent !== undefined && typeof props.listIndent !== 'number') {
      return false;
    }
    if (props.codeTheme !== undefined && !['light', 'dark', 'auto'].includes(props.codeTheme)) {
      return false;
    }
    return true;
  }

  /**
   * Handle click events to detect link clicks
   * Called by the engine when this element is clicked
   */
  handleClick(clickX?: number, clickY?: number): boolean {
    logger.info(`handleClick called: clickX=${clickX}, clickY=${clickY}, linkRegions=${this._linkRegions.length}, onLink type=${typeof this.props.onLink}`);

    // If no coordinates provided or no bounds stored, can't detect links
    if (clickX === undefined || clickY === undefined || !this._lastRenderBounds) {
      logger.info(`handleClick: early return - clickX=${clickX}, clickY=${clickY}, lastRenderBounds=${!!this._lastRenderBounds}`);
      return false;
    }

    // Link regions are stored at screen coordinates (rendered positions after scroll translation)
    // So we compare directly with the click coordinates (also screen coordinates)
    logger.info(`handleClick: checking screen coords (${clickX}, ${clickY})`);

    // Log all link regions for debugging
    for (const region of this._linkRegions) {
      logger.debug(`  Link region: x=${region.x}-${region.x + region.width}, y=${region.y}, url=${region.url}`);
    }

    // Check if click is within any link region (using screen coordinates)
    for (const region of this._linkRegions) {
      const inX = clickX >= region.x && clickX < region.x + region.width;
      const inY = clickY === region.y;
      logger.debug(`  Checking region x=${region.x}-${region.x + region.width}, y=${region.y}: inX=${inX}, inY=${inY}`);
      if (inX && inY) {
        // Found a link - call the onLink handler if provided
        logger.debug(`  Match found. Calling onLink with url=${region.url}`);
        if (typeof this.props.onLink === 'function') {
          try {
            this.props.onLink({
              url: region.url,
              title: region.title
            });
          } catch (e) {
            logger.error(`onLink handler threw error: ${e}`);
          }
          return true;
        } else {
          logger.info(`  No onLink handler defined`);
        }
      }
    }

    // Note: Mermaid graph element bounds are registered with the main renderer via
    // renderElementSubtree, so hit testing finds them automatically. No manual
    // click handling needed here - the engine routes clicks to the appropriate elements.

    logger.info(`handleClick: no match found`);
    return false;
  }

  /**
   * Get sixel outputs from embedded image canvases.
   * Used by engine to render sixel graphics for images in markdown content.
   */
  getSixelOutputs(): SixelOutputData[] {
    return this._imageRenderer.getSixelOutputs();
  }

  /**
   * Get kitty outputs from embedded image canvases.
   * Used by engine to render kitty graphics for images in markdown content.
   */
  getKittyOutputs(): KittyOutputData[] {
    return this._imageRenderer.getKittyOutputs();
  }
}

// Lint schema for markdown component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { registerComponent } from '../element.ts';

export const markdownSchema: ComponentSchema = {
  description: 'Render markdown content with syntax highlighting',
  props: {
    text: { type: 'string', description: 'Markdown text content' },
    src: { type: 'string', description: 'Load markdown from file path' },
    maxWidth: { type: 'number', description: 'Maximum content width' },
    enableGfm: { type: 'boolean', description: 'Enable GitHub-flavored markdown' },
    listIndent: { type: 'number', description: 'List indentation spaces' },
    codeTheme: { type: 'string', enum: ['light', 'dark', 'auto'], description: 'Code block color theme' },
    onLink: { type: 'function', description: 'Link click handler' },
    debug: { type: 'boolean', description: 'Enable debug overlay showing line numbers' },
    styles: { type: 'object', description: 'Custom styles for heading, code, blockquote, link elements' },
  },
};

registerComponentSchema('markdown', markdownSchema);

// Register markdown component for createElement to create MarkdownElement instances
registerComponent({
  type: 'markdown',
  componentClass: MarkdownElement,
  defaultProps: {
    wrap: true,
    disabled: false,
    enableGfm: true,
    listIndent: 2,
    codeTheme: 'auto',
  },
  validate: (props) => MarkdownElement.validate(props as any),
});