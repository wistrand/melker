# Melker

A modern **Deno** library for creating rich Terminal UI interfaces using HTML-like `.melker` files or TypeScript.

## Quick Start with .melker Files

Create a file `hello.melker`:
```html
<container style="width: 40; height: 8; border: thin; padding: 1;">
  <text style="font-weight: bold; color: cyan;">
    Hello, Terminal UI!
  </text>
  <button title="Click Me" onClick="context.exit()" />
</container>
```

Run it:
```bash
deno run --allow-all melker.ts hello.melker
```

That's it! No build step, no compilation - just write HTML-like markup and run.

## How It Works

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           .melker file                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ <container style="border: thin">                                  │  │
│  │   <text>Hello!</text>                                             │  │
│  │   <button title="OK" onClick="handleClick()" />                   │  │
│  │ </container>                                                      │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ parse
┌─────────────────────────────────────────────────────────────────────────┐
│                         melker template                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ melker`<container style=${{border:'thin'}}>...</container>`       │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ transform
┌─────────────────────────────────────────────────────────────────────────┐
│                          createElement                                  │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ createElement('container', {style: {border: 'thin'}},             │  │
│  │   createElement('text', {}, 'Hello!'),                            │  │
│  │   createElement('button', {title: 'OK', onClick: handleClick})    │  │
│  │ )                                                                 │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼ layout + render
┌─────────────────────────────────────────────────────────────────────────┐
│                         Terminal Output                                 │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │ ┌────────────────────┐                                            │  │
│  │ │ Hello!             │                                            │  │
│  │ │ [ OK ]             │                                            │  │
│  │ └────────────────────┘                                            │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

## .melker File Features

### Styling with CSS-like Syntax
```html
<melker>
  <style>
    button { background-color: blue; color: white; }
    #title { font-weight: bold; }
    .highlight { color: yellow; }
  </style>

  <container style="padding: 2;">
    <text id="title">Welcome</text>
    <button title="Start" class="highlight" />
  </container>
</melker>
```

### TypeScript Scripts
```html
<melker>
  <script type="typescript">
    let count = 0;

    function increment() {
      count++;
      const el = context.getElementById('counter');
      el.props.text = `Count: ${count}`;
      context.render();
    }
  </script>

  <container style="border: thin; padding: 1;">
    <text id="counter">Count: 0</text>
    <button title="+" onClick="increment()" />
  </container>
</melker>
```

### Load from URL
```bash
# Serve files locally
deno run --allow-net --allow-read serve.ts examples/melker --port 1990

# Run from URL
deno run --allow-all melker.ts http://localhost:1990/counter.melker
```

## Features

- **HTML-like .melker files** - Write UIs in familiar HTML syntax
- **CSS-like styling** - Use `<style>` tags with selectors
- **TypeScript support** - Inline or external scripts with full type safety
- **Flexbox layout** - Modern layout with flex-direction, flex-wrap, gap
- **Interactive components** - Inputs, buttons, dialogs, menus, file browser
- **Dual-buffer rendering** - Efficient ANSI terminal output
- **Theme support** - Multiple built-in themes (bw, gray, color, fullcolor)
- **LSP support** - Editor integration with diagnostics, completions, hover

## TypeScript API

For more control, use the TypeScript API directly:

### createElement Syntax
```typescript
import { createElement, createApp } from '@melker/core';

const ui = createElement('container', {
  style: { border: 'thin', padding: 2 }
},
  createElement('text', { text: 'Hello!' }),
  createElement('button', { title: 'OK', onClick: () => console.log('clicked') })
);

const app = await createApp(ui);
```

### Template Literal Syntax
```typescript
import { melker, createApp } from '@melker/core';

const ui = melker`
  <container style=${{ border: 'thin', padding: 2 }}>
    <text>Hello!</text>
    <button title="OK" onClick=${() => console.log('clicked')} />
  </container>
`;

const app = await createApp(ui);
```

## Component Types

### Container
Layout container with flexbox support:

```typescript
createElement('container', {
  style: {
    border: 'thin',
    display: 'flex',
    flexDirection: 'column'
  }
},
  /* children as varargs */
  createElement('text', { text: 'Child 1' }),
  createElement('text', { text: 'Child 2' })
);
```

### Text Output
Display text with styling:

```typescript
createElement('text', {
  text: 'Styled text',
  style: {
    color: 'green',
    fontWeight: 'bold',
    backgroundColor: 'black'
  }
});
```

### Input
Single-line text field with full keyboard support:

