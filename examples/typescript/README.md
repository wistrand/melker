# TypeScript Examples

TypeScript examples demonstrating programmatic Melker usage.

## Running

```bash
deno run --allow-all examples/typescript/create-element/minimal-example.ts
deno run --allow-all examples/typescript/template/template-demo.ts
```

## createElement API (`create-element/`)

Low-level API using `createElement()` function calls.

| File | Description |
|------|-------------|
| `minimal-example.ts` | Minimal Melker setup |
| `basic-usage.ts` | Core API - createElement, serialization, tree manipulation |
| `terminal-ui-demo.ts` | Complete terminal application with responsive layouts |
| `interactive-demo.ts` | Event handling, focus management, user interaction |
| `dialog-demo.ts` | Modal dialogs |
| `form-demo.ts` | Radio buttons and checkboxes |
| `simple-list-demo.ts` | Basic list component |
| `mixed-list-demo.ts` | List with different child types |
| `scrolling-list-demo.ts` | Scrollable list container |
| `mirror-demo.ts` | Debug server HTML mirror |
| `template-comparison.ts` | createElement vs melker template comparison |
| `theme-demo.ts` | Theme system demonstration |

## Template API (`template/`)

Template literal syntax using `` melker`...` `` tagged templates.

| File | Description |
|------|-------------|
| `template-demo.ts` | Template literal syntax usage |
| `template-button-demo.ts` | Button handling with templates |
| `state-management-example.ts` | State management patterns |
| `tabs-ts-demo.ts` | Tabbed interface component |
| `analog-clock-demo.ts` | Canvas-based analog clock |
| `canvas-graphics-demo.ts` | Canvas drawing primitives |
| `canvas-sine-wave-demo.ts` | Animated sine wave |
| `list-demo.ts` | List component example |
| `file-browser-standalone.ts` | Standalone file browser |

## API Comparison

**createElement (imperative):**
```typescript
const ui = createElement('container', { style: { border: 'thin' } },
  createElement('text', { text: 'Hello!' }),
  createElement('button', { label: 'OK', onClick: () => app.exit() })
);
```

**Template literals (declarative):**
```typescript
const ui = melker`
  <container style=${{ border: 'thin' }}>
    <text>Hello!</text>
    <button label="OK" onClick=${() => app.exit()} />
  </container>
`;
```

Both APIs use `createApp(ui)` to run the application.
