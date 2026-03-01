/**
 * Graph Component
 *
 * Renders diagrams from Mermaid or JSON input.
 * Supports flowcharts, sequence diagrams, and class diagrams.
 *
 * Usage:
 *   <graph type="mermaid">
 *     flowchart LR
 *       A[Start] --> B[End]
 *   </graph>
 *
 *   <graph type="mermaid">
 *     sequenceDiagram
 *       A->>B: Hello
 *   </graph>
 *
 *   <graph type="mermaid">
 *     classDiagram
 *       class Animal
 *   </graph>
 *
 *   <graph type="json" src="./diagram.json" />
 */

import {
  Element,
  type BaseProps,
  type Bounds,
  type Renderable,
  type ComponentRenderContext,
  type IntrinsicSizeContext,
} from '../../types.ts';
import type { DualBuffer, Cell } from '../../buffer.ts';
import { graphToMelker, type ContainerOptions } from './graph-to-melker.ts';
import { detectParserType, type ParserType } from './parsers/mod.ts';
import { parseXmlToElement } from '../../template.ts';
import { Stylesheet } from '../../stylesheet.ts';
import { getGlobalEngine } from '../../global-accessors.ts';
import { getLogger } from '../../logging.ts';
import { registerComponent } from '../../element.ts';
import { readTextFile } from '../../runtime/mod.ts';

const logger = getLogger('Graph');

export interface GraphProps extends BaseProps {
  /** Parser type: 'mermaid' or 'json' (default: auto-detect) */
  type?: ParserType;
  /** Load content from URL */
  src?: string;
  /** Inline content (alternative to children text) */
  text?: string;
  /** Enable scrolling (default: true) */
  scrollable?: boolean;
}

/**
 * Extract style content from generated melker XML.
 * Returns the CSS content between <style> and </style> tags.
 */
function extractStyleContent(melkerXml: string): string | null {
  const styleMatch = melkerXml.match(/<style>([\s\S]*?)<\/style>/);
  if (styleMatch) {
    return styleMatch[1].trim();
  }
  return null;
}

/**
 * Extract the inner container content from generated melker XML.
 * Strips <melker>, <policy>, <style> and returns just the container XML.
 */
function extractContainerXml(melkerXml: string): string {
  // Find the main container (after </style>)
  const styleEndMatch = melkerXml.match(/<\/style>\s*/);
  if (!styleEndMatch) {
    // No style tag, look for first <container
    const containerMatch = melkerXml.match(/<container[^>]*>/);
    if (containerMatch) {
      const startIdx = melkerXml.indexOf(containerMatch[0]);
      const endIdx = melkerXml.lastIndexOf('</melker>');
      if (endIdx > startIdx) {
        return melkerXml.substring(startIdx, endIdx).trim();
      }
    }
    return '<container><text>Parse error</text></container>';
  }

  const styleEndIdx = styleEndMatch.index! + styleEndMatch[0].length;
  const endIdx = melkerXml.lastIndexOf('</melker>');

  if (endIdx > styleEndIdx) {
    return melkerXml.substring(styleEndIdx, endIdx).trim();
  }

  return '<container><text>Parse error</text></container>';
}

export class GraphElement extends Element implements Renderable {
  static readonly type = 'graph';
  declare type: 'graph';
  declare props: GraphProps;

  // Cached content from src
  private _srcContent: string | null = null;
  private _lastSrc: string | null = null;
  private _loadError: string | null = null;

  // Cached generated element
  private _generatedElement: Element | null = null;
  private _lastContent: string | null = null;
  private _childrenGenerated: boolean = false;
  private _registeredStylesheet: Stylesheet | null = null;
  private _pendingStylesheet: Stylesheet | null = null;

  constructor(props: GraphProps, children: Element[] = []) {
    super('graph', props, children);
    // Generate children immediately if we have inline content (not src)
    if (!props.src) {
      this._generateChildren();
    }
  }

