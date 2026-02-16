// Folding range provider

import type { FoldingRange } from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import type { AstNode } from './types.ts';
import { offsetToPosition } from './utils.ts';

// Get folding ranges for the document
export function getFoldingRanges(text: string): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  try {
    const ast = parse(text) as AstNode[];

    function addFoldingFromNode(node: AstNode): void {
      if (node.type !== 'Tag') return;

      if (node.open && node.close) {
        const startPos = offsetToPosition(text, node.open.end);
        const endPos = offsetToPosition(text, node.close.start);
        if (endPos.line > startPos.line) {
          ranges.push({
            startLine: startPos.line,
            startCharacter: startPos.character,
            endLine: endPos.line,
            endCharacter: endPos.character,
          });
        }
      }

      if (node.name === 'style' && node.body) {
        for (const child of node.body) {
          if (child.type === 'Text' && child.value) {
            addCssFoldingRanges(child.value, child.start, text, ranges);
          }
        }
      }

      if (node.body) {
        for (const child of node.body) {
          addFoldingFromNode(child);
        }
      }
    }

    for (const node of ast) {
      addFoldingFromNode(node);
    }
  } catch {
    // Ignore parse errors
  }

  return ranges;
}

// Add folding ranges for CSS rule blocks inside style tags
export function addCssFoldingRanges(
  styleContent: string,
  contentStart: number,
  text: string,
  ranges: FoldingRange[]
): void {
  const braceStack: number[] = [];
  for (let i = 0; i < styleContent.length; i++) {
    if (styleContent[i] === '/' && styleContent[i + 1] === '*') {
      const end = styleContent.indexOf('*/', i + 2);
      i = end === -1 ? styleContent.length - 1 : end + 1;
      continue;
    }
    if (styleContent[i] === '{') {
      braceStack.push(contentStart + i);
    } else if (styleContent[i] === '}' && braceStack.length > 0) {
      const openOffset = braceStack.pop()!;
      const closeOffset = contentStart + i;
      const startPos = offsetToPosition(text, openOffset);
      const endPos = offsetToPosition(text, closeOffset);
      if (endPos.line > startPos.line) {
        ranges.push({
          startLine: startPos.line,
          startCharacter: startPos.character,
          endLine: endPos.line,
          endCharacter: endPos.character,
        });
      }
    }
  }
}
