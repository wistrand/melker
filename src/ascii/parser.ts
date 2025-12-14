// ASCII box parser adapted from tuilly, modified for melker integration

import {
  Box,
  BoxStructure,
  Bounds,
  ParsedBox,
  ParseResult,
  ParseError,
  LayoutHints,
  ParsedButton,
  TabBarInfo,
  TabInfo,
} from './types.ts';
import { AsciiParseError, ERROR_MESSAGES } from './errors.ts';

/**
 * Parse ASCII box diagram into box structure.
 * Synchronous - no external file loading.
 */
export function parseAsciiBoxes(ascii: string): ParseResult {
  const errors: ParseError[] = [];
  const lines = ascii.split('\n');
  const grid = lines.map((line) => line.split(''));

  // Find all boxes
  const parsedBoxes = findAllBoxes(grid, errors);

  // Check for overlapping boxes
  const overlapErrors = checkOverlappingBoxes(parsedBoxes);
  errors.push(...overlapErrors);

  if (overlapErrors.length > 0) {
    return { errors };
  }

  // Find top-level boxes
  const topLevelBoxes = parsedBoxes.filter((box) => box.isTopLevel);

  // Build structure
  const structure = buildBoxStructure(parsedBoxes, topLevelBoxes);

  return { structure, errors };
}

function findAllBoxes(grid: string[][], errors: ParseError[]): ParsedBox[] {
  const boxes: ParsedBox[] = [];

  // Create a mutable copy of the grid
  const mutableGrid = grid.map((row) => [...row]);

  // Keep finding boxes until no more are found
  while (true) {
    const box = findSmallestBox(mutableGrid, grid, errors);
    if (!box) break;

    boxes.push(box);
    // Replace the box area with spaces to "remove" it
    replaceBoxWithSpaces(mutableGrid, box);
  }

  // Determine which boxes are top-level
  for (const box of boxes) {
    box.isTopLevel = !boxes.some(
      (other) => other !== box && isBoxInside(box.bounds, other.bounds)
    );
  }

  return boxes;
}

function findSmallestBox(
  grid: string[][],
  originalGrid: string[][],
  errors: ParseError[]
): ParsedBox | null {
  let smallestBox: ParsedBox | null = null;
  let smallestArea = Infinity;

  for (let row = 0; row < grid.length; row++) {
    for (let col = 0; col < grid[row].length; col++) {
      if (grid[row][col] === '+') {
        const box = detectSimpleBox(grid, originalGrid, row, col, errors);
        if (box) {
          const area = box.bounds.width * box.bounds.height;
          if (area < smallestArea) {
            smallestArea = area;
            smallestBox = box;
          }
        }
      }
    }
  }

  return smallestBox;
}

function detectSimpleBox(
  grid: string[][],
  originalGrid: string[][],
  topRow: number,
  leftCol: number,
  errors: ParseError[]
): ParsedBox | null {
  // Find the top-right corner by scanning right for the next '+'
  let rightCol = leftCol + 1;
  while (rightCol < grid[topRow].length && grid[topRow][rightCol] !== '+') {
    rightCol++;
  }

  if (rightCol >= grid[topRow].length || grid[topRow][rightCol] !== '+') {
    return null;
  }

  // Extract the box title from the top line
  const topLine = grid[topRow].slice(leftCol, rightCol + 1).join('');
  const extracted = extractIdentifier(topLine);
  if (!extracted) {
    return null;
  }
  const { id, displayName, inferredType, inferredProps } = extracted;

  // Check if this is a single-line box (next row doesn't have content border '|')
  const width = rightCol - leftCol + 1;
  let height = 1;
  let bottomRow = topRow;

  // Check the row below for content or bottom border (use original grid for detection)
  if (topRow + 1 < originalGrid.length && leftCol < originalGrid[topRow + 1].length) {
    const charBelow = originalGrid[topRow + 1][leftCol];

    if (charBelow === '|') {
      // Multi-line box - find the bottom border
      bottomRow = topRow + 1;
      while (
        bottomRow < originalGrid.length &&
        leftCol < originalGrid[bottomRow].length &&
        originalGrid[bottomRow][leftCol] !== '+'
      ) {
        bottomRow++;
      }

      if (
        bottomRow >= originalGrid.length ||
        leftCol >= originalGrid[bottomRow].length ||
        originalGrid[bottomRow][leftCol] !== '+'
      ) {
        return null; // Unclosed box
      }

      height = bottomRow - topRow + 1;
    }
    // If char below is '+', '-', or anything else, it's a single-line box (height=1)
  }

  // Extract content lines for button detection
  const contentLines: string[] = [];
  for (let row = topRow + 1; row < bottomRow; row++) {
    const line = originalGrid[row].slice(leftCol + 1, rightCol).join('');
    contentLines.push(line);
  }

  // Extract properties and hints from the box content (use original grid!)
  const { properties, hints, tabBar } = extractPropertiesAndHints(
    originalGrid,
    topRow,
    leftCol,
    width,
    height
  );

  return {
    id,
    displayName,
    bounds: {
      top: topRow,
      left: leftCol,
      width,
      height,
    },
    properties,
    hints,
    contentLines,
    tabBar,
    inferredType,
    inferredProps,
    isTopLevel: false,
  };
}

