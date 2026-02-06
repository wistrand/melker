// Graphics overlay manager for sixel, kitty, and iTerm2 graphics rendering
// Handles collecting outputs from canvas elements and rendering them to the terminal

import { Document } from './document.ts';
import { RenderingEngine } from './rendering.ts';
import { Element } from './types.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('GraphicsOverlayManager');
import {
  detectSixelCapabilities,
  type SixelCapabilities,
} from './sixel/mod.ts';
import {
  detectKittyCapabilities,
  type KittyCapabilities,
} from './kitty/mod.ts';
import {
  detectITermCapabilities,
  type ITermCapabilities,
} from './iterm2/mod.ts';

// Reusable TextEncoder to avoid per-render allocations
const textEncoder = new TextEncoder();

export interface GraphicsOverlayManagerDeps {
  document: Document;
  renderer: RenderingEngine;
  writeAllSync: (data: Uint8Array) => void;
}

/**
 * Manages sixel, kitty, and iTerm2 graphics overlays.
 * Handles collecting outputs from canvas/img/video elements, rendering them
 * to the terminal, and cleaning up stale graphics.
 */
export class GraphicsOverlayManager {
  private _document: Document;
  private _renderer: RenderingEngine;
  private _writeAllSync: (data: Uint8Array) => void;

  // Graphics capabilities (detected at startup)
  private _sixelCapabilities?: SixelCapabilities;
  private _kittyCapabilities?: KittyCapabilities;
  private _itermCapabilities?: ITermCapabilities;

  // Track previous sixel bounds for clearing on scroll/move
  private _previousSixelBounds: Array<{ x: number; y: number; width: number; height: number }> = [];

  // Track previous kitty image IDs for cleanup
  private _previousKittyImageIds: number[] = [];

  // Track if scroll happened this frame (for Konsole sixel workaround)
  private _scrollHappenedThisFrame = false;

  constructor(deps: GraphicsOverlayManagerDeps) {
    this._document = deps.document;
    this._renderer = deps.renderer;
    this._writeAllSync = deps.writeAllSync;
  }

  // --- Capability detection & access ---

  /**
   * Detect all graphics capabilities (sixel, kitty, iTerm2).
   * Called during engine start().
   */
  async detectCapabilities(skipQueries: boolean): Promise<void> {
    // Detect sixel capabilities
    try {
      this._sixelCapabilities = await detectSixelCapabilities(false, skipQueries);
      logger.info('Sixel detection', {
        supported: this._sixelCapabilities.supported,
        colors: this._sixelCapabilities.colorRegisters,
        cellSize: `${this._sixelCapabilities.cellWidth}x${this._sixelCapabilities.cellHeight}`,
        method: this._sixelCapabilities.detectionMethod,
        multiplexer: this._sixelCapabilities.inMultiplexer,
        remote: this._sixelCapabilities.isRemote,
      });
    } catch (error) {
      logger.warn('Sixel detection failed', { error: String(error) });
    }

    // Detect kitty capabilities
    try {
      this._kittyCapabilities = await detectKittyCapabilities(false, skipQueries);
      logger.info('Kitty detection', {
        supported: this._kittyCapabilities.supported,
        method: this._kittyCapabilities.detectionMethod,
        terminal: this._kittyCapabilities.terminalProgram,
        multiplexer: this._kittyCapabilities.inMultiplexer,
        remote: this._kittyCapabilities.isRemote,
      });
    } catch (error) {
      logger.warn('Kitty detection failed', { error: String(error) });
    }

    // Detect iTerm2 capabilities (environment-based, no terminal queries)
    try {
      this._itermCapabilities = detectITermCapabilities();
      logger.info('iTerm2 detection', {
        supported: this._itermCapabilities.supported,
        method: this._itermCapabilities.detectionMethod,
        terminal: this._itermCapabilities.terminalProgram,
        multiplexer: this._itermCapabilities.inMultiplexer,
        multipart: this._itermCapabilities.useMultipart,
        remote: this._itermCapabilities.isRemote,
      });
    } catch (error) {
      logger.warn('iTerm2 detection failed', { error: String(error) });
    }
  }

  // --- Capability getters (delegated from engine's public getters) ---

  get sixelCapabilities(): SixelCapabilities | undefined {
    return this._sixelCapabilities;
  }

  get kittyCapabilities(): KittyCapabilities | undefined {
    return this._kittyCapabilities;
  }

  get itermCapabilities(): ITermCapabilities | undefined {
    return this._itermCapabilities;
  }

  // --- Public methods ---

