// Document links provider (clickable src/href)

import type { DocumentLink } from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import type { AstNode } from './types.ts';
import { createRange } from './utils.ts';

export function getDocumentLinks(text: string, uri: string): DocumentLink[] {
  const links: DocumentLink[] = [];

  try {
    const ast = parse(text) as AstNode[];

    function visitNode(node: AstNode): void {
      if (node.type !== 'Tag' || !node.attributes) {
        if (node.body) node.body.forEach(visitNode);
        return;
      }

      for (const attr of node.attributes) {
        const name = attr.name.value;
        if ((name === 'src' || name === 'href') && attr.value?.value) {
          const value = attr.value.value;
          if (!value || value.startsWith('javascript:')) continue;

          let target: string;
          if (/^https?:\/\//.test(value)) {
            target = value;
          } else {
            const base = uri.replace(/\/[^/]*$/, '/');
            target = base + value;
          }

          links.push({
            range: createRange(text, attr.value.start, attr.value.end),
            target,
          });
        }
      }

      if (node.body) node.body.forEach(visitNode);
    }

    for (const node of ast) {
      visitNode(node);
    }
  } catch {
    // Ignore parse errors
  }

  return links;
}
