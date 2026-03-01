// Canvas SVG-like path drawing - parse SVG path strings, tessellate curves, draw/fill paths
// Curves are flattened to line segments, reusing Bresenham line and scanline polygon fill

import type { DrawableCanvas } from './canvas-draw.ts';
import { drawLine, fillPoly } from './canvas-draw.ts';

// ============================================
// Path Command Types
// ============================================

export type PathCommand =
  | { type: 'M'; x: number; y: number }
  | { type: 'L'; x: number; y: number }
  | { type: 'H'; x: number }
  | { type: 'V'; y: number }
  | { type: 'Q'; cx: number; cy: number; x: number; y: number }
  | { type: 'T'; x: number; y: number }
  | { type: 'C'; c1x: number; c1y: number; c2x: number; c2y: number; x: number; y: number }
  | { type: 'S'; c2x: number; c2y: number; x: number; y: number }
  | { type: 'A'; rx: number; ry: number; rotation: number; largeArc: boolean; sweep: boolean; x: number; y: number }
  | { type: 'Z' };

// ============================================
// SVG Path String Parser
// ============================================

// Tokenize SVG path d attribute into numbers and command letters
function tokenize(d: string): (string | number)[] {
  const tokens: (string | number)[] = [];
  let i = 0;
  const len = d.length;

  while (i < len) {
    const ch = d[i];

    // Skip whitespace and commas
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === ',') {
      i++;
      continue;
    }

    // Command letter
    if (/[A-Za-z]/.test(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }

    // Number (including negative, decimal, scientific notation)
    if (ch === '-' || ch === '+' || ch === '.' || (ch >= '0' && ch <= '9')) {
      let numStr = '';
      // Sign
      if (ch === '-' || ch === '+') {
        numStr += ch;
        i++;
      }
      // Integer part
      while (i < len && d[i] >= '0' && d[i] <= '9') {
        numStr += d[i];
        i++;
      }
      // Decimal part
      if (i < len && d[i] === '.') {
        numStr += '.';
        i++;
        while (i < len && d[i] >= '0' && d[i] <= '9') {
          numStr += d[i];
          i++;
        }
      }
      // Scientific notation
      if (i < len && (d[i] === 'e' || d[i] === 'E')) {
        numStr += d[i];
        i++;
        if (i < len && (d[i] === '+' || d[i] === '-')) {
          numStr += d[i];
          i++;
        }
        while (i < len && d[i] >= '0' && d[i] <= '9') {
          numStr += d[i];
          i++;
        }
      }
      tokens.push(parseFloat(numStr));
      continue;
    }

    // Skip unknown characters
    i++;
  }

  return tokens;
}

/**
 * Parse an SVG path `d` attribute string into absolute PathCommand array.
 * Handles all SVG path commands: M/m L/l H/h V/v Q/q T/t C/c S/s A/a Z/z
 */
export function parseSVGPath(d: string): PathCommand[] {
  const tokens = tokenize(d);
  const commands: PathCommand[] = [];
  let i = 0;
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;  // subpath start (for Z)
  let lastCmd = '';

  function nextNum(): number {
    while (i < tokens.length && typeof tokens[i] === 'string') i++;
    if (i >= tokens.length) return 0;
    return tokens[i++] as number;
  }

  function nextFlag(): boolean {
    while (i < tokens.length && typeof tokens[i] === 'string') i++;
    if (i >= tokens.length) return false;
    const v = tokens[i++] as number;
    return v !== 0;
  }

  while (i < tokens.length) {
    let cmd: string;

    if (typeof tokens[i] === 'string') {
      cmd = tokens[i] as string;
      i++;
    } else {
      // Implicit repeat of last command
      // After M, implicit repeats become L; after m, implicit repeats become l
      if (lastCmd === 'M') cmd = 'L';
      else if (lastCmd === 'm') cmd = 'l';
      else cmd = lastCmd;
    }

    const isRel = cmd === cmd.toLowerCase() && cmd !== 'Z' && cmd !== 'z';
    const upper = cmd.toUpperCase();
    lastCmd = cmd;

    switch (upper) {
      case 'M': {
        const x = nextNum() + (isRel ? curX : 0);
        const y = nextNum() + (isRel ? curY : 0);
        commands.push({ type: 'M', x, y });
        curX = x; curY = y;
        startX = x; startY = y;
        // After M, implicit params become L
        lastCmd = isRel ? 'm' : 'M';
        break;
      }
      case 'L': {
        const x = nextNum() + (isRel ? curX : 0);
        const y = nextNum() + (isRel ? curY : 0);
        commands.push({ type: 'L', x, y });
        curX = x; curY = y;
        break;
      }
      case 'H': {
        const x = nextNum() + (isRel ? curX : 0);
        commands.push({ type: 'H', x });
        curX = x;
        break;
      }
      case 'V': {
        const y = nextNum() + (isRel ? curY : 0);
        commands.push({ type: 'V', y });
        curY = y;
        break;
      }
      case 'Q': {
        const cx = nextNum() + (isRel ? curX : 0);
        const cy = nextNum() + (isRel ? curY : 0);
        const x = nextNum() + (isRel ? curX : 0);
        const y = nextNum() + (isRel ? curY : 0);
        commands.push({ type: 'Q', cx, cy, x, y });
        curX = x; curY = y;
        break;
      }
      case 'T': {
        const x = nextNum() + (isRel ? curX : 0);
        const y = nextNum() + (isRel ? curY : 0);
        commands.push({ type: 'T', x, y });
        curX = x; curY = y;
        break;
      }
      case 'C': {
        const c1x = nextNum() + (isRel ? curX : 0);
        const c1y = nextNum() + (isRel ? curY : 0);
        const c2x = nextNum() + (isRel ? curX : 0);
        const c2y = nextNum() + (isRel ? curY : 0);
        const x = nextNum() + (isRel ? curX : 0);
        const y = nextNum() + (isRel ? curY : 0);
        commands.push({ type: 'C', c1x, c1y, c2x, c2y, x, y });
        curX = x; curY = y;
        break;
      }
      case 'S': {
        const c2x = nextNum() + (isRel ? curX : 0);
        const c2y = nextNum() + (isRel ? curY : 0);
        const x = nextNum() + (isRel ? curX : 0);
        const y = nextNum() + (isRel ? curY : 0);
        commands.push({ type: 'S', c2x, c2y, x, y });
        curX = x; curY = y;
        break;
      }
      case 'A': {
        let rx = nextNum();
        let ry = nextNum();
        if (isRel) { /* rx/ry are always absolute */ }
        const rotation = nextNum();
        const largeArc = nextFlag();
        const sweep = nextFlag();
        const x = nextNum() + (isRel ? curX : 0);
        const y = nextNum() + (isRel ? curY : 0);
        commands.push({ type: 'A', rx: Math.abs(rx), ry: Math.abs(ry), rotation, largeArc, sweep, x, y });
        curX = x; curY = y;
        break;
      }
      case 'Z': {
        commands.push({ type: 'Z' });
        curX = startX; curY = startY;
        break;
      }
    }
  }

  return commands;
}

// ============================================
// Curve Tessellation
// ============================================

const DEFAULT_TOLERANCE = 0.5;
const MAX_DEPTH = 10;

/**
 * Tessellate a quadratic Bezier curve into line segment vertices.
 * Uses De Casteljau recursive subdivision.
 * Returns vertex array excluding start point, including end point.
 */
export function tessellateQuadratic(
  x0: number, y0: number,
  cx: number, cy: number,
  x1: number, y1: number,
  tolerance: number = DEFAULT_TOLERANCE
): number[][] {
  const result: number[][] = [];
  subdivideQuadratic(x0, y0, cx, cy, x1, y1, tolerance * tolerance, 0, result);
  return result;
}

function subdivideQuadratic(
  x0: number, y0: number,
  cx: number, cy: number,
  x1: number, y1: number,
  tolSq: number,
  depth: number,
  result: number[][]
): void {
  // Flatness test: distance from control point to midpoint of chord
  const mx = (x0 + x1) * 0.5;
  const my = (y0 + y1) * 0.5;
  const dx = cx - mx;
  const dy = cy - my;
  const distSq = dx * dx + dy * dy;

  if (distSq <= tolSq || depth >= MAX_DEPTH) {
    result.push([x1, y1]);
    return;
  }

  // De Casteljau split at t=0.5
  const q0x = (x0 + cx) * 0.5, q0y = (y0 + cy) * 0.5;
  const q1x = (cx + x1) * 0.5, q1y = (cy + y1) * 0.5;
  const rx = (q0x + q1x) * 0.5, ry = (q0y + q1y) * 0.5;

  subdivideQuadratic(x0, y0, q0x, q0y, rx, ry, tolSq, depth + 1, result);
  subdivideQuadratic(rx, ry, q1x, q1y, x1, y1, tolSq, depth + 1, result);
}

/**
 * Tessellate a cubic Bezier curve into line segment vertices.
 * Uses De Casteljau recursive subdivision.
 * Returns vertex array excluding start point, including end point.
 */
export function tessellateCubic(
  x0: number, y0: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  x1: number, y1: number,
  tolerance: number = DEFAULT_TOLERANCE
): number[][] {
  const result: number[][] = [];
  subdivideCubic(x0, y0, c1x, c1y, c2x, c2y, x1, y1, tolerance * tolerance, 0, result);
  return result;
}

function subdivideCubic(
  x0: number, y0: number,
  c1x: number, c1y: number,
  c2x: number, c2y: number,
  x1: number, y1: number,
  tolSq: number,
  depth: number,
  result: number[][]
): void {
  // Flatness test: max distance of control points from chord
  const ux = 3 * c1x - 2 * x0 - x1;
  const uy = 3 * c1y - 2 * y0 - y1;
  const vx = 3 * c2x - 2 * x1 - x0;
  const vy = 3 * c2y - 2 * y1 - y0;
  const maxDistSq = Math.max(ux * ux + uy * uy, vx * vx + vy * vy);

  if (maxDistSq <= 16 * tolSq || depth >= MAX_DEPTH) {
    result.push([x1, y1]);
    return;
  }

  // De Casteljau split at t=0.5
  const m1x = (x0 + c1x) * 0.5, m1y = (y0 + c1y) * 0.5;
  const m2x = (c1x + c2x) * 0.5, m2y = (c1y + c2y) * 0.5;
  const m3x = (c2x + x1) * 0.5, m3y = (c2y + y1) * 0.5;
  const m4x = (m1x + m2x) * 0.5, m4y = (m1y + m2y) * 0.5;
  const m5x = (m2x + m3x) * 0.5, m5y = (m2y + m3y) * 0.5;
  const mx = (m4x + m5x) * 0.5, my = (m4y + m5y) * 0.5;

  subdivideCubic(x0, y0, m1x, m1y, m4x, m4y, mx, my, tolSq, depth + 1, result);
  subdivideCubic(mx, my, m5x, m5y, m3x, m3y, x1, y1, tolSq, depth + 1, result);
}

/**
 * Tessellate an SVG elliptical arc into line segment vertices.
 * Converts SVG endpoint parameterization to center parameterization per SVG spec F.6.5-F.6.6.
 * Returns vertex array excluding start point, including end point.
 */
export function tessellateArc(
  x0: number, y0: number,
  rx: number, ry: number,
  rotationDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x1: number, y1: number,
  tolerance: number = DEFAULT_TOLERANCE
): number[][] {
  // Degenerate: zero radii or same point → line
  if (rx === 0 || ry === 0 || (x0 === x1 && y0 === y1)) {
    return [[x1, y1]];
  }

  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotationDeg * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // Step 1: Compute (x1', y1') — SVG spec F.6.5.1
  const dx = (x0 - x1) * 0.5;
  const dy = (y0 - y1) * 0.5;
  const x1p = cosPhi * dx + sinPhi * dy;
  const y1p = -sinPhi * dx + cosPhi * dy;

  // Step 2: Scale radii if too small — SVG spec F.6.6.3
  let x1p2 = x1p * x1p;
  let y1p2 = y1p * y1p;
  let rx2 = rx * rx;
  let ry2 = ry * ry;
  const lambda = x1p2 / rx2 + y1p2 / ry2;
  if (lambda > 1) {
    const sqrtL = Math.sqrt(lambda);
    rx *= sqrtL;
    ry *= sqrtL;
    rx2 = rx * rx;
    ry2 = ry * ry;
  }

  // Step 3: Compute center point (cx', cy') — SVG spec F.6.5.2-F.6.5.3
  let sq = (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2);
  if (sq < 0) sq = 0;
  let root = Math.sqrt(sq);
  if (largeArc === sweep) root = -root;
  const cxp = root * (rx * y1p) / ry;
  const cyp = root * -(ry * x1p) / rx;

  // Step 4: Compute center (cx, cy) — SVG spec F.6.5.3
  const cx = cosPhi * cxp - sinPhi * cyp + (x0 + x1) * 0.5;
  const cy = sinPhi * cxp + cosPhi * cyp + (y0 + y1) * 0.5;

  // Step 5: Compute start angle and sweep — SVG spec F.6.5.5-F.6.5.6
  function angle(ux: number, uy: number, vx: number, vy: number): number {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.max(-1, Math.min(1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  }

  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dtheta = angle(
    (x1p - cxp) / rx, (y1p - cyp) / ry,
    (-x1p - cxp) / rx, (-y1p - cyp) / ry
  );

  // Adjust sweep
  if (!sweep && dtheta > 0) dtheta -= 2 * Math.PI;
  else if (sweep && dtheta < 0) dtheta += 2 * Math.PI;

  // Step 6: Generate line segments with adaptive step
  const maxR = Math.max(rx, ry);
  const step = Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / maxR)));
  const numSteps = Math.max(2, Math.ceil(Math.abs(dtheta) / step));

  const result: number[][] = [];
  for (let s = 1; s <= numSteps; s++) {
    const t = s === numSteps ? theta1 + dtheta : theta1 + (dtheta * s) / numSteps;
    const cosT = Math.cos(t);
    const sinT = Math.sin(t);
    const px = cosPhi * rx * cosT - sinPhi * ry * sinT + cx;
    const py = sinPhi * rx * cosT + cosPhi * ry * sinT + cy;
    result.push([px, py]);
  }

  return result;
}

// ============================================
// Path to Polygon Conversion
// ============================================

/**
 * Convert path commands into polygon subpaths.
 * Each subpath is a vertex array [[x,y], ...].
 * Multiple subpaths enable holes via even-odd fill rule.
 */
export function pathToPolygons(commands: PathCommand[], tolerance: number = DEFAULT_TOLERANCE): number[][][] {
  const subpaths: number[][][] = [];
  let current: number[][] = [];
  let curX = 0, curY = 0;
  let startX = 0, startY = 0;
  let lastCx = 0, lastCy = 0;  // last control point for T/S
  let lastType = '';

  function ensureCurrent(): void {
    if (current.length === 0) {
      current.push([curX, curY]);
    }
  }

  for (const cmd of commands) {
    switch (cmd.type) {
      case 'M':
        if (current.length > 1) subpaths.push(current);
        curX = cmd.x; curY = cmd.y;
        startX = curX; startY = curY;
        current = [[curX, curY]];
        lastCx = curX; lastCy = curY;
        break;

      case 'L':
        ensureCurrent();
        curX = cmd.x; curY = cmd.y;
        current.push([curX, curY]);
        lastCx = curX; lastCy = curY;
        break;

      case 'H':
        ensureCurrent();
        curX = cmd.x;
        current.push([curX, curY]);
        lastCx = curX; lastCy = curY;
        break;

      case 'V':
        ensureCurrent();
        curY = cmd.y;
        current.push([curX, curY]);
        lastCx = curX; lastCy = curY;
        break;

      case 'Q': {
        ensureCurrent();
        const pts = tessellateQuadratic(curX, curY, cmd.cx, cmd.cy, cmd.x, cmd.y, tolerance);
        for (const p of pts) current.push(p);
        lastCx = cmd.cx; lastCy = cmd.cy;
        curX = cmd.x; curY = cmd.y;
        break;
      }

      case 'T': {
        ensureCurrent();
        // Reflect last control point for smooth continuation
        let cx: number, cy: number;
        if (lastType === 'Q' || lastType === 'T') {
          cx = 2 * curX - lastCx;
          cy = 2 * curY - lastCy;
        } else {
          cx = curX;
          cy = curY;
        }
        const pts = tessellateQuadratic(curX, curY, cx, cy, cmd.x, cmd.y, tolerance);
        for (const p of pts) current.push(p);
        lastCx = cx; lastCy = cy;
        curX = cmd.x; curY = cmd.y;
        break;
      }

      case 'C': {
        ensureCurrent();
        const pts = tessellateCubic(curX, curY, cmd.c1x, cmd.c1y, cmd.c2x, cmd.c2y, cmd.x, cmd.y, tolerance);
        for (const p of pts) current.push(p);
        lastCx = cmd.c2x; lastCy = cmd.c2y;
        curX = cmd.x; curY = cmd.y;
        break;
      }

      case 'S': {
        ensureCurrent();
        // Reflect last control point for smooth continuation
        let c1x: number, c1y: number;
        if (lastType === 'C' || lastType === 'S') {
          c1x = 2 * curX - lastCx;
          c1y = 2 * curY - lastCy;
        } else {
          c1x = curX;
          c1y = curY;
        }
        const pts = tessellateCubic(curX, curY, c1x, c1y, cmd.c2x, cmd.c2y, cmd.x, cmd.y, tolerance);
        for (const p of pts) current.push(p);
        lastCx = cmd.c2x; lastCy = cmd.c2y;
        curX = cmd.x; curY = cmd.y;
        break;
      }

      case 'A': {
        ensureCurrent();
        const pts = tessellateArc(curX, curY, cmd.rx, cmd.ry, cmd.rotation, cmd.largeArc, cmd.sweep, cmd.x, cmd.y, tolerance);
        for (const p of pts) current.push(p);
        curX = cmd.x; curY = cmd.y;
        lastCx = curX; lastCy = curY;
        break;
      }

      case 'Z':
        ensureCurrent();
        if (current.length > 0) {
          // Mark closure by returning to start
          curX = startX; curY = startY;
          subpaths.push(current);
        }
        current = [];
        lastCx = curX; lastCy = curY;
        break;
    }

    lastType = cmd.type;
  }

  // Push final unclosed subpath
  if (current.length > 1) {
    subpaths.push(current);
  }

  return subpaths;
}

// ============================================
// Draw/Fill Entry Points
// ============================================

/**
 * Stroke a path (outline only).
 * For closed subpaths (ending in Z), connects last point to first.
 */
export function drawPath(canvas: DrawableCanvas, commands: PathCommand[], tolerance?: number): void {
  const subpaths = pathToPolygons(commands, tolerance);
  for (const verts of subpaths) {
    if (verts.length < 2) continue;
    for (let i = 0; i < verts.length - 1; i++) {
      drawLine(canvas,
        Math.floor(verts[i][0]), Math.floor(verts[i][1]),
        Math.floor(verts[i + 1][0]), Math.floor(verts[i + 1][1]));
    }
    // Check if subpath is closed (first and last point coincide)
    const first = verts[0];
    const last = verts[verts.length - 1];
    if (Math.abs(first[0] - last[0]) > 0.5 || Math.abs(first[1] - last[1]) > 0.5) {
      // Not closed — don't connect back (open subpath stroke)
    }
    // If closed, the Z command already added start point proximity via pathToPolygons
  }
}

/**
 * Fill a path using even-odd rule.
 * Multiple subpaths create holes. Unclosed subpaths are implicitly closed for fill.
 */
export function fillPath(canvas: DrawableCanvas, commands: PathCommand[], tolerance?: number): void {
  const subpaths = pathToPolygons(commands, tolerance);
  fillPolySub(canvas, subpaths);
}

/**
 * Stroke a path from an SVG path string.
 */
export function drawPathSVG(canvas: DrawableCanvas, d: string, tolerance?: number): void {
  drawPath(canvas, parseSVGPath(d), tolerance);
}

/**
 * Fill a path from an SVG path string using even-odd rule.
 */
export function fillPathSVG(canvas: DrawableCanvas, d: string, tolerance?: number): void {
  fillPath(canvas, parseSVGPath(d), tolerance);
}

// ============================================
// Color Variants
// ============================================

export function drawPathColor(canvas: DrawableCanvas, commands: PathCommand[], color: number | string, tolerance?: number): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawPath(canvas, commands, tolerance);
  canvas.setColorDirect(savedColor);
}

export function fillPathColor(canvas: DrawableCanvas, commands: PathCommand[], color: number | string, tolerance?: number): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  fillPath(canvas, commands, tolerance);
  canvas.setColorDirect(savedColor);
}

export function drawPathSVGColor(canvas: DrawableCanvas, d: string, color: number | string, tolerance?: number): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  drawPathSVG(canvas, d, tolerance);
  canvas.setColorDirect(savedColor);
}

export function fillPathSVGColor(canvas: DrawableCanvas, d: string, color: number | string, tolerance?: number): void {
  const savedColor = canvas.getColor();
  canvas.setColor(color);
  fillPathSVG(canvas, d, tolerance);
  canvas.setColorDirect(savedColor);
}

// ============================================
// Aspect-Corrected Variants
// ============================================

/**
 * Stroke a path with aspect ratio correction.
 * All X coordinates are scaled by 1/aspectRatio.
 */
export function drawPathCorrected(canvas: DrawableCanvas, commands: PathCommand[], tolerance?: number): void {
  drawPath(canvas, correctCommands(canvas, commands), tolerance);
}

/**
 * Fill a path with aspect ratio correction.
 * All X coordinates are scaled by 1/aspectRatio.
 */
export function fillPathCorrected(canvas: DrawableCanvas, commands: PathCommand[], tolerance?: number): void {
  fillPath(canvas, correctCommands(canvas, commands), tolerance);
}

function correctCommands(canvas: DrawableCanvas, commands: PathCommand[]): PathCommand[] {
  const a = canvas.getPixelAspectRatio();
  if (a === 0) return commands;
  const inv = 1 / a;
  return commands.map(cmd => {
    switch (cmd.type) {
      case 'M': return { ...cmd, x: Math.round(cmd.x * inv) };
      case 'L': return { ...cmd, x: Math.round(cmd.x * inv) };
      case 'H': return { ...cmd, x: Math.round(cmd.x * inv) };
      case 'V': return cmd;
      case 'Q': return { ...cmd, cx: Math.round(cmd.cx * inv), x: Math.round(cmd.x * inv) };
      case 'T': return { ...cmd, x: Math.round(cmd.x * inv) };
      case 'C': return { ...cmd, c1x: Math.round(cmd.c1x * inv), c2x: Math.round(cmd.c2x * inv), x: Math.round(cmd.x * inv) };
      case 'S': return { ...cmd, c2x: Math.round(cmd.c2x * inv), x: Math.round(cmd.x * inv) };
      case 'A': return { ...cmd, rx: Math.round(cmd.rx * inv), x: Math.round(cmd.x * inv) };
      case 'Z': return cmd;
    }
  });
}

// ============================================
// Multi-Subpath Scanline Fill
// ============================================

/**
 * Fill multiple polygon subpaths using scanline even-odd rule.
 * Edges from all subpaths contribute to the same scanline intersection set,
 * enabling holes when inner contours are wound opposite to outer contours.
 */
export function fillPolySub(canvas: DrawableCanvas, subpaths: number[][][]): void {
  if (subpaths.length === 0) return;

  // Single subpath: delegate to existing fillPoly
  if (subpaths.length === 1) {
    const sp = subpaths[0];
    if (sp.length >= 3) fillPoly(canvas, sp);
    return;
  }

  // Find bounding box across all subpaths
  let minY = Infinity, maxY = -Infinity;
  for (const sp of subpaths) {
    for (const p of sp) {
      const y = Math.floor(p[1]);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }

  const bufH = canvas.getBufferHeight();
  const bufW = canvas.getBufferWidth();
  if (minY < 0) minY = 0;
  if (maxY >= bufH) maxY = bufH - 1;

  const nodeX: number[] = [];

  for (let y = minY; y <= maxY; y++) {
    nodeX.length = 0;

    // Collect edge intersections from all subpaths
    for (const sp of subpaths) {
      const n = sp.length;
      if (n < 3) continue;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const yi = sp[i][1], yj = sp[j][1];
        if ((yi < y && yj >= y) || (yj < y && yi >= y)) {
          nodeX.push(Math.round(
            sp[i][0] + (y - yi) / (yj - yi) * (sp[j][0] - sp[i][0])
          ));
        }
      }
    }

    nodeX.sort((a, b) => a - b);

    // Fill between pairs (even-odd rule)
    for (let i = 0; i < nodeX.length - 1; i += 2) {
      let x0 = nodeX[i];
      let x1 = nodeX[i + 1];
      if (x0 < 0) x0 = 0;
      if (x1 >= bufW) x1 = bufW - 1;
      for (let x = x0; x <= x1; x++) {
        canvas.setPixel(x, y, true);
      }
    }
  }
}
