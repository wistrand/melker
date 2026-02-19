// Segment display renderers
// Each renderer produces multi-line ASCII/Unicode art for 7-segment digits

import type { SegmentMask } from './charsets.ts';
import type { SegmentRenderer, SegmentHeight, SegmentRenderOptions, RenderedChar } from './types.ts';
import { FONT_3x5, getFont5x7, type BitmapFont } from './bitmap-fonts.ts';
import { getUnicodeTier, type UnicodeTier } from '../../utils/terminal-detection.ts';

// Re-export types for convenience
export type { SegmentRenderer, SegmentHeight, SegmentRenderOptions, RenderedChar } from './types.ts';

// Cache tier — ━┃●▬▮▯■╭╮╰╯ need full; █░ work in basic
const _tier: UnicodeTier = getUnicodeTier();
const _full = _tier === 'full';       // for renderers needing thick/geometric chars
const _hasBlocks = _tier !== 'ascii'; // for renderers using only █░

/**
 * Box Drawing Renderer - Uses ━ and ┃ characters
 * Clean, thin lines
 */
export class BoxDrawingRenderer implements SegmentRenderer {
  readonly name = 'box-drawing';
  readonly charWidth = 7; // 6 + 1 padding
  readonly charHeight: SegmentHeight;
  readonly onChar = _full ? '━' : '=';
  readonly offChar = '·';

  readonly horzOn = _full ? '━' : '=';
  readonly horzOff = '·';
  readonly vertOn = _full ? '┃' : '|';
  readonly vertOff = '·';

  constructor(height: SegmentHeight = 5) {
    this.charHeight = height;
  }

  renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar {
    const [a, b, c, d, e, f, g] = segments;
    const { showOffSegments } = options;

    const hOn = this.horzOn;
    const hOff = showOffSegments ? this.horzOff : ' ';
    const vOn = this.vertOn;
    const vOff = showOffSegments ? this.vertOff : ' ';

    const topH = a ? hOn.repeat(4) : hOff.repeat(4);
    const midH = g ? hOn.repeat(4) : hOff.repeat(4);
    const botH = d ? hOn.repeat(4) : hOff.repeat(4);
    const topL = f ? vOn : vOff;
    const topR = b ? vOn : vOff;
    const botL = e ? vOn : vOff;
    const botR = c ? vOn : vOff;

    if (this.charHeight === 7) {
      return {
        width: this.charWidth,
        lines: [
          ` ${topH}  `,
          `${topL}    ${topR} `,
          `${topL}    ${topR} `,
          ` ${midH}  `,
          `${botL}    ${botR} `,
          `${botL}    ${botR} `,
          ` ${botH}  `,
        ],
      };
    }

    // 5-row version
    return {
      width: this.charWidth,
      lines: [
        ` ${topH}  `,
        `${topL}    ${topR} `,
        ` ${midH}  `,
        `${botL}    ${botR} `,
        ` ${botH}  `,
      ],
    };
  }

  renderColon(options: SegmentRenderOptions): RenderedChar {
    const c = _full ? '●' : 'o';
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', `${c} `, '  ', `${c} `, '  ', '  '],
      };
    }
    return {
      width: 2,
      lines: ['  ', `${c} `, '  ', `${c} `, '  '],
    };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    const c = _full ? '●' : 'o';
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '  ', '  ', '  ', '  ', `${c} `],
      };
    }
    return {
      width: 2,
      lines: ['  ', '  ', '  ', '  ', `${c} `],
    };
  }
}

/**
 * Block Renderer - Uses █ block characters
 * Thick, solid segments
 */
export class BlockRenderer implements SegmentRenderer {
  readonly name = 'block';
  readonly charWidth = 7; // 6 + 1 padding
  readonly charHeight: SegmentHeight;
  readonly onChar = _hasBlocks ? '█' : '#';
  readonly offChar = _hasBlocks ? '░' : '.';

  constructor(height: SegmentHeight = 5) {
    this.charHeight = height;
  }

  renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar {
    const [a, b, c, d, e, f, g] = segments;
    const { showOffSegments } = options;

    const hOn = _hasBlocks ? '█' : '#';
    const hOff = showOffSegments ? (_hasBlocks ? '░' : '.') : ' ';
    const vOn = _hasBlocks ? '█' : '#';
    const vOff = showOffSegments ? (_hasBlocks ? '░' : '.') : ' ';

    const topH = a ? hOn.repeat(4) : hOff.repeat(4);
    const midH = g ? hOn.repeat(4) : hOff.repeat(4);
    const botH = d ? hOn.repeat(4) : hOff.repeat(4);
    const topL = f ? vOn : vOff;
    const topR = b ? vOn : vOff;
    const botL = e ? vOn : vOff;
    const botR = c ? vOn : vOff;

    if (this.charHeight === 7) {
      return {
        width: this.charWidth,
        lines: [
          ` ${topH}  `,
          `${topL}    ${topR} `,
          `${topL}    ${topR} `,
          ` ${midH}  `,
          `${botL}    ${botR} `,
          `${botL}    ${botR} `,
          ` ${botH}  `,
        ],
      };
    }

    return {
      width: this.charWidth,
      lines: [
        ` ${topH}  `,
        `${topL}    ${topR} `,
        ` ${midH}  `,
        `${botL}    ${botR} `,
        ` ${botH}  `,
      ],
    };
  }

