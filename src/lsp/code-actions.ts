// Code actions (quick fixes) provider

import {
  CodeActionKind,
  type CodeAction,
  type CodeActionParams,
} from 'npm:vscode-languageserver@9.0.1/node.js';
import { createRange, positionToOffset, toKebabCase } from './utils.ts';
import { levenshteinDistance, findSimilarNames } from './fuzzy.ts';
import {
  BASE_PROPS_SCHEMA,
  BASE_STYLES_SCHEMA,
  getComponentSchema,
} from '../lint.ts';

export function getCodeActions(text: string, params: CodeActionParams): CodeAction[] {
  const actions: CodeAction[] = [];
  const diagnostics = params.context.diagnostics;

  for (const diag of diagnostics) {
    const code = diag.code as string | undefined;
    if (!code) continue;

    const diagMessage = diag.message;

    if (code === 'style-as-prop') {
      const match = diagMessage.match(/^"([^"]+)" is a style property/);
      if (!match) continue;
      const propName = match[1];
      const kebabName = toKebabCase(propName);

      const startOffset = positionToOffset(text, diag.range.start);
      const lineStart = text.lastIndexOf('\n', startOffset) + 1;
      const lineEnd = text.indexOf('\n', startOffset);
      const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);

      const attrPattern = new RegExp(`${propName}(?:=(?:"([^"]*)"|'([^']*)'))?`);
      const attrMatch = line.match(attrPattern);
      if (!attrMatch) continue;

      const attrValue = attrMatch[1] ?? attrMatch[2] ?? '';
      const attrStartInLine = line.indexOf(attrMatch[0]);
      const attrAbsStart = lineStart + attrStartInLine;
      const attrAbsEnd = attrAbsStart + attrMatch[0].length;

      const styleDecl = attrValue ? `${kebabName}: ${attrValue}` : kebabName;

      const tagStart = text.lastIndexOf('<', startOffset);
      const tagEnd = text.indexOf('>', startOffset);
      const tagContent = text.substring(tagStart, tagEnd === -1 ? text.length : tagEnd + 1);
      const styleMatch = tagContent.match(/style=(?:"([^"]*)"|'([^']*)')/);

      if (styleMatch) {
        const existingValue = styleMatch[1] ?? styleMatch[2] ?? '';
        const styleAttrStart = tagStart + tagContent.indexOf(styleMatch[0]);
        const quote = tagContent[tagContent.indexOf(styleMatch[0]) + 6];
        const separator = existingValue.endsWith(';') || existingValue === '' ? '' : '; ';
        const newValue = `${existingValue}${separator}${styleDecl}`;

        actions.push({
          title: `Move "${propName}" to style attribute`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: createRange(text, attrAbsStart - 1, attrAbsEnd),
                  newText: '',
                },
                {
                  range: createRange(text, styleAttrStart, styleAttrStart + styleMatch[0].length),
                  newText: `style=${quote}${newValue}${quote}`,
                },
              ],
            },
          },
        });
      } else {
        actions.push({
          title: `Replace with style="${styleDecl}"`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: createRange(text, attrAbsStart, attrAbsEnd),
                  newText: `style="${styleDecl}"`,
                },
              ],
            },
          },
        });
      }
    } else if (code === 'invalid-enum-value') {
      const valuesMatch = diagMessage.match(/Valid values: (.+)$/);
      if (!valuesMatch) continue;
      const validValues = valuesMatch[1].split(', ');

      const invalidMatch = diagMessage.match(/Invalid value "([^"]+)"/);
      if (!invalidMatch) continue;
      const invalidValue = invalidMatch[1];

      const sorted = [...validValues].sort(
        (a, b) => levenshteinDistance(invalidValue, a) - levenshteinDistance(invalidValue, b)
      );

      for (const suggestion of sorted.slice(0, 5)) {
        actions.push({
          title: `Change to "${suggestion}"`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          isPreferred: suggestion === sorted[0],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: diag.range,
                  newText: suggestion,
                },
              ],
            },
          },
        });
      }
    } else if (code === 'unknown-style') {
      const propMatch = diagMessage.match(/Unknown style property "([^"]+)"/);
      if (!propMatch) continue;
      const unknownProp = propMatch[1];

      const candidates = Object.keys(BASE_STYLES_SCHEMA).map(k => toKebabCase(k));
      const similar = findSimilarNames(unknownProp, candidates);

      for (const suggestion of similar) {
        actions.push({
          title: `Change to "${suggestion}"`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          isPreferred: suggestion === similar[0],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: diag.range,
                  newText: suggestion,
                },
              ],
            },
          },
        });
      }
    } else if (code === 'unknown-prop') {
      const propMatch = diagMessage.match(/Unknown property "([^"]+)" on <([^>]+)>/);
      if (!propMatch) continue;
      const unknownProp = propMatch[1];
      const elementName = propMatch[2];

      const schema = getComponentSchema(elementName);
      const allProps = schema
        ? { ...BASE_PROPS_SCHEMA, ...schema.props }
        : { ...BASE_PROPS_SCHEMA };

      const candidates = Object.keys(allProps);
      const similar = findSimilarNames(unknownProp, candidates);

      for (const suggestion of similar) {
        actions.push({
          title: `Change to "${suggestion}"`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          isPreferred: suggestion === similar[0],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                {
                  range: diag.range,
                  newText: suggestion,
                },
              ],
            },
          },
        });
      }
    }
  }

  return actions;
}
