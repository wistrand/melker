// Document and style validation for LSP diagnostics

import {
  DiagnosticSeverity,
  type Diagnostic,
} from 'npm:vscode-languageserver@9.0.1/node.js';
import { parseHtml as parse } from '../deps.ts';
import type { AstNode, AstAttribute } from './types.ts';
import { createRange, toKebabCase, parseStyleString, preprocessSelfClosingTags } from './utils.ts';
import { stripCssComments, unwrapAtRules } from './css-utils.ts';
import {
  POLICY_PERMISSION_TYPES, VALID_POLICY_PERMISSIONS,
  POLICY_KEY_TYPES, VALID_POLICY_KEYS,
  SPECIAL_TAG_SCHEMAS,
} from './constants.ts';
import {
  BASE_PROPS_SCHEMA,
  BASE_STYLES_SCHEMA,
  getComponentSchema,
  getRegisteredComponents,
  type PropSchema,
} from '../lint.ts';

// Check if value matches expected type
function checkPolicyType(value: unknown, expectedType: string): boolean {
  if (expectedType === 'string') {
    return typeof value === 'string';
  }
  if (expectedType === 'boolean') {
    return typeof value === 'boolean';
  }
  if (expectedType === 'object') {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }
  if (expectedType === 'string[]') {
    return Array.isArray(value) && value.every(v => typeof v === 'string');
  }
  if (expectedType === 'boolean | string[]') {
    return typeof value === 'boolean' ||
      (Array.isArray(value) && value.every(v => typeof v === 'string'));
  }
  return true;
}

// Get actual type description for error message
function describeType(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'empty array';
    const types = [...new Set(value.map(v => typeof v))];
    return `array of ${types.join('/')}`;
  }
  return typeof value;
}

// Validate policy tag content (JSON)
export function validatePolicyTagContent(
  text: string,
  node: AstNode,
  diagnostics: Diagnostic[]
): void {
  if (!node.body || node.body.length === 0) return;

  let policyContent = '';
  let contentStart = 0;

  for (const child of node.body) {
    if (child.type === 'Text' && child.value) {
      if (!contentStart) contentStart = child.start;
      policyContent += child.value;
    }
  }

  const trimmed = policyContent.trim();
  if (!trimmed) return;

  try {
    const policy = JSON.parse(trimmed);

    const findKeyPosition = (key: string): { start: number; end: number } | null => {
      const keyPattern = new RegExp(`"${key}"\\s*:`);
      const match = policyContent.match(keyPattern);
      if (match && match.index !== undefined) {
        const start = contentStart + match.index + 1;
        return { start, end: start + key.length };
      }
      return null;
    };

    if (typeof policy === 'object' && policy !== null) {
      for (const key of Object.keys(policy)) {
        const pos = findKeyPosition(key);

        if (!VALID_POLICY_KEYS.has(key)) {
          if (pos) {
            diagnostics.push({
              range: createRange(text, pos.start, pos.end),
              severity: DiagnosticSeverity.Warning,
              message: `Unknown policy key "${key}". Valid keys: ${[...VALID_POLICY_KEYS].join(', ')}`,
              source: 'melker',
            });
          }
        } else {
          const expectedType = POLICY_KEY_TYPES[key];
          const value = policy[key];
          if (!checkPolicyType(value, expectedType)) {
            if (pos) {
              diagnostics.push({
                range: createRange(text, pos.start, pos.end),
                severity: DiagnosticSeverity.Warning,
                message: `"${key}" should be ${expectedType}, got ${describeType(value)}`,
                source: 'melker',
              });
            }
          }
        }
      }

      if (policy.permissions && typeof policy.permissions === 'object') {
        for (const key of Object.keys(policy.permissions)) {
          const pos = findKeyPosition(key);

          if (!VALID_POLICY_PERMISSIONS.has(key)) {
            if (pos) {
              diagnostics.push({
                range: createRange(text, pos.start, pos.end),
                severity: DiagnosticSeverity.Warning,
                message: `Unknown permission "${key}". Valid permissions: ${[...VALID_POLICY_PERMISSIONS].join(', ')}`,
                source: 'melker',
              });
            }
          } else {
            const expectedType = POLICY_PERMISSION_TYPES[key];
            const value = policy.permissions[key];
            if (!checkPolicyType(value, expectedType)) {
              if (pos) {
                diagnostics.push({
                  range: createRange(text, pos.start, pos.end),
                  severity: DiagnosticSeverity.Warning,
                  message: `"${key}" should be ${expectedType}, got ${describeType(value)}`,
                  source: 'melker',
                });
              }
            }
          }
        }
      }
    }
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    const posMatch = errorMsg.match(/position (\d+)/i);
    let errorStart = contentStart;
    let errorEnd = contentStart + trimmed.length;

    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      errorStart = contentStart + pos;
      errorEnd = errorStart + 1;
    }

    diagnostics.push({
      range: createRange(text, errorStart, errorEnd),
      severity: DiagnosticSeverity.Error,
      message: `Invalid JSON in policy: ${errorMsg}`,
      source: 'melker',
    });
  }
}