  /**
   * Render all graphics overlays (sixel, kitty, iTerm2).
   */
  renderOverlays(): void {
    this._renderSixelOverlays();
    this._renderKittyOverlays();
    this._renderITermOverlays();
  }

  /**
   * Clear all graphics (sixel bounds + delete kitty images).
   * Used when UI overlays are visible and graphics must be hidden.
   */
  clearAllGraphics(): void {
    if (this._previousSixelBounds.length > 0) {
      this._clearStaleSixelAreas([]);
      this._previousSixelBounds = [];
    }
    if (this._previousKittyImageIds.length > 0) {
      const deleteCommands = this._previousKittyImageIds.map(id => `\x1b_Ga=d,d=i,i=${id},q=2\x1b\\`).join('');
      this._writeAllSync(textEncoder.encode(deleteCommands));
      this._previousKittyImageIds = [];
    }
  }

  /**
   * Handle Konsole workaround: check if force redraw is needed due to scrolling
   * with sixel visible. Returns whether force redraw is needed.
   * Resets the scroll flag.
   */
  handleKonsoleWorkaround(): boolean {
    const hasKonsoleQuirk = this._sixelCapabilities?.quirks?.includes('konsole-sixel-edge');
    const hasSixelVisible = this._previousSixelBounds.length > 0;
    const needsForceRedraw = !!(hasKonsoleQuirk && this._scrollHappenedThisFrame && hasSixelVisible);

    // Reset scroll flag after checking
    this._scrollHappenedThisFrame = false;

    // Clear sixel areas completely before force redraw to remove all artifacts
    if (needsForceRedraw && this._previousSixelBounds.length > 0) {
      this._clearStaleSixelAreas([]);
      this._previousSixelBounds = [];
    }

    return needsForceRedraw;
  }

  /**
   * Mark that a scroll happened this frame (for Konsole sixel workaround).
   */
  markScrollHappened(): void {
    this._scrollHappenedThisFrame = true;
  }

  // --- Private methods ---

  /**
   * Collect sixel outputs from all canvas elements in the document.
   * Returns array of { data, bounds } for each sixel.
   */
  private _collectSixelOutputs(): Array<{ data: string; bounds: { x: number; y: number; width: number; height: number } }> {
    if (!this._sixelCapabilities?.supported) {
      return [];
    }

    const outputs: Array<{ data: string; bounds: { x: number; y: number; width: number; height: number } }> = [];

    // Traverse document tree to find canvas elements with sixel output
    const collectFromElement = (element: Element): void => {
      // Check if this is a canvas element with sixel output
      if (element.type === 'canvas' || element.type === 'img' || element.type === 'video') {
        const canvas = element as { getSixelOutput?: () => { data: string; bounds: { x: number; y: number; width: number; height: number } } | null };
        if (canvas.getSixelOutput) {
          const sixelOutput = canvas.getSixelOutput();
          if (sixelOutput?.data && sixelOutput.bounds) {
            outputs.push({ data: sixelOutput.data, bounds: sixelOutput.bounds });
          }
        }
      }

      // Check if this is a markdown element with embedded image canvases
      if (element.type === 'markdown') {
        const markdown = element as { getSixelOutputs?: () => Array<{ data: string; bounds: { x: number; y: number; width: number; height: number } }> };
        if (markdown.getSixelOutputs) {
          const sixelOutputs = markdown.getSixelOutputs();
          for (const output of sixelOutputs) {
            if (output?.data && output.bounds) {
              outputs.push({ data: output.data, bounds: output.bounds });
            }
          }
        }
      }

      // Recurse into children
      if (element.children) {
        for (const child of element.children) {
          collectFromElement(child);
        }
      }
    };

    if (this._document.root) {
      collectFromElement(this._document.root);
    }

    if (outputs.length > 0) {
      logger.debug('Collected sixel outputs', { count: outputs.length });
    }

    return outputs;
  }

