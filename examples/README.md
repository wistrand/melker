# Melker Examples

This directory contains focused examples demonstrating different aspects of the Melker terminal UI library.

## Directory Structure

```
examples/
├── ts/                    # TypeScript examples using createElement API
├── melker/               # .melker declarative template files
├── melker-md/            # Markdown files with ASCII box layouts
└── *.ts                  # TypeScript examples using melker template API
```

## TypeScript Examples with createElement (`ts/`)

| Example | Description |
|---------|-------------|
| `basic_usage.ts` | Core API - createElement, serialization, tree manipulation |
| `minimal_example.ts` | Minimal Melker setup |
| `terminal_ui_demo.ts` | Complete terminal application with responsive layouts |
| `interactive_demo.ts` | Event handling, focus management, user interaction |
| `dialog_demo.ts` | Modal dialogs |
| `file_browser_demo.ts` | File system navigation in modal |
| `file_browser_standalone.ts` | Standalone file browser application |
| `form_demo.ts` | Radio buttons and checkboxes |
| `simple_list_demo.ts` | Basic list component |
| `mixed_list_demo.ts` | List with different child types |
| `scrolling_list_demo.ts` | Scrollable list container |
| `mirror_demo.ts` | Debug server HTML mirror |
| `template_comparison.ts` | createElement vs melker template comparison |
| `theme_demo.ts` | Theme system demonstration |

```bash
# Run a TypeScript example
deno run --allow-all examples/ts/minimal_example.ts
```

## TypeScript Examples with melker Templates (root)

| Example | Description |
|---------|-------------|
| `template_demo.ts` | Template literal syntax usage |
| `chat_demo.ts` | Interactive chat application |
| `state_management_example.ts` | State management patterns |
| `tabs_ts_demo.ts` | Tabbed interface component |
| `analog_clock_demo.ts` | Canvas-based analog clock |
| `canvas_graphics_demo.ts` | Canvas drawing primitives |
| `list_demo.ts` | List component example |
| `markdown_template_viewer.ts` | Markdown rendering |

```bash
# Run a template example
deno run --allow-all examples/template_demo.ts
```

## .melker File Examples (`melker/`)

See `examples/melker/README.md` for declarative `.melker` template examples.

```bash
# Run a .melker file (requires --unstable-bundle for npm/jsr imports)
deno run --unstable-bundle --allow-all melker.ts examples/melker/counter.melker

# Run from URL
deno run --unstable-bundle --allow-all melker.ts http://localhost:1990/melker/counter.melker
```

## Markdown Examples (`melker-md/`)

See `examples/melker-md/README.md` for markdown files with ASCII box layouts.

```bash
# Run a markdown file directly
deno run --unstable-bundle --allow-all melker.ts examples/melker-md/counter.md

# Convert to .melker format
deno run --unstable-bundle --allow-all melker.ts --convert examples/melker-md/counter.md
```

Features external scripts (`## Scripts` section) and OAuth (`json oauth` blocks).

## Key Patterns Demonstrated

### Element Creation
```typescript
const element = createElement('container', {
  style: { width: 80, height: 24, border: 'thin' },
  id: 'my-container'
},
  createElement('text', { text: 'Hello!' })
);
```

### Event Handling
```typescript
createElement('button', {
  title: 'Click Me',
  onClick: (event: ClickEvent) => {
    console.log('Button clicked!');
  }
})
```

### Automatic Scrolling
```typescript
// Scrolling is automatic for any container with scrollable: true
createElement('container', {
  scrollable: true,
  style: { height: 10 }
}, children);

// Auto-scroll to bottom programmatically
engine.scrollToBottom('container-id');
```

### MelkerEngine Setup
```typescript
const ui = createElement('container', {
  style: { width: 80, height: 24, border: 'thin', padding: 1 }
},
  createElement('text', { text: 'Hello, Melker!' })
);

// Simple setup with excellent defaults
const app = await createApp(ui);
```

**Default options include:**
- `autoResize: true` - Handle terminal resize automatically
- `autoRender: true` - Re-render when UI changes
- `alternateScreen: true` - Use full-screen mode
- `hideCursor: true` - Hide terminal cursor
- `enableEvents: true` - Enable keyboard/mouse events
- `colorSupport: 'truecolor'` - Full color support

### Input Elements
```typescript
// Regular text input
createElement('input', {
  id: 'username',
  placeholder: 'Enter username'
});

// Password input (characters masked with *)
createElement('input', {
  id: 'password',
  format: 'password',
  placeholder: 'Enter password'
});
```

### Automatic Focus Management
```typescript
// Focus is automatic! Elements with types 'input' and 'button'
// are automatically focusable.

createElement('input', {
  id: 'my-input',
  placeholder: 'Type here...'
});

// Tab navigates between focusable elements
// Shift+Tab navigates in reverse
```

## Best Practices

- **Direct event handlers** - Attach events directly to elements
- **Automatic scrolling** - Set `scrollable: true` for mouse wheel handling
- **Automatic focus** - Inputs and buttons are automatically focusable
- **Responsive layouts** - UI adapts to terminal size changes
- **State management** - Update UI by recreating element tree with new state