  /**
   * Load content from src URL
   */
  async loadContent(): Promise<void> {
    const { src } = this.props;

    if (!src) {
      this._srcContent = null;
      this._lastSrc = null;
      return;
    }

    // Skip if already attempted this URL (even on error)
    if (src === this._lastSrc) {
      return;
    }

    try {
      logger.debug('Loading graph from URL', { src });

      // Get the global engine for base URL resolution
      const engine = getGlobalEngine();
      if (!engine) {
        throw new Error('No global Melker engine available for URL resolution');
      }

      const resolvedUrl = engine.resolveUrl(src);

      // Convert file:// URL to pathname for Deno.readTextFile
      let content: string;
      if (resolvedUrl.startsWith('file://')) {
        const filePath = new URL(resolvedUrl).pathname;
        content = await readTextFile(filePath);
      } else {
        // HTTP/HTTPS URLs use fetch
        const response = await fetch(resolvedUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        content = await response.text();
      }

      this._srcContent = content;
      this._lastSrc = src;
      this._loadError = null;
      this._childrenGenerated = false; // Force regeneration

      logger.debug('Loaded graph content', { src, length: this._srcContent.length });
    } catch (error) {
      this._loadError = error instanceof Error ? error.message : String(error);
      this._lastSrc = src; // Prevent retry loop
      logger.error(`Failed to load graph from ${src}: ${this._loadError}`);
    }
  }

  /**
   * Get the graph content (priority: src > text prop > children text)
   */
  getContent(): string | null {
    // Priority 1: Content loaded from src
    if (this._srcContent) {
      return this._srcContent;
    }

    // Priority 2: text prop
    if (this.props.text) {
      return this.props.text;
    }

    // Priority 3: Extract text from children
    return this._getChildrenText();
  }

  /**
   * Extract text content from text element children.
   * Unescapes HTML entities that were escaped during preprocessing
   * to protect XML content inside the graph tag from being parsed.
   */
  private _getChildrenText(): string | null {
    const textParts: string[] = [];

    const children = this.children || [];
    for (const child of children) {
      if (child.type === 'text' && child.props.text) {
        textParts.push(child.props.text);
      }
    }

    if (textParts.length === 0) {
      return null;
    }

    // Unescape HTML entities that were escaped during template preprocessing
    const joined = textParts.join('\n');
    return joined
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&');
  }

  /**
   * Generate children from the graph content using graphToMelker
   */
  private _generateChildren(): void {
    if (this._childrenGenerated) {
      return;
    }

    const content = this.getContent();

    if (!content) {
      this._generatedElement = null;
      this.children = [];
      this._childrenGenerated = true;
      return;
    }

    // Skip if content hasn't changed
    if (content === this._lastContent && this._generatedElement) {
      return;
    }

    try {
      // Auto-detect type if not specified
      const type = this.props.type || (content.trim().startsWith('{') ? 'json' : 'mermaid');

      // Build container options from props
      const containerOpts: ContainerOptions = {
        scrollable: this.props.scrollable !== false, // Default true
        width: 'fill',
      };

      // Apply style overrides if provided
      if (this.props.style) {
        if (this.props.style.width !== undefined) {
          containerOpts.width = String(this.props.style.width);
        }
        if (this.props.style.height !== undefined) {
          containerOpts.height = String(this.props.style.height);
        }
      }

      // Generate melker XML using graphToMelker
      const melkerXml = graphToMelker(content, {
        type,
        name: 'Graph',
        container: containerOpts,
      });

      logger.debug('Generated melker XML', { length: melkerXml.length });

      // Extract style content and create stylesheet
      const styleContent = extractStyleContent(melkerXml);
      let stylesheet: Stylesheet | null = null;
      if (styleContent) {
        stylesheet = Stylesheet.fromString(styleContent);
        logger.debug('Created graph stylesheet', { rules: stylesheet.length });
      }

      // Extract just the container XML (strip <melker>, <policy>, <style>)
      const containerXml = extractContainerXml(melkerXml);

      logger.debug('Extracted container XML', { length: containerXml.length });

      // Parse the container XML to an Element
      this._generatedElement = parseXmlToElement(containerXml);
      this._lastContent = content;

      // Register the stylesheet on the document (prepended so document styles can override).
      // This ensures the graph's CSS classes survive the document's applyTo pass.
      if (stylesheet) {
        this._pendingStylesheet = stylesheet;
        this._tryRegisterStylesheet();
      }

      // Set as single child
      this.children = [this._generatedElement];
      this._childrenGenerated = true;

      logger.debug('Generated graph element', {
        type,
        childType: this._generatedElement.type,
        childrenCount: this._generatedElement.children?.length || 0,
      });
    } catch (error) {
      logger.error(`Failed to generate graph: ${error instanceof Error ? error.message : String(error)}`);
      this._generatedElement = null;
      this.children = [];
      this._childrenGenerated = true;
    }
  }

  /**
   * Try to register a pending stylesheet on the document.
   * Called lazily because the engine/document may not exist during construction.
   */
  private _tryRegisterStylesheet(): void {
    if (!this._pendingStylesheet) return;

    const engine = getGlobalEngine();
    if (engine?.document) {
      // Remove previously registered graph stylesheet if regenerating
      if (this._registeredStylesheet) {
        engine.document.removeStylesheet(this._registeredStylesheet);
      }
      engine.document.addStylesheet(this._pendingStylesheet, true);
      this._registeredStylesheet = this._pendingStylesheet;
      // Apply to generated element now so the current render cycle uses correct styles
      // (the document's initial style pass ran before this stylesheet was registered)
      if (this._generatedElement) {
        this._pendingStylesheet.applyTo(this._generatedElement);
      }
      this._pendingStylesheet = null;
      logger.debug('Registered graph stylesheet on document (prepended)');
    }
    // If engine/document not yet available, keep pending for next call
  }

  /**
   * Calculate intrinsic size - delegate to generated children
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    this._generateChildren();
    this._tryRegisterStylesheet();

    if (!this._generatedElement) {
      return { width: 10, height: 3 }; // Minimum size
    }

    if ('intrinsicSize' in this._generatedElement && typeof this._generatedElement.intrinsicSize === 'function') {
      return (this._generatedElement as any).intrinsicSize(context);
    }

    return { width: 20, height: 10 };
  }

  /**
   * Render the graph
   */
  render(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    _context: ComponentRenderContext
  ): void {
    this._generateChildren();
    this._tryRegisterStylesheet();

    // If there's a load error, show it
    if (this._loadError) {
      const errorMsg = `Error: ${this._loadError}`;
      for (let i = 0; i < Math.min(errorMsg.length, bounds.width); i++) {
        buffer.currentBuffer.setCell(bounds.x + i, bounds.y, {
          char: errorMsg[i],
          foreground: 0xFF0000, // Red
          ...style,
        });
      }
      return;
    }

    // If no content, show placeholder
    if (!this._generatedElement) {
      const msg = 'Empty graph';
      for (let i = 0; i < Math.min(msg.length, bounds.width); i++) {
        buffer.currentBuffer.setCell(bounds.x + i, bounds.y, {
          char: msg[i],
          ...style,
        });
      }
      return;
    }

    // Note: The actual rendering is handled by the layout system
    // which will render the generated children.
  }

  /**
   * Get the generated element (call after _generateChildren)
   */
  getGeneratedElement(): Element | null {
    this._generateChildren();
    return this._generatedElement;
  }

  /**
   * Validate graph props
   */
  static validate(props: GraphProps): boolean {
    // Type is optional now (auto-detected)
    if (props.type && !['mermaid', 'json', 'sequence', 'class'].includes(props.type)) {
      return false;
    }
    return true;
  }
}

// Lint schema for graph component
import { registerComponentSchema, type ComponentSchema } from '../../lint.ts';

export const graphSchema: ComponentSchema = {
  description: 'Render diagrams from mermaid or JSON syntax',
  props: {
    type: { type: 'string', enum: ['mermaid', 'json', 'sequence', 'class'], description: 'Parser type (default: auto-detect)' },
    src: { type: 'string', description: 'Load content from URL' },
    text: { type: 'string', description: 'Inline content (alternative to children text)' },
    content: { type: 'string', description: 'Inline content (alias for text)' },
    scrollable: { type: 'boolean', description: 'Enable scrolling (default: true)' },
  },
};

registerComponentSchema('graph', graphSchema);

// Register the graph component
registerComponent({
  type: 'graph',
  componentClass: GraphElement,
  defaultProps: {
    type: 'mermaid',
    // Graph elements use flex layout; height is content-sized so graphs don't expand to fill parent
    style: { display: 'flex', flexDirection: 'column', width: 'fill' },
  },
  validate: (props) => GraphElement.validate(props as any),
});