  /**
   * Generate a blank/clear sixel to erase graphics at a specific position.
   * This overwrites any existing sixel graphics with transparent pixels.
   */
  private _generateClearSixel(
    x: number,
    y: number,
    widthChars: number,
    heightChars: number
  ): string {
    if (!this._sixelCapabilities) return '';

    const cellWidth = this._sixelCapabilities.cellWidth || 8;
    const cellHeight = this._sixelCapabilities.cellHeight || 16;

    const pixelWidth = widthChars * cellWidth;
    const rawPixelHeight = heightChars * cellHeight;

    // Round height DOWN to nearest multiple of 6 (sixel row height)
    // This matches the content sixel dimensions and ensures we don't
    // draw black pixels into terminal rows below the intended bounds
    const pixelHeight = Math.floor(rawPixelHeight / 6) * 6;

    // Sixel rows are 6 pixels tall
    const sixelRows = pixelHeight / 6;

    // Build a blank sixel: transparent pixels (color 0, no data = blank)
    // DCS P1;P2;P3 q <data> ST
    // P1=0 (normal aspect), P2=0 (no background), P3=0 (horizontal grid)
    // Use "raster attributes" to set size: " Pan ; Pad ; Ph ; Pv
    // Pan=1, Pad=1 (aspect ratio 1:1), Ph=width, Pv=height

    let sixel = '';
    // Position cursor
    sixel += `\x1b[${y + 1};${x + 1}H`;
    // Start sixel sequence with raster attributes
    sixel += `\x1bP0;0;0q"1;1;${pixelWidth};${pixelHeight}`;
    // Define color 0 as transparent/background (black with 0% intensity works as clear)
    sixel += '#0;2;0;0;0';
    // Select color 0
    sixel += '#0';
    // Fill each row with solid color 0 (character '~' = 0x7E = 63 = all 6 pixels ON)
    // Using '?' (all off) might be treated as transparent, so we use solid black instead
    // Use RLE: !<count><char>
    const solidRow = `!${pixelWidth}~`;
    for (let row = 0; row < sixelRows; row++) {
      sixel += solidRow;
      if (row < sixelRows - 1) {
        sixel += '-'; // Move to next sixel row
      }
    }
    // End sixel sequence
    sixel += '\x1b\\';

    return sixel;
  }

  /**
   * Clear areas where sixels were previously rendered but are no longer present.
   * This prevents "ghost" sixels when content scrolls or moves.
   */
  private _clearStaleSixelAreas(
    currentBounds: Array<{ x: number; y: number; width: number; height: number }>
  ): void {
    if (this._previousSixelBounds.length === 0) {
      return;
    }

    // Find areas in previous bounds that don't overlap with current bounds
    const staleBounds: Array<{ x: number; y: number; width: number; height: number }> = [];

    for (const prev of this._previousSixelBounds) {
      let isStale = true;
      for (const curr of currentBounds) {
        // Check if previous bounds match current bounds (same position and size)
        if (prev.x === curr.x && prev.y === curr.y &&
            prev.width === curr.width && prev.height === curr.height) {
          isStale = false;
          break;
        }
      }
      if (isStale) {
        staleBounds.push(prev);
      }
    }

    if (staleBounds.length === 0) {
      return;
    }

    logger.debug('Clearing stale sixel areas', {
      count: staleBounds.length,
      staleBounds,
      previousCount: this._previousSixelBounds.length,
      currentCount: currentBounds.length,
    });

    // Clear stale areas by outputting blank sixels
    // This overwrites the old sixel graphics with transparent/blank pixels
    let clearOutput = '';
    for (const bounds of staleBounds) {
      clearOutput += this._generateClearSixel(bounds.x, bounds.y, bounds.width, bounds.height);
    }

    if (clearOutput) {
      this._writeAllSync(textEncoder.encode(clearOutput));
    }
  }

  /**
   * Output sixel graphics overlays after buffer rendering.
   * Sixel data bypasses the buffer and is positioned directly on the terminal.
   */
  private _renderSixelOverlays(): void {
    if (!this._sixelCapabilities?.supported) {
      logger.trace('Sixel overlays skipped - not supported');
      return;
    }

    // Check if any overlays are active (dropdowns, dialogs, tooltips, etc.)
    // Sixel graphics render on top of everything, so we must hide them when
    // overlays are visible to prevent sixels from obscuring the overlay content.
    if (this._renderer?.hasVisibleOverlays()) {
      logger.debug('Sixel overlays skipped - UI overlays active');
      // Clear any previously rendered sixels so they don't obscure the overlay
      this._clearStaleSixelAreas([]);
      this._previousSixelBounds = [];
      return;
    }

    // Note: We intentionally DO NOT skip sixel rendering when _pendingRender is true.
    // Video playback relies on sixel rendering every frame - skipping would show only
    // the first frame. The _pendingRender optimization applies to the main buffer
    // rendering, not sixel overlays.

    const sixelOutputs = this._collectSixelOutputs();
    logger.debug('Sixel outputs collected', {
      count: sixelOutputs.length,
      bounds: sixelOutputs.map(o => o.bounds),
      previousBounds: this._previousSixelBounds,
    });

    // Extract current bounds
    const currentBounds = sixelOutputs.map(o => o.bounds);

    // Clear areas where sixels were previously rendered but moved/removed
    this._clearStaleSixelAreas(currentBounds);

    // Update previous bounds for next frame
    this._previousSixelBounds = currentBounds;

    if (sixelOutputs.length === 0) {
      return;
    }

    // Output all sixel data
    // Each sixel output already includes cursor positioning
    const combined = sixelOutputs.map(o => o.data).join('');
    this._writeAllSync(textEncoder.encode(combined));

    logger.debug('Rendered sixel overlays', { count: sixelOutputs.length });
  }

