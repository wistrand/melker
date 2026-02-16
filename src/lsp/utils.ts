// Shared utility functions for LSP modules

import type { Position, Range } from 'npm:vscode-languageserver@9.0.1/node.js';
import type { AstNode, AstAttribute } from './types.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('LSP');

// Position utilities
export function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

export function positionToOffset(text: string, position: Position): number {
  let offset = 0;
  let line = 0;
  while (line < position.line && offset < text.length) {
    if (text[offset] === '\n') {
      line++;
    }
    offset++;
  }
  return offset + position.character;
}

export function createRange(text: string, start: number, end: number): Range {
  const startPos = offsetToPosition(text, start);
  const endPos = offsetToPosition(text, end);
  logger.debug('createRange', { start, end, startPos, endPos });
  return { start: startPos, end: endPos };
}

// Find element at position in AST
export function findElementAtOffset(nodes: AstNode[], offset: number): AstNode | null {
  for (const node of nodes) {
    if (node.type === 'Tag' && offset >= node.start && offset <= node.end) {
      if (node.body) {
        const child = findElementAtOffset(node.body, offset);
        if (child) return child;
      }
      return node;
    }
  }
  return null;
}

// Find attribute at position
export function findAttributeAtOffset(node: AstNode, offset: number): AstAttribute | null {
  if (!node.attributes) return null;
  for (const attr of node.attributes) {
    if (offset >= attr.start && offset <= attr.end) {
      return attr;
    }
  }
  return null;
}

// Check if position is inside element's opening tag (for attribute completion)
export function isInOpeningTag(node: AstNode, offset: number): boolean {
  if (!node.open) return false;
  return offset >= node.open.start && offset <= node.open.end;
}

// Check if position is right after '<' (for element completion)
export function isAfterOpenBracket(text: string, offset: number): boolean {
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '<') return true;
    if (char === '>' || char === ' ' || char === '\n') return false;
  }
  return false;
}

// Get element name being typed
export function getPartialElementName(text: string, offset: number): string {
  let start = offset;
  while (start > 0 && /[a-zA-Z0-9-]/.test(text[start - 1])) {
    start--;
  }
  return text.substring(start, offset);
}

// Preprocess content to convert self-closing special tags to explicit open/close
export function preprocessSelfClosingTags(content: string): string {
  return content.replace(
    /<(script|style|title|oauth|policy)(\s[^>]*)?\s*\/>/gi,
    '<$1$2></$1>'
  );
}

// Convert kebab-case to camelCase (e.g., "background-color" -> "backgroundColor")
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Convert camelCase to kebab-case (e.g., "backgroundColor" -> "background-color")
export function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

// Parse CSS-like style string into property positions
export function parseStyleString(
  styleValue: string,
  baseOffset: number
): Array<{ name: string; value: string; nameStart: number; nameEnd: number; valueStart: number; valueEnd: number }> {
  const properties: Array<{ name: string; value: string; nameStart: number; nameEnd: number; valueStart: number; valueEnd: number }> = [];

  let content = styleValue;
  let offset = baseOffset;

  // Strip outer {{ }} if present (object style)
  const objectMatch = content.match(/^\s*\{\{([\s\S]*)\}\}\s*$/);
  if (objectMatch) {
    const innerStart = content.indexOf('{{') + 2;
    content = objectMatch[1];
    offset += innerStart;
  }

  // Split by semicolon or comma
  const separator = content.includes(';') ? ';' : ',';
  let currentPos = 0;

  for (const part of content.split(separator)) {
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) {
      currentPos += part.length + 1;
      continue;
    }

    const namePart = part.substring(0, colonIndex);
    const valuePart = part.substring(colonIndex + 1);

    const nameMatch = namePart.match(/^\s*/);
    const nameStartOffset = nameMatch ? nameMatch[0].length : 0;
    const name = namePart.trim().replace(/['"]/g, '');

    const valueMatch = valuePart.match(/^\s*/);
    const valueStartOffset = colonIndex + 1 + (valueMatch ? valueMatch[0].length : 0);
    const value = valuePart.trim().replace(/['"]/g, '');

    if (name) {
      properties.push({
        name: toCamelCase(name),
        value,
        nameStart: offset + currentPos + nameStartOffset,
        nameEnd: offset + currentPos + nameStartOffset + name.length,
        valueStart: offset + currentPos + valueStartOffset,
        valueEnd: offset + currentPos + valueStartOffset + value.length,
      });
    }

    currentPos += part.length + 1;
  }

  return properties;
}