```typescript
createElement('input', {
  placeholder: 'Enter text...',
  value: '',
  onKeyPress: (event) => {
    if (event.key === 'Enter') {
      console.log('Submitted:', event.target.getValue());
    }
  }
});
```

### Textarea
Multi-line text input with cursor navigation:

```typescript
createElement('textarea', {
  placeholder: 'Enter multi-line text...',
  rows: 5,
  cols: 40,
  value: '',
  onChange: (event) => console.log('Text changed:', event.value)
});
```

### Button
Clickable interactive element:

```typescript
createElement('button', {
  title: 'Click Me',
  onClick: () => console.log('Button clicked!')
});
```

### Menu System
Complete menu bar with dropdown menus:

```typescript
import { createElement } from '@melker/core';

// Menu bar with dropdown menus
createElement('menu-bar', {},
  createElement('menu', { title: 'File' },
    createElement('menu-item', {
      title: 'New',
      shortcut: 'Ctrl+N',
      onClick: () => console.log('New file')
    }),
    createElement('menu-item', {
      title: 'Open',
      shortcut: 'Ctrl+O',
      onClick: () => console.log('Open file')
    }),
    createElement('menu-separator'),
    createElement('menu-item', {
      title: 'Exit',
      onClick: () => process.exit(0)
    })
  ),
  createElement('menu', { title: 'Edit' },
    createElement('menu-item', {
      title: 'Cut',
      shortcut: 'Ctrl+X',
      disabled: true
    }),
    createElement('menu-item', {
      title: 'Copy',
      shortcut: 'Ctrl+C'
    })
  )
);
```

**Features:**
- Keyboard navigation with arrow keys, Enter, and Escape
- Mouse hover effects with underline styling
- Keyboard shortcuts display
- Disabled and checked states
- Automatic overlay rendering (menus appear above other content)

### Template Literal Components
```typescript
const handleSubmit = (value) => console.log('Submitted:', value);

const ui = melker`
  <container style=${{ padding: 2 }}>
    <input
      placeholder="Type here..."
      onKeyPress=${(e) => e.key === 'Enter' && handleSubmit(e.target.getValue())}
    />
    <button title="Submit" onClick=${() => handleSubmit('button click')} />
  </container>
`;
```

## Mouse and Input Limitations

### Mouse Tracking Requirements

Melker supports full mouse tracking (click, move, drag, scroll) but requires specific conditions:

**✅ Mouse tracking works when:**
- Running directly in a terminal: `deno run --allow-all app.ts`
- Terminal supports raw mode (most modern terminals do)
- stdin/stdout are connected to TTY (not redirected)

**❌ Mouse tracking unavailable when:**
- Running through IDEs or development tools (Claude Code, VS Code terminal, etc.)
- Input/output streams are redirected (`app.ts > output.txt`)
- Terminal multiplexers or remote sessions with stream redirection
- Docker containers without proper TTY allocation

**Detection and Fallbacks:**
- Melker automatically detects when mouse tracking isn't available
- Keyboard input always works regardless of TTY status
- Clear warnings explain why mouse tracking failed
- Applications gracefully fall back to keyboard-only operation

```typescript
// Your app will work in both modes automatically
const ui = createElement('container', {},
  createElement('button', {
    title: 'Click or Press Enter',
    onClick: handleAction,      // Mouse click (if available)
    onKeyPress: (e) =>         // Keyboard fallback (always available)
      e.key === 'Enter' && handleAction()
  })
);
```

**Development vs Production:**
- During development (IDEs), expect keyboard-only interaction
- In production (direct terminal), full mouse support is available
- Test both modes to ensure your UI works in all environments

### Text Selection

Melker supports text selection with two modes:

- **Click + Drag**: Text-editor style flow selection within a component (start to end of line, full middle lines, start of line to end position)
- **Alt + Click + Drag**: Rectangular selection across the entire screen (useful for copying UI chrome like borders)

**Copy to Clipboard:** Press `Alt+N` to copy the current selection to the system clipboard.

**Clipboard Requirements:**

The clipboard feature requires a platform-specific command-line tool:

| Platform | Required Package | Install Command |
|----------|-----------------|-----------------|
| Linux (X11) | `xclip` or `xsel` | `sudo pacman -S xclip` (Arch) / `sudo apt install xclip` (Debian/Ubuntu) |
| Linux (Wayland) | `wl-clipboard` | `sudo pacman -S wl-clipboard` (Arch) / `sudo apt install wl-clipboard` (Debian/Ubuntu) |
| macOS | `pbcopy` | Pre-installed |
| WSL2 | `clip.exe` | Pre-installed |

