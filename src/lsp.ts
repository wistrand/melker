// LSP Server for .melker files
// Provides diagnostics, hover, and completion support

import process from 'node:process';
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  CompletionItemKind,
  DiagnosticSeverity,
  MarkupKind,
  SemanticTokensBuilder,
  SymbolKind,
  CodeActionKind,
  InsertTextFormat,
  type InitializeParams,
  type InitializeResult,
  type TextDocumentPositionParams,
  type CompletionItem,
  type Hover,
  type Diagnostic,
  type Range,
  type Position,
  type SemanticTokensParams,
  type DocumentSymbol,
  type FoldingRange,
  type CodeAction,
  type CodeActionParams,
  type Definition,
  type Location,
  type DocumentLink,
  type LinkedEditingRanges,
  type Color,
  type ColorInformation,
  type ColorPresentation,
  type DocumentColorParams,
} from 'npm:vscode-languageserver@9.0.1/node.js';
import { TextDocument } from 'npm:vscode-languageserver-textdocument@1.0.12';
import { parseHtml as parse } from './deps.ts';
import { cssToRgba, unpackRGBA } from './components/color-utils.ts';
import type { PackedRGBA } from './types.ts';
import { levenshteinDistance, findSimilarNames } from './string-utils.ts';

// Import lint schemas
import {
  BASE_PROPS_SCHEMA,
  BASE_STYLES_SCHEMA,
  getComponentSchema,
  getRegisteredComponents,
  type PropSchema,
} from './lint.ts';

// Import logging
import { getLogger } from './logging.ts';

// Import mod.ts to register all component schemas
import '../mod.ts';

const logger = getLogger('LSP');

// Theme CSS variable names available for :root overrides (29 palette keys)
const THEME_VAR_NAMES = [
  '--theme-primary', '--theme-secondary', '--theme-background', '--theme-foreground',
  '--theme-surface', '--theme-border',
  '--theme-success', '--theme-warning', '--theme-error', '--theme-info',
  '--theme-button-primary', '--theme-button-secondary', '--theme-button-background',
  '--theme-input-background', '--theme-input-foreground', '--theme-input-border',
  '--theme-focus-primary', '--theme-focus-background',
  '--theme-text-primary', '--theme-text-secondary', '--theme-text-muted',
  '--theme-header-background', '--theme-header-foreground',
  '--theme-sidebar-background', '--theme-sidebar-foreground',
  '--theme-modal-background', '--theme-modal-foreground',
  '--theme-scrollbar-thumb', '--theme-scrollbar-track',
];

// Named colors supported by Melker's cssToRgba()
const NAMED_COLORS = [
  'black', 'white', 'red', 'green', 'blue', 'yellow',
  'cyan', 'magenta', 'orange', 'purple', 'pink', 'lime',
  'gray', 'grey', 'transparent',
];

// Color format snippet completions
const COLOR_FORMAT_SNIPPETS: Array<{ label: string; insert: string; detail: string }> = [
  { label: '#rrggbb',          insert: '#${1:000000}',                       detail: 'Hex color' },
  { label: '#rgb',             insert: '#${1:000}',                          detail: 'Hex color (shorthand)' },
  { label: '#rrggbbaa',        insert: '#${1:000000}${2:ff}',                detail: 'Hex color with alpha' },
  { label: 'rgb(r, g, b)',     insert: 'rgb(${1:0}, ${2:0}, ${3:0})',        detail: 'RGB color (0-255)' },
  { label: 'rgba(r, g, b, a)', insert: 'rgba(${1:0}, ${2:0}, ${3:0}, ${4:1})', detail: 'RGBA color with alpha (0-1)' },
  { label: 'hsl(h, s%, l%)',   insert: 'hsl(${1:0}, ${2:50}%, ${3:50}%)',    detail: 'HSL color' },
  { label: 'hsla(h, s%, l%, a)', insert: 'hsla(${1:0}, ${2:50}%, ${3:50}%, ${4:1})', detail: 'HSLA color with alpha' },
  { label: 'oklch(L C H)',     insert: 'oklch(${1:0.5} ${2:0.1} ${3:180})',  detail: 'OKLCH perceptual color' },
  { label: 'oklab(L a b)',     insert: 'oklab(${1:0.5} ${2:0} ${3:0})',      detail: 'OKLAB perceptual color' },
];

// AST node types from html5parser
interface AstAttribute {
  start: number;
  end: number;
  name: { start: number; end: number; value: string };
  value?: { start: number; end: number; value: string; quote?: string };
}

interface AstNode {
  start: number;
  end: number;
  type: 'Tag' | 'Text';
  name?: string;
  rawName?: string;
  attributes?: AstAttribute[];
  body?: AstNode[];
  open?: { start: number; end: number };
  close?: { start: number; end: number };
  value?: string;
}

// Position utilities
function offsetToPosition(text: string, offset: number): Position {
  let line = 0;
  let character = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      character = 0;
    } else {
      character++;
    }
  }
  return { line, character };
}

function positionToOffset(text: string, position: Position): number {
  let offset = 0;
  let line = 0;
  while (line < position.line && offset < text.length) {
    if (text[offset] === '\n') {
      line++;
    }
    offset++;
  }
  return offset + position.character;
}

function createRange(text: string, start: number, end: number): Range {
  const startPos = offsetToPosition(text, start);
  const endPos = offsetToPosition(text, end);
  logger.debug('createRange', { start, end, startPos, endPos });
  return { start: startPos, end: endPos };
}

// Find element at position in AST
function findElementAtOffset(nodes: AstNode[], offset: number): AstNode | null {
  for (const node of nodes) {
    if (node.type === 'Tag' && offset >= node.start && offset <= node.end) {
      // Check children first for more specific match
      if (node.body) {
        const child = findElementAtOffset(node.body, offset);
        if (child) return child;
      }
      return node;
    }
  }
  return null;
}

// Find attribute at position
function findAttributeAtOffset(node: AstNode, offset: number): AstAttribute | null {
  if (!node.attributes) return null;
  for (const attr of node.attributes) {
    if (offset >= attr.start && offset <= attr.end) {
      return attr;
    }
  }
  return null;
}

// Check if position is inside element's opening tag (for attribute completion)
function isInOpeningTag(node: AstNode, offset: number): boolean {
  if (!node.open) return false;
  return offset >= node.open.start && offset <= node.open.end;
}

// Check if position is right after '<' (for element completion)
function isAfterOpenBracket(text: string, offset: number): boolean {
  // Look back for '<' without hitting '>' or another '<'
  for (let i = offset - 1; i >= 0; i--) {
    const char = text[i];
    if (char === '<') return true;
    if (char === '>' || char === ' ' || char === '\n') return false;
  }
  return false;
}

