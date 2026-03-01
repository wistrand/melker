// Text component implementation

import { Element, BaseProps, Renderable, TextSelectable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { getGlobalEngine } from '../global-accessors.ts';
import { getLogger } from '../logging.ts';
import { readTextFile } from '../runtime/mod.ts';

const logger = getLogger('Text');

export interface TextProps extends BaseProps {
  text?: string;                     // Text content - optional when src is used
  src?: string;                      // URL to fetch text content from (relative to engine base URL)
}

export class TextElement extends Element implements Renderable, TextSelectable {
  declare type: 'text';
  declare props: TextProps;

  // Source content loading
  private _srcContent: string | null = null;
  private _lastSrc: string | null = null;

  constructor(props: TextProps, children: Element[] = []) {
    const defaultProps: TextProps = {
      disabled: false,
      ...props,
      style: {
        // Default styles would go here (none currently)
        ...props.style
      },
    };

    super('text', defaultProps, children);
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

    try {
      // Get the global engine for base URL resolution
      const engine = getGlobalEngine();
      if (!engine) {
        throw new Error('No global Melker engine available for URL resolution');
      }

      const resolvedUrl = engine.resolveUrl(src);

      // Convert file:// URL to pathname for Deno.readTextFile
      let filePath = resolvedUrl;
      if (resolvedUrl.startsWith('file://')) {
        filePath = new URL(resolvedUrl).pathname;
      }

      const content = await readTextFile(filePath);

      this._srcContent = content;
      this._lastSrc = src;

      return content;
    } catch (error) {
      logger.error(`Failed to fetch text from ${src}`, error instanceof Error ? error : new Error(String(error)));
      return null;
    }
  }

  /**
   * Render the text to the terminal buffer
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    let { text, src } = this.props;

    // Get textWrap from style (default to 'nowrap')
    const elementStyle = this.props.style || {};
    const textWrap = elementStyle.textWrap || 'nowrap';

    // Use loaded content if available, otherwise use provided text, otherwise show loading
    if (src && this._srcContent) {
      text = this._srcContent;
    } else if ((text === undefined || text === null || text === '') && src) {
      text = 'Loading content from: ' + src + '...';
    }

    // Handle empty text (but not "0" or 0)
    if (text === undefined || text === null || text === '') return;

    // Convert to string if needed (handles numeric values like 0)
    text = String(text);

    // Handle async content loading
    if (src) {
      // Trigger async fetch if we don't have content or src changed
      if (!this._srcContent || this._lastSrc !== src) {
        this._fetchSrcContent().then(content => {
          if (content !== null) {
            // Try to trigger a full re-render
            const engine = getGlobalEngine();
            if (engine && engine.forceRender) {
              engine.forceRender();
            }
          }
        }).catch(error => {
          logger.error('Error loading text content', error instanceof Error ? error : new Error(String(error)));
        });
      }
    }

    // Ensure we have valid bounds before rendering
    if (bounds.width <= 0 || bounds.height <= 0) {
      return;
    }

    // Calculate content area within borders and padding
    // Prefer computedStyle (includes CSS animation values) over props.style
    const styleForPadding = context.computedStyle || elementStyle;
    const borderWidth = elementStyle.border === 'thin' ? 1 : 0;
    const paddingValue = styleForPadding.padding || 0;

    // Handle padding as either number or BoxSpacing
    const paddingTop = typeof paddingValue === 'number' ? paddingValue : (paddingValue.top || 0);
    const paddingLeft = typeof paddingValue === 'number' ? paddingValue : (paddingValue.left || 0);
    const paddingRight = typeof paddingValue === 'number' ? paddingValue : (paddingValue.right || 0);
    const paddingBottom = typeof paddingValue === 'number' ? paddingValue : (paddingValue.bottom || 0);

    // Content must not overlap with borders - calculate inner content area
    const contentBounds: Bounds = {
      x: bounds.x + borderWidth + paddingLeft,
      y: bounds.y + borderWidth + paddingTop,
      width: Math.max(0, bounds.width - (2 * borderWidth) - paddingLeft - paddingRight),
      height: Math.max(0, bounds.height - (2 * borderWidth) - paddingTop - paddingBottom)
    };


    // Only render text if we have valid content area
    if (contentBounds.width <= 0 || contentBounds.height <= 0) {
      return;
    }

    if (textWrap === 'wrap') {
      this._renderWrappedText(text, contentBounds, style, buffer);
    } else {
      this._renderPlainText(text, contentBounds, style, buffer);
    }
  }

  /**
   * Render plain text with newline preservation but no word wrapping
   */
  private _renderPlainText(
    text: string,
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer
  ): void {
    const lines = text.split('\n');
    let currentY = bounds.y;
    const elementStyle = this.props.style || {};
    const textAlign = elementStyle['text-align'] || elementStyle.textAlign || 'left';

    for (const line of lines) {
      if (currentY >= bounds.y + bounds.height) {
        break; // No more vertical space
      }

  
      // Truncate line if it's too long for the container
      const displayLine = line.length > bounds.width ?
        line.substring(0, bounds.width) : line;

      // Calculate X position based on text alignment
      let x = bounds.x;
      if (textAlign === 'center') {
        const padding = Math.max(0, bounds.width - displayLine.length);
        x = bounds.x + Math.floor(padding / 2);
      } else if (textAlign === 'right') {
        const padding = Math.max(0, bounds.width - displayLine.length);
        x = bounds.x + padding;
      }

      buffer.currentBuffer.setText(x, currentY, displayLine, style);
      currentY++;
    }
  }

  /**
   * Render wrapped text across multiple lines
   */
  private _renderWrappedText(
    text: string,
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer
  ): void {
    // Split text by newlines first to preserve existing line breaks
    const paragraphs = text.split('\n');
    let currentY = bounds.y;

    for (const paragraph of paragraphs) {
      if (currentY >= bounds.y + bounds.height) {
        break; // No more vertical space
      }

      if (paragraph.trim() === '') {
        // Empty line - just advance Y position
        currentY++;
        continue;
      }

      // Word wrap this paragraph
      let remainingText = paragraph;
      let currentX = bounds.x;

      while (remainingText.length > 0 && currentY < bounds.y + bounds.height) {
        const availableWidth = bounds.width - (currentX - bounds.x);

        if (availableWidth <= 0) {
          currentY++;
          currentX = bounds.x;
          continue;
        }

        // Find natural break point or use available width
        let breakPoint = availableWidth;

        // If the remaining text fits completely, use it all
        if (remainingText.length <= availableWidth) {
          breakPoint = remainingText.length;
        } else {
          // Only look for word boundaries if text doesn't fit
          // Look for space or comma as break points
          const searchArea = remainingText.substring(0, availableWidth + 1);
          const spaceIndex = searchArea.lastIndexOf(' ');
          const commaIndex = searchArea.lastIndexOf(',');
          // Use the later of space or comma (prefer breaking after comma)
          // For comma, break after it (+1), for space, break at it
          let bestBreak = -1;
          if (spaceIndex > 0 && spaceIndex < availableWidth) {
            bestBreak = spaceIndex;
          }
          if (commaIndex > 0 && commaIndex + 1 <= availableWidth) {
            // Break after the comma if it's a better position
            if (commaIndex + 1 > bestBreak) {
              bestBreak = commaIndex + 1;
            }
          }
          if (bestBreak > 0) {
            breakPoint = bestBreak;
          }
        }

        const line = remainingText.substring(0, breakPoint).trimEnd();
        if (line.length > 0) {
          buffer.currentBuffer.setText(currentX, currentY, line, style);
        }

        remainingText = remainingText.substring(breakPoint).trimStart();
        currentY++;
        currentX = bounds.x;
      }
    }
  }

  /**
   * Calculate intrinsic size for the text component
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    let { text, src } = this.props;

    // Get textWrap from style (default to 'nowrap')
    const elementStyle = this.props.style || {};
    const textWrap = elementStyle.textWrap || 'nowrap';

    // Use loaded content if available, otherwise use provided text
    if (src && this._srcContent) {
      text = this._srcContent;
    } else if (!text && src) {
      // No content loaded yet, reserve space for loading
      return {
        width: context.availableSpace.width || 80,
        height: 3  // Reserve some space for loading content
      };
    }

    // Handle empty text (but not "0" or 0)
    if (text === undefined || text === null || text === '') return { width: 0, height: 0 };

    // Convert to string if needed (handles numeric values like 0)
    text = String(text);

    // Fast path for simple single-line text (most common case)
    if (textWrap !== 'wrap' && !text.includes('\n')) {
      return { width: text.length, height: 1 };
    }

    // Split text by newlines to get accurate dimensions
    const lines = text.split('\n');
    let width = 0;
    let height = lines.length;

    if (textWrap === 'wrap') {
      const maxWidth = context.availableSpace.width || 80;
      // When wrapping, use the available width - don't expand to fit longest line
      width = maxWidth;

      // Calculate wrapped height by processing each paragraph
      height = 0;
      for (const line of lines) {
        if (line.trim() === '') {
          height += 1; // Empty line
        } else {
          // Calculate how many lines this paragraph will take when wrapped
          const linesNeeded = Math.ceil(line.length / maxWidth);
          height += linesNeeded;
        }
      }
    } else {
      // No wrapping - width is the longest line
      width = Math.max(...lines.map(line => line.length));
    }

    return { width, height };
  }

  /**
   * Get the text content (standard API)
   */
  getValue(): string {
    return this.props.text ?? '';
  }

  /**
   * Set the text content (standard API)
   */
  setValue(text: string): void {
    this.props.text = text;
  }

  /**
   * Check if this text supports text selection
   */
  isTextSelectable(): boolean {
    return true;
  }

  static validate(props: TextProps): boolean {
    if (props.text !== undefined && typeof props.text !== 'string') {
      return false;
    }
    if (props.src !== undefined && typeof props.src !== 'string') {
      return false;
    }
    // Validate textWrap if present in style
    if (props.style?.textWrap !== undefined && !['nowrap', 'wrap'].includes(props.style.textWrap)) {
      return false;
    }
    // Either text or src must be provided (allow text=0)
    if ((props.text === undefined || props.text === null || props.text === '') && !props.src) {
      return false;
    }
    return true;
  }
}

// Lint schema for text component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';
import { registerComponent } from '../element.ts';

export const textSchema: ComponentSchema = {
  description: 'Display text content with optional styling',
  props: {
    text: { type: 'string', description: 'Text content to display' },
    src: { type: 'string', description: 'Load text from file path' },
  },
};

registerComponentSchema('text', textSchema);

// Register text component for createElement
registerComponent({
  type: 'text',
  componentClass: TextElement,
  defaultProps: {
    wrap: false,
    disabled: false,
  },
  validate: (props) => TextElement.validate(props as any),
});