// Markdown component implementation
// Phase 1: Basic AST parsing and simple text rendering
// Phase 2: Heading, paragraph, and basic inline formatting
// Phase 3: Lists, code blocks, and blockquotes

import { Element, BaseProps, Renderable, Interactive, TextSelectable, Bounds, ComponentRenderContext, IntrinsicSizeContext, hasIntrinsicSize, type ColorInput } from '../types.ts';
import { type DualBuffer, type Cell, EMPTY_CHAR } from '../buffer.ts';
import { fromMarkdown, gfm, gfmFromMarkdown } from '../deps.ts';
import { getThemeColor, getThemeManager } from '../theme.ts';
import { CanvasElement } from './canvas.ts';
import { type SixelOutputData, type KittyOutputData, getEffectiveGfxMode } from './canvas-render.ts';
import { getLogger } from '../logging.ts';
import { parseMelkerFile } from '../template.ts';
import { getStringWidth } from '../char-width.ts';
import { MelkerConfig } from '../config/mod.ts';
import { COLORS, parseColor } from './color-utils.ts';

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

// Position info from mdast (source location tracking)
interface Position {
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}

// Unified spacing configuration for markdown elements
interface SpacingRule {
  before: number;  // Lines before element
  after: number;   // Lines after element
}

type NodeType = 'paragraph' | 'heading' | 'list' | 'listItem' | 'code' | 'blockquote' | 'table' | 'image' | 'html';

// Default spacing rules for each node type
const DEFAULT_SPACING: Record<NodeType, SpacingRule> = {
  paragraph: { before: 0, after: 1 },
  heading: { before: 0, after: 1 },
  list: { before: 0, after: 1 },      // Only for top-level lists
  listItem: { before: 0, after: 0 },
  code: { before: 0, after: 1 },
  blockquote: { before: 1, after: 1 },
  table: { before: 1, after: 1 },
  image: { before: 0, after: 1 },
  html: { before: 0, after: 0 },
};

// Get spacing for a node type
function getSpacing(nodeType: NodeType): SpacingRule {
  return DEFAULT_SPACING[nodeType] || { before: 0, after: 0 };
}

// Style configuration for markdown elements
export interface MarkdownStyleConfig {
  // Heading styles by level (1-6)
  heading?: {
    [level: number]: { bold?: boolean; underline?: boolean; italic?: boolean; dim?: boolean };
  };
  // Code block style overrides
  codeBlock?: { background?: ColorInput; foreground?: ColorInput };
  // Inline code style overrides
  inlineCode?: { background?: ColorInput; foreground?: ColorInput };
  // Blockquote style overrides
  blockquote?: { foreground?: ColorInput; italic?: boolean };
  // Link style overrides
  link?: { foreground?: ColorInput; underline?: boolean };
}

// Default style configuration
const DEFAULT_STYLES: Required<MarkdownStyleConfig> = {
  heading: {
    1: { bold: true, underline: true },
    2: { bold: true },
    3: { underline: true },
    4: {},
    5: {},
    6: {}
  },
  codeBlock: {}, // Uses theme colors
  inlineCode: {}, // Uses theme colors
  blockquote: { italic: true },
  link: { underline: true }
};

// Define the AST node types we need (subset of mdast types)
interface ASTNode {
  type: string;
  children?: ASTNode[];
  value?: string;
  depth?: number;
  position?: Position; // Source position info from parser
}

interface Root extends ASTNode {
  type: 'root';
  children: ASTNode[];
}

interface Paragraph extends ASTNode {
  type: 'paragraph';
  children: ASTNode[];
}

interface Heading extends ASTNode {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: ASTNode[];
}

interface Text extends ASTNode {
  type: 'text';
  value: string;
}

interface Strong extends ASTNode {
  type: 'strong';
  children: ASTNode[];
}

interface Emphasis extends ASTNode {
  type: 'emphasis';
  children: ASTNode[];
}

interface InlineCode extends ASTNode {
  type: 'inlineCode';
  value: string;
}

// Phase 3: New node types for lists, code blocks, and blockquotes
interface List extends ASTNode {
  type: 'list';
  ordered: boolean;
  start?: number;
  children: ListItem[];
}

interface ListItem extends ASTNode {
  type: 'listItem';
  children: ASTNode[];
}

interface Code extends ASTNode {
  type: 'code';
  value: string;
  lang?: string;
  meta?: string;
}

interface Blockquote extends ASTNode {
  type: 'blockquote';
  children: ASTNode[];
}

// Table types (GFM extension)
interface Table extends ASTNode {
  type: 'table';
  align?: ('left' | 'center' | 'right' | null)[];
  children: TableRow[];
}

interface TableRow extends ASTNode {
  type: 'tableRow';
  children: TableCell[];
}

interface TableCell extends ASTNode {
  type: 'tableCell';
  children: ASTNode[];
}

// HTML node (for raw HTML like <img> tags)
interface Html extends ASTNode {
  type: 'html';
  value: string;
}

// Image node (for markdown ![alt](url) syntax)
interface Image extends ASTNode {
  type: 'image';
  url: string;
  alt?: string;
  title?: string;
}

// Link node (for markdown [text](url) syntax)
interface Link extends ASTNode {
  type: 'link';
  url: string;
  title?: string;
  children: ASTNode[];
}

// Link region for click detection
interface LinkRegion {
  x: number;
  y: number;
  width: number;
  url: string;
  title?: string;
}

// Link event passed to onLink handler
export interface LinkEvent {
  url: string;
  title?: string;
}

export interface MarkdownProps extends BaseProps {
  text?: string;                      // Raw markdown content (consistent with TextProps) - optional when src is used
  src?: string;                       // URL to fetch markdown content from (relative to engine base URL)
  maxWidth?: number;                  // Max rendering width
  enableGfm?: boolean;                // Enable GitHub Flavored Markdown (default: true)
  listIndent?: number;                // List item indentation (default: 2)
  codeTheme?: 'light' | 'dark' | 'auto';  // Code block theme (default: 'auto')
  onLink?: (event: LinkEvent) => void;  // Callback when a link is clicked
  debug?: boolean;                    // Enable debug overlay (shows line numbers)
  styles?: MarkdownStyleConfig;       // Custom styles for markdown elements
}

interface MarkdownRenderContext {
  bounds: Bounds;
  style: Partial<Cell>;
  buffer: DualBuffer;
  context: ComponentRenderContext;
  currentY: number;                   // Current vertical position
  currentX: number;                   // Current horizontal position
  baseStyle: Partial<Cell>;          // Base style for this render context
  listDepth?: number;                 // Current list nesting depth (Phase 3)
  listType?: 'ordered' | 'unordered'; // Current list type (Phase 3)
  listStart?: number;                 // Starting number for ordered lists (Phase 3)
  itemNumber?: number;                // Current item number in ordered list (Phase 3)
  itemIndex?: number;                 // Current item index in list (Phase 3)
  // Debug tracking
  debugEnabled?: boolean;             // Whether debug overlay is enabled
  inputLine?: number;                 // Current input source line number
  renderedLine?: number;              // Current rendered output line number
  debugOverlay?: Map<number, { inputLine: number; renderedLine: number }>; // y -> line info
}