  /**
   * Collect kitty outputs from all canvas elements in the document.
   * Returns array of { data, bounds, imageId } for each kitty image.
   */
  private _collectKittyOutputs(): Array<{ data: string; bounds: { x: number; y: number; width: number; height: number }; imageId: number; fromCache?: boolean }> {
    if (!this._kittyCapabilities?.supported) {
      return [];
    }

    const outputs: Array<{ data: string; bounds: { x: number; y: number; width: number; height: number }; imageId: number; fromCache?: boolean }> = [];

    // Traverse document tree to find canvas elements with kitty output
    const collectFromElement = (element: Element): void => {
      // Check if this is a canvas element with kitty output
      if (element.type === 'canvas' || element.type === 'img' || element.type === 'video') {
        const canvas = element as { getKittyOutput?: () => { data: string; bounds: { x: number; y: number; width: number; height: number }; imageId: number; fromCache?: boolean } | null };
        if (canvas.getKittyOutput) {
          const kittyOutput = canvas.getKittyOutput();
          if (kittyOutput?.data && kittyOutput.bounds) {
            outputs.push({ data: kittyOutput.data, bounds: kittyOutput.bounds, imageId: kittyOutput.imageId, fromCache: kittyOutput.fromCache });
          }
        }
      }

      // Check if this is a markdown element with embedded image canvases
      if (element.type === 'markdown') {
        const markdown = element as { getKittyOutputs?: () => Array<{ data: string; bounds: { x: number; y: number; width: number; height: number }; imageId: number; fromCache?: boolean }> };
        if (markdown.getKittyOutputs) {
          const kittyOutputs = markdown.getKittyOutputs();
          for (const output of kittyOutputs) {
            if (output?.data && output.bounds) {
              outputs.push({ data: output.data, bounds: output.bounds, imageId: output.imageId, fromCache: output.fromCache });
            }
          }
        }
      }

      // Recurse into children
      if (element.children) {
        for (const child of element.children) {
          collectFromElement(child);
        }
      }
    };

    if (this._document.root) {
      collectFromElement(this._document.root);
    }

    if (outputs.length > 0) {
      logger.debug('Collected kitty outputs', { count: outputs.length });
    }

    return outputs;
  }

  /**
   * Output kitty graphics overlays after buffer rendering.
   * Kitty data bypasses the buffer and is positioned directly on the terminal.
   */
  private _renderKittyOverlays(): void {
    if (!this._kittyCapabilities?.supported) {
      logger.trace('Kitty overlays skipped - not supported');
      return;
    }

    // Check if any overlays are active (dropdowns, dialogs, tooltips, etc.)
    // Kitty graphics render on top of everything, so we must hide them when
    // overlays are visible to prevent kitty images from obscuring the overlay content.
    if (this._renderer?.hasVisibleOverlays()) {
      logger.debug('Kitty overlays skipped - UI overlays active');
      // Delete any previously rendered kitty images so they don't obscure the overlay
      if (this._previousKittyImageIds.length > 0) {
        const deleteCommands = this._previousKittyImageIds.map(id => `\x1b_Ga=d,d=i,i=${id},q=2\x1b\\`).join('');
        this._writeAllSync(textEncoder.encode(deleteCommands));
        this._previousKittyImageIds = [];
      }
      return;
    }

    const kittyOutputs = this._collectKittyOutputs();
    logger.debug('Kitty outputs collected', {
      count: kittyOutputs.length,
      bounds: kittyOutputs.map(o => o.bounds),
      previousIds: this._previousKittyImageIds,
    });

    // Extract current image IDs
    const currentImageIds = kittyOutputs.map(o => o.imageId);

    // Always send all kitty outputs (like sixel does).
    // Buffer placeholder rendering overwrites kitty cells each frame, so we must
    // re-send the image. The caching in generateKittyOutput() still saves encoding
    // time (hash check + reuse encoded data), we just can't skip the terminal write.
    if (kittyOutputs.length > 0) {
      // Each kitty output already includes cursor positioning
      const combined = kittyOutputs.map(o => o.data).join('');
      this._writeAllSync(textEncoder.encode(combined));
      const cached = kittyOutputs.filter(o => o.fromCache).length;
      logger.debug('Rendered kitty overlays', { count: kittyOutputs.length, cached });
    }

    // Delete stale images (elements that were removed, not just updated)
    // With stable IDs, an element keeps the same ID while updating content
    const removedIds = this._previousKittyImageIds.filter(id => !currentImageIds.includes(id));
    if (removedIds.length > 0) {
      const deleteCommands = removedIds.map(id => `\x1b_Ga=d,d=i,i=${id},q=2\x1b\\`).join('');
      this._writeAllSync(textEncoder.encode(deleteCommands));
      logger.debug('Deleted stale kitty images', { ids: removedIds });
    }

    // Update previous IDs for next frame
    this._previousKittyImageIds = currentImageIds;
  }

