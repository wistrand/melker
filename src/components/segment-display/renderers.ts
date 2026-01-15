// Segment display renderers
// Each renderer produces multi-line ASCII/Unicode art for 7-segment digits

import type { SegmentMask } from './charsets.ts';
import type { SegmentRenderer, SegmentHeight, SegmentRenderOptions, RenderedChar } from './types.ts';

// Re-export types for convenience
export type { SegmentRenderer, SegmentHeight, SegmentRenderOptions, RenderedChar } from './types.ts';

/**
 * Box Drawing Renderer - Uses ━ and ┃ characters
 * Clean, thin lines
 */
export class BoxDrawingRenderer implements SegmentRenderer {
  readonly name = 'box-drawing';
  readonly charWidth = 7; // 6 + 1 padding
  readonly charHeight: SegmentHeight;
  readonly onChar = '━';
  readonly offChar = '·';

  readonly horzOn = '━';
  readonly horzOff = '·';
  readonly vertOn = '┃';
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
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '● ', '  ', '● ', '  ', '  '],
      };
    }
    return {
      width: 2,
      lines: ['  ', '● ', '  ', '● ', '  '],
    };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '  ', '  ', '  ', '  ', '● '],
      };
    }
    return {
      width: 2,
      lines: ['  ', '  ', '  ', '  ', '● '],
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
  readonly onChar = '█';
  readonly offChar = '░';

  constructor(height: SegmentHeight = 5) {
    this.charHeight = height;
  }

  renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar {
    const [a, b, c, d, e, f, g] = segments;
    const { showOffSegments } = options;

    const hOn = '█';
    const hOff = showOffSegments ? '░' : ' ';
    const vOn = '█';
    const vOff = showOffSegments ? '░' : ' ';

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
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '█ ', '  ', '█ ', '  ', '  '],
      };
    }
    return {
      width: 2,
      lines: ['  ', '█ ', '  ', '█ ', '  '],
    };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '  ', '  ', '  ', '  ', '█ '],
      };
    }
    return {
      width: 2,
      lines: ['  ', '  ', '  ', '  ', '█ '],
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
  readonly onChar = '━';
  readonly offChar = '·';

  constructor(height: SegmentHeight = 5) {
    this.charHeight = height;
  }

  renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar {
    const [a, b, c, d, e, f, g] = segments;
    const { showOffSegments } = options;

    const hOn = '━';
    const hOff = showOffSegments ? '·' : ' ';
    const vOn = '┃';
    const vOff = showOffSegments ? '·' : ' ';

    // Corners
    const tlOn = '╭';
    const trOn = '╮';
    const blOn = '╰';
    const brOn = '╯';
    const mlOn = '├';
    const mrOn = '┤';

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
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '● ', '  ', '● ', '  ', '  '],
      };
    }
    return {
      width: 2,
      lines: ['  ', '● ', '  ', '● ', '  '],
    };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '  ', '  ', '  ', '  ', '● '],
      };
    }
    return {
      width: 2,
      lines: ['  ', '  ', '  ', '  ', '● '],
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
  readonly onChar = '▬';
  readonly offChar = '▯';

  constructor(height: SegmentHeight = 5) {
    this.charHeight = height;
  }

  renderChar(segments: SegmentMask, options: SegmentRenderOptions): RenderedChar {
    const [a, b, c, d, e, f, g] = segments;
    const { showOffSegments } = options;

    // Horizontal: ▬ (on) or ▭ (off, but ▭ isn't great, use spaces or ─)
    const hOn = '▬';
    const hOff = showOffSegments ? '─' : ' ';
    // Vertical: ▮ (on) or ▯ (off)
    const vOn = '▮';
    const vOff = showOffSegments ? '▯' : ' ';

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
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '■ ', '  ', '■ ', '  ', '  '],
      };
    }
    return {
      width: 2,
      lines: ['  ', '■ ', '  ', '■ ', '  '],
    };
  }

  renderDot(options: SegmentRenderOptions): RenderedChar {
    if (this.charHeight === 7) {
      return {
        width: 2,
        lines: ['  ', '  ', '  ', '  ', '  ', '  ', '■ '],
      };
    }
    return {
      width: 2,
      lines: ['  ', '  ', '  ', '  ', '■ '],
    };
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
    case 'box-drawing':
    default:
      return new BoxDrawingRenderer(height);
  }
}
