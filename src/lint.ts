// Lint mode for validating element props and styles during template parsing

import { getLogger } from './logging.ts';
import { MelkerConfig } from './config/mod.ts';

const lintLogger = getLogger('Lint');

// Schema types
export type PropType = 'string' | 'number' | 'boolean' | 'function' | 'object' | 'array' | 'any';

export interface PropSchema {
  type: PropType | PropType[];
  required?: boolean;
  enum?: any[];
  description?: string;
}

export interface ComponentSchema {
  description?: string;  // Component description
  props: Record<string, PropSchema>;
  styles?: Record<string, PropSchema>;  // Component-specific styles (rare)
}

export interface LintWarning {
  type: 'unknown-prop' | 'unknown-style' | 'invalid-prop-type' | 'invalid-style-value' | 'unknown-element';
  elementType: string;
  property: string;
  value?: any;
  message: string;
  suggestion?: string;
}

// Global state
let _lintEnabled = false;
let _warnings: LintWarning[] = [];
const _componentSchemas: Map<string, ComponentSchema> = new Map();

// Base props that all components inherit (not styles - those are in BASE_STYLES_SCHEMA)
// Note: Style properties can also be used as element attributes and are validated via allStyles
export const BASE_PROPS_SCHEMA: Record<string, PropSchema> = {
  // Identity
  id: { type: 'string', description: 'Unique element identifier' },
  class: { type: ['string', 'array'], description: 'CSS-like class names for styling' },
  classList: { type: 'array', description: 'Array of class names (internal)' },
  style: { type: 'object', description: 'Inline style object' },
  tabIndex: { type: 'number', description: 'Tab navigation order (-1 to skip)' },
  disabled: { type: 'boolean', description: 'Disable interaction and focus' },

  // Event handlers (string in .melker files, function at runtime)
  onClick: { type: ['function', 'string'], description: 'Click/Enter key handler' },
  onKeyPress: { type: ['function', 'string'], description: 'Key press handler' },
  onFocus: { type: ['function', 'string'], description: 'Focus gained handler' },
  onBlur: { type: ['function', 'string'], description: 'Focus lost handler' },
  onChange: { type: ['function', 'string'], description: 'Value change handler' },
  onInput: { type: ['function', 'string'], description: 'Input event handler' },
  onMouseDown: { type: ['function', 'string'], description: 'Mouse button pressed handler' },
  onMouseUp: { type: ['function', 'string'], description: 'Mouse button released handler' },
  onMouseMove: { type: ['function', 'string'], description: 'Mouse movement handler' },
  onScroll: { type: ['function', 'string'], description: 'Scroll event handler' },
};

