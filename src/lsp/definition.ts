// Go-to-definition provider

import type { Definition, Location, Position } from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import type { AstNode } from './types.ts';
import { positionToOffset, createRange, findElementAtOffset, findAttributeAtOffset } from './utils.ts';
import { stripCssComments, unwrapAtRules } from './css-utils.ts';

interface CssSelectorInfo {
  selector: string;
  start: number;
  end: number;
}

export function findAllStyleBlocks(ast: AstNode[]): Array<{ content: string; contentStart: number }> {
  const blocks: Array<{ content: string; contentStart: number }> = [];

  function visit(node: AstNode): void {
    if (node.type === 'Tag' && node.name === 'style' && node.body) {
      for (const child of node.body) {
        if (child.type === 'Text' && child.value) {
          blocks.push({ content: child.value, contentStart: child.start });
        }
      }
    }
    if (node.body) node.body.forEach(visit);
  }

  ast.forEach(visit);
  return blocks;
}

export function parseCssSelectors(content: string, contentStart: number): CssSelectorInfo[] {
  const selectors: CssSelectorInfo[] = [];

  const stripped = stripCssComments(content);
  const unwrapped = unwrapAtRules(stripped);

  const rulePattern = /([^{]+)\{[^}]*\}/g;
  let match;
  while ((match = rulePattern.exec(unwrapped)) !== null) {
    const selectorStr = match[1];
    const selectorBase = contentStart + match.index;

    let offset = 0;
    for (const part of selectorStr.split(',')) {
      const trimmed = part.trim();
      if (trimmed) {
        const trimStart = part.indexOf(trimmed);
        const absStart = selectorBase + offset + trimStart;
        selectors.push({
          selector: trimmed,
          start: absStart,
          end: absStart + trimmed.length,
        });
      }
      offset += part.length + 1;
    }
  }

  return selectors;
}

export function findSelectorPartAtOffset(
  selector: string,
  selectorStart: number,
  offset: number
): { type: 'id' | 'class' | 'type'; value: string } | null {
  const relOffset = offset - selectorStart;
  if (relOffset < 0 || relOffset > selector.length) return null;

  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];

    if (' >~+'.includes(ch)) { i++; continue; }

    if (ch === ':') {
      i++;
      if (i < selector.length && selector[i] === ':') i++;
      while (i < selector.length && /[\w-]/.test(selector[i])) i++;
      if (i < selector.length && selector[i] === '(') {
        let depth = 1;
        i++;
        while (i < selector.length && depth > 0) {
          if (selector[i] === '(') depth++;
          else if (selector[i] === ')') depth--;
          i++;
        }
      }
      continue;
    }

    if (ch === '#') {
      const start = i;
      i++;
      const nameStart = i;
      while (i < selector.length && /[\w-]/.test(selector[i])) i++;
      if (relOffset >= start && relOffset <= i) {
        return { type: 'id', value: selector.substring(nameStart, i) };
      }
      continue;
    }

    if (ch === '.') {
      const start = i;
      i++;
      const nameStart = i;
      while (i < selector.length && /[\w-]/.test(selector[i])) i++;
      if (relOffset >= start && relOffset <= i) {
        return { type: 'class', value: selector.substring(nameStart, i) };
      }
      continue;
    }

    if (ch === '[') {
      const start = i;
      while (i < selector.length && selector[i] !== ']') i++;
      if (i < selector.length) i++;
      if (relOffset >= start && relOffset <= i) return null;
      continue;
    }

    if (/[\w-]/.test(ch)) {
      const start = i;
      while (i < selector.length && /[\w-]/.test(selector[i])) i++;
      if (relOffset >= start && relOffset <= i) {
        return { type: 'type', value: selector.substring(start, i) };
      }
      continue;
    }

    i++;
  }

  return null;
}

function findElementsMatching(
  nodes: AstNode[],
  text: string,
  uri: string,
  locations: Location[],
  predicate: (node: AstNode) => boolean | undefined
): void {
  for (const node of nodes) {
    if (node.type === 'Tag' && predicate(node)) {
      const range = node.open
        ? createRange(text, node.open.start, node.open.end)
        : createRange(text, node.start, node.end);
      locations.push({ uri, range });
    }
    if (node.body) {
      findElementsMatching(node.body, text, uri, locations, predicate);
    }
  }
}

export function getDefinition(text: string, position: Position, uri: string): Definition | null {
  try {
    const ast = parse(text) as AstNode[];
    const offset = positionToOffset(text, position);

    const node = findElementAtOffset(ast, offset);
    if (node && node.type === 'Tag' && node.attributes) {
      const attr = findAttributeAtOffset(node, offset);
      if (attr?.value) {
        const inValue = offset >= attr.value.start && offset <= attr.value.end;
        if (inValue) {
          if (attr.name.value === 'id') {
            const id = attr.value.value;
            const locations: Location[] = [];
            for (const block of findAllStyleBlocks(ast)) {
              for (const sel of parseCssSelectors(block.content, block.contentStart)) {
                if (sel.selector.includes(`#${id}`)) {
                  locations.push({ uri, range: createRange(text, sel.start, sel.end) });
                }
              }
            }
            return locations.length > 0 ? locations : null;
          }

          if (attr.name.value === 'class') {
            const classValue = attr.value.value;
            const relOffset = offset - attr.value.start;
            const classes = classValue.split(/\s+/);
            let pos = 0;
            let targetClass = '';
            for (const cls of classes) {
              const clsStart = classValue.indexOf(cls, pos);
              const clsEnd = clsStart + cls.length;
              if (relOffset >= clsStart && relOffset <= clsEnd) {
                targetClass = cls;
                break;
              }
              pos = clsEnd;
            }
            if (!targetClass) return null;

            const locations: Location[] = [];
            for (const block of findAllStyleBlocks(ast)) {
              for (const sel of parseCssSelectors(block.content, block.contentStart)) {
                if (sel.selector.includes(`.${targetClass}`)) {
                  locations.push({ uri, range: createRange(text, sel.start, sel.end) });
                }
              }
            }
            return locations.length > 0 ? locations : null;
          }
        }
      }
    }

    for (const block of findAllStyleBlocks(ast)) {
      const blockEnd = block.contentStart + block.content.length;
      if (offset < block.contentStart || offset > blockEnd) continue;

      const allSelectors = parseCssSelectors(block.content, block.contentStart);
      for (const sel of allSelectors) {
        if (offset < sel.start || offset > sel.end) continue;

        const part = findSelectorPartAtOffset(sel.selector, sel.start, offset);
        if (!part) return null;

        const locations: Location[] = [];

        if (part.type === 'id') {
          findElementsMatching(ast, text, uri, locations,
            (n) => n.attributes?.some(a => a.name.value === 'id' && a.value?.value === part.value));
        } else if (part.type === 'class') {
          findElementsMatching(ast, text, uri, locations,
            (n) => n.attributes?.some(a => a.name.value === 'class' &&
              a.value?.value.split(/\s+/).includes(part.value)));
        } else if (part.type === 'type') {
          findElementsMatching(ast, text, uri, locations,
            (n) => n.name === part.value);
        }

        return locations.length > 0 ? locations : null;
      }

      return null;
    }

    return null;
  } catch {
    return null;
  }
}
