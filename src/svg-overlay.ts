// Shared SVG overlay parser and canvas drawer
// Used by both CanvasElement (pixel coordinates) and TileMapElement (geo coordinates)

import { parseSVGPath, type PathCommand, drawPath, drawPathColor, fillPathColor } from './components/canvas-path.ts';
import type { CanvasElement } from './components/canvas.ts';

/** Unescape basic HTML entities in SVG text content. */
function unescapeHtml(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// ===== Parsed SVG types =====

export interface ParsedSvgPath {
  kind: 'path';
  commands: PathCommand[];
  stroke?: string;
  fill?: string;
}

export interface ParsedSvgText {
  kind: 'text';
  x: number;       // pixel x (canvas) or lon (tile-map remaps)
  y: number;       // pixel y (canvas) or lat (tile-map remaps)
  text: string;
  fill?: string;
  bg?: string;
  align: 'left' | 'center' | 'right';
}

export type ParsedSvgElement = ParsedSvgPath | ParsedSvgText;

// Re-export for convenience
export type { PathCommand } from './components/canvas-path.ts';

/**
 * Parse an SVG overlay string into structured elements.
 * Extracts `<path>` and `<text>` elements with their attributes.
 *
 * For text elements, uses `x`/`y` attributes (pixel coords for canvas).
 * Tile-map calls this then remaps `lat`/`lon` attrs to its own geo fields.
 */
export function parseSvgOverlay(str: string): ParsedSvgElement[] {
  const elements: ParsedSvgElement[] = [];
  const attrRegex = /(\w[\w-]*)\s*=\s*"([^"]*)"/g;

  // Parse <path> elements
  const pathRegex = /<path\s+([^>]*?)\/?>/gi;
  let match;
  while ((match = pathRegex.exec(str)) !== null) {
    const attrs: Record<string, string> = {};
    let attrMatch;
    attrRegex.lastIndex = 0;
    while ((attrMatch = attrRegex.exec(match[1])) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    if (attrs.d) {
      elements.push({
        kind: 'path',
        commands: parseSVGPath(attrs.d),
        stroke: attrs.stroke,
        fill: attrs.fill,
      });
    }
  }

  // Parse <text> elements: <text x="10" y="20" fill="#fff">Label</text>
  // Also supports lat/lon for tile-map backward compat
  const textRegex = /<text\s+([^>]*?)>([\s\S]*?)<\/text>/gi;
  while ((match = textRegex.exec(str)) !== null) {
    const attrs: Record<string, string> = {};
    let attrMatch;
    attrRegex.lastIndex = 0;
    while ((attrMatch = attrRegex.exec(match[1])) !== null) {
      attrs[attrMatch[1]] = attrMatch[2];
    }
    // Support both x/y (canvas) and lat/lon (tile-map)
    const x = parseFloat(attrs.x ?? attrs.lon ?? '');
    const y = parseFloat(attrs.y ?? attrs.lat ?? '');
    if (!isNaN(x) && !isNaN(y)) {
      const align = attrs['text-anchor'] === 'middle' ? 'center'
        : attrs['text-anchor'] === 'end' ? 'right'
        : (attrs.align as 'left' | 'center' | 'right') || 'left';
      elements.push({
        kind: 'text',
        x, y,
        text: unescapeHtml(match[2].trim()),
        fill: attrs.fill,
        bg: attrs.bg || attrs.background,
        align,
      });
    }
  }

  return elements;
}

/** Scale path commands by sx/sy factors. */
function scalePathCommands(commands: PathCommand[], sx: number, sy: number): PathCommand[] {
  return commands.map((cmd): PathCommand => {
    switch (cmd.type) {
      case 'M': return { type: 'M', x: cmd.x * sx, y: cmd.y * sy };
      case 'L': return { type: 'L', x: cmd.x * sx, y: cmd.y * sy };
      case 'H': return { type: 'H', x: cmd.x * sx };
      case 'V': return { type: 'V', y: cmd.y * sy };
      case 'T': return { type: 'T', x: cmd.x * sx, y: cmd.y * sy };
      case 'Q': return { type: 'Q', cx: cmd.cx * sx, cy: cmd.cy * sy, x: cmd.x * sx, y: cmd.y * sy };
      case 'S': return { type: 'S', c2x: cmd.c2x * sx, c2y: cmd.c2y * sy, x: cmd.x * sx, y: cmd.y * sy };
      case 'C': return { type: 'C', c1x: cmd.c1x * sx, c1y: cmd.c1y * sy, c2x: cmd.c2x * sx, c2y: cmd.c2y * sy, x: cmd.x * sx, y: cmd.y * sy };
      case 'A': return { type: 'A', rx: cmd.rx * sx, ry: cmd.ry * sy, rotation: cmd.rotation, largeArc: cmd.largeArc, sweep: cmd.sweep, x: cmd.x * sx, y: cmd.y * sy };
      case 'Z': return cmd;
    }
  });
}

/**
 * Draw parsed SVG overlay elements onto a canvas.
 * Coordinates are in aspect-corrected "visual" space where equal distances
 * in X and Y appear the same size on screen. The pixelAspect parameter
 * (width/height of a buffer pixel) is used to correct X coordinates so
 * circles and squares render correctly regardless of graphics mode.
 * Optional scaleX/scaleY rescale coordinates when the canvas has resized
 * since the overlay was first applied.
 */
export function drawSvgOverlay(canvas: CanvasElement, elements: ParsedSvgElement[], scaleX = 1, scaleY = 1, pixelAspect = 1): void {
  // Combine resize scale with aspect correction on X axis.
  // pixelAspect < 1 means pixels are narrower than tall → stretch X.
  const effectiveSx = scaleX / pixelAspect;
  const effectiveSy = scaleY;
  const needsScale = effectiveSx !== 1 || effectiveSy !== 1;

  for (const el of elements) {
    if (el.kind === 'text') {
      const color = el.fill || '#ffffff';
      canvas.drawTextColor(el.x * effectiveSx, el.y * effectiveSy, el.text, color, {
        align: el.align,
        bg: el.bg,
      });
      continue;
    }

    const commands = needsScale ? scalePathCommands(el.commands, effectiveSx, effectiveSy) : el.commands;
    const hasFill = el.fill && el.fill !== 'none';
    const hasStroke = el.stroke && el.stroke !== 'none';
    if (hasFill) {
      fillPathColor(canvas, commands, el.fill!);
    }
    if (hasStroke) {
      drawPathColor(canvas, commands, el.stroke!);
    }
    if (!hasFill && !hasStroke) {
      drawPath(canvas, commands);
    }
  }
}
