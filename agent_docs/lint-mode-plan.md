# Lint Mode Implementation Plan

Add validation during template parsing to warn about unsupported props/styles on elements.

## New Files

| File | Purpose |
|------|---------|
| `src/lint.ts` | Warning collection, enable/disable, formatting |
| `src/lint-schema.ts` | Component schemas defining valid props/styles per element |

## Schema Structure

```typescript
// Prop types for validation
type PropType = 'string' | 'number' | 'boolean' | 'function' | 'object' | 'array' | 'any';

interface PropSchema {
  type: PropType | PropType[];
  required?: boolean;
  enum?: any[];          // Allowed values
  description?: string;  // For error messages
}

interface ComponentSchema {
  props: Record<string, PropSchema>;   // Valid props with types/enums
  styles: Record<string, PropSchema>;  // Valid style properties
  inheritsFrom?: string[];             // e.g., ['BaseProps']
}

// Example for button
'button': {
  props: {
    title: { type: 'string', required: true },
    variant: { type: 'string', enum: ['default', 'primary', 'secondary', 'plain'] },
  },
  inheritsFrom: ['BaseProps']
}
```

## Base Props Schema (inherited by all components)

From `types.ts` BaseProps:
- `id`, `class`, `classList`, `style`, `tabIndex`, `disabled`
- Layout: `width`, `height`, `display`, `overflow`, `position`, `top`, `right`, `bottom`, `left`, `zIndex`
- Flexbox: `flexDirection`, `justifyContent`, `alignItems`, `flexGrow`, `flexShrink`
- Events: `onClick`, `onKeyPress`, `onFocus`, `onBlur`, `onChange`

## Base Styles Schema

From `types.ts` Style interface:
- Colors: `color`, `backgroundColor`, `borderColor`
- Font: `fontWeight`
- Border: `border`, `borderTop`, `borderBottom`, `borderLeft`, `borderRight`
- Spacing: `padding`, `margin`, `marginBottom`
- Layout: `boxSizing`, `textWrap`, `display`, `position`, `overflow`, `width`, `height`
- Flexbox: `flex`, `flexDirection`, `flexWrap`, `justifyContent`, `alignItems`, `alignContent`, `alignSelf`, `flexGrow`, `flexShrink`, `flexBasis`
- Text: `textAlign`, `verticalAlign`

## Component-Specific Props

| Component | Key Props |
|-----------|-----------|
| `container` | `scrollable`, `scrollX`, `scrollY` |
| `text` | `text`, `src`, `wrap` |
| `input` | `value`, `placeholder`, `maxLength`, `readOnly`, `cursorPosition`, `complete` |
| `textarea` | `value`, `placeholder`, `maxLength`, `readOnly`, `rows`, `cols`, `wrap` |
| `button` | `title`, `variant` |
| `checkbox` | `title`, `checked`, `indeterminate` |
| `radio` | `title`, `value`, `checked`, `name` |
| `dialog` | `title`, `modal`, `backdrop`, `open` |
| `list` | `selectionMode`, `selectedItems`, `focusedItem`, `scrollTop`, `onSelectionChange` |
| `li` | `marker`, `indent`, `focused`, `selected`, `selectionMode` |
| `menu` | `title`, `items`, `visible`, `submenuPosition`, `autoClose`, `anchorElement` |
| `menu-item` | `title`, `shortcut`, `icon`, `disabled`, `checked`, `separator`, `submenu` |
| `markdown` | `text`, `src`, `maxWidth`, `enableGfm`, `listIndent`, `codeTheme`, `onLink` |
| `canvas` | `width`, `height`, `scale`, `backgroundColor`, `charAspectRatio`, `src`, `dither` |

## Integration Point

Validate in `convertToElement()` in `template.ts`:

```typescript
function convertToElement(node: ParsedNode, context: TemplateContext): Element {
  // ... existing code ...

  if (isLintEnabled()) {
    const warnings = validateElementProps(node.name, node.attributes);
    collectWarnings(warnings);
  }

  return createElement(node.name, node.attributes || {}, ...children);
}
```

This catches both:
- `.melker` file parsing (via `parseMelkerFile`)
- Template literal parsing (via `melker` tagged template)

## Enable/Disable Options

1. **Environment variable**: `MELKER_LINT=true`
2. **CLI flag**: `--lint` (for .melker runner)
3. **Programmatic**: `enableLint(true)`

## Warning Types

| Type | Description |
|------|-------------|
| `unknown-prop` | Property not in component schema |
| `unknown-style` | Style property not recognized |
| `invalid-prop-type` | Wrong type for known prop |
| `invalid-style-value` | Invalid value for style (e.g., wrong enum) |

## Warning Interface

```typescript
interface LintWarning {
  type: 'unknown-prop' | 'unknown-style' | 'invalid-prop-type' | 'invalid-style-value';
  elementType: string;
  property: string;
  value?: any;
  message: string;
  location?: { line?: number; column?: number };
}
```

## Output

Warnings collected during parse, displayed via logging system after completion:

```
[Lint] WARN: Unknown property "lable" on <button>. Did you mean "title"?
[Lint] WARN: Unknown style "colours" on <text>. Did you mean "color"?
```

## Files to Modify

| File | Change |
|------|--------|
| `src/template.ts` | Add validation call in `convertToElement` |
| `src/melker-main.ts` | Add `--lint` CLI flag |
| `melker.ts` | Export lint functions |

## Implementation Order

1. Create `src/lint.ts` with warning collection infrastructure
2. Create `src/lint-schema.ts` with base props/styles schemas
3. Add schemas for each component (container, text, button, input, etc.)
4. Integrate validation into `src/template.ts`
5. Add `--lint` CLI flag in `src/melker-main.ts`
6. Export lint functions from `melker.ts`
7. Test with various .melker examples

## Future Considerations

1. **Strict mode**: `MELKER_LINT=strict` to treat warnings as errors
2. **Auto-suggest**: Suggest similar valid props for typos (Levenshtein distance)
3. **IDE integration**: Export schema for LSP support
4. **Deprecation warnings**: Mark deprecated props in schema
5. **Documentation generation**: Auto-generate component docs from schemas