  renderColon(options: SegmentRenderOptions): RenderedChar {
    const c = this.onChar;
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', `${c} `, '  ', `${c} `, '  ', '  '],
      };
    }
    return {
      width: 2,
      lines: ['  ', `${c} `, '  ', `${c} `, '  '],
    };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    const c = this.onChar;
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '  ', '  ', '  ', '  ', `${c} `],
      };
    }
    return {
      width: 2,
      lines: ['  ', '  ', '  ', '  ', `${c} `],
    };
  }
}

/**
 * Rounded Renderer - Uses rounded box drawing characters
 * Modern, softer look
 */
export class RoundedRenderer implements SegmentRenderer {
  readonly name = 'rounded';
  readonly charWidth = 7; // 6 + 1 padding
  readonly charHeight: SegmentHeight;
  readonly onChar = _full ? '━' : '=';
  readonly offChar = '·';

  constructor(height: SegmentHeight = 5) {
    this.charHeight = height;
  }

  renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar {
    const [a, b, c, d, e, f, g] = segments;
    const { showOffSegments } = options;

    const hOn = _full ? '━' : '=';
    const hOff = showOffSegments ? '·' : ' ';
    const vOn = _full ? '┃' : '|';
    const vOff = showOffSegments ? '·' : ' ';

    // Corners
    const tlOn = _full ? '╭' : '+';
    const trOn = _full ? '╮' : '+';
    const blOn = _full ? '╰' : '+';
    const brOn = _full ? '╯' : '+';
    const mlOn = _full ? '├' : '+';
    const mrOn = _full ? '┤' : '+';

    const topL = f ? vOn : vOff;
    const topR = b ? vOn : vOff;
    const botL = e ? vOn : vOff;
    const botR = c ? vOn : vOff;

    // Build top line with corners if segment a is on
    const topLine = a
      ? `${tlOn}${hOn.repeat(4)}${trOn} `
      : ` ${(showOffSegments ? hOff : ' ').repeat(4)}  `;

    // Build bottom line with corners if segment d is on
    const botLine = d
      ? `${blOn}${hOn.repeat(4)}${brOn} `
      : ` ${(showOffSegments ? hOff : ' ').repeat(4)}  `;

    // Build middle line
    const midLine = g
      ? `${mlOn}${hOn.repeat(4)}${mrOn} `
      : ` ${(showOffSegments ? hOff : ' ').repeat(4)}  `;

    if (this.charHeight === 7) {
      return {
        width: this.charWidth,
        lines: [
          topLine,
          `${topL}    ${topR} `,
          `${topL}    ${topR} `,
          midLine,
          `${botL}    ${botR} `,
          `${botL}    ${botR} `,
          botLine,
        ],
      };
    }

    return {
      width: this.charWidth,
      lines: [
        topLine,
        `${topL}    ${topR} `,
        midLine,
        `${botL}    ${botR} `,
        botLine,
      ],
    };
  }

  renderColon(options: SegmentRenderOptions): RenderedChar {
    const c = _full ? '●' : 'o';
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', `${c} `, '  ', `${c} `, '  ', '  '],
      };
    }
    return {
      width: 2,
      lines: ['  ', `${c} `, '  ', `${c} `, '  '],
    };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    const c = _full ? '●' : 'o';
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '  ', '  ', '  ', '  ', `${c} `],
      };
    }
    return {
      width: 2,
      lines: ['  ', '  ', '  ', '  ', `${c} `],
    };
  }
}

/**
 * Geometric Renderer - Uses geometric shapes ▬ ▮ ▯
 * Chunky LCD aesthetic
 */
export class GeometricRenderer implements SegmentRenderer {
  readonly name = 'geometric';
  readonly charWidth = 7; // 6 + 1 padding
  readonly charHeight: SegmentHeight;
  readonly onChar = _full ? '▬' : '=';
  readonly offChar = _full ? '▯' : '.';

  constructor(height: SegmentHeight = 5) {
    this.charHeight = height;
  }

  renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar {
    const [a, b, c, d, e, f, g] = segments;
    const { showOffSegments } = options;

    // Horizontal: ▬ (on) or ─ (off dim)
    const hOn = _full ? '▬' : '=';
    const hOff = showOffSegments ? (_full ? '─' : '-') : ' ';
    // Vertical: ▮ (on) or ▯ (off dim)
    const vOn = _full ? '▮' : '|';
    const vOff = showOffSegments ? (_full ? '▯' : '.') : ' ';

    const topH = a ? hOn.repeat(4) : hOff.repeat(4);
    const midH = g ? hOn.repeat(4) : hOff.repeat(4);
    const botH = d ? hOn.repeat(4) : hOff.repeat(4);
    const topL = f ? vOn : vOff;
    const topR = b ? vOn : vOff;
    const botL = e ? vOn : vOff;
    const botR = c ? vOn : vOff;

    if (this.charHeight === 7) {
      return {
        width: this.charWidth,
        lines: [
          ` ${topH}  `,
          `${topL}    ${topR} `,
          `${topL}    ${topR} `,
          ` ${midH}  `,
          `${botL}    ${botR} `,
          `${botL}    ${botR} `,
          ` ${botH}  `,
        ],
      };
    }

    return {
      width: this.charWidth,
      lines: [
        ` ${topH}  `,
        `${topL}    ${topR} `,
        ` ${midH}  `,
        `${botL}    ${botR} `,
        ` ${botH}  `,
      ],
    };
  }

  renderColon(options: SegmentRenderOptions): RenderedChar {
    const c = _full ? '■' : '*';
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', `${c} `, '  ', `${c} `, '  ', '  '],
      };
    }
    return {
      width: 2,
      lines: ['  ', `${c} `, '  ', `${c} `, '  '],
    };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    const c = _full ? '■' : '*';
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '  ', '  ', '  ', '  ', `${c} `],
      };
    }
    return {
      width: 2,
      lines: ['  ', '  ', '  ', '  ', `${c} `],
    };
  }
}

/**
 * Pixel Renderer - Uses bitmap font glyphs rendered as block pixels
 * Supports full printable ASCII via bitmap fonts
 */
export class PixelRenderer implements SegmentRenderer {
  readonly name = 'pixel';
  readonly charHeight: SegmentHeight;
  charWidth: number;
  readonly onChar = _hasBlocks ? '█' : '#';
  readonly offChar = _hasBlocks ? '░' : '.';
  private _font: BitmapFont | null;
  // _fontPromise removed — getFont5x7() is now synchronous

  constructor(height: SegmentHeight = 5, font?: BitmapFont) {
    this.charHeight = height;
    if (font) {
      this._font = font;
    } else if (height === 7) {
      this._font = null; // loaded lazily via ensureFont()
    } else {
      this._font = FONT_3x5;
    }
    this.charWidth = (this._font?.width ?? 5) + 1; // +1 for inter-char gap
  }

  /**
   * Ensure the font is loaded (decodes PSF2 on first use for height 7)
   */
  ensureFont(): void {
    if (this._font) return;
    this._font = getFont5x7();
    this.charWidth = this._font.width + 1;
  }

  /**
   * Replace the bitmap font (e.g. with a parsed PSF2 font)
   */
  setFont(font: BitmapFont): void {
    this._font = font;
    this.charWidth = font.width + 1;
  }

  /**
   * Render a character from bitmap font glyph
   */
  renderGlyph(char: string, options: SegmentRenderOptions): RenderedChar {
    if (!this._font) return this._renderBlank();

    const glyph = this._font.glyphs[char]
      || this._font.glyphs[char.toUpperCase()]
      || this._font.glyphs[' '];

    if (!glyph) {
      return this._renderBlank();
    }

    const w = this._font.width;
    const on = options.onChar || this.onChar;
    const off = options.offChar || (options.showOffSegments ? this.offChar : ' ');
    const lines: string[] = [];

    for (const row of glyph) {
      let line = '';
      for (let bit = w - 1; bit >= 0; bit--) {
        line += (row >> bit) & 1 ? on : off;
      }
      line += ' '; // inter-char gap
      lines.push(line);
    }

    return { lines, width: this.charWidth };
  }

  // SegmentRenderer interface — not used for pixel mode, but required by interface
  renderChar(_segments: SegmentMask, options: SegmentRenderOptions): RenderedChar {
    return this.renderGlyph(' ', options);
  }

  renderColon(options: SegmentRenderOptions): RenderedChar {
    const on = options.onChar || this.onChar;
    if (this.charHeight === 7) {
      return { width: 2, lines: ['  ', '  ', `${on} `, '  ', `${on} `, '  ', '  '] };
    }
    return { width: 2, lines: ['  ', `${on} `, '  ', `${on} `, '  '] };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    const on = options.onChar || this.onChar;
    if (this.charHeight === 7) {
      return { width: 2, lines: ['  ', '  ', '  ', '  ', '  ', '  ', `${on} `] };
    }
    return { width: 2, lines: ['  ', '  ', '  ', '  ', `${on} `] };
  }

  private _renderBlank(): RenderedChar {
    const lines = Array(this.charHeight).fill(' '.repeat(this.charWidth));
    return { lines, width: this.charWidth };
  }
}

/**
 * Get renderer by name
 */
export function getRenderer(name: string, height: SegmentHeight = 5): SegmentRenderer {
  switch (name) {
    case 'block':
      return new BlockRenderer(height);
    case 'rounded':
      return new RoundedRenderer(height);
    case 'geometric':
      return new GeometricRenderer(height);
    case 'pixel':
      return new PixelRenderer(height);
    case 'box-drawing':
    default:
      return new BoxDrawingRenderer(height);
  }
}
