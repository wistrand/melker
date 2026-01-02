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
  type InitializeParams,
  type InitializeResult,
  type TextDocumentPositionParams,
  type CompletionItem,
  type Hover,
  type Diagnostic,
  type Range,
  type Position,
  type SemanticTokensParams,
} from 'npm:vscode-languageserver@9.0.1/node.js';
import { TextDocument } from 'npm:vscode-languageserver-textdocument';
import { parse } from 'npm:html5parser';

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

// Import melker.ts to register all component schemas
import '../melker.ts';

const logger = getLogger('LSP');

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
  ai: 'boolean | string[]',
  clipboard: 'boolean',
  keyring: 'boolean',
  browser: 'boolean',
};

// Valid policy permission keys
const VALID_POLICY_PERMISSIONS = new Set(Object.keys(POLICY_PERMISSION_TYPES));

// Policy top-level key types
const POLICY_KEY_TYPES: Record<string, string> = {
  name: 'string',
  version: 'string',
  description: 'string',
  permissions: 'object',
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
  // Parse selector parts: #id, .class, type, or compound like button.primary
  const trimmed = selector.trim();
  if (!trimmed) return;

  // Extract type selector if present (not starting with # or .)
  let remaining = trimmed;

  if (remaining.startsWith('#')) {
    // ID selector - skip validation (any ID is valid)
    const idMatch = remaining.match(/^#([^.]+)/);
    if (idMatch) {
      remaining = remaining.slice(idMatch[0].length);
    }
  } else if (!remaining.startsWith('.')) {
    // Type selector - validate against registered components
    const typeMatch = remaining.match(/^([^.]+)/);
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
      remaining = remaining.slice(typeMatch[0].length);
    }
  }

  // Class selectors (.class1.class2) - no validation needed, any class name is valid
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
      });
    } else if (schema.enum && valuePart) {
      // Validate enum values
      if (!schema.enum.includes(valuePart)) {
        const valueStart = propsStart + propOffset + colonIndex + 1 + property.substring(colonIndex + 1).indexOf(valuePart);
        diagnostics.push({
          range: createRange(text, valueStart, valueStart + valuePart.length),
          severity: DiagnosticSeverity.Warning,
          message: `Invalid value "${valuePart}" for style "${keyPart}". Valid values: ${schema.enum.join(', ')}`,
          source: 'melker',
        });
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

    if (!schema) {
      // Unknown style property
      diagnostics.push({
        range: createRange(text, prop.nameStart, prop.nameEnd),
        severity: DiagnosticSeverity.Warning,
        message: `Unknown style property "${prop.name}" on <${elementName}>`,
        source: 'melker',
      });
    } else if (schema.enum && prop.value) {
      // Validate enum values
      if (!schema.enum.includes(prop.value)) {
        diagnostics.push({
          range: createRange(text, prop.valueStart, prop.valueEnd),
          severity: DiagnosticSeverity.Warning,
          message: `Invalid value "${prop.value}" for style "${prop.name}". Valid values: ${schema.enum.join(', ')}`,
          source: 'melker',
        });
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
        onLogin: true,
        onLogout: true,
        onFail: true,
      },
      'policy': {
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
              });
              continue;
            }

            diagnostics.push({
              range: createRange(text, attr.name.start, attr.name.end),
              severity: DiagnosticSeverity.Warning,
              message: `Unknown property "${propName}" on <${node.name}>`,
              source: 'melker',
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

            if (styleSchema?.enum) {
              const kebabProp = toKebabCase(styleProp);
              for (const value of styleSchema.enum) {
                completions.push({
                  label: String(value),
                  kind: CompletionItemKind.EnumMember,
                  detail: `Value for ${kebabProp}`,
                  insertText: String(value),
                });
              }
              return completions;
            }
          } else {
            // Completing a style property name
            // Find existing properties to avoid duplicates
            const existingProps = new Set<string>();
            const propMatches = attrValue.matchAll(/([\w-]+)\s*:/g);
            for (const match of propMatches) {
              existingProps.add(toCamelCase(match[1]));
            }

            for (const [name, styleSchema] of Object.entries(allStyles)) {
              if (!existingProps.has(name)) {
                const kebabName = toKebabCase(name);
                completions.push({
                  label: kebabName,
                  kind: CompletionItemKind.Property,
                  detail: styleSchema.description,
                  insertText: `${kebabName}: `,
                  sortText: `0${kebabName}`,
                });
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

      if (schema?.enum) {
        for (const value of schema.enum) {
          completions.push({
            label: String(value),
            kind: CompletionItemKind.EnumMember,
            detail: `Value for ${propName}`,
            insertText: String(value),
          });
        }
        return completions;
      }
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
          triggerCharacters: ['<', ' ', '=', '"', "'"],
        },
        hoverProvider: true,
        semanticTokensProvider: {
          legend: {
            tokenTypes,
            tokenModifiers,
          },
          full: true,
        },
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
