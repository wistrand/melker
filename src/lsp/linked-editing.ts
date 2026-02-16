// Linked editing ranges (rename open/close tags in sync)

import type { Position, LinkedEditingRanges } from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import type { AstNode } from './types.ts';
import { positionToOffset, createRange, findElementAtOffset } from './utils.ts';

export function getLinkedEditingRanges(text: string, position: Position): LinkedEditingRanges | null {
  try {
    const ast = parse(text) as AstNode[];
    const offset = positionToOffset(text, position);
    const node = findElementAtOffset(ast, offset);
    if (!node || !node.name || !node.open || !node.close) return null;

    const openNameStart = node.open.start + 1;
    const openNameEnd = openNameStart + node.name.length;
    const closeNameStart = node.close.start + 2;
    const closeNameEnd = closeNameStart + node.name.length;

    const inOpen = offset >= openNameStart && offset <= openNameEnd;
    const inClose = offset >= closeNameStart && offset <= closeNameEnd;
    if (!inOpen && !inClose) return null;

    return {
      ranges: [
        createRange(text, openNameStart, openNameEnd),
        createRange(text, closeNameStart, closeNameEnd),
      ],
    };
  } catch {
    return null;
  }
}