## Advanced Styling

### Individual Border Control
```typescript
createElement('container', {
  style: {
    borderBottom: 'thin',    // Only bottom border
    borderColor: 'cyan',
    padding: 1
  }
});
```

### Style Inheritance
Only specific properties inherit from parent to child:
- ✅ `color` - Text color
- ✅ `backgroundColor` - Background color
- ✅ `fontWeight` - Typography weight
- ✅ `borderColor` - Border color consistency
- ❌ `border`, `padding`, `margin` - Element-specific properties

```typescript
createElement('container', {
  style: { color: 'cyan', fontWeight: 'bold' }
},
  createElement('text', {
    text: 'This inherits cyan color and bold weight'
  })
);
```

## Layout System

### Flexbox Layout
```typescript
createElement('container', {
  style: {
    width: 80,
    height: 20,
    display: 'flex',
    flexDirection: 'row',
    justifyContent: 'space-between'
  }
},
  createElement('text', {
    text: 'Left',
    style: { flex: 1 }
  }),
  createElement('text', {
    text: 'Right',
    style: { flex: 1 }
  })
);
```

### Flex-Wrap Support
Create multi-column layouts that adapt to terminal size:

```typescript
// Creates multiple columns when terminal height is insufficient
createElement('container', {
  style: {
    display: 'flex',
    flexDirection: 'column',
    flexWrap: 'wrap',
    height: 'fill'
  }
},
  createElement('text', { text: 'Item 1' }),
  createElement('text', { text: 'Item 2' }),
  createElement('text', { text: 'Item 3' }),
  // ... more items
);
```

**How it works:**
- Items use intrinsic sizes when wrapping is enabled
- Multiple columns/rows are created when content doesn't fit
- Columns are positioned correctly on screen without stretching
- Works with both row and column flex directions

## Themes

Melker includes multiple built-in themes that can be selected via the `MELKER_THEME` environment variable:

### Available Themes
- **bw-std**: Black and white, standard (light) mode - maximum compatibility
- **bw-dark**: Black and white, dark mode
- **gray-std**: Grayscale, standard (light) mode
- **gray-dark**: Grayscale, dark mode
- **color-std**: Basic ANSI colors, standard mode
- **color-dark**: Basic ANSI colors, dark mode
- **fullcolor-std**: Full color palette, standard mode
- **fullcolor-dark**: Full color palette, dark mode

### Gray Theme Enforcement

The gray themes enforce grayscale conversion for all colors, including manually set color styles:

```typescript
// Even with explicit colors...
createElement('text', {
  text: 'This text',
  style: { color: '#ff0000' }  // Bright red
});

// When running with MELKER_THEME=gray-std or gray-dark,
// colors are automatically converted to nearest gray equivalent
```

**Conversion Details:**
- Uses luminance-based algorithm for hex colors: `0.299*R + 0.587*G + 0.114*B`
- Uses brightness mapping for named ANSI colors
- Maps all colors to 4 gray levels: `black`, `brightBlack`, `gray`, `white`
- **gray-std**: Light background theme (white background, dark text)
- **gray-dark**: Dark background theme (black background, light text)

This ensures consistent grayscale appearance across all UI elements, even those with explicitly set colors.

## Development

### Requirements
- Deno 1.40+
- ANSI-compatible terminal

### Commands
```bash
# Type check
deno task check

# Run tests
deno task test

# Run tests with watch mode
deno task test:watch

# Generate test coverage
deno task test:coverage

# Run example with different themes
MELKER_THEME=fullcolor-dark deno run --allow-env examples/chat_demo.ts
MELKER_THEME=bw-std deno run --allow-env examples/template_demo.ts

# Run in headless mode for testing
MELKER_HEADLESS=true deno run --allow-env examples/chat_demo.ts

# Enable debug server
MELKER_DEBUG_PORT=8080 deno run --allow-net --allow-env examples/chat_demo.ts
```

### Environment Variables
- `MELKER_THEME`: Set theme (`bw-std`, `gray-dark`, `color-std`, `fullcolor-dark`, etc.)
- `MELKER_HEADLESS`: Enable headless mode for testing (`true`/`false`)
- `MELKER_DEBUG_PORT`: Enable debug server on specified port
- `MELKER_NO_ALTERNATE_SCREEN`: Disable alternate screen mode for debugging
- `MELKER_LINT`: Enable lint mode for validation (`true`/`1`)