function replaceBoxWithSpaces(grid: string[][], box: ParsedBox): void {
  const { top, left, width, height } = box.bounds;

  for (let row = top; row < top + height; row++) {
    for (let col = left; col < left + width; col++) {
      if (row < grid.length && col < grid[row].length) {
        grid[row][col] = ' ';
      }
    }
  }
}

interface ExtractedIdentifier {
  id: string;
  displayName?: string;
  /** Inferred element type from shorthand syntax */
  inferredType?: string;
  /** Inferred properties from shorthand syntax */
  inferredProps?: Record<string, string>;
}

/**
 * Parse shorthand type syntax in box names:
 *   [Button Title]     → button with title
 *   "Text content"     → text with content
 *   {inputId}          → input with id
 *   <type> content     → explicit type with content
 */
function parseShorthandType(content: string): ExtractedIdentifier | null {
  // [Button Title] → button
  const buttonMatch = content.match(/^\[(.+)\]$/);
  if (buttonMatch) {
    const title = buttonMatch[1].trim();
    // Generate id from title (lowercase, spaces to hyphens)
    const id = title.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return {
      id: id || 'button',
      inferredType: 'button',
      inferredProps: { title },
    };
  }

  // "Text content" → text
  const textMatch = content.match(/^"(.+)"$/);
  if (textMatch) {
    const text = textMatch[1];
    const id = text.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 20);
    return {
      id: id || 'text',
      inferredType: 'text',
      inferredProps: { text },
    };
  }

  // {inputId} → input
  const inputMatch = content.match(/^\{(.+)\}$/);
  if (inputMatch) {
    const id = inputMatch[1].trim();
    return {
      id,
      inferredType: 'input',
      inferredProps: {},
    };
  }

  // <type> content → explicit type (e.g., <checkbox> Remember me)
  const explicitMatch = content.match(/^<([a-z-]+)>\s*(.*)$/);
  if (explicitMatch) {
    const type = explicitMatch[1];
    const rest = explicitMatch[2].trim();
    // For checkbox/radio, rest is title; for text, rest is content
    const id = rest.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').substring(0, 20) || type;
    const props: Record<string, string> = {};
    if (type === 'checkbox' || type === 'radio' || type === 'button') {
      if (rest) props.title = rest;
    } else if (type === 'text' || type === 'markdown') {
      if (rest) props.text = rest;
    } else if (type === 'input' || type === 'textarea') {
      if (rest) props.placeholder = rest;
    }
    return {
      id,
      inferredType: type,
      inferredProps: props,
    };
  }

  return null;
}