// Validate style tag content (CSS-like rules)
export function validateStyleTagContent(
  text: string,
  node: AstNode,
  diagnostics: Diagnostic[]
): void {
  if (!node.body || node.body.length === 0) return;

  let styleContent = '';
  let contentStart = 0;

  for (const child of node.body) {
    if (child.type === 'Text' && child.value) {
      if (!contentStart) contentStart = child.start;
      styleContent += child.value;
    }
  }

  if (!styleContent.trim()) return;

  styleContent = stripCssComments(styleContent);
  styleContent = unwrapAtRules(styleContent);

  const rulePattern = /([^{]+)\{([^}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(styleContent)) !== null) {
    const selectorStr = match[1].trim();
    const propertiesStr = match[2].trim();
    const ruleStart = contentStart + match.index;

    if (selectorStr) {
      validateStyleSelector(text, selectorStr, ruleStart, diagnostics);
    }

    if (propertiesStr) {
      const propsStart = ruleStart + match[1].length + 1;
      validateStyleBlockProperties(text, propertiesStr, propsStart, diagnostics);
    }
  }
}

// Validate a CSS selector
function validateStyleSelector(
  text: string,
  selector: string,
  selectorStart: number,
  diagnostics: Diagnostic[]
): void {
  const trimmed = selector.trim();
  if (!trimmed) return;

  if (trimmed.startsWith('@')) return;

  if (trimmed.includes(',')) {
    let offset = 0;
    for (const part of trimmed.split(',')) {
      const partTrimmed = part.trim();
      if (partTrimmed) {
        const partStart = trimmed.indexOf(part, offset);
        validateStyleSelector(text, partTrimmed, selectorStart + partStart, diagnostics);
      }
      offset += part.length + 1;
    }
    return;
  }

  const parts = trimmed.split(/\s*>\s*|\s+/).filter(p => p.length > 0);

  for (const part of parts) {
    validateCompoundSelector(text, part, selectorStart + trimmed.indexOf(part), diagnostics);
  }
}

// Validate a single compound selector
function validateCompoundSelector(
  text: string,
  selector: string,
  selectorStart: number,
  diagnostics: Diagnostic[]
): void {
  if (!selector) return;

  if (selector.startsWith('&')) return;
  if (selector.startsWith('*')) return;

  const pseudoStripped = selector.replace(/:(root|focus|hover|active|disabled|first-child|last-child)\b/g, '');
  if (!pseudoStripped) return;

  let remaining = pseudoStripped;

  if (remaining.startsWith('#')) return;
  if (remaining.startsWith('.')) return;

  const typeMatch = remaining.match(/^([a-zA-Z][\w-]*)/);
  if (typeMatch) {
    const typeName = typeMatch[1];
    const schema = getComponentSchema(typeName);
    const registeredComponents = getRegisteredComponents();

    if (!schema && registeredComponents.length > 0) {
      diagnostics.push({
        range: createRange(text, selectorStart, selectorStart + typeName.length),
        severity: DiagnosticSeverity.Warning,
        message: `Unknown element type "${typeName}" in selector`,
        source: 'melker',
      });
    }
  }
}

// Validate properties in a style block
function validateStyleBlockProperties(
  text: string,
  propertiesStr: string,
  propsStart: number,
  diagnostics: Diagnostic[]
): void {
  const properties = propertiesStr.split(';').map(p => p.trim()).filter(p => p.length > 0);

  let currentOffset = 0;
  for (const property of properties) {
    const propOffset = propertiesStr.indexOf(property, currentOffset);
    const colonIndex = property.indexOf(':');

    if (colonIndex === -1) {
      currentOffset = propOffset + property.length;
      continue;
    }

    const keyPart = property.substring(0, colonIndex).trim();
    const valuePart = property.substring(colonIndex + 1).trim();

    if (keyPart.startsWith('--')) {
      currentOffset = propOffset + property.length;
      continue;
    }

    const camelKey = keyPart.replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());
    const schema = BASE_STYLES_SCHEMA[camelKey];
    const keyStart = propsStart + propOffset + property.indexOf(keyPart);

    if (!schema) {
      diagnostics.push({
        range: createRange(text, keyStart, keyStart + keyPart.length),
        severity: DiagnosticSeverity.Warning,
        message: `Unknown style property "${keyPart}"`,
        source: 'melker',
        code: 'unknown-style',
      });
    } else if (schema.enum && valuePart) {
      if (!valuePart.startsWith('var(')) {
        if (!schema.enum.includes(valuePart)) {
          const valueStart = propsStart + propOffset + colonIndex + 1 + property.substring(colonIndex + 1).indexOf(valuePart);
          diagnostics.push({
            range: createRange(text, valueStart, valueStart + valuePart.length),
            severity: DiagnosticSeverity.Warning,
            message: `Invalid value "${valuePart}" for style "${keyPart}". Valid values: ${schema.enum.join(', ')}`,
            source: 'melker',
            code: 'invalid-enum-value',
          });
        }
      }
    }

    currentOffset = propOffset + property.length;
  }
}