### Project Structure
```
src/
├── melker.ts           # Main entry point, exports
├── melker-main.ts      # .melker file runner (supports URLs)
├── lint.ts             # Lint mode validation, schemas
├── lsp.ts              # Language Server Protocol for .melker files
├── types.ts            # Core type definitions
├── element.ts          # Element creation, component registry
├── template.ts         # Template literal system, .melker parsing
├── input.ts            # Terminal input processing
├── layout.ts           # Flexbox layout engine
├── engine.ts           # Main application engine
├── buffer.ts           # Dual-buffer system
├── renderer.ts         # ANSI terminal rendering
├── document.ts         # Document model, element registry
├── rendering.ts        # Render pipeline, overlays
├── sizing.ts           # Box model calculations
├── viewport.ts         # Viewport management for scrolling
├── viewport-buffer.ts  # Viewport buffer proxies
├── content-measurer.ts # Content size measurement
├── theme.ts            # Theming system
├── focus.ts            # Focus management
├── events.ts           # Event system
├── resize.ts           # Terminal resize handling
├── logging.ts          # File-based logging
├── headless.ts         # Headless mode for testing
├── debug-server.ts     # WebSocket debug server
├── components/         # UI Components
│   ├── container.ts    # Layout container
│   ├── text.ts         # Text display
│   ├── input.ts        # Single-line text input
│   ├── textarea.ts     # Multi-line text input
│   ├── button.ts       # Buttons
│   ├── dialog.ts       # Modal dialogs
│   ├── file-browser.ts # File system navigation
│   ├── menu-bar.ts     # Menu bar container
│   ├── menu.ts         # Dropdown menu
│   ├── menu-item.ts    # Menu entry
│   ├── menu-separator.ts # Menu divider
│   ├── checkbox.ts     # Checkboxes
│   ├── radio.ts        # Radio buttons
│   ├── list.ts         # List container
│   ├── li.ts           # List item
│   ├── canvas.ts       # Pixel graphics
│   ├── video.ts        # Video playback
│   └── markdown.ts     # Markdown rendering
└── video/              # Video processing
    ├── ffmpeg.ts       # FFmpeg integration
    ├── dither.ts       # Dithering algorithms
    └── subtitle.ts     # Subtitle handling
```

## Architecture Highlights

- **Template Literal System**: HTML-style syntax with expression interpolation
- **Advanced Layout Engine**: Unified layout system using flexbox with flex-wrap support
- **Menu Overlay System**: Dropdown menus render as overlays after normal content for proper z-ordering
- **Comprehensive Input Handling**: Raw terminal input with keyboard and mouse support
- **Border-Box Sizing**: Consistent sizing model where borders are included in dimensions
- **Whitelist Inheritance**: Predictable style cascading with explicit control
- **Dual-Buffer System**: Efficient terminal rendering with minimal ANSI escape sequences
- **Environment-Driven Theming**: Multiple built-in themes with grayscale enforcement for gray themes
- **Headless Testing**: Virtual terminal support for automated testing and CI
- **Debug Server**: WebSocket-based debugging for remote development
- **File-Based Logging**: Structured logging system that doesn't interfere with terminal UI

## Examples

See `examples/` directory for complete demos:

### .melker Files (`examples/melker/`)
- `counter.melker` - Basic counter with state management
- `hello.melker` - Simple hello world
- `dialog_demo.melker` - Modal dialog system
- `menu_example.melker` - Menu bar and dropdowns
- `flex-demo.melker` - Flexbox layout showcase
- `analog-clock.melker` - Canvas animation

### TypeScript with createElement (`examples/ts/`)
- `minimal_example.ts` - Simplest possible example
- `interactive_demo.ts` - Event handling, state updates
- `file_browser_demo.ts` - File system navigation
- `form_demo.ts` - Radio buttons, checkboxes
- `theme_demo.ts` - Theme system showcase

### TypeScript with melker templates (`examples/`)
- `template_demo.ts` - Template literal syntax
- `chat_demo.ts` - Interactive chat application

### Running Examples
```bash
# Run .melker file
deno run --allow-all melker.ts examples/melker/counter.melker

# Pass arguments to .melker file (available as ${argv[1]}, ${argv[2]}, etc.)
deno run --allow-all melker.ts examples/melker/markdown_viewer.melker README.md

# Run .melker from URL
deno run --allow-all melker.ts http://localhost:1990/melker/counter.melker

# Run TypeScript example
deno run --allow-all examples/ts/minimal_example.ts
```

## License

MIT License - see LICENSE file for details.