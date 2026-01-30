// Markdown component types and interfaces
// Extracted from markdown.ts for better organization

import { BaseProps, type ColorInput } from '../types.ts';
import { type DualBuffer, type Cell } from '../buffer.ts';
import { type ComponentRenderContext, type Bounds } from '../types.ts';

// ============================================================================
// Source Position Types
// ============================================================================

/** Position info from mdast (source location tracking) */
export interface Position {
  start: { line: number; column: number; offset?: number };
  end: { line: number; column: number; offset?: number };
}

// ============================================================================
// Spacing Configuration
// ============================================================================

/** Unified spacing configuration for markdown elements */
export interface SpacingRule {
  before: number;  // Lines before element
  after: number;   // Lines after element
}

export type NodeType = 'paragraph' | 'heading' | 'list' | 'listItem' | 'code' | 'blockquote' | 'table' | 'image' | 'html';

/** Default spacing rules for each node type */
export const DEFAULT_SPACING: Record<NodeType, SpacingRule> = {
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

/** Get spacing for a node type */
export function getSpacing(nodeType: NodeType): SpacingRule {
  return DEFAULT_SPACING[nodeType] || { before: 0, after: 0 };
}

// ============================================================================
// Style Configuration
// ============================================================================

/** Style configuration for markdown elements */
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

/** Default style configuration */
export const DEFAULT_STYLES: Required<MarkdownStyleConfig> = {
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

// ============================================================================
// AST Node Types (subset of mdast types)
// ============================================================================

export interface ASTNode {
  type: string;
  children?: ASTNode[];
  value?: string;
  depth?: number;
  position?: Position; // Source position info from parser
}

export interface Root extends ASTNode {
  type: 'root';
  children: ASTNode[];
}

export interface Paragraph extends ASTNode {
  type: 'paragraph';
  children: ASTNode[];
}

export interface Heading extends ASTNode {
  type: 'heading';
  depth: 1 | 2 | 3 | 4 | 5 | 6;
  children: ASTNode[];
}

export interface Text extends ASTNode {
  type: 'text';
  value: string;
}

export interface Strong extends ASTNode {
  type: 'strong';
  children: ASTNode[];
}

export interface Emphasis extends ASTNode {
  type: 'emphasis';
  children: ASTNode[];
}

export interface InlineCode extends ASTNode {
  type: 'inlineCode';
  value: string;
}

export interface List extends ASTNode {
  type: 'list';
  ordered: boolean;
  start?: number;
  children: ListItem[];
}

export interface ListItem extends ASTNode {
  type: 'listItem';
  children: ASTNode[];
}

export interface Code extends ASTNode {
  type: 'code';
  value: string;
  lang?: string;
  meta?: string;
}

export interface Blockquote extends ASTNode {
  type: 'blockquote';
  children: ASTNode[];
}

// Table types (GFM extension)
export interface Table extends ASTNode {
  type: 'table';
  align?: ('left' | 'center' | 'right' | null)[];
  children: TableRow[];
}

export interface TableRow extends ASTNode {
  type: 'tableRow';
  children: TableCell[];
}

export interface TableCell extends ASTNode {
  type: 'tableCell';
  children: ASTNode[];
}

// HTML node (for raw HTML like <img> tags)
export interface Html extends ASTNode {
  type: 'html';
  value: string;
}

// Image node (for markdown ![alt](url) syntax)
export interface Image extends ASTNode {
  type: 'image';
  url: string;
  alt?: string;
  title?: string;
}

// Link node (for markdown [text](url) syntax)
export interface Link extends ASTNode {
  type: 'link';
  url: string;
  title?: string;
  children: ASTNode[];
}

// ============================================================================
// Link Detection Types
// ============================================================================

/** Link region for click detection */
export interface LinkRegion {
  x: number;
  y: number;
  width: number;
  url: string;
  title?: string;
}

/** Link event passed to onLink handler */
export interface LinkEvent {
  url: string;
  title?: string;
}

// ============================================================================
// Component Props
// ============================================================================

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

// ============================================================================
// Render Context
// ============================================================================

export interface MarkdownRenderContext {
  bounds: Bounds;
  style: Partial<Cell>;
  buffer: DualBuffer;
  context: ComponentRenderContext;
  currentY: number;                   // Current vertical position
  currentX: number;                   // Current horizontal position
  baseStyle: Partial<Cell>;          // Base style for this render context
  listDepth?: number;                 // Current list nesting depth
  listType?: 'ordered' | 'unordered'; // Current list type
  listStart?: number;                 // Starting number for ordered lists
  itemNumber?: number;                // Current item number in ordered list
  itemIndex?: number;                 // Current item index in list
  // Debug tracking
  debugEnabled?: boolean;             // Whether debug overlay is enabled
  inputLine?: number;                 // Current input source line number
  renderedLine?: number;              // Current rendered output line number
  debugOverlay?: Map<number, { inputLine: number; renderedLine: number }>; // y -> line info
}
