// Semantic token detection for embedded TypeScript

import { parseHtml as parse } from '../deps.ts';
import type { AstNode } from './types.ts';
import { offsetToPosition, preprocessSelfClosingTags } from './utils.ts';
import { EVENT_HANDLER_PROPS } from './constants.ts';

// Semantic token types for embedded TypeScript in event handlers
export const tokenTypes = ['string'];
export const tokenModifiers = ['typescript'];

// Find all TypeScript code regions (event handlers and script content)
export function findTypeScriptRanges(text: string): Array<{ line: number; char: number; length: number }> {
  const ranges: Array<{ line: number; char: number; length: number }> = [];
  const lines = text.split('\n');

  function addRange(startOffset: number, endOffset: number) {
    const startPos = offsetToPosition(text, startOffset);
    const endPos = offsetToPosition(text, endOffset);

    if (startPos.line === endPos.line) {
      ranges.push({
        line: startPos.line,
        char: startPos.character,
        length: endOffset - startOffset,
      });
    } else {
      for (let line = startPos.line; line <= endPos.line; line++) {
        const lineContent = lines[line] || '';
        let char = 0;
        let length = lineContent.length;

        if (line === startPos.line) {
          char = startPos.character;
          length = lineContent.length - char;
        } else if (line === endPos.line) {
          length = endPos.character;
        }

        if (length > 0) {
          ranges.push({ line, char, length });
        }
      }
    }
  }

  try {
    const preprocessed = preprocessSelfClosingTags(text);
    const ast = parse(preprocessed) as AstNode[];

    function processNode(node: AstNode) {
      if (node.type !== 'Tag') return;

      if (node.name === 'script' && node.body) {
        for (const child of node.body) {
          if (child.type === 'Text' && child.value && child.value.trim()) {
            addRange(child.start, child.end);
          }
        }
      }

      for (const attr of node.attributes || []) {
        if (EVENT_HANDLER_PROPS.has(attr.name.value) && attr.value) {
          addRange(attr.value.start, attr.value.end);
        }
      }

      if (node.body) {
        node.body.forEach(processNode);
      }
    }

    ast.forEach(processNode);
  } catch {
    // Ignore parse errors
  }

  return ranges;
}