function extractIdentifier(line: string): ExtractedIdentifier | null {
  // Pattern: +--content--+ where content can be:
  //   - "id" (just identifier)
  //   - "id Display Name" (identifier + display name after whitespace)
  //   - Shorthand: [Button], "text", {input}, <type> content
  const match = line.match(/\+--(.+?)--+\+/);
  if (match) {
    const content = match[1].trim();

    // Try shorthand syntax first
    const shorthand = parseShorthandType(content);
    if (shorthand) {
      return shorthand;
    }

    // Must contain at least one letter to be valid
    if (content && /[a-zA-Z]/.test(content)) {
      // Split on first whitespace: "id Display Name" -> ["id", "Display Name"]
      const spaceIndex = content.search(/\s/);
      if (spaceIndex > 0) {
        const id = content.substring(0, spaceIndex);
        const displayName = content.substring(spaceIndex).trim();
        // ID must be a valid identifier (letters, numbers, underscore, hyphen)
        if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
          return { id, displayName: displayName || undefined };
        }
      }
      // No whitespace - entire content is the ID
      return { id: content };
    }
  }

  // Fallback: try to extract anything between + characters that isn't just dashes
  const fallbackMatch = line.match(/\+([^+]+)\+/);
  if (fallbackMatch) {
    const content = fallbackMatch[1].replace(/^-+|-+$/g, '').trim();

    // Try shorthand syntax first
    const shorthand = parseShorthandType(content);
    if (shorthand) {
      return shorthand;
    }

    // Must contain at least one letter to be valid
    if (content && /[a-zA-Z]/.test(content)) {
      const spaceIndex = content.search(/\s/);
      if (spaceIndex > 0) {
        const id = content.substring(0, spaceIndex);
        const displayName = content.substring(spaceIndex).trim();
        if (/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
          return { id, displayName: displayName || undefined };
        }
      }
      return { id: content };
    }
  }

  return null;
}

function extractPropertiesAndHints(
  grid: string[][],
  topRow: number,
  leftCol: number,
  width: number,
  height: number
): { properties?: Record<string, string>; hints?: LayoutHints; tabBar?: TabBarInfo } {
  const properties: Record<string, string> = {};
  let hints: LayoutHints | undefined;
  let tabBar: TabBarInfo | undefined;
  let hasProperties = false;
  let currentKey: string | null = null;
  let currentValue = '';

  const bottomRow = topRow + height - 1;
  const rightCol = leftCol + width - 1;

  for (let row = topRow + 1; row < bottomRow; row++) {
    const rawLine = grid[row].slice(leftCol + 1, rightCol).join('');
    const contentLine = rawLine.trim();

    // Skip empty lines
    if (!contentLine) continue;

    // Skip lines that are nested box borders (start with + or start/end with |)
    // But don't skip property lines that happen to contain + in the value
    if (contentLine.startsWith('+') || contentLine.startsWith('|')) continue;
    if (contentLine.endsWith('|')) continue;

    // Check for compact hints line (starts with `: `)
    if (contentLine.startsWith(': ')) {
      const parsedHints = parseCompactHints(contentLine.substring(2));
      hints = hints ? { ...hints, ...parsedHints } : parsedHints;
      continue;
    }

    // Check for tab bar line (│ Tab1* │ Tab2 │)
    if (contentLine.startsWith('│')) {
      const parsedTabBar = parseTabBar(contentLine);
      if (parsedTabBar) {
        tabBar = parsedTabBar;
        continue;
      }
    }

    // Look for key:value pattern
    const match = contentLine.match(/^([^:]+):\s*(.*)$/);
    if (match) {
      // Save previous key:value if we have one
      if (currentKey) {
        properties[currentKey] = currentValue.trim();
        hasProperties = true;
      }
      currentKey = match[1].trim();
      currentValue = match[2].trim();
    } else if (currentKey && contentLine) {
      // Continuation line - append to current value
      currentValue = currentValue ? currentValue + ' ' + contentLine : contentLine;
    }
  }

  // Don't forget the last key:value pair
  if (currentKey) {
    properties[currentKey] = currentValue.trim();
    hasProperties = true;
  }

  return {
    properties: hasProperties ? properties : undefined,
    hints,
    tabBar,
  };
}

/**
 * Parse tab bar line like "│ Tab1* │ Tab2 │ Tab3 │"
 * Returns tab info if the line matches the pattern, otherwise null
 */
export function parseTabBar(line: string): TabBarInfo | null {
  // Match pattern: starts and ends with │, contains │-separated tabs
  // Tab with * suffix is active
  const trimmed = line.trim();

  // Must start and end with │
  if (!trimmed.startsWith('│') || !trimmed.endsWith('│')) {
    return null;
  }

  // Split by │ and extract tab titles
  const parts = trimmed.split('│').map(p => p.trim()).filter(p => p.length > 0);

  if (parts.length === 0) {
    return null;
  }

  const tabs: TabInfo[] = [];
  for (const part of parts) {
    const isActive = part.endsWith('*');
    const title = isActive ? part.slice(0, -1).trim() : part;

    if (title.length > 0) {
      tabs.push({ title, isActive });
    }
  }

  // Must have at least one tab
  if (tabs.length === 0) {
    return null;
  }

  // If no active tab marked, first one is active
  const hasActive = tabs.some(t => t.isActive);
  if (!hasActive && tabs.length > 0) {
    tabs[0].isActive = true;
  }

  return { tabs };
}

/**
 * Parse compact layout hints from string like "r 2 = -"
 */
export function parseCompactHints(hintsStr: string): LayoutHints {
  const hints: LayoutHints = {};
  const tokens = hintsStr.trim().split(/\s+/);

  for (const token of tokens) {
    // Direction
    if (token === 'r') {
      hints.direction = 'row';
    } else if (token === 'c') {
      hints.direction = 'column';
    }
    // Gap (single digit 0-9)
    else if (/^[0-9]$/.test(token)) {
      hints.gap = parseInt(token, 10);
    }
    // Justify
    else if (token === '<') {
      hints.justify = 'start';
    } else if (token === '=') {
      hints.justify = 'center';
    } else if (token === '>') {
      hints.justify = 'end';
    } else if (token === '~') {
      hints.justify = 'space-between';
    }
    // Align
    else if (token === '^') {
      hints.align = 'start';
    } else if (token === '-') {
      hints.align = 'center';
    } else if (token === 'v') {
      hints.align = 'end';
    } else if (token === '+') {
      hints.align = 'stretch';
    }
    // Flex (e.g., *2, *1)
    else if (token.startsWith('*')) {
      const value = parseInt(token.substring(1), 10);
      if (!isNaN(value)) {
        hints.flex = value;
      }
    }
    // Width (e.g., w10, wfill)
    else if (token.startsWith('w')) {
      const value = token.substring(1);
      if (value === 'fill') {
        hints.width = 'fill';
      } else {
        const num = parseInt(value, 10);
        if (!isNaN(num)) {
          hints.width = num;
        }
      }
    }
    // Height (e.g., h5, hfill)
    else if (token.startsWith('h')) {
      const value = token.substring(1);
      if (value === 'fill') {
        hints.height = 'fill';
      } else {
        const num = parseInt(value, 10);
        if (!isNaN(num)) {
          hints.height = num;
        }
      }
    }
    // Fill both (f)
    else if (token === 'f') {
      hints.width = 'fill';
      hints.height = 'fill';
    }
  }

  return hints;
}

/**
 * Parse button shortcut syntax: [ #id @handler() Title ]
 */
export function parseButtonShortcuts(line: string, lineNumber: number): ParsedButton[] {
  const buttons: ParsedButton[] = [];
  const regex = /\[\s*([^\]]+?)\s*\]/g;
  let match;

  while ((match = regex.exec(line)) !== null) {
    const content = match[1].trim();
    const startCol = match.index;
    const endCol = match.index + match[0].length;

    let id: string | undefined;
    let onClick: string | undefined;
    let title = content;

    // Parse #id
    const idMatch = title.match(/^#(\S+)/);
    if (idMatch) {
      id = idMatch[1];
      title = title.substring(idMatch[0].length).trim();
    }

    // Parse @handler()
    const handlerMatch = title.match(/^@(\S+\(\))/);
    if (handlerMatch) {
      onClick = handlerMatch[1];
      title = title.substring(handlerMatch[0].length).trim();
    }

    if (title) {
      buttons.push({
        id,
        title,
        onClick,
        bounds: { left: startCol, right: endCol, line: lineNumber },
      });
    }
  }

  return buttons;
}

function checkOverlappingBoxes(boxes: ParsedBox[]): ParseError[] {
  const errors: ParseError[] = [];

  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const b = boxes[j];

      if (boxesOverlap(a.bounds, b.bounds)) {
        // Check if one is fully inside the other (this is allowed)
        if (!isBoxInside(a.bounds, b.bounds) && !isBoxInside(b.bounds, a.bounds)) {
          errors.push({
            message: ERROR_MESSAGES.overlappingBoxes(a.id, b.id),
            line: Math.min(a.bounds.top, b.bounds.top) + 1,
          });
        }
      }
    }
  }

  return errors;
}

function boxesOverlap(a: Bounds, b: Bounds): boolean {
  const aRight = a.left + a.width;
  const aBottom = a.top + a.height;
  const bRight = b.left + b.width;
  const bBottom = b.top + b.height;

  return !(aRight <= b.left || bRight <= a.left || aBottom <= b.top || bBottom <= a.top);
}