// Debug mode check - enabled via prop or config (fallback)
function isMarkdownDebugEnabledFromEnv(): boolean {
  try {
    return MelkerConfig.get().debugMarkdownDebug;
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
  // The actual resolved URL of the loaded markdown file (for resolving relative image paths)
  private _resolvedSrcUrl: string | null = null;
  // Error message to display when content loading fails
  private _loadError: string | null = null;
  // Cache for image canvases (keyed by resolved src path)
  private _imageCanvases: Map<string, CanvasElement> = new Map();
  // Cache for image aspect ratios (width/height) - used for auto-height calculation
  private _imageAspectRatios: Map<string, number> = new Map();
  private _melkerElements: Map<string, Element> = new Map();
  // Link regions for click detection (rebuilt on each render)
  private _linkRegions: LinkRegion[] = [];
  // Last render bounds for click coordinate mapping
  private _lastRenderBounds: Bounds | null = null;
  // Last scroll offset for click coordinate translation
  private _lastScrollOffset: { x: number; y: number } = { x: 0, y: 0 };
  // Actual rendered content height (set during render)
  private _lastRenderedHeight: number = 0;
  // Flag to prevent infinite re-render loops
  private _heightStabilized: boolean = false;

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
   * Get the markdown content (either from text prop or loaded from src)
   */
  getContent(): string | null {
    // Prefer inline text prop
    if (this.props.text) {
      return this.props.text;
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
        console.error('Engine not available for URL resolution');
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
      } else if (resolvedUrl.startsWith('http://') || resolvedUrl.startsWith('https://')) {
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
      this._resolvedSrcUrl = resolvedUrl; // Store the actual resolved URL for image path resolution
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
          this._heightStabilized = false; // Reset for new content
          this._lastRenderedHeight = 0;
        }
        this._fetchSrcContent().then(content => {
          if (content !== null) {
            // Clear cached AST to force re-parsing of new content
            this._parsedAst = null;
            this._lastParsedText = null;
            this._loadError = null; // Clear any previous error
            this._heightStabilized = false; // Reset for new content
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
          console.error('Error fetching markdown content:', error);
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
    if (heightDiff > 0 && !this._heightStabilized) {
      // Mark as stabilized to prevent infinite loops
      this._heightStabilized = true;

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
      this._heightStabilized = true;
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
    } catch (error) {
      console.error('Failed to parse markdown:', error);
      this._parsedAst = null;
    }
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
          const linkedCodeStyle = { ...codeStyle, underline: true };
          spans.push({ text: codeValue, style: linkedCodeStyle, linkUrl: mdLinkUrl, linkTitle: codeValue });
        } else {
          spans.push({ text: codeValue, style: codeStyle, linkUrl, linkTitle });
        }
        break;
      }

      case 'link': {
        const linkNode = node as Link;
        const linkStyle = this._getLinkStyle(style);
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
        // Style for links: underline and use primary color
        const inlineLinkStyle = this._getLinkStyle(ctx.style);
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
   */
  private _renderCodeBlock(node: Code, ctx: MarkdownRenderContext): number {
    const { codeTheme } = this.props;
    const code = node.value;
    const language = node.lang;

    // Special handling for melker blocks - render as actual UI elements
    if (language === 'melker') {
      return this._renderMelkerBlock(code, ctx);
    }

    // Use local y tracking - don't modify ctx.currentY (caller does that)
    let localY = ctx.currentY;

    // No extra spacing before code block - paragraphs already add trailing spacing
    let totalHeight = 0;

    // Create code block style
    const codeStyle = this._getCodeBlockStyle(codeTheme, ctx.baseStyle);

    // Render language label outside the block on top-right (if present)
    // Label appears on the line just before the code content, right-aligned above the block
    if (language) {
      const langStyle = {
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
  private _renderMelkerBlock(code: string, ctx: MarkdownRenderContext): number {
    // Use local y tracking
    let localY = ctx.currentY;
    let totalHeight = 1; // spacing before
    localY += 1;

    try {
      // Create a cache key from the code content and markdown src (for path resolution)
      const cacheKey = `${this.props.src || ''}:${code.trim()}`;

      // Check if we have a cached element
      let element = this._melkerElements.get(cacheKey);

      if (!element) {
        // Parse the melker content
        const parseResult = parseMelkerFile(code);
        element = parseResult.element;

        // Resolve file paths for elements that have them (canvas, video)
        // This makes relative paths resolve from the markdown file's directory
        if (element.props.src && typeof element.props.src === 'string') {
          element.props.src = this._resolveImagePath(element.props.src);
        }
        // Also resolve video-specific paths (subtitle, poster)
        if (element.props.subtitle && typeof element.props.subtitle === 'string') {
          element.props.subtitle = this._resolveImagePath(element.props.subtitle);
        }
        if (element.props.poster && typeof element.props.poster === 'string') {
          element.props.poster = this._resolveImagePath(element.props.poster);
        }

        // Cache the element
        this._melkerElements.set(cacheKey, element);
      }

      // Check if element is Renderable (has a render method)
      const elementAsAny = element as unknown as Record<string, unknown>;
      if (element && typeof elementAsAny.render === 'function') {
        const renderable = element as unknown as Renderable;

        // Get element dimensions from props or intrinsicSize
        let elementWidth = ctx.bounds.width;
        let elementHeight = 15; // Default height

        // Try to get dimensions from element props
        if (element.props.width && typeof element.props.width === 'number') {
          elementWidth = Math.min(element.props.width, ctx.bounds.width);
        }
        if (element.props.height && typeof element.props.height === 'number') {
          elementHeight = element.props.height;
        }

        // If element has intrinsicSize, use it
        if (hasIntrinsicSize(element)) {
          try {
            const intrinsic = element.intrinsicSize({
              availableSpace: { width: ctx.bounds.width, height: 100 },
            });
            if (intrinsic.height) {
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

        // Render the element
        renderable.render(elementBounds, ctx.style, ctx.buffer, ctx.context);

        totalHeight += elementHeight;
        localY += elementHeight;
      } else {
        // Fallback: render error message
        const errorStyle = {
          ...ctx.style,
          foreground: getThemeColor('error'),
        };
        ctx.buffer.currentBuffer.setText(ctx.currentX, localY, '[Melker block: element not renderable]', errorStyle);
        totalHeight += 1;
        localY += 1;
      }
    } catch (error) {
      // Render error message
      const errorStyle = {
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
    if (!node.children || node.children.length === 0) {
      return 0;
    }

    let totalHeight = 0;
    const alignments = node.align || [];
    const spacing = getSpacing('table');

    // First pass: calculate column widths
    const columnWidths = this._calculateTableColumnWidths(node, ctx);
    const numColumns = columnWidths.length;

    if (numColumns === 0) {
      return 0;
    }

    // Use local y tracking - don't modify ctx.currentY (caller does that)
    let localY = ctx.currentY;

    // Add spacing before table
    totalHeight += spacing.before;
    localY += spacing.before;

    // Box-drawing characters for table borders
    const borderChars = {
      topLeft: '\u250c',     // +
      topRight: '\u2510',    // +
      bottomLeft: '\u2514',  // +
      bottomRight: '\u2518', // +
      horizontal: '\u2500',  // -
      vertical: '\u2502',    // |
      leftT: '\u251c',       // +-
      rightT: '\u2524',      // -+
      topT: '\u252c',        // T
      bottomT: '\u2534',     // inverted T
      cross: '\u253c',       // +
    };

    const borderStyle = {
      ...ctx.style,
      foreground: getThemeColor('border')
    };

    // Create a local context with our local y position
    const localCtx = { ...ctx, currentY: localY };

    // Draw top border
    this._drawTableBorderLine(localCtx, columnWidths, borderChars.topLeft, borderChars.horizontal, borderChars.topT, borderChars.topRight, borderStyle);
    totalHeight += 1;
    localY += 1;
    localCtx.currentY = localY;

    // Render rows
    for (let rowIndex = 0; rowIndex < node.children.length; rowIndex++) {
      const row = node.children[rowIndex];
      const isHeader = rowIndex === 0;

      // Render the row content
      const rowHeight = this._renderTableRow(row, localCtx, columnWidths, alignments, isHeader, borderChars.vertical, borderStyle);
      totalHeight += rowHeight;
      localY += rowHeight;
      localCtx.currentY = localY;

      // Draw separator after header row
      if (isHeader && node.children.length > 1) {
        this._drawTableBorderLine(localCtx, columnWidths, borderChars.leftT, borderChars.horizontal, borderChars.cross, borderChars.rightT, borderStyle);
        totalHeight += 1;
        localY += 1;
        localCtx.currentY = localY;
      }
    }

    // Draw bottom border
    this._drawTableBorderLine(localCtx, columnWidths, borderChars.bottomLeft, borderChars.horizontal, borderChars.bottomT, borderChars.bottomRight, borderStyle);
    totalHeight += 1;
    localY += 1;

    // Add spacing after table
    totalHeight += spacing.after;

    return totalHeight;
  }

  /**
   * Calculate column widths for a table
   */
  private _calculateTableColumnWidths(node: Table, ctx: MarkdownRenderContext): number[] {
    const columnWidths: number[] = [];
    const maxColumnWidth = 30; // Max width before wrapping

    // Find max width for each column (capped at maxColumnWidth)
    for (const row of node.children) {
      for (let colIndex = 0; colIndex < row.children.length; colIndex++) {
        const cell = row.children[colIndex];
        const cellText = this._extractTextContent(cell);
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
  private _drawTableBorderLine(
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
  private _renderTableRow(
    row: TableRow,
    ctx: MarkdownRenderContext,
    columnWidths: number[],
    alignments: ('left' | 'center' | 'right' | null)[],
    isHeader: boolean,
    verticalChar: string,
    borderStyle: Partial<Cell>
  ): number {
    // First, collect styled spans for each cell and wrap them
    const wrappedCells: Array<Array<Array<{text: string, style: Partial<Cell>, linkUrl?: string, linkTitle?: string}>>> = [];
    let maxLines = 1;

    // Base style for cells
    const baseCellStyle = isHeader
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
      const spans = this._flattenInlineElements(cell.children, baseCellStyle);

      // Wrap styled spans into lines
      const lines = this._wrapStyledSpans(spans, width);
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
            this._linkRegions.push({
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
  private _wrapStyledSpans(
    spans: Array<{text: string, style: Partial<Cell>, linkUrl?: string, linkTitle?: string}>,
    width: number
  ): Array<Array<{text: string, style: Partial<Cell>, linkUrl?: string, linkTitle?: string}>> {
    const lines: Array<Array<{text: string, style: Partial<Cell>, linkUrl?: string, linkTitle?: string}>> = [];
    let currentLine: Array<{text: string, style: Partial<Cell>, linkUrl?: string, linkTitle?: string}> = [];
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
  private _alignText(text: string, width: number, alignment: 'left' | 'center' | 'right' | null): string {
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
    // Use available width so aspect ratio is calculated correctly
    const width = ctx.bounds.width;
    return this._renderImageElement(node.url, node.alt, width, undefined, ctx);
  }

  /**
   * Parse a dimension value with optional unit suffix.
   * - Bare numbers or 'px' suffix: treated as CSS pixels, converted to chars (divide by 8)
   * - 'ch' suffix: treated as characters, used as-is
   * - '%' suffix: percentage of available width
   */
  private _parseDimension(value: string, availableWidth: number): number {
    const match = value.match(/^(\d+(?:\.\d+)?)(px|ch|%)?$/i);
    if (!match) return 0;

    const num = parseFloat(match[1]);
    const unit = (match[2] || 'px').toLowerCase();

    switch (unit) {
      case 'ch':
        return Math.round(num);
      case '%':
        return Math.round((num / 100) * availableWidth);
      case 'px':
      default:
        // Convert pixels to characters (approx 8px per char)
        return Math.round(num / 8);
    }
  }

  /**
   * Parse and render an <img> tag
   */
  private _renderImgTag(attributes: string, ctx: MarkdownRenderContext): number {
    // Parse attributes
    const srcMatch = attributes.match(/src\s*=\s*["']([^"']+)["']/i);
    const widthMatch = attributes.match(/width\s*=\s*["']?(\d+(?:px|ch|%)?|\d+)["']?/i);
    const heightMatch = attributes.match(/height\s*=\s*["']?(\d+(?:px|ch|%)?|\d+)["']?/i);
    const altMatch = attributes.match(/alt\s*=\s*["']([^"']*)["']/i);

    if (!srcMatch) {
      return 0; // No src, skip
    }

    const src = srcMatch[1];
    const availableWidth = ctx.bounds.width;
    const width = widthMatch ? this._parseDimension(widthMatch[1], availableWidth) : undefined;
    const height = heightMatch ? this._parseDimension(heightMatch[1], availableWidth) : undefined;
    const alt = altMatch ? altMatch[1] : undefined;

    return this._renderImageElement(src, alt, width, height, ctx);
  }

  /**
   * Render an image using Canvas element
   */
  private _renderImageElement(
    src: string,
    alt: string | undefined,
    width: number | undefined,
    height: number | undefined,
    ctx: MarkdownRenderContext
  ): number {
    // Resolve src relative to markdown source file
    const resolvedSrc = this._resolveImagePath(src);
    logger.debug('Resolved image path', { originalSrc: src, resolvedSrc });

    // Calculate dimensions
    const imgWidth = width || 30;
    let imgHeight: number;

    if (height !== undefined) {
      // Height explicitly specified
      imgHeight = height;
    } else if (width !== undefined) {
      // Width specified but height not - try to calculate from cached aspect ratio
      const cachedAspect = this._imageAspectRatios.get(resolvedSrc);
      if (cachedAspect !== undefined) {
        // Calculate height from width and aspect ratio, accounting for terminal char aspect
        // Terminal chars are typically ~2x taller than wide, so we divide by 2
        imgHeight = Math.round(imgWidth / cachedAspect / 2);
        logger.debug('Using cached aspect ratio for height', { cachedAspect, imgWidth, imgHeight });
      } else {
        // Aspect ratio not yet known - use placeholder height
        imgHeight = 15;
        logger.debug('Aspect ratio not cached, using placeholder height', { imgWidth, imgHeight });
      }
    } else {
      // Neither specified - use defaults
      imgHeight = 15;
    }

    logger.debug('Rendering image element', { src, alt, width: imgWidth, height: imgHeight });

    // Check if theme is B&W or color (limited palette) - apply dithering for better image quality
    const themeType = getThemeManager().getThemeType();

    // Create a unique cache key combining src, dimensions, and dither settings
    const cacheKey = `${resolvedSrc}:${imgWidth}x${imgHeight}`;

    // Check if we already have a canvas for this image
    let canvas = this._imageCanvases.get(cacheKey);

    if (!canvas) {
      // Create a new Canvas element with dithering for B&W/color themes
      // Include src prop for sixel palette caching and id for debugging
      const canvasId = `md-img-${this._imageCanvases.size}`;
      const isSixel = getEffectiveGfxMode() === 'sixel';
      canvas = new CanvasElement({
        id: canvasId,
        width: imgWidth,
        height: imgHeight,
        dither: 'auto',
        // 3-bit (8 levels) for sixel - good balance of quality and palette usage
        ...(isSixel && { ditherBits: 3 }),
        src: resolvedSrc,
      }, []);

      // Store in cache
      this._imageCanvases.set(cacheKey, canvas);

      // Start loading the image asynchronously
      logger.info('Starting image load', { resolvedSrc });
      canvas.loadImage(resolvedSrc).then(() => {
        logger.info('Image loaded successfully', { resolvedSrc });

        // Cache the image aspect ratio for future renders
        const loadedImage = (canvas as any)._loadedImage;
        if (loadedImage && loadedImage.width && loadedImage.height) {
          const aspectRatio = loadedImage.width / loadedImage.height;
          const previousAspect = this._imageAspectRatios.get(resolvedSrc);
          this._imageAspectRatios.set(resolvedSrc, aspectRatio);
          logger.debug('Cached image aspect ratio', { resolvedSrc, aspectRatio });

          // If this is a new aspect ratio, reset height stabilization to allow re-layout
          if (previousAspect === undefined) {
            this._heightStabilized = false;
            logger.debug('Reset height stabilization for new image aspect ratio');

            // Invalidate the cache and re-render with correct dimensions
            if (width !== undefined && height === undefined) {
              this._imageCanvases.delete(cacheKey);
              logger.debug('Invalidating canvas cache for aspect ratio update', { cacheKey });
            }
          }
        }

        // Trigger re-render when image loads
        if (ctx.context.requestRender) {
          ctx.context.requestRender();
        }
      }).catch((err) => {
        logger.error('Failed to load image: ' + String(err), undefined, { resolvedSrc });
      });
    }

    // Render the canvas at current position
    const bounds: Bounds = {
      x: ctx.currentX,
      y: ctx.currentY,
      width: Math.min(imgWidth, ctx.bounds.width),
      height: imgHeight,
    };

    canvas.render(bounds, ctx.style, ctx.buffer, ctx.context);

    // Add alt text below image if provided
    let totalHeight = imgHeight + 1; // +1 for spacing

    if (alt) {
      const altStyle = {
        ...ctx.style,
        foreground: getThemeColor('textMuted'),
        italic: true,
      };
      const altText = `[${alt}]`;
      ctx.buffer.currentBuffer.setText(ctx.currentX, ctx.currentY + imgHeight, altText, altStyle);
      totalHeight += 1;
    }

    return totalHeight;
  }

  /**
   * Resolve image path relative to markdown source file
   */
  private _resolveImagePath(src: string): string {
    logger.debug('Resolving image path', { src, markdownSrc: this.props.src });

    // If src is already absolute URL, return as-is
    if (src.startsWith('http://') || src.startsWith('https://') || src.startsWith('file://')) {
      logger.debug('Image src is absolute URL');
      return src;
    }

    // If src is absolute path, return as-is
    if (src.startsWith('/')) {
      logger.debug('Image src is absolute path');
      return src;
    }

    // Use the actual resolved URL of the markdown file (set during loadUrl)
    // This correctly handles cwd-relative paths passed as command-line arguments
    const markdownUrl = this._resolvedSrcUrl;
    if (!markdownUrl) {
      // No resolved URL yet, fall back to engine resolution
      const engine = globalThis.melkerEngine;
      if (engine && typeof engine.resolveUrl === 'function') {
        const resolved = engine.resolveUrl(src);
        logger.debug('Resolved via engine (no resolved markdown URL)', { resolved });
        return resolved;
      }
      logger.debug('No engine available, returning src as-is');
      return src;
    }

    // Resolve relative to markdown file's directory
    try {
      // Get the directory of the markdown file
      const markdownDir = markdownUrl.substring(0, markdownUrl.lastIndexOf('/') + 1);
      const combinedUrl = markdownDir + src;

      // Normalize the URL to resolve ../ and ./
      const normalizedUrl = new URL(combinedUrl);
      // Return plain pathname (strip file:// protocol) for local files
      const resolvedPath = normalizedUrl.protocol === 'file:' ? normalizedUrl.pathname : normalizedUrl.href;
      logger.debug('Resolved relative to markdown file', { markdownUrl, markdownDir, combinedUrl, resolvedPath });
      return resolvedPath;
    } catch (e) {
      logger.error('Error resolving image path: ' + String(e));
    }

    return src;
  }

  /**
   * Get code block style based on theme
   */
  private _getCodeBlockStyle(theme: string | undefined, baseStyle: Partial<Cell>): Partial<Cell> {
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
      return {
        width: availableWidth,
        height: this._estimateContentHeight(this._parsedAst, availableWidth)
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

    logger.info(`handleClick: no match found`);
    return false;
  }

  /**
   * Get sixel outputs from embedded image canvases.
   * Used by engine to render sixel graphics for images in markdown content.
   */
  getSixelOutputs(): SixelOutputData[] {
    const outputs: SixelOutputData[] = [];
    logger.debug('getSixelOutputs called', { canvasCount: this._imageCanvases.size });
    for (const [key, canvas] of this._imageCanvases.entries()) {
      const sixelOutput = canvas.getSixelOutput();
      logger.debug('Checking canvas for sixel output', {
        key,
        hasSixelOutput: !!sixelOutput,
        hasData: !!sixelOutput?.data,
        hasBounds: !!sixelOutput?.bounds,
        isSixelMode: canvas.isSixelMode(),
      });
      if (sixelOutput?.data && sixelOutput.bounds) {
        outputs.push(sixelOutput);
      }
    }
    logger.debug('getSixelOutputs returning', { outputCount: outputs.length });
    return outputs;
  }

  /**
   * Get kitty outputs from embedded image canvases.
   * Used by engine to render kitty graphics for images in markdown content.
   */
  getKittyOutputs(): KittyOutputData[] {
    const outputs: KittyOutputData[] = [];
    for (const [key, canvas] of this._imageCanvases.entries()) {
      const kittyOutput = canvas.getKittyOutput();
      if (kittyOutput?.data && kittyOutput.bounds) {
        outputs.push(kittyOutput);
      }
    }
    logger.debug('getKittyOutputs returning', { outputCount: outputs.length });
    return outputs;
  }
}

// Lint schema for markdown component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

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