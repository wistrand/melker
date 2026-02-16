// Hover information provider

import {
  MarkupKind,
  type Hover,
  type Position,
} from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import type { AstNode } from './types.ts';
import { positionToOffset, findElementAtOffset, findAttributeAtOffset } from './utils.ts';
import {
  BASE_PROPS_SCHEMA,
  BASE_STYLES_SCHEMA,
  getComponentSchema,
  type PropSchema,
} from '../lint.ts';

// Format type for display
export function formatType(schema: PropSchema): string {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  let typeStr = types.join(' | ');
  if (schema.enum) {
    typeStr = schema.enum.map(v => `"${v}"`).join(' | ');
  }
  return typeStr;
}

// Get hover information
export function getHover(text: string, position: Position): Hover | null {
  const offset = positionToOffset(text, position);

  try {
    const ast = parse(text) as AstNode[];
    const node = findElementAtOffset(ast, offset);

    if (!node || node.type !== 'Tag' || !node.name) return null;

    // Check if hovering over element name
    if (node.open && offset >= node.open.start + 1 && offset <= node.open.start + 1 + node.name.length) {
      const schema = getComponentSchema(node.name);
      if (schema) {
        const contents = [`**<${node.name}>**`];
        if (schema.description) {
          contents.push('', schema.description);
        }
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: contents.join('\n'),
          },
        };
      }
    }

    // Check if hovering over attribute
    const attr = findAttributeAtOffset(node, offset);
    if (attr) {
      const propName = attr.name.value;
      const schema = getComponentSchema(node.name);

      let propSchema: PropSchema | undefined;
      if (schema?.props[propName]) {
        propSchema = schema.props[propName];
      } else if (BASE_PROPS_SCHEMA[propName]) {
        propSchema = BASE_PROPS_SCHEMA[propName];
      } else if (BASE_STYLES_SCHEMA[propName]) {
        propSchema = BASE_STYLES_SCHEMA[propName];
      } else if (schema?.styles?.[propName]) {
        propSchema = schema.styles[propName];
      }

      if (propSchema) {
        const contents = [`**${propName}**`];
        if (propSchema.description) {
          contents.push('', propSchema.description);
        }
        contents.push('', `Type: \`${formatType(propSchema)}\``);
        if (propSchema.required) {
          contents.push('', '*Required*');
        }
        return {
          contents: {
            kind: MarkupKind.Markdown,
            value: contents.join('\n'),
          },
        };
      }
    }
  } catch {
    // Ignore parse errors for hover
  }

  return null;
}