// Base styles that all components support
export const BASE_STYLES_SCHEMA: Record<string, PropSchema> = {
  // Colors
  color: { type: 'string', description: 'Text/foreground color' },
  backgroundColor: { type: 'string', description: 'Background color' },
  borderColor: { type: 'string', description: 'Border color' },
  borderTopColor: { type: 'string', description: 'Top border color' },
  borderBottomColor: { type: 'string', description: 'Bottom border color' },
  borderLeftColor: { type: 'string', description: 'Left border color' },
  borderRightColor: { type: 'string', description: 'Right border color' },

  // Font
  fontWeight: { type: 'string', enum: ['normal', 'bold'], description: 'Text weight' },

  // Border
  border: { type: 'string', enum: ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'ascii', 'ascii-rounded'], description: 'Border on all sides' },
  borderTop: { type: 'string', enum: ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'ascii', 'ascii-rounded'], description: 'Top border' },
  borderBottom: { type: 'string', enum: ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'ascii', 'ascii-rounded'], description: 'Bottom border' },
  borderLeft: { type: 'string', enum: ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'ascii', 'ascii-rounded'], description: 'Left border' },
  borderRight: { type: 'string', enum: ['none', 'thin', 'thick', 'double', 'rounded', 'dashed', 'dashed-rounded', 'ascii', 'ascii-rounded'], description: 'Right border' },

  // Spacing
  padding: { type: ['number', 'object'], description: 'Inner spacing (all sides or {top,right,bottom,left})' },
  paddingTop: { type: 'number', description: 'Top inner spacing' },
  paddingBottom: { type: 'number', description: 'Bottom inner spacing' },
  paddingLeft: { type: 'number', description: 'Left inner spacing' },
  paddingRight: { type: 'number', description: 'Right inner spacing' },
  margin: { type: ['number', 'object'], description: 'Outer spacing (all sides or {top,right,bottom,left})' },
  marginTop: { type: 'number', description: 'Top outer spacing' },
  marginBottom: { type: 'number', description: 'Bottom outer spacing' },
  marginLeft: { type: 'number', description: 'Left outer spacing' },
  marginRight: { type: 'number', description: 'Right outer spacing' },

  // Layout
  boxSizing: { type: 'string', enum: ['border-box', 'content-box'], description: 'How width/height include padding/border' },
  textWrap: { type: 'string', enum: ['nowrap', 'wrap'], description: 'Text wrapping behavior' },
  display: { type: 'string', enum: ['block', 'flex'], description: 'Layout mode' },
  position: { type: 'string', enum: ['static', 'relative', 'absolute', 'fixed'], description: 'Positioning mode' },
  overflow: { type: 'string', enum: ['visible', 'hidden', 'scroll'], description: 'Content overflow behavior' },
  width: { type: ['number', 'string'], description: 'Element width' },
  height: { type: ['number', 'string'], description: 'Element height' },
  minWidth: { type: ['number', 'string'], description: 'Minimum width' },
  minHeight: { type: ['number', 'string'], description: 'Minimum height' },
  maxWidth: { type: ['number', 'string'], description: 'Maximum width' },
  maxHeight: { type: ['number', 'string'], description: 'Maximum height' },
  top: { type: 'number', description: 'Top offset' },
  right: { type: 'number', description: 'Right offset' },
  bottom: { type: 'number', description: 'Bottom offset' },
  left: { type: 'number', description: 'Left offset' },
  zIndex: { type: 'number', description: 'Stack order' },

  // Flexbox
  flex: { type: ['number', 'string'], description: 'Flex shorthand (grow shrink basis)' },
  flexDirection: { type: 'string', enum: ['row', 'column', 'row-reverse', 'column-reverse'], description: 'Main axis direction' },
  flexWrap: { type: 'string', enum: ['nowrap', 'wrap', 'wrap-reverse'], description: 'Item wrapping' },
  justifyContent: { type: 'string', enum: ['flex-start', 'flex-end', 'center', 'space-between', 'space-around', 'space-evenly'], description: 'Main axis alignment' },
  alignItems: { type: 'string', enum: ['flex-start', 'flex-end', 'center', 'stretch', 'baseline'], description: 'Cross axis alignment' },
  alignContent: { type: 'string', enum: ['flex-start', 'flex-end', 'center', 'stretch', 'space-between', 'space-around'], description: 'Multi-line alignment' },
  alignSelf: { type: 'string', enum: ['auto', 'flex-start', 'flex-end', 'center', 'stretch', 'baseline'], description: 'Override align-items for this item' },
  flexGrow: { type: 'number', description: 'Grow factor' },
  flexShrink: { type: 'number', description: 'Shrink factor' },
  flexBasis: { type: ['number', 'string'], description: 'Initial size' },
  gap: { type: 'number', description: 'Spacing between items' },

  // Text
  textAlign: { type: 'string', enum: ['left', 'center', 'right'], description: 'Horizontal text alignment' },
  verticalAlign: { type: 'string', enum: ['top', 'center', 'bottom'], description: 'Vertical text alignment' },
  fontSize: { type: 'string', description: 'Ignored (terminals have fixed font size)' },
  fontFamily: { type: 'string', description: 'Ignored (terminals have fixed font)' },
};

// Enable/disable lint mode
export function enableLint(enabled: boolean = true): void {
  _lintEnabled = enabled;
  if (enabled) {
    lintLogger.info('Lint mode enabled');
  }
}

export function isLintEnabled(): boolean {
  // Check config if not explicitly set
  if (!_lintEnabled) {
    _lintEnabled = MelkerConfig.get().lint;
  }
  return _lintEnabled;
}

// Warning collection
export function addWarning(warning: LintWarning): void {
  _warnings.push(warning);
}

export function getWarnings(): LintWarning[] {
  return [..._warnings];
}

export function clearWarnings(): void {
  _warnings = [];
}

// Schema registration
export function registerComponentSchema(elementType: string, schema: ComponentSchema): void {
  _componentSchemas.set(elementType, schema);
}

export function getComponentSchema(elementType: string): ComponentSchema | undefined {
  return _componentSchemas.get(elementType);
}

export function getRegisteredComponents(): string[] {
  return Array.from(_componentSchemas.keys());
}

// Convert camelCase to kebab-case for display (e.g., fontSize -> font-size)
function toKebabCase(str: string): string {
  return str.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

// Find similar property names for suggestions
function findSimilar(prop: string, validProps: string[]): string | undefined {
  const propLower = prop.toLowerCase();

  // Check for exact lowercase match
  for (const valid of validProps) {
    if (valid.toLowerCase() === propLower) {
      return valid;
    }
  }

  // Check for substring match
  for (const valid of validProps) {
    if (valid.toLowerCase().includes(propLower) || propLower.includes(valid.toLowerCase())) {
      return valid;
    }
  }

  // Simple Levenshtein-like check for typos (max 2 edits for short props)
  for (const valid of validProps) {
    if (Math.abs(valid.length - prop.length) <= 2) {
      let diff = 0;
      const shorter = prop.length < valid.length ? prop : valid;
      const longer = prop.length < valid.length ? valid : prop;
      for (let i = 0; i < shorter.length && diff <= 2; i++) {
        if (shorter[i].toLowerCase() !== longer[i].toLowerCase()) diff++;
      }
      diff += longer.length - shorter.length;
      if (diff <= 2) return valid;
    }
  }

  return undefined;
}

// Validate element props and styles
export function validateElementProps(
  elementType: string,
  props: Record<string, any>
): LintWarning[] {
  const warnings: LintWarning[] = [];
  const schema = _componentSchemas.get(elementType);

  // Skip validation for unknown elements (might be custom components)
  if (!schema) {
    return warnings;
  }

  // Combine base props with component-specific props
  const validProps = { ...BASE_PROPS_SCHEMA, ...schema.props };
  const validStyles = { ...BASE_STYLES_SCHEMA, ...(schema.styles || {}) };

  for (const [propName, propValue] of Object.entries(props)) {
    if (propName === 'style' && typeof propValue === 'object' && propValue !== null) {
      // Validate style properties
      for (const [styleName, styleValue] of Object.entries(propValue)) {
        const displayName = toKebabCase(styleName);
        if (!validStyles[styleName]) {
          const suggestion = findSimilar(styleName, Object.keys(validStyles));
          warnings.push({
            type: 'unknown-style',
            elementType,
            property: styleName,
            value: styleValue,
            message: `Unknown style "${displayName}" on <${elementType}>`,
            suggestion: suggestion ? `Did you mean "${toKebabCase(suggestion)}"?` : undefined,
          });
        } else {
          // Validate style value type/enum
          const styleSchema = validStyles[styleName];
          if (styleSchema.enum && !styleSchema.enum.includes(styleValue)) {
            warnings.push({
              type: 'invalid-style-value',
              elementType,
              property: styleName,
              value: styleValue,
              message: `Invalid value "${styleValue}" for style "${displayName}" on <${elementType}>. Valid values: ${styleSchema.enum.join(', ')}`,
            });
          }
        }
      }
    } else if (propName === 'children') {
      // Skip children - it's always valid
      continue;
    } else if (!validProps[propName]) {
      // Check if it's a style property used as element attribute
      if (validStyles[propName]) {
        const kebabName = toKebabCase(propName);
        warnings.push({
          type: 'unknown-prop',
          elementType,
          property: propName,
          value: propValue,
          message: `"${propName}" is a style property. Use style="${kebabName}: ${propValue}" instead`,
        });
      } else {
        const suggestion = findSimilar(propName, Object.keys(validProps));
        warnings.push({
          type: 'unknown-prop',
          elementType,
          property: propName,
          value: propValue,
          message: `Unknown property "${propName}" on <${elementType}>`,
          suggestion: suggestion ? `Did you mean "${suggestion}"?` : undefined,
        });
      }
    } else {
      // Validate prop type
      const propSchema = validProps[propName];
      let actualType: string = Array.isArray(propValue) ? 'array' : typeof propValue;

      // Special case: __isStringHandler objects are treated as functions (event handlers in .melker files)
      if (actualType === 'object' && propValue !== null && propValue.__isStringHandler === true) {
        actualType = 'function';
      }

      // Special case: string "true"/"false" are treated as booleans (from .melker file parsing)
      if (actualType === 'string' && (propValue === 'true' || propValue === 'false')) {
        actualType = 'boolean';
      }

      const expectedTypes = Array.isArray(propSchema.type) ? propSchema.type : [propSchema.type];

      if (!expectedTypes.includes('any') && !expectedTypes.includes(actualType as PropType)) {
        // Provide helpful message for common mistakes
        let message = `Invalid type for "${propName}" on <${elementType}>. Expected ${expectedTypes.join(' or ')}, got ${actualType}`;

        // Special case: boolean prop with {true}/{false} syntax (template literal syntax in .melker file)
        if (expectedTypes.includes('boolean') && actualType === 'string') {
          if (propValue === '{true}' || propValue === '{false}') {
            message = `Invalid syntax for "${propName}" on <${elementType}>. Use ${propName}="${propValue.slice(1, -1)}" instead of ${propName}=${propValue}`;
          } else {
            message = `Invalid value "${propValue}" for boolean "${propName}" on <${elementType}>. Use ${propName}="true" or ${propName}="false"`;
          }
        }

        warnings.push({
          type: 'invalid-prop-type',
          elementType,
          property: propName,
          value: propValue,
          message,
        });
      }

      // Validate enum values
      if (propSchema.enum && !propSchema.enum.includes(propValue)) {
        warnings.push({
          type: 'invalid-prop-type',
          elementType,
          property: propName,
          value: propValue,
          message: `Invalid value "${propValue}" for "${propName}" on <${elementType}>. Valid values: ${propSchema.enum.join(', ')}`,
        });
      }
    }
  }

  return warnings;
}

// Format warnings for display
export function formatWarnings(warnings: LintWarning[]): string {
  if (warnings.length === 0) return '';

  const lines: string[] = [];
  lines.push(`Found ${warnings.length} lint warning(s):`);

  for (const warning of warnings) {
    let msg = `  - ${warning.message}`;
    if (warning.suggestion) {
      msg += ` ${warning.suggestion}`;
    }
    lines.push(msg);
  }

  return lines.join('\n');
}

// Report warnings using logger and console
export function reportWarnings(): void {
  const warnings = getWarnings();
  if (warnings.length === 0) return;

  // Print to stderr for CLI visibility
  console.error(`\n[Lint] Found ${warnings.length} warning(s):`);

  for (const warning of warnings) {
    let msg = warning.message;
    if (warning.suggestion) {
      msg += ` ${warning.suggestion}`;
    }
    // Log to file
    lintLogger.warn(msg);
    // Print to stderr
    console.error(`  - ${msg}`);
  }

  console.error('');
  lintLogger.info(`Total: ${warnings.length} lint warning(s)`);
}