// Validate style attribute value
export function validateStyleAttribute(
  text: string,
  attr: AstAttribute,
  elementName: string,
  allStyles: Record<string, PropSchema>,
  diagnostics: Diagnostic[]
): void {
  const styleValue = attr.value?.value;
  if (!styleValue) return;

  const properties = parseStyleString(styleValue, attr.value!.start);

  for (const prop of properties) {
    const schema = allStyles[prop.name];

    if (prop.name.startsWith('--')) continue;

    if (!schema) {
      diagnostics.push({
        range: createRange(text, prop.nameStart, prop.nameEnd),
        severity: DiagnosticSeverity.Warning,
        message: `Unknown style property "${prop.name}" on <${elementName}>`,
        source: 'melker',
        code: 'unknown-style',
      });
    } else if (schema.enum && prop.value) {
      if (!prop.value.startsWith('var(')) {
        if (!schema.enum.includes(prop.value)) {
          diagnostics.push({
            range: createRange(text, prop.valueStart, prop.valueEnd),
            severity: DiagnosticSeverity.Warning,
            message: `Invalid value "${prop.value}" for style "${prop.name}". Valid values: ${schema.enum.join(', ')}`,
            source: 'melker',
            code: 'invalid-enum-value',
          });
        }
      }
    }
  }
}

// Validate document and return diagnostics
export function validateDocument(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  try {
    const preprocessed = preprocessSelfClosingTags(text);
    const ast = parse(preprocessed) as AstNode[];

    function validateNode(node: AstNode) {
      if (node.type !== 'Tag' || !node.name) return;

      if (node.name.startsWith('!')) {
        return;
      }

      if (SPECIAL_TAG_SCHEMAS[node.name]) {
        const validAttrs = SPECIAL_TAG_SCHEMAS[node.name];
        for (const attr of node.attributes || []) {
          const propName = attr.name.value;
          if (!validAttrs[propName]) {
            diagnostics.push({
              range: createRange(text, attr.name.start, attr.name.end),
              severity: DiagnosticSeverity.Warning,
              message: `Unknown attribute "${propName}" on <${node.name}>`,
              source: 'melker',
            });
          }
        }

        if (node.name === 'style') {
          validateStyleTagContent(text, node, diagnostics);
        }

        if (node.name === 'policy') {
          validatePolicyTagContent(text, node, diagnostics);
        }

        if (node.name === 'script' || node.name === 'style' || node.name === 'policy') {
          return;
        }

        if (node.body) {
          node.body.forEach(validateNode);
        }
        return;
      }

      const schema = getComponentSchema(node.name);

      if (!schema) {
        const registeredComponents = getRegisteredComponents();
        if (registeredComponents.length > 0) {
          diagnostics.push({
            range: createRange(text, node.open?.start ?? node.start, node.open?.end ?? node.end),
            severity: DiagnosticSeverity.Warning,
            message: `Unknown element <${node.name}>`,
            source: 'melker',
          });
        }
      } else {
        const allProps = { ...BASE_PROPS_SCHEMA, ...schema.props };
        const allStyles = { ...BASE_STYLES_SCHEMA, ...(schema.styles || {}) };

        for (const attr of node.attributes || []) {
          const propName = attr.name.value;

          if (propName === 'style' && attr.value) {
            validateStyleAttribute(text, attr, node.name, allStyles, diagnostics);
            continue;
          }

          if (!allProps[propName]) {
            if (allStyles[propName]) {
              const kebabName = toKebabCase(propName);
              diagnostics.push({
                range: createRange(text, attr.name.start, attr.name.end),
                severity: DiagnosticSeverity.Warning,
                message: `"${propName}" is a style property. Use style="${kebabName}: ..." instead`,
                source: 'melker',
                code: 'style-as-prop',
              });
              continue;
            }

            diagnostics.push({
              range: createRange(text, attr.name.start, attr.name.end),
              severity: DiagnosticSeverity.Warning,
              message: `Unknown property "${propName}" on <${node.name}>`,
              source: 'melker',
              code: 'unknown-prop',
            });
          } else {
            const propSchema = allProps[propName];
            if (propSchema.enum && attr.value) {
              const value = attr.value.value;
              if (!propSchema.enum.includes(value)) {
                diagnostics.push({
                  range: createRange(text, attr.value.start, attr.value.end),
                  severity: DiagnosticSeverity.Warning,
                  message: `Invalid value "${value}" for "${propName}". Valid values: ${propSchema.enum.join(', ')}`,
                  source: 'melker',
                  code: 'invalid-enum-value',
                });
              }
            }
          }
        }
      }

      if (node.body) {
        node.body.forEach(validateNode);
      }
    }

    ast.forEach(validateNode);
  } catch (e) {
    diagnostics.push({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: DiagnosticSeverity.Error,
      message: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
      source: 'melker',
    });
  }

  return diagnostics;
}