  /**
   * Collect iTerm2 outputs from all canvas elements in the document.
   * Returns array of { data, bounds } for each iTerm2 image.
   */
  private _collectITermOutputs(): Array<{ data: string; bounds: { x: number; y: number; width: number; height: number }; fromCache?: boolean }> {
    if (!this._itermCapabilities?.supported) {
      return [];
    }

    const outputs: Array<{ data: string; bounds: { x: number; y: number; width: number; height: number }; fromCache?: boolean }> = [];

    // Traverse document tree to find canvas elements with iTerm2 output
    const collectFromElement = (element: Element): void => {
      // Check if this is a canvas element with iTerm2 output
      if (element.type === 'canvas' || element.type === 'img' || element.type === 'video') {
        const canvas = element as { getITermOutput?: () => { data: string; bounds: { x: number; y: number; width: number; height: number }; fromCache?: boolean } | null };
        if (canvas.getITermOutput) {
          const itermOutput = canvas.getITermOutput();
          if (itermOutput?.data && itermOutput.bounds) {
            outputs.push({ data: itermOutput.data, bounds: itermOutput.bounds, fromCache: itermOutput.fromCache });
          }
        }
      }

      // Check if this is a markdown element with embedded image canvases
      if (element.type === 'markdown') {
        const markdown = element as { getITermOutputs?: () => Array<{ data: string; bounds: { x: number; y: number; width: number; height: number }; fromCache?: boolean }> };
        if (markdown.getITermOutputs) {
          const itermOutputs = markdown.getITermOutputs();
          for (const output of itermOutputs) {
            if (output?.data && output.bounds) {
              outputs.push({ data: output.data, bounds: output.bounds, fromCache: output.fromCache });
            }
          }
        }
      }

      // Recurse into children
      if (element.children) {
        for (const child of element.children) {
          collectFromElement(child);
        }
      }
    };

    if (this._document.root) {
      collectFromElement(this._document.root);
    }

    if (outputs.length > 0) {
      logger.debug('Collected iTerm2 outputs', { count: outputs.length });
    }

    return outputs;
  }

  /**
   * Output iTerm2 graphics overlays after buffer rendering.
   * iTerm2 data bypasses the buffer and is positioned directly on the terminal.
   */
  private _renderITermOverlays(): void {
    if (!this._itermCapabilities?.supported) {
      logger.trace('iTerm2 overlays skipped - not supported');
      return;
    }

    // Check if any overlays are active (dropdowns, dialogs, tooltips, etc.)
    // iTerm2 graphics render on top of everything, so we must hide them when
    // overlays are visible to prevent iTerm2 images from obscuring the overlay content.
    if (this._renderer?.hasVisibleOverlays()) {
      logger.debug('iTerm2 overlays skipped - UI overlays active');
      return;
    }

    const itermOutputs = this._collectITermOutputs();
    logger.debug('iTerm2 outputs collected', {
      count: itermOutputs.length,
      bounds: itermOutputs.map(o => o.bounds),
    });

    // Send all iTerm2 outputs
    // Unlike Kitty, iTerm2 doesn't have explicit image IDs to track for deletion.
    // Images are simply overwritten when re-rendered at the same position.
    if (itermOutputs.length > 0) {
      // Each iTerm2 output already includes cursor positioning
      const combined = itermOutputs.map(o => o.data).join('');
      this._writeAllSync(textEncoder.encode(combined));
      const cached = itermOutputs.filter(o => o.fromCache).length;
      logger.debug('Rendered iTerm2 overlays', { count: itermOutputs.length, cached });
    }
  }
}
