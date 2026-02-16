// Completion provider

import {
  CompletionItemKind,
  InsertTextFormat,
  type CompletionItem,
  type Position,
  type Range,
} from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import type { AstNode } from './types.ts';
import {
  positionToOffset, isAfterOpenBracket, getPartialElementName,
  isInOpeningTag, toCamelCase, toKebabCase, preprocessSelfClosingTags,
  findElementAtOffset,
} from './utils.ts';
import {
  THEME_VAR_NAMES, NAMED_COLORS, COLOR_FORMAT_SNIPPETS,
  COLOR_PROPERTY_NAMES, SPECIAL_TAGS,
} from './constants.ts';
import { getLogger } from '../logging.ts';
import {
  BASE_PROPS_SCHEMA,
  BASE_STYLES_SCHEMA,
  getComponentSchema,
  getRegisteredComponents,
} from '../lint.ts';

const logger = getLogger('LSP');

// Get completions
export function getCompletions(text: string, position: Position): CompletionItem[] {
  const offset = positionToOffset(text, position);
  const completions: CompletionItem[] = [];

  const textBefore = text.substring(0, offset);
  const lineStart = textBefore.lastIndexOf('\n') + 1;
  const lineText = textBefore.substring(lineStart);

  // Element name completion (after '<')
  if (isAfterOpenBracket(text, offset)) {
    const partial = getPartialElementName(text, offset).toLowerCase();

    for (const [tag, info] of Object.entries(SPECIAL_TAGS)) {
      if (tag.toLowerCase().startsWith(partial)) {
        completions.push({
          label: tag,
          kind: CompletionItemKind.Class,
          detail: info.description,
          insertText: tag,
          sortText: `0${tag}`,
        });
      }
    }

    const components = getRegisteredComponents();
    for (const comp of components) {
      if (comp.toLowerCase().startsWith(partial)) {
        const schema = getComponentSchema(comp);
        completions.push({
          label: comp,
          kind: CompletionItemKind.Class,
          detail: schema?.description,
          insertText: comp,
          sortText: `1${comp}`,
        });
      }
    }
    return completions;
  }

  try {
    const preprocessed = preprocessSelfClosingTags(text);
    const ast = parse(preprocessed) as AstNode[];
    const node = findElementAtOffset(ast, offset);

    if (node && node.type === 'Tag' && node.name && isInOpeningTag(node, offset)) {
      const schema = getComponentSchema(node.name);
      const specialTag = SPECIAL_TAGS[node.name];

      // Check if we're completing an attribute value
      const attrValueMatch = lineText.match(/(\w+)=["']([^"']*)$/);
      if (attrValueMatch) {
        const attrName = attrValueMatch[1];
        const attrValue = attrValueMatch[2];

        // Style attribute completion
        if (attrName === 'style') {
          const allStyles = { ...BASE_STYLES_SCHEMA, ...(schema?.styles || {}) };

          const styleContext = attrValue.match(/(?:^|[;,])\s*([\w-]*)\s*:\s*([^;,]*)$/);

          if (styleContext) {
            // Completing a style value
            const styleProp = toCamelCase(styleContext[1]);
            const styleSchema = allStyles[styleProp];
            const partialValue = styleContext[2].trim();

            // var() variable name completion
            const inlineVarMatch = partialValue.match(/var\((--[\w-]*)$/);
            if (inlineVarMatch) {
              const varPartial = inlineVarMatch[1];
              const varPartialStartChar = position.character - varPartial.length;
              const varEditRange: Range = {
                start: { line: position.line, character: varPartialStartChar },
                end: position,
              };
              for (const varName of THEME_VAR_NAMES) {
                if (!varPartial || varName.startsWith(varPartial)) {
                  completions.push({
                    label: varName,
                    kind: CompletionItemKind.Variable,
                    detail: 'Theme color variable',
                    textEdit: {
                      range: varEditRange,
                      newText: varName,
                    },
                    sortText: `0${varName}`,
                  });
                }
              }
              return completions;
            }

            // Always offer var()
            if (!partialValue || 'var('.startsWith(partialValue.toLowerCase())) {
              const partialStartChar = position.character - partialValue.length;
              completions.push({
                label: 'var()',
                kind: CompletionItemKind.Function,
                detail: 'CSS variable reference',
                insertTextFormat: InsertTextFormat.Snippet,
                textEdit: {
                  range: {
                    start: { line: position.line, character: partialStartChar },
                    end: position,
                  },
                  newText: 'var(--${1:name})',
                },
                sortText: '1var',
              });
            }

            if (styleSchema?.enum) {
              const kebabProp = toKebabCase(styleProp);
              const partialStartChar = position.character - partialValue.length;
              const editRange: Range = {
                start: { line: position.line, character: partialStartChar },
                end: position,
              };

              for (const value of styleSchema.enum) {
                const strValue = String(value);
                if (!partialValue || strValue.toLowerCase().startsWith(partialValue.toLowerCase())) {
                  completions.push({
                    label: strValue,
                    kind: CompletionItemKind.EnumMember,
                    detail: `Value for ${kebabProp}`,
                    textEdit: {
                      range: editRange,
                      newText: strValue,
                    },
                  });
                }
              }
            }

            // Color value completions
            if (COLOR_PROPERTY_NAMES.has(styleProp)) {
              const partialLower = partialValue.toLowerCase();
              const partialStartChar = position.character - partialValue.length;
              const editRange: Range = {
                start: { line: position.line, character: partialStartChar },
                end: position,
              };
              for (const name of NAMED_COLORS) {
                if (!partialValue || name.startsWith(partialLower)) {
                  completions.push({
                    label: name,
                    kind: CompletionItemKind.Color,
                    detail: 'Named color',
                    textEdit: { range: editRange, newText: name },
                    sortText: `1${name}`,
                  });
                }
              }
              for (const fmt of COLOR_FORMAT_SNIPPETS) {
                if (!partialValue || fmt.label.startsWith(partialLower) || fmt.insert.startsWith(partialLower)) {
                  completions.push({
                    label: fmt.label,
                    kind: CompletionItemKind.Snippet,
                    detail: fmt.detail,
                    insertTextFormat: InsertTextFormat.Snippet,
                    textEdit: { range: editRange, newText: fmt.insert },
                    sortText: `2${fmt.label}`,
                  });
                }
              }
            }

            return completions;
          } else {
            // Completing a style property name
            const existingProps = new Set<string>();
            const propMatches = attrValue.matchAll(/([\w-]+)\s*:/g);
            for (const match of propMatches) {
              existingProps.add(toCamelCase(match[1]));
            }

            const partialMatch = attrValue.match(/(?:^|[;,])\s*([\w-]*)$/);
            const partial = partialMatch ? partialMatch[1] : '';

            const partialStartChar = position.character - partial.length;
            const editRange: Range = {
              start: { line: position.line, character: partialStartChar },
              end: position,
            };

            for (const [name, styleSchema] of Object.entries(allStyles)) {
              if (!existingProps.has(name)) {
                const kebabName = toKebabCase(name);
                if (!partial || kebabName.startsWith(partial.toLowerCase())) {
                  completions.push({
                    label: kebabName,
                    kind: CompletionItemKind.Property,
                    detail: styleSchema.description,
                    textEdit: {
                      range: editRange,
                      newText: `${kebabName}: `,
                    },
                    sortText: `0${kebabName}`,
                  });
                }
              }
            }
            return completions;
          }
        }

        // Regular attribute value completion
        let propSchema;

        if (schema?.props[attrName]) {
          propSchema = schema.props[attrName];
        } else if (BASE_PROPS_SCHEMA[attrName]) {
          propSchema = BASE_PROPS_SCHEMA[attrName];
        } else if (BASE_STYLES_SCHEMA[attrName]) {
          propSchema = BASE_STYLES_SCHEMA[attrName];
        }

        if (propSchema?.enum) {
          for (const value of propSchema.enum) {
            completions.push({
              label: String(value),
              kind: CompletionItemKind.EnumMember,
              insertText: String(value),
            });
          }
          return completions;
        }

        if (specialTag && attrName === 'type' && node.name === 'script') {
          completions.push(
            { label: 'typescript', kind: CompletionItemKind.EnumMember, insertText: 'typescript' },
            { label: 'javascript', kind: CompletionItemKind.EnumMember, insertText: 'javascript' },
          );
          return completions;
        }
      }

      // Attribute name completion for special tags
      if (specialTag) {
        const existingAttrs = new Set(node.attributes?.map(a => a.name.value) || []);
        for (const [attrName, description] of Object.entries(specialTag.attrs)) {
          if (!existingAttrs.has(attrName)) {
            completions.push({
              label: attrName,
              kind: CompletionItemKind.Property,
              detail: description,
              insertText: `${attrName}=""`,
              sortText: attrName === 'wellknown' ? '0' : '1',
            });
          }
        }
        return completions;
      }

      // Attribute name completion for regular components
      const existingAttrs = new Set(node.attributes?.map(a => a.name.value) || []);
      const allProps = { ...BASE_PROPS_SCHEMA, ...(schema?.props || {}) };
      const allStyles = { ...BASE_STYLES_SCHEMA, ...(schema?.styles || {}) };

      for (const [name, propSchema] of Object.entries(allProps)) {
        if (!existingAttrs.has(name)) {
          completions.push({
            label: name,
            kind: CompletionItemKind.Property,
            detail: propSchema.description,
            insertText: `${name}=""`,
            sortText: propSchema.required ? `0${name}` : `1${name}`,
          });
        }
      }

      for (const [name, styleSchema] of Object.entries(allStyles)) {
        if (!existingAttrs.has(name) && !allProps[name]) {
          completions.push({
            label: name,
            kind: CompletionItemKind.Property,
            detail: styleSchema.description,
            insertText: `${name}=""`,
            sortText: `2${name}`,
          });
        }
      }
    }

    // Check if we're inside a <style> tag body
    const styleTagCompletions = getStyleTagCompletions(text, offset, ast);
    if (styleTagCompletions.length > 0) {
      return styleTagCompletions;
    }
  } catch {
    // Ignore parse errors for completion
  }

  return completions;
}

// Get completions for content inside <style> tag
function getStyleTagCompletions(text: string, offset: number, ast: AstNode[]): CompletionItem[] {
  const completions: CompletionItem[] = [];

  function findStyleTag(nodes: AstNode[]): AstNode | null {
    for (const node of nodes) {
      if (node.type === 'Tag' && node.name === 'style') {
        const openEnd = node.open?.end ?? node.start;
        const closeStart = node.close?.start ?? node.end;
        if (offset > openEnd && offset < closeStart) {
          return node;
        }
      }
      if (node.body) {
        const found = findStyleTag(node.body);
        if (found) return found;
      }
    }
    return null;
  }

  const styleTag = findStyleTag(ast);
  if (!styleTag) return completions;

  const openEnd = styleTag.open?.end ?? styleTag.start;
  const styleContent = text.substring(openEnd, offset);

  const lastOpenBrace = styleContent.lastIndexOf('{');
  const lastCloseBrace = styleContent.lastIndexOf('}');
  const insideBlock = lastOpenBrace > lastCloseBrace;

  if (insideBlock) {
    const blockContent = styleContent.substring(lastOpenBrace + 1);

    // Check if we're completing a value (after :)
    const valueMatch = blockContent.match(/([\w-]+)\s*:\s*([^;]*)$/);
    if (valueMatch) {
      const propName = valueMatch[1];
      const camelProp = propName.replace(/-([a-z])/g, (_m, l) => l.toUpperCase());
      const schema = BASE_STYLES_SCHEMA[camelProp];

      // var() variable name completion
      const varMatch = valueMatch[2].match(/var\((--[\w-]*)$/);
      if (varMatch) {
        const partial = varMatch[1];
        for (const varName of THEME_VAR_NAMES) {
          if (!partial || varName.startsWith(partial)) {
            completions.push({
              label: varName,
              kind: CompletionItemKind.Variable,
              detail: 'Theme color variable',
              insertText: varName,
              sortText: `0${varName}`,
            });
          }
        }
        return completions;
      }

      // Always offer var()
      completions.push({
        label: 'var()',
        kind: CompletionItemKind.Function,
        detail: 'CSS variable reference',
        insertText: 'var(--${1:name})',
        insertTextFormat: InsertTextFormat.Snippet,
        sortText: '0var',
      });

      if (schema?.enum) {
        for (const value of schema.enum) {
          completions.push({
            label: String(value),
            kind: CompletionItemKind.EnumMember,
            detail: `Value for ${propName}`,
            insertText: String(value),
          });
        }
      }

      // Color value completions
      if (COLOR_PROPERTY_NAMES.has(camelProp)) {
        const partialValue = valueMatch[2].trim().toLowerCase();
        for (const name of NAMED_COLORS) {
          if (!partialValue || name.startsWith(partialValue)) {
            completions.push({
              label: name,
              kind: CompletionItemKind.Color,
              detail: 'Named color',
              insertText: name,
              sortText: `1${name}`,
            });
          }
        }
        for (const fmt of COLOR_FORMAT_SNIPPETS) {
          if (!partialValue || fmt.label.startsWith(partialValue) || fmt.insert.startsWith(partialValue)) {
            completions.push({
              label: fmt.label,
              kind: CompletionItemKind.Snippet,
              detail: fmt.detail,
              insertText: fmt.insert,
              insertTextFormat: InsertTextFormat.Snippet,
              sortText: `2${fmt.label}`,
            });
          }
        }
      }

      return completions;
    }

    // Completing property name
    const existingProps = new Set<string>();
    const propMatches = blockContent.matchAll(/([\w-]+)\s*:/g);
    for (const match of propMatches) {
      existingProps.add(match[1].replace(/-([a-z])/g, (_m, l) => l.toUpperCase()));
    }

    for (const [name, schema] of Object.entries(BASE_STYLES_SCHEMA)) {
      if (!existingProps.has(name)) {
        const kebabName = toKebabCase(name);
        completions.push({
          label: kebabName,
          kind: CompletionItemKind.Property,
          detail: schema.description,
          insertText: `${kebabName}: `,
          sortText: `0${kebabName}`,
        });
      }
    }

    // Custom property snippet
    completions.push({
      label: '--',
      kind: CompletionItemKind.Snippet,
      detail: 'Custom property (CSS variable)',
      insertText: '--${1:name}: ${2:value}',
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: '1--',
    });

    // In :root blocks, offer --theme-* variable overrides
    const beforeBrace = styleContent.substring(0, lastOpenBrace);
    const stripped = beforeBrace.replace(/\/\*[\s\S]*?\*\//g, '');
    const lastBlockEnd = stripped.lastIndexOf('}');
    const currentSelector = stripped.substring(lastBlockEnd + 1).trim();
    logger.debug('Style block selector detection', { currentSelector, lastBlockEnd });
    if (/(?:^|,\s*):root\s*$/.test(currentSelector)) {
      const partialMatch = blockContent.match(/(?:^|;)\s*([\w-]*)$/);
      const partial = partialMatch ? partialMatch[1] : '';
      logger.debug('Root block theme var completion', { partial, blockContent: blockContent.substring(Math.max(0, blockContent.length - 40)) });

      for (const varName of THEME_VAR_NAMES) {
        if (existingProps.has(varName)) continue;
        if (partial && !varName.startsWith(partial)) continue;
        completions.push({
          label: varName,
          kind: CompletionItemKind.Variable,
          detail: 'Theme color override',
          insertText: `${varName}: `,
          sortText: `0${varName}`,
        });
      }
    }
  } else {
    // Outside property block - completing selectors
    const components = getRegisteredComponents();
    for (const comp of components) {
      completions.push({
        label: comp,
        kind: CompletionItemKind.Class,
        detail: `Element type selector`,
        insertText: `${comp} {\n  \n}`,
        sortText: `1${comp}`,
      });
    }

    completions.push({
      label: '#',
      kind: CompletionItemKind.Snippet,
      detail: 'ID selector',
      insertText: '#',
      sortText: '0#',
    });

    completions.push({
      label: '.',
      kind: CompletionItemKind.Snippet,
      detail: 'Class selector',
      insertText: '.',
      sortText: '0.',
    });

    completions.push({
      label: ':root',
      kind: CompletionItemKind.Snippet,
      detail: 'Root scope for CSS custom properties',
      insertText: ':root {\n  --${1:name}: ${2:value};\n}',
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: '0:root',
    });

    completions.push({
      label: '*',
      kind: CompletionItemKind.Snippet,
      detail: 'Universal selector (all elements)',
      insertText: '* {\n  \n}',
      sortText: '0*',
    });

    completions.push({
      label: ':focus',
      kind: CompletionItemKind.Keyword,
      detail: 'Matches focused element',
      insertText: ':focus',
      sortText: '0:focus',
    });
    completions.push({
      label: ':hover',
      kind: CompletionItemKind.Keyword,
      detail: 'Matches hovered element',
      insertText: ':hover',
      sortText: '0:hover',
    });

    completions.push({
      label: '@media',
      kind: CompletionItemKind.Snippet,
      detail: 'Media query block',
      insertText: '@media (${1:min-width: 80}) {\n  $0\n}',
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: '0@media',
    });
    completions.push({
      label: '@container',
      kind: CompletionItemKind.Snippet,
      detail: 'Container query block',
      insertText: '@container (${1:min-width: 40}) {\n  $0\n}',
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: '0@container',
    });
    completions.push({
      label: '@keyframes',
      kind: CompletionItemKind.Snippet,
      detail: 'Keyframe animation',
      insertText: '@keyframes ${1:name} {\n  from { $2 }\n  to { $0 }\n}',
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: '0@keyframes',
    });
  }

  return completions;
}