// Get element name being typed
function getPartialElementName(text: string, offset: number): string {
  let start = offset;
  while (start > 0 && /[a-zA-Z0-9-]/.test(text[start - 1])) {
    start--;
  }
  return text.substring(start, offset);
}

// Preprocess content to convert self-closing special tags to explicit open/close
function preprocessSelfClosingTags(content: string): string {
  return content.replace(
    /<(script|style|title|oauth|policy)(\s[^>]*)?\s*\/>/gi,
    '<$1$2></$1>'
  );
}

// Convert kebab-case to camelCase (e.g., "background-color" -> "backgroundColor")
function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

// Convert camelCase to kebab-case (e.g., "backgroundColor" -> "background-color")
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

// Parse CSS-like style string into property positions
// Returns array of { name, value, nameStart, nameEnd, valueStart, valueEnd }
function parseStyleString(
  styleValue: string,
  baseOffset: number
): Array<{ name: string; value: string; nameStart: number; nameEnd: number; valueStart: number; valueEnd: number }> {
  const properties: Array<{ name: string; value: string; nameStart: number; nameEnd: number; valueStart: number; valueEnd: number }> = [];

  // Handle both CSS-style (semicolon separated) and object-style (comma separated)
  // CSS: "width: 40; border: thin"
  // Object: "{{ width: 40, border: 'thin' }}"

  let content = styleValue;
  let offset = baseOffset;

  // Strip outer {{ }} if present (object style)
  const objectMatch = content.match(/^\s*\{\{([\s\S]*)\}\}\s*$/);
  if (objectMatch) {
    const innerStart = content.indexOf('{{') + 2;
    content = objectMatch[1];
    offset += innerStart;
  }

  // Split by semicolon or comma
  const separator = content.includes(';') ? ';' : ',';
  let currentPos = 0;

  for (const part of content.split(separator)) {
    const colonIndex = part.indexOf(':');
    if (colonIndex === -1) {
      currentPos += part.length + 1;
      continue;
    }

    const namePart = part.substring(0, colonIndex);
    const valuePart = part.substring(colonIndex + 1);

    // Find actual positions (accounting for whitespace)
    const nameMatch = namePart.match(/^\s*/);
    const nameStartOffset = nameMatch ? nameMatch[0].length : 0;
    const name = namePart.trim().replace(/['"]/g, ''); // Remove quotes from property names

    const valueMatch = valuePart.match(/^\s*/);
    const valueStartOffset = colonIndex + 1 + (valueMatch ? valueMatch[0].length : 0);
    const value = valuePart.trim().replace(/['"]/g, ''); // Remove quotes from values

    if (name) {
      properties.push({
        name: toCamelCase(name),
        value,
        nameStart: offset + currentPos + nameStartOffset,
        nameEnd: offset + currentPos + nameStartOffset + name.length,
        valueStart: offset + currentPos + valueStartOffset,
        valueEnd: offset + currentPos + valueStartOffset + value.length,
      });
    }

    currentPos += part.length + 1;
  }

  return properties;
}

// Policy permission types
const POLICY_PERMISSION_TYPES: Record<string, 'boolean' | 'string[]' | 'boolean | string[]'> = {
  all: 'boolean',
  read: 'string[]',
  write: 'string[]',
  net: 'string[]',
  run: 'string[]',
  env: 'string[]',
  ffi: 'string[]',
  sys: 'string[]',
  ai: 'boolean | string[]',
  clipboard: 'boolean',
  keyring: 'boolean',
  browser: 'boolean',
  shader: 'boolean',
};

// Valid policy permission keys
const VALID_POLICY_PERMISSIONS = new Set(Object.keys(POLICY_PERMISSION_TYPES));

// Policy top-level key types
const POLICY_KEY_TYPES: Record<string, string> = {
  name: 'string',
  version: 'string',
  description: 'string',
  comment: 'string',
  permissions: 'object',
  config: 'object',
  configSchema: 'object',
};

// Valid top-level policy keys
const VALID_POLICY_KEYS = new Set(Object.keys(POLICY_KEY_TYPES));

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
function validatePolicyTagContent(
  text: string,
  node: AstNode,
  diagnostics: Diagnostic[]
): void {
  // Get the text content from policy tag body
  if (!node.body || node.body.length === 0) return;

  // Find text nodes in body
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

  // Try to parse as JSON
  try {
    const policy = JSON.parse(trimmed);

    // Helper to find key position in JSON content
    const findKeyPosition = (key: string): { start: number; end: number } | null => {
      const keyPattern = new RegExp(`"${key}"\\s*:`);
      const match = policyContent.match(keyPattern);
      if (match && match.index !== undefined) {
        const start = contentStart + match.index + 1; // +1 for opening quote
        return { start, end: start + key.length };
      }
      return null;
    };

    // Validate top-level keys
    if (typeof policy === 'object' && policy !== null) {
      for (const key of Object.keys(policy)) {
        const pos = findKeyPosition(key);

        if (!VALID_POLICY_KEYS.has(key)) {
          // Unknown key
          if (pos) {
            diagnostics.push({
              range: createRange(text, pos.start, pos.end),
              severity: DiagnosticSeverity.Warning,
              message: `Unknown policy key "${key}". Valid keys: ${[...VALID_POLICY_KEYS].join(', ')}`,
              source: 'melker',
            });
          }
        } else {
          // Check type
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

      // Validate permissions object
      if (policy.permissions && typeof policy.permissions === 'object') {
        for (const key of Object.keys(policy.permissions)) {
          const pos = findKeyPosition(key);

          if (!VALID_POLICY_PERMISSIONS.has(key)) {
            // Unknown permission
            if (pos) {
              diagnostics.push({
                range: createRange(text, pos.start, pos.end),
                severity: DiagnosticSeverity.Warning,
                message: `Unknown permission "${key}". Valid permissions: ${[...VALID_POLICY_PERMISSIONS].join(', ')}`,
                source: 'melker',
              });
            }
          } else {
            // Check type
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
    // JSON parse error
    const errorMsg = e instanceof Error ? e.message : String(e);

    // Try to extract line/column from error message
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
function validateStyleTagContent(
  text: string,
  node: AstNode,
  diagnostics: Diagnostic[]
): void {
  // Get the text content from style tag body
  if (!node.body || node.body.length === 0) return;

  // Find text nodes in body
  let styleContent = '';
  let contentStart = 0;

  for (const child of node.body) {
    if (child.type === 'Text' && child.value) {
      if (!contentStart) contentStart = child.start;
      styleContent += child.value;
    }
  }

  if (!styleContent.trim()) return;

  // Strip CSS comments before parsing rules
  styleContent = styleContent.replace(/\/\*[\s\S]*?\*\//g, '');

  // Unwrap at-rules so the flat regex can handle inner rules.
  // @keyframes blocks are removed entirely (from/to/% are not element selectors).
  // @media/@container wrappers are removed, exposing their inner rules.
  function unwrapAtRules(css: string): string {
    let result = '';
    let i = 0;
    while (i < css.length) {
      // Check for at-rule
      if (css[i] === '@') {
        const braceIdx = css.indexOf('{', i);
        if (braceIdx === -1) { result += css.substring(i); break; }
        const atName = css.substring(i, braceIdx).trim();

        // Find matching closing brace
        let depth = 1;
        let j = braceIdx + 1;
        while (j < css.length && depth > 0) {
          if (css[j] === '{') depth++;
          else if (css[j] === '}') depth--;
          j++;
        }
        const innerBody = css.substring(braceIdx + 1, j - 1);

        if (atName.startsWith('@keyframes')) {
          // Drop entirely — inner selectors (from/to/%) aren't element selectors
        } else {
          // @media, @container — unwrap, keep inner rules
          result += innerBody;
        }
        i = j;
      } else {
        result += css[i];
        i++;
      }
    }
    return result;
  }

  styleContent = unwrapAtRules(styleContent);

  // Parse CSS-like rules: selector { properties }
  const rulePattern = /([^{]+)\{([^}]*)\}/g;
  let match;

  while ((match = rulePattern.exec(styleContent)) !== null) {
    const selectorStr = match[1].trim();
    const propertiesStr = match[2].trim();
    const ruleStart = contentStart + match.index;

    // Validate selector
    if (selectorStr) {
      validateStyleSelector(text, selectorStr, ruleStart, diagnostics);
    }

    // Validate properties
    if (propertiesStr) {
      const propsStart = ruleStart + match[1].length + 1; // +1 for '{'
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

  // Skip at-rules (@media, @container, @keyframes) — not element selectors
  if (trimmed.startsWith('@')) return;

  // Handle comma-separated selectors (validate each independently)
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

  // Split by combinators (child >, descendant space) and validate each compound selector
  // Split on ' > ' or lone spaces (not inside pseudo-classes)
  const parts = trimmed.split(/\s*>\s*|\s+/).filter(p => p.length > 0);

  for (const part of parts) {
    validateCompoundSelector(text, part, selectorStart + trimmed.indexOf(part), diagnostics);
  }
}

// Validate a single compound selector (e.g., "button.primary:hover", ":root", "&.active")
function validateCompoundSelector(
  text: string,
  selector: string,
  selectorStart: number,
  diagnostics: Diagnostic[]
): void {
  if (!selector) return;

  // Skip & (nested selector reference)
  if (selector.startsWith('&')) return;

  // Skip * (universal selector) — may have pseudo/class appended like *:hover
  if (selector.startsWith('*')) return;

  // Strip pseudo-classes (:focus, :hover, :root) before validating
  const pseudoStripped = selector.replace(/:(root|focus|hover|active|disabled|first-child|last-child)\b/g, '');
  if (!pseudoStripped) return; // Was purely a pseudo-class like :root

  // Extract parts: #id, .class, type
  let remaining = pseudoStripped;

  if (remaining.startsWith('#')) {
    // ID selector — any ID is valid
    return;
  } else if (remaining.startsWith('.')) {
    // Class selector — any class name is valid
    return;
  }

  // Type selector — validate against registered components
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
  // Parse properties like "color: red; border: thin;"
  const properties = propertiesStr.split(';').map(p => p.trim()).filter(p => p.length > 0);

  let currentOffset = 0;
  for (const property of properties) {
    // Find the actual position in the original string
    const propOffset = propertiesStr.indexOf(property, currentOffset);
    const colonIndex = property.indexOf(':');

    if (colonIndex === -1) {
      currentOffset = propOffset + property.length;
      continue;
    }

    const keyPart = property.substring(0, colonIndex).trim();
    const valuePart = property.substring(colonIndex + 1).trim();

    // Skip CSS custom property declarations (--*)
    if (keyPart.startsWith('--')) {
      currentOffset = propOffset + property.length;
      continue;
    }

    // Convert kebab-case to camelCase for lookup
    const camelKey = keyPart.replace(/-([a-z])/g, (_m, letter) => letter.toUpperCase());

    // Validate property name
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
      // Skip enum validation for var() references (resolved at runtime)
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
function validateStyleAttribute(
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

    // Skip CSS custom property declarations (--*)
    if (prop.name.startsWith('--')) continue;

    if (!schema) {
      // Unknown style property
      diagnostics.push({
        range: createRange(text, prop.nameStart, prop.nameEnd),
        severity: DiagnosticSeverity.Warning,
        message: `Unknown style property "${prop.name}" on <${elementName}>`,
        source: 'melker',
        code: 'unknown-style',
      });
    } else if (schema.enum && prop.value) {
      // Skip enum validation for var() references (resolved at runtime)
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
function validateDocument(text: string): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];

  try {
    const preprocessed = preprocessSelfClosingTags(text);
    const ast = parse(preprocessed) as AstNode[];

    // Schemas for special melker tags
    const specialTagSchemas: Record<string, Record<string, boolean>> = {
      'melker': {},
      'script': { type: true, src: true },
      'style': {},
      'title': {},
      'oauth': {
        wellknown: true,
        'client-id': true,
        'redirect-uri': true,
        scopes: true,
        scope: true,
        audience: true,
        'auto-login': true,
        'debug-server': true,
        onLogin: true,
        onLogout: true,
        onFail: true,
      },
      'policy': {
        src: true,
      },
      'help': {
        src: true,
      },
    };

    function validateNode(node: AstNode) {
      if (node.type !== 'Tag' || !node.name) return;

      // Skip HTML comments (<!-- ... --> parsed as tags starting with !)
      if (node.name.startsWith('!')) {
        return;
      }

      // Handle special melker tags
      if (specialTagSchemas[node.name]) {
        const validAttrs = specialTagSchemas[node.name];
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

        // Validate style tag content (CSS rules)
        if (node.name === 'style') {
          validateStyleTagContent(text, node, diagnostics);
        }

        // Validate policy tag content (JSON)
        if (node.name === 'policy') {
          validatePolicyTagContent(text, node, diagnostics);
        }

        // Do NOT recurse into script/style/policy children - their content is code/JSON, not HTML
        // This avoids false warnings for characters like < > in TypeScript/CSS/JSON
        if (node.name === 'script' || node.name === 'style' || node.name === 'policy') {
          return;
        }

        // Recurse into children for other special tags (melker, title, oauth)
        if (node.body) {
          node.body.forEach(validateNode);
        }
        return;
      }

      const schema = getComponentSchema(node.name);

      // Unknown element
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
        // Validate attributes
        const allProps = { ...BASE_PROPS_SCHEMA, ...schema.props };
        const allStyles = { ...BASE_STYLES_SCHEMA, ...(schema.styles || {}) };

        for (const attr of node.attributes || []) {
          const propName = attr.name.value;

          // Validate style attribute
          if (propName === 'style' && attr.value) {
            validateStyleAttribute(text, attr, node.name, allStyles, diagnostics);
            continue;
          }

          // Check if prop exists
          if (!allProps[propName]) {
            // Check if it's a style property (should be inside style attribute, not as element prop)
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
            // Validate enum values
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

      // Recurse into children
      if (node.body) {
        node.body.forEach(validateNode);
      }
    }

    ast.forEach(validateNode);
  } catch (e) {
    // Parse error
    diagnostics.push({
      range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } },
      severity: DiagnosticSeverity.Error,
      message: `Parse error: ${e instanceof Error ? e.message : String(e)}`,
      source: 'melker',
    });
  }

  return diagnostics;
}

// Format type for display
function formatType(schema: PropSchema): string {
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  let typeStr = types.join(' | ');
  if (schema.enum) {
    typeStr = schema.enum.map(v => `"${v}"`).join(' | ');
  }
  return typeStr;
}

// Get hover information
function getHover(text: string, position: Position): Hover | null {
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

      // Look up in component props, base props, or styles
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

// Get completions
function getCompletions(text: string, position: Position): CompletionItem[] {
  const offset = positionToOffset(text, position);
  const completions: CompletionItem[] = [];

  // Check context
  const textBefore = text.substring(0, offset);
  const lineStart = textBefore.lastIndexOf('\n') + 1;
  const lineText = textBefore.substring(lineStart);

  // Special melker tags with their attributes and descriptions
  const specialTags: Record<string, { description: string; attrs: Record<string, string> }> = {
    'melker': {
      description: 'Root wrapper element for .melker files',
      attrs: {},
    },
    'script': {
      description: 'TypeScript/JavaScript code block',
      attrs: {
        'type': 'Script type (e.g., "typescript")',
        'src': 'External script file path',
      },
    },
    'style': {
      description: 'CSS stylesheet block',
      attrs: {},
    },
    'title': {
      description: 'Application title',
      attrs: {},
    },
    'oauth': {
      description: 'OAuth2 PKCE authentication configuration',
      attrs: {
        'wellknown': 'OAuth well-known configuration URL (required)',
        'client-id': 'OAuth client ID',
        'redirect-uri': 'OAuth redirect URI',
        'scopes': 'OAuth scopes (space-separated)',
        'scope': 'OAuth scopes (alias for scopes)',
        'audience': 'OAuth audience',
        'auto-login': 'Automatically trigger login on load',
        'debug-server': 'Enable debug server for OAuth flow',
        'onLogin': 'Handler called after successful login',
        'onLogout': 'Handler called after logout',
        'onFail': 'Handler called on authentication failure',
      },
    },
    'policy': {
      description: 'Permission policy declaration for sandboxed execution',
      attrs: {
        'src': 'External policy JSON file path',
      },
    },
    'help': {
      description: 'Help content for the application (markdown)',
      attrs: {
        'src': 'External help file path',
      },
    },
  };

  // Element name completion (after '<')
  if (isAfterOpenBracket(text, offset)) {
    const partial = getPartialElementName(text, offset).toLowerCase();

    // Add special tags
    for (const [tag, info] of Object.entries(specialTags)) {
      if (tag.toLowerCase().startsWith(partial)) {
        completions.push({
          label: tag,
          kind: CompletionItemKind.Class,
          detail: info.description,
          insertText: tag,
          sortText: `0${tag}`, // Special tags first
        });
      }
    }

    // Add registered components
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

  // Try to find current element for attribute completion
  try {
    const preprocessed = preprocessSelfClosingTags(text);
    const ast = parse(preprocessed) as AstNode[];
    const node = findElementAtOffset(ast, offset);

    if (node && node.type === 'Tag' && node.name && isInOpeningTag(node, offset)) {
      const schema = getComponentSchema(node.name);
      const specialTag = specialTags[node.name];

      // Check if we're completing an attribute value
      const attrValueMatch = lineText.match(/(\w+)=["']([^"']*)$/);
      if (attrValueMatch) {
        const attrName = attrValueMatch[1];
        const attrValue = attrValueMatch[2];

        // Style attribute completion
        if (attrName === 'style') {
          const allStyles = { ...BASE_STYLES_SCHEMA, ...(schema?.styles || {}) };

          // Check if we're after a colon (completing a value) or not (completing a property name)
          // e.g., "border: " -> completing value for "border"
          // e.g., "border: thin; " -> completing new property name
          const styleContext = attrValue.match(/(?:^|[;,])\s*([\w-]*)\s*:\s*([^;,]*)$/);

          if (styleContext) {
            // Completing a style value
            const styleProp = toCamelCase(styleContext[1]);
            const styleSchema = allStyles[styleProp];
            const partialValue = styleContext[2].trim();

            // Check if we're inside var(-- for variable name completion
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

            // Always offer var() as a value option
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

              // Calculate the range of just the partial value to replace
              const partialStartChar = position.character - partialValue.length;
              const editRange: Range = {
                start: { line: position.line, character: partialStartChar },
                end: position,
              };

              for (const value of styleSchema.enum) {
                const strValue = String(value);
                // Only show completions that match the partial (if any)
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

            // Color value completions for color properties
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
            // Find existing properties to avoid duplicates
            const existingProps = new Set<string>();
            const propMatches = attrValue.matchAll(/([\w-]+)\s*:/g);
            for (const match of propMatches) {
              existingProps.add(toCamelCase(match[1]));
            }

            // Find the partial property name being typed and its position
            // e.g., in "flex-direction: row; gap: 2; overf" the partial is "overf"
            const partialMatch = attrValue.match(/(?:^|[;,])\s*([\w-]*)$/);
            const partial = partialMatch ? partialMatch[1] : '';

            // Calculate the range of just the partial text to replace
            // Position is: current cursor - length of partial
            const partialStartChar = position.character - partial.length;
            const editRange: Range = {
              start: { line: position.line, character: partialStartChar },
              end: position,
            };

            for (const [name, styleSchema] of Object.entries(allStyles)) {
              if (!existingProps.has(name)) {
                const kebabName = toKebabCase(name);
                // Only show completions that match the partial (if any)
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
        let propSchema: PropSchema | undefined;

        if (schema?.props[attrName]) {
          propSchema = schema.props[attrName];
        } else if (BASE_PROPS_SCHEMA[attrName]) {
          propSchema = BASE_PROPS_SCHEMA[attrName];
        } else if (BASE_STYLES_SCHEMA[attrName]) {
          propSchema = BASE_STYLES_SCHEMA[attrName];
        }

        // Enum value completion for component props
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

        // Special value completions for special tags
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
              sortText: attrName === 'wellknown' ? '0' : '1', // wellknown first for oauth
            });
          }
        }
        return completions;
      }

      // Attribute name completion for regular components
      const existingAttrs = new Set(node.attributes?.map(a => a.name.value) || []);
      const allProps = { ...BASE_PROPS_SCHEMA, ...(schema?.props || {}) };
      const allStyles = { ...BASE_STYLES_SCHEMA, ...(schema?.styles || {}) };

      // Add props
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

      // Add styles (with lower priority)
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

  // Find if we're inside a style tag
  function findStyleTag(nodes: AstNode[]): AstNode | null {
    for (const node of nodes) {
      if (node.type === 'Tag' && node.name === 'style') {
        // Check if offset is inside the tag body (after open tag, before close tag)
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

  // Get text content of style tag
  const openEnd = styleTag.open?.end ?? styleTag.start;
  const styleContent = text.substring(openEnd, offset);

  // Determine context
  // 1. After `:` - complete property values
  // 2. After `{` or `;` - complete property names
  // 3. After `}` or at start - complete selectors

  // Check if we're inside a rule block (between { and })
  const lastOpenBrace = styleContent.lastIndexOf('{');
  const lastCloseBrace = styleContent.lastIndexOf('}');
  const insideBlock = lastOpenBrace > lastCloseBrace;

  if (insideBlock) {
    // Inside property block
    const blockContent = styleContent.substring(lastOpenBrace + 1);

    // Check if we're completing a value (after :)
    const valueMatch = blockContent.match(/([\w-]+)\s*:\s*([^;]*)$/);
    if (valueMatch) {
      const propName = valueMatch[1];
      const camelProp = propName.replace(/-([a-z])/g, (_m, l) => l.toUpperCase());
      const schema = BASE_STYLES_SCHEMA[camelProp];

      // Check if we're inside var(-- for variable name completion
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

      // Always offer var() as a value option
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

      // Color value completions for color properties
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

    // Completing property name (after { or ;)
    // Find existing properties in this block
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

    // Add custom property declaration snippet
    completions.push({
      label: '--',
      kind: CompletionItemKind.Snippet,
      detail: 'Custom property (CSS variable)',
      insertText: '--${1:name}: ${2:value}',
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: '1--',
    });

    // In :root blocks, offer --theme-* variable overrides
    // Extract the selector for the current block by looking at text before the last {
    const beforeBrace = styleContent.substring(0, lastOpenBrace);
    // Strip CSS comments
    const stripped = beforeBrace.replace(/\/\*[\s\S]*?\*\//g, '');
    // Find the last selector: after last } or start of content
    const lastBlockEnd = stripped.lastIndexOf('}');
    const currentSelector = stripped.substring(lastBlockEnd + 1).trim();
    logger.debug('Style block selector detection', { currentSelector, lastBlockEnd });
    if (/(?:^|,\s*):root\s*$/.test(currentSelector)) {
      // Find the partial text being typed for filtering
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
    // Add element type selectors
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

    // Add ID selector prefix
    completions.push({
      label: '#',
      kind: CompletionItemKind.Snippet,
      detail: 'ID selector',
      insertText: '#',
      sortText: '0#',
    });

    // Add class selector prefix
    completions.push({
      label: '.',
      kind: CompletionItemKind.Snippet,
      detail: 'Class selector',
      insertText: '.',
      sortText: '0.',
    });

    // Add :root selector for CSS variables
    completions.push({
      label: ':root',
      kind: CompletionItemKind.Snippet,
      detail: 'Root scope for CSS custom properties',
      insertText: ':root {\n  --${1:name}: ${2:value};\n}',
      insertTextFormat: InsertTextFormat.Snippet,
      sortText: '0:root',
    });

    // Add universal selector
    completions.push({
      label: '*',
      kind: CompletionItemKind.Snippet,
      detail: 'Universal selector (all elements)',
      insertText: '* {\n  \n}',
      sortText: '0*',
    });

    // Add pseudo-class selectors
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

    // Add at-rule snippets
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

// Semantic token types for embedded TypeScript in event handlers
const tokenTypes = ['string'];
const tokenModifiers = ['typescript'];

// Event handler property names that contain TypeScript code
const EVENT_HANDLER_PROPS = new Set([
  'onClick', 'onKeyPress', 'onFocus', 'onBlur', 'onChange', 'onInput',
  'onMouseDown', 'onMouseUp', 'onMouseMove', 'onScroll',
  'onLogin', 'onLogout', 'onFail', // oauth handlers
  'onPlay', 'onPause', 'onError', 'onEnd', 'onFrame', // video handlers
]);

// Find all TypeScript code regions (event handlers and script content)
// Returns line-by-line tokens for proper semantic token encoding
function findTypeScriptRanges(text: string): Array<{ line: number; char: number; length: number }> {
  const ranges: Array<{ line: number; char: number; length: number }> = [];
  const lines = text.split('\n');

  // Helper to add a range, splitting multi-line content into per-line tokens
  function addRange(startOffset: number, endOffset: number) {
    const startPos = offsetToPosition(text, startOffset);
    const endPos = offsetToPosition(text, endOffset);

    if (startPos.line === endPos.line) {
      // Single line
      ranges.push({
        line: startPos.line,
        char: startPos.character,
        length: endOffset - startOffset,
      });
    } else {
      // Multi-line: add token for each line
      for (let line = startPos.line; line <= endPos.line; line++) {
        const lineContent = lines[line] || '';
        let char = 0;
        let length = lineContent.length;

        if (line === startPos.line) {
          // First line: start at character position
          char = startPos.character;
          length = lineContent.length - char;
        } else if (line === endPos.line) {
          // Last line: end at character position
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

      // Check for script tag content
      if (node.name === 'script' && node.body) {
        for (const child of node.body) {
          if (child.type === 'Text' && child.value && child.value.trim()) {
            addRange(child.start, child.end);
          }
        }
      }

      // Check for event handler attributes
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

// Levenshtein distance for fuzzy matching
// levenshteinDistance and findSimilarNames imported from string-utils.ts

// Get document symbols (outline) from AST
function getDocumentSymbols(text: string): DocumentSymbol[] {
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

      // Build detail string from id/class attributes
      let detail = '';
      const id = node.attributes?.find(a => a.name.value === 'id');
      const cls = node.attributes?.find(a => a.name.value === 'class');
      if (id?.value) detail += `#${id.value.value}`;
      if (cls?.value) detail += (detail ? ' ' : '') + `.${cls.value.value.replace(/\s+/g, '.')}`;

      const children: DocumentSymbol[] = [];

      // For style tags, extract CSS selectors as child symbols
      if (node.name === 'style' && node.body) {
        for (const child of node.body) {
          if (child.type === 'Text' && child.value) {
            const cssSymbols = extractStyleSymbols(child.value, child.start, text);
            children.push(...cssSymbols);
          }
        }
      }

      // Recurse into child elements
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
function extractStyleSymbols(styleContent: string, contentStart: number, text: string): DocumentSymbol[] {
  const symbols: DocumentSymbol[] = [];
  let i = 0;
  let depth = 0;

  while (i < styleContent.length) {
    // Skip whitespace
    while (i < styleContent.length && /\s/.test(styleContent[i])) i++;
    if (i >= styleContent.length) break;

    // Skip comments
    if (styleContent[i] === '/' && styleContent[i + 1] === '*') {
      const end = styleContent.indexOf('*/', i + 2);
      i = end === -1 ? styleContent.length : end + 2;
      continue;
    }

    // At depth 0, we're looking at selectors or @-rules
    if (depth === 0) {
      const selectorStart = i;
      // Find the opening brace
      while (i < styleContent.length && styleContent[i] !== '{') i++;
      if (i >= styleContent.length) break;

      const selector = styleContent.substring(selectorStart, i).trim();
      if (selector) {
        const absStart = contentStart + selectorStart;
        // Find matching close brace
        let braceDepth = 1;
        const blockStart = i;
        i++; // skip opening brace
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
      // Inside a block, skip to matching close
      if (styleContent[i] === '{') depth++;
      else if (styleContent[i] === '}') depth--;
      i++;
    }
  }

  return symbols;
}

// Get folding ranges for the document
function getFoldingRanges(text: string): FoldingRange[] {
  const ranges: FoldingRange[] = [];

  try {
    const ast = parse(text) as AstNode[];

    function addFoldingFromNode(node: AstNode): void {
      if (node.type !== 'Tag') return;

      // Only fold multi-line elements with a close tag
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

      // Add CSS folding for style tags
      if (node.name === 'style' && node.body) {
        for (const child of node.body) {
          if (child.type === 'Text' && child.value) {
            addCssFoldingRanges(child.value, child.start, text, ranges);
          }
        }
      }

      // Recurse
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
function addCssFoldingRanges(
  styleContent: string,
  contentStart: number,
  text: string,
  ranges: FoldingRange[]
): void {
  const braceStack: number[] = [];
  for (let i = 0; i < styleContent.length; i++) {
    // Skip comments
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

// Get code actions (quick fixes) for diagnostics
function getCodeActions(text: string, params: CodeActionParams): CodeAction[] {
  const actions: CodeAction[] = [];
  const diagnostics = params.context.diagnostics;

  for (const diag of diagnostics) {
    const code = diag.code as string | undefined;
    if (!code) continue;

    const diagMessage = diag.message;

    if (code === 'style-as-prop') {
      // Extract prop name from message: '"propName" is a style property...'
      const match = diagMessage.match(/^"([^"]+)" is a style property/);
      if (!match) continue;
      const propName = match[1];
      const kebabName = toKebabCase(propName);

      // Find the attribute in the source to get value
      const startOffset = positionToOffset(text, diag.range.start);
      const lineStart = text.lastIndexOf('\n', startOffset) + 1;
      const lineEnd = text.indexOf('\n', startOffset);
      const line = text.substring(lineStart, lineEnd === -1 ? text.length : lineEnd);

      // Find the attribute and its value in the line
      const attrPattern = new RegExp(`${propName}(?:=(?:"([^"]*)"|'([^']*)'))?`);
      const attrMatch = line.match(attrPattern);
      if (!attrMatch) continue;

      const attrValue = attrMatch[1] ?? attrMatch[2] ?? '';
      const attrStartInLine = line.indexOf(attrMatch[0]);
      const attrAbsStart = lineStart + attrStartInLine;
      const attrAbsEnd = attrAbsStart + attrMatch[0].length;

      const styleDecl = attrValue ? `${kebabName}: ${attrValue}` : kebabName;

      // Check if there's an existing style attribute on the same element
      // Find the tag this attribute belongs to
      const tagStart = text.lastIndexOf('<', startOffset);
      const tagEnd = text.indexOf('>', startOffset);
      const tagContent = text.substring(tagStart, tagEnd === -1 ? text.length : tagEnd + 1);
      const styleMatch = tagContent.match(/style=(?:"([^"]*)"|'([^']*)')/);

      if (styleMatch) {
        // Append to existing style attribute
        const existingValue = styleMatch[1] ?? styleMatch[2] ?? '';
        const styleAttrStart = tagStart + tagContent.indexOf(styleMatch[0]);
        const quote = tagContent[tagContent.indexOf(styleMatch[0]) + 6]; // char after style=
        const separator = existingValue.endsWith(';') || existingValue === '' ? '' : '; ';
        const newValue = `${existingValue}${separator}${styleDecl}`;

        actions.push({
          title: `Move "${propName}" to style attribute`,
          kind: CodeActionKind.QuickFix,
          diagnostics: [diag],
          edit: {
            changes: {
              [params.textDocument.uri]: [
                // Remove the offending attribute (and leading space)
                {
                  range: createRange(text, attrAbsStart - 1, attrAbsEnd),
                  newText: '',
                },
                // Replace existing style value
                {
                  range: createRange(text, styleAttrStart, styleAttrStart + styleMatch[0].length),
                  newText: `style=${quote}${newValue}${quote}`,
                },
              ],
            },
          },
        });
      } else {
        // No existing style attr — replace the prop with a style attribute
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
      // Extract valid values from message: '... Valid values: a, b, c'
      const valuesMatch = diagMessage.match(/Valid values: (.+)$/);
      if (!valuesMatch) continue;
      const validValues = valuesMatch[1].split(', ');

      // Extract the current invalid value
      const invalidMatch = diagMessage.match(/Invalid value "([^"]+)"/);
      if (!invalidMatch) continue;
      const invalidValue = invalidMatch[1];

      // Offer each valid value as a fix, sorted by similarity
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
      // Extract the unknown property name
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
      // Extract the unknown property name
      const propMatch = diagMessage.match(/Unknown property "([^"]+)" on <([^>]+)>/);
      if (!propMatch) continue;
      const unknownProp = propMatch[1];
      const elementName = propMatch[2];

      // Get valid props for this element
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

// --- Linked Editing Ranges ---

function getLinkedEditingRanges(text: string, position: Position): LinkedEditingRanges | null {
  try {
    const ast = parse(text) as AstNode[];
    const offset = positionToOffset(text, position);
    const node = findElementAtOffset(ast, offset);
    if (!node || !node.name || !node.open || !node.close) return null;

    const openNameStart = node.open.start + 1; // skip '<'
    const openNameEnd = openNameStart + node.name.length;
    const closeNameStart = node.close.start + 2; // skip '</'
    const closeNameEnd = closeNameStart + node.name.length;

    // Check cursor is in one of the tag names
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

// --- Document Links ---

function getDocumentLinks(text: string, uri: string): DocumentLink[] {
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
            // Resolve relative path against document URI
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

// --- Color Provider ---

const COLOR_PROPERTY_NAMES = new Set([
  'color', 'backgroundColor', 'borderColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'connectorColor', 'background', 'foreground', 'dividerColor',
]);

function packedToLspColor(packed: PackedRGBA): Color {
  const { r, g, b, a } = unpackRGBA(packed);
  return { red: r / 255, green: g / 255, blue: b / 255, alpha: a / 255 };
}

function extractColors(text: string): ColorInformation[] {
  const colors: ColorInformation[] = [];

  try {
    const ast = parse(text) as AstNode[];

    function visitNode(node: AstNode): void {
      if (node.type !== 'Tag') {
        if (node.body) node.body.forEach(visitNode);
        return;
      }

      // Inline style attributes
      if (node.attributes) {
        for (const attr of node.attributes) {
          if (attr.name.value === 'style' && attr.value?.value) {
            const props = parseStyleString(attr.value.value, attr.value.start);
            for (const prop of props) {
              if (!COLOR_PROPERTY_NAMES.has(prop.name) || !prop.value) continue;
              if (prop.value.startsWith('var(')) continue;
              try {
                const packed = cssToRgba(prop.value);
                colors.push({
                  range: createRange(text, prop.valueStart, prop.valueEnd),
                  color: packedToLspColor(packed),
                });
              } catch { /* skip invalid */ }
            }
          }
        }
      }

      // Style tag CSS blocks
      if (node.name === 'style' && node.body) {
        for (const child of node.body) {
          if (child.type === 'Text' && child.value) {
            extractColorsFromCss(child.value, child.start, text, colors);
          }
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

  return colors;
}

function extractColorsFromCss(
  css: string,
  contentStart: number,
  text: string,
  colors: ColorInformation[]
): void {
  // Strip comments
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');

  // Unwrap at-rules (same pattern as validateStyleTagContent)
  let unwrapped = '';
  let i = 0;
  while (i < stripped.length) {
    if (stripped[i] === '@') {
      const braceIdx = stripped.indexOf('{', i);
      if (braceIdx === -1) { unwrapped += stripped.substring(i); break; }
      const atName = stripped.substring(i, braceIdx).trim();
      let depth = 1;
      let j = braceIdx + 1;
      while (j < stripped.length && depth > 0) {
        if (stripped[j] === '{') depth++;
        else if (stripped[j] === '}') depth--;
        j++;
      }
      if (atName.startsWith('@keyframes')) {
        // Drop entirely
      } else {
        unwrapped += stripped.substring(braceIdx + 1, j - 1);
      }
      i = j;
    } else {
      unwrapped += stripped[i];
      i++;
    }
  }

  // Parse rules: selector { properties }
  const rulePattern = /([^{]+)\{([^}]*)\}/g;
  let match;
  while ((match = rulePattern.exec(unwrapped)) !== null) {
    const propertiesStr = match[2].trim();
    if (!propertiesStr) continue;

    const propsStart = contentStart + match.index + match[1].length + 1;
    const properties = propertiesStr.split(';');
    let propOffset = 0;

    for (const property of properties) {
      if (!property.trim()) {
        propOffset += property.length + 1;
        continue;
      }
      const colonIndex = property.indexOf(':');
      if (colonIndex === -1) {
        propOffset += property.length + 1;
        continue;
      }

      const keyPart = property.substring(0, colonIndex).trim();
      const valuePart = property.substring(colonIndex + 1).trim();
      const camelKey = keyPart.replace(/-([a-z])/g, (_m, letter: string) => letter.toUpperCase());

      if (COLOR_PROPERTY_NAMES.has(camelKey) && valuePart && !valuePart.startsWith('var(')) {
        try {
          const packed = cssToRgba(valuePart);
          const valueStartInProp = colonIndex + 1 + property.substring(colonIndex + 1).indexOf(valuePart);
          const absStart = propsStart + propOffset + valueStartInProp;
          colors.push({
            range: createRange(text, absStart, absStart + valuePart.length),
            color: packedToLspColor(packed),
          });
        } catch { /* skip invalid */ }
      }

      propOffset += property.length + 1;
    }
  }
}

function getColorPresentations(color: Color): ColorPresentation[] {
  const r = Math.round(color.red * 255);
  const g = Math.round(color.green * 255);
  const b = Math.round(color.blue * 255);
  const a = color.alpha;

  const hex = `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  const presentations: ColorPresentation[] = [
    { label: hex },
    { label: `rgb(${r}, ${g}, ${b})` },
  ];

  if (a < 1) {
    presentations.push(
      { label: `${hex}${Math.round(a * 255).toString(16).padStart(2, '0')}` },
      { label: `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})` },
    );
  }

  return presentations;
}

// --- Go to Definition ---

interface CssSelectorInfo {
  selector: string;
  start: number;
  end: number;
}

function findAllStyleBlocks(ast: AstNode[]): Array<{ content: string; contentStart: number }> {
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

function parseCssSelectors(content: string, contentStart: number): CssSelectorInfo[] {
  const selectors: CssSelectorInfo[] = [];

  // Strip comments
  const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');

  // Unwrap at-rules
  let unwrapped = '';
  let i = 0;
  while (i < stripped.length) {
    if (stripped[i] === '@') {
      const braceIdx = stripped.indexOf('{', i);
      if (braceIdx === -1) { unwrapped += stripped.substring(i); break; }
      const atName = stripped.substring(i, braceIdx).trim();
      let depth = 1;
      let j = braceIdx + 1;
      while (j < stripped.length && depth > 0) {
        if (stripped[j] === '{') depth++;
        else if (stripped[j] === '}') depth--;
        j++;
      }
      if (atName.startsWith('@keyframes')) {
        // Drop
      } else {
        unwrapped += stripped.substring(braceIdx + 1, j - 1);
      }
      i = j;
    } else {
      unwrapped += stripped[i];
      i++;
    }
  }

  const rulePattern = /([^{]+)\{[^}]*\}/g;
  let match;
  while ((match = rulePattern.exec(unwrapped)) !== null) {
    const selectorStr = match[1];
    const selectorBase = contentStart + match.index;

    // Split comma-separated selectors
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
      offset += part.length + 1; // +1 for comma
    }
  }

  return selectors;
}

function findSelectorPartAtOffset(
  selector: string,
  selectorStart: number,
  offset: number
): { type: 'id' | 'class' | 'type'; value: string } | null {
  const relOffset = offset - selectorStart;
  if (relOffset < 0 || relOffset > selector.length) return null;

  // Walk the selector to find the token at the cursor position
  let i = 0;
  while (i < selector.length) {
    const ch = selector[i];

    // Skip whitespace and combinators
    if (' >~+'.includes(ch)) { i++; continue; }

    // Skip pseudo-elements (::before) and pseudo-classes (:hover)
    if (ch === ':') {
      i++;
      if (i < selector.length && selector[i] === ':') i++; // ::
      // Skip the pseudo name
      while (i < selector.length && /[\w-]/.test(selector[i])) i++;
      // Skip functional pseudo args like :nth-child(2n)
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

    // ID selector
    if (ch === '#') {
      const start = i;
      i++; // skip #
      const nameStart = i;
      while (i < selector.length && /[\w-]/.test(selector[i])) i++;
      if (relOffset >= start && relOffset <= i) {
        return { type: 'id', value: selector.substring(nameStart, i) };
      }
      continue;
    }

    // Class selector
    if (ch === '.') {
      const start = i;
      i++; // skip .
      const nameStart = i;
      while (i < selector.length && /[\w-]/.test(selector[i])) i++;
      if (relOffset >= start && relOffset <= i) {
        return { type: 'class', value: selector.substring(nameStart, i) };
      }
      continue;
    }

    // Attribute selector [attr=val] — skip
    if (ch === '[') {
      const start = i;
      while (i < selector.length && selector[i] !== ']') i++;
      if (i < selector.length) i++; // skip ]
      if (relOffset >= start && relOffset <= i) return null;
      continue;
    }

    // Type selector (bare word)
    if (/[\w-]/.test(ch)) {
      const start = i;
      while (i < selector.length && /[\w-]/.test(selector[i])) i++;
      if (relOffset >= start && relOffset <= i) {
        return { type: 'type', value: selector.substring(start, i) };
      }
      continue;
    }

    // Universal selector or anything else
    i++;
  }

  return null;
}

function getDefinition(text: string, position: Position, uri: string): Definition | null {
  try {
    const ast = parse(text) as AstNode[];
    const offset = positionToOffset(text, position);

    // Check if cursor is on an element attribute
    const node = findElementAtOffset(ast, offset);
    if (node && node.type === 'Tag' && node.attributes) {
      const attr = findAttributeAtOffset(node, offset);
      if (attr?.value) {
        const inValue = offset >= attr.value.start && offset <= attr.value.end;
        if (inValue) {
          // Case A: id="..." → find CSS #id selectors
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

          // Case B: class="..." → find CSS .class selectors
          if (attr.name.value === 'class') {
            const classValue = attr.value.value;
            // Determine which class word cursor is on
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

    // Case C: Cursor inside <style> content → find elements
    // Check if cursor is inside a style tag
    for (const block of findAllStyleBlocks(ast)) {
      const blockEnd = block.contentStart + block.content.length;
      if (offset < block.contentStart || offset > blockEnd) continue;

      // Find which selector the cursor is in
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

      return null; // Cursor in style but not in a selector
    }

    return null;
  } catch {
    return null;
  }
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

// Exports for testing
export const _testing = {
  validateDocument,
  getHover,
  getCompletions,
  getDocumentSymbols,
  getFoldingRanges,
  getCodeActions,
  getLinkedEditingRanges,
  getDocumentLinks,
  extractColors,
  getColorPresentations,
  getDefinition,
  levenshteinDistance,
  findSimilarNames,
};

// Start the LSP server
export async function startLspServer(): Promise<void> {
  logger.info('Starting LSP server');

  // Simulate --stdio flag for vscode-languageserver auto-detection
  if (!process.argv.includes('--stdio')) {
    process.argv.push('--stdio');
  }

  // Create connection - it will auto-detect stdio mode from argv
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    logger.info('Client initialized', {
      clientName: params.clientInfo?.name ?? 'unknown',
      rootUri: params.rootUri,
    });
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: {
          triggerCharacters: ['<', ' ', '=', '"', "'", ':', ';', '{'],
        },
        hoverProvider: true,
        semanticTokensProvider: {
          legend: {
            tokenTypes,
            tokenModifiers,
          },
          full: true,
        },
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        codeActionProvider: {
          codeActionKinds: [CodeActionKind.QuickFix],
        },
        definitionProvider: true,
        documentLinkProvider: { resolveProvider: false },
        linkedEditingRangeProvider: true,
        colorProvider: true,
      },
    };
  });

  // Validate on open and change
  documents.onDidChangeContent((change) => {
    logger.debug('Document changed', { uri: change.document.uri });
    const diagnostics = validateDocument(change.document.getText());

    // Log each diagnostic for debugging
    for (const diag of diagnostics) {
      logger.debug('Diagnostic', {
        message: diag.message,
        severity: diag.severity,
        range: `${diag.range.start.line}:${diag.range.start.character}-${diag.range.end.line}:${diag.range.end.character}`,
        source: diag.source,
      });
    }

    connection.sendDiagnostics({
      uri: change.document.uri,
      diagnostics,
    });
    logger.debug('Diagnostics published', { uri: change.document.uri, count: diagnostics.length });
  });

  // Hover
  connection.onHover((params: TextDocumentPositionParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getHover(document.getText(), params.position);
  });

  // Completion
  connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getCompletions(document.getText(), params.position);
  });

  // Semantic tokens - mark TypeScript regions (event handlers and script content)
  connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };

    const text = document.getText();
    const ranges = findTypeScriptRanges(text);
    const builder = new SemanticTokensBuilder();

    // Sort by line then character for proper encoding
    ranges.sort((a, b) => a.line - b.line || a.char - b.char);

    for (const range of ranges) {
      // tokenType 0 = 'string', tokenModifier 1 = 'typescript' (bit mask)
      builder.push(range.line, range.char, range.length, 0, 1);
    }

    logger.debug('Semantic tokens', { count: ranges.length });
    return builder.build();
  });

  // Document symbols (outline)
  connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getDocumentSymbols(document.getText());
  });

  // Folding ranges
  connection.onFoldingRanges((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getFoldingRanges(document.getText());
  });

  // Code actions (quick fixes)
  connection.onCodeAction((params: CodeActionParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getCodeActions(document.getText(), params);
  });

  // Linked editing ranges (rename open/close tags in sync)
  connection.languages.onLinkedEditingRange((params: TextDocumentPositionParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getLinkedEditingRanges(document.getText(), params.position);
  });

  // Document links (clickable src/href)
  connection.onDocumentLinks((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getDocumentLinks(document.getText(), params.textDocument.uri);
  });

  // Color provider
  connection.onDocumentColor((params: DocumentColorParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return extractColors(document.getText());
  });

  connection.onColorPresentation((params) => {
    return getColorPresentations(params.color);
  });

  // Go to definition
  connection.onDefinition((params: TextDocumentPositionParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getDefinition(document.getText(), params.position, params.textDocument.uri);
  });

  documents.listen(connection);
  connection.listen();

  logger.info('LSP server listening on stdio');

  // Keep the server running until the connection is closed
  await new Promise<void>((resolve) => {
    connection.onExit(() => {
      logger.info('LSP server exiting');
      resolve();
    });
  });
}
