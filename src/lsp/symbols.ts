// Document symbols (outline) provider

import {
  SymbolKind,
  type DocumentSymbol,
} from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import type { AstNode } from './types.ts';
import { createRange } from './utils.ts';

// Get document symbols (outline) from AST
export function getDocumentSymbols(text: string): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];

  try {
    const ast = parse(text) as AstNode[];

    function symbolKindForTag(name: string): SymbolKind {
      switch (name) {
        case 'script': return SymbolKind.Function;
        case 'style': return SymbolKind.Namespace;
        case 'policy': return SymbolKind.Object;
        case 'title': return SymbolKind.String;
        default: return SymbolKind.Property;
      }
    }

    function nodeToSymbol(node: AstNode): DocumentSymbol | null {
      if (node.type !== 'Tag' || !node.name) return null;

      const range = createRange(text, node.start, node.end);
      const selectionRange = node.open
        ? createRange(text, node.open.start, node.open.end)
        : range;

      let detail = '';
      const id = node.attributes?.find(a => a.name.value === 'id');
      const cls = node.attributes?.find(a => a.name.value === 'class');
      if (id?.value) detail += `#${id.value.value}`;
      if (cls?.value) detail += (detail ? ' ' : '') + `.${cls.value.value.replace(/\s+/g, '.')}`;

      const children: DocumentSymbol[] = [];

      if (node.name === 'style' && node.body) {
        for (const child of node.body) {
          if (child.type === 'Text' && child.value) {
            const cssSymbols = extractStyleSymbols(child.value, child.start, text);
            children.push(...cssSymbols);
          }
        }
      }

      if (node.body) {
        for (const child of node.body) {
          const sym = nodeToSymbol(child);
          if (sym) children.push(sym);
        }
      }

      return {
        name: `<${node.name}>`,
        detail,
        kind: symbolKindForTag(node.name),
        range,
        selectionRange,
        children: children.length > 0 ? children : undefined,
      };
    }

    for (const node of ast) {
      const sym = nodeToSymbol(node);
      if (sym) symbols.push(sym);
    }
  } catch {
    // Ignore parse errors
  }

  return symbols;
}

// Extract CSS selector symbols from style tag content
export function extractStyleSymbols(styleContent: string, contentStart: number, text: string): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  let i = 0;
  let depth = 0;

  while (i < styleContent.length) {
    while (i < styleContent.length && /\s/.test(styleContent[i])) i++;
    if (i >= styleContent.length) break;

    if (styleContent[i] === '/' && styleContent[i + 1] === '*') {
      const end = styleContent.indexOf('*/', i + 2);
      i = end === -1 ? styleContent.length : end + 2;
      continue;
    }

    if (depth === 0) {
      const selectorStart = i;
      while (i < styleContent.length && styleContent[i] !== '{') i++;
      if (i >= styleContent.length) break;

      const selector = styleContent.substring(selectorStart, i).trim();
      if (selector) {
        const absStart = contentStart + selectorStart;
        let braceDepth = 1;
        const blockStart = i;
        i++;
        while (i < styleContent.length && braceDepth > 0) {
          if (styleContent[i] === '{') braceDepth++;
          else if (styleContent[i] === '}') braceDepth--;
          i++;
        }
        const absEnd = contentStart + i;

        symbols.push({
          name: selector,
          kind: SymbolKind.Field,
          range: createRange(text, absStart, absEnd),
          selectionRange: createRange(text, absStart, contentStart + blockStart),
        });
      }
    } else {
      if (styleContent[i] === '{') depth++;
      else if (styleContent[i] === '}') depth--;
      i++;
    }
  }

  return symbols;
}