function isBoxInside(inner: Bounds, outer: Bounds): boolean {
  return (
    inner.top > outer.top &&
    inner.top + inner.height < outer.top + outer.height &&
    inner.left > outer.left &&
    inner.left + inner.width < outer.left + outer.width
  );
}

function buildBoxStructure(
  parsedBoxes: ParsedBox[],
  topLevelBoxes: ParsedBox[]
): BoxStructure {
  const boxes = new Map<string, Box>();
  const definitions = new Map<string, ParsedBox>();
  const processedIds = new Set<string>();

  // First pass: create all top-level box definitions
  for (const parsed of topLevelBoxes) {
    definitions.set(parsed.id, parsed);

    const box: Box = {
      id: parsed.id,
      displayName: parsed.displayName,
      isReference: false,
      children: [],
      bounds: parsed.bounds,
      properties: parsed.properties,
      hints: parsed.hints,
      tabBar: parsed.tabBar,
      inferredType: parsed.inferredType,
      inferredProps: parsed.inferredProps,
    };
    boxes.set(box.id, box);
  }

  // Second pass: build hierarchy
  function processBox(parsed: ParsedBox, parentBox?: Box): void {
    const key = `${parsed.bounds.top},${parsed.bounds.left}`;
    if (processedIds.has(key)) return;
    processedIds.add(key);

    // Find children of this parsed box
    const children = parsedBoxes.filter(
      (other) => other !== parsed && isBoxInside(other.bounds, parsed.bounds)
    );

    // Filter out children that belong to nested boxes
    const directChildren = children.filter(
      (child) =>
        !children.some(
          (other) =>
            other !== child &&
            isBoxInside(child.bounds, other.bounds) &&
            isBoxInside(other.bounds, parsed.bounds)
        )
    );

    if (parentBox) {
      // Check if this is a reference to a top-level definition
      const isRef =
        definitions.has(parsed.id) &&
        !isBoxInside(parsed.bounds, definitions.get(parsed.id)!.bounds);

      if (isRef) {
        // This is a reference
        const refBox: Box = {
          id: parsed.id,
          displayName: parsed.displayName,
          isReference: true,
          bounds: parsed.bounds,
          properties: parsed.properties,
          hints: parsed.hints,
          tabBar: parsed.tabBar,
          inferredType: parsed.inferredType,
          inferredProps: parsed.inferredProps,
        };
        (parentBox.children = parentBox.children || []).push(refBox);
      } else {
        // This is a regular nested box
        const nestedBox: Box = {
          id: parsed.id,
          displayName: parsed.displayName,
          isReference: false,
          bounds: parsed.bounds,
          properties: parsed.properties,
          hints: parsed.hints,
          tabBar: parsed.tabBar,
          inferredType: parsed.inferredType,
          inferredProps: parsed.inferredProps,
        };
        (parentBox.children = parentBox.children || []).push(nestedBox);

        // Process children of this nested box
        for (const child of directChildren) {
          processBox(child, nestedBox);
        }
      }
    } else {
      // This is a top-level box
      const box = boxes.get(parsed.id);
      if (box) {
        // Process children
        for (const child of directChildren) {
          processBox(child, box);
        }
      }
    }
  }

  // Process all top-level boxes
  for (const parsed of topLevelBoxes) {
    processBox(parsed);
  }

  const rootBoxes = Array.from(boxes.values()).filter((box) =>
    topLevelBoxes.some((parsed) => parsed.id === box.id)
  );

  return { boxes, rootBoxes };
}

/**
 * Infer flex direction from children positions
 */
export function inferFlexDirection(children: Box[]): 'row' | 'column' {
  if (children.length < 2) return 'column';

  // Check if children are horizontally aligned (similar Y positions)
  const yPositions = children.map((c) => c.bounds?.top ?? 0);
  const yVariance = Math.max(...yPositions) - Math.min(...yPositions);

  // Check if children are vertically aligned (similar X positions)
  const xPositions = children.map((c) => c.bounds?.left ?? 0);
  const xVariance = Math.max(...xPositions) - Math.min(...xPositions);

  // If Y positions are similar (within 1 char), it's a row
  if (yVariance <= 1 && xVariance > 1) {
    return 'row';
  }

  // If X positions are similar, it's a column
  if (xVariance <= 1 && yVariance > 1) {
    return 'column';
  }

  // Default to column
  return 'column';
}
