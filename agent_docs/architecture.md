# Architecture

## Core Concepts

- **Document Model**: HTML-inspired elements with React-like createElement pattern, JSON serializable
- **Dual-Buffer Rendering**: Character buffer + style buffer for efficient ANSI output
- **Flexbox Layout**: Single layout engine with flex-wrap, border-box sizing
- **Theming**: Environment-driven via `MELKER_THEME` (bw, gray, color, fullcolor variants)

## Components

| Component | File | Notes |
|-----------|------|-------|
| Container | `src/components/container.ts` | Flexbox layout, scrolling |
| Text | `src/components/text.ts` | Text display with wrapping |
| Input | `src/components/input.ts` | Single-line text input |
| Textarea | `src/components/textarea.ts` | Multi-line text input with cursor |
| Button | `src/components/button.ts` | Uses `title` prop (not `label`) |
| Dialog | `src/components/dialog.ts` | Modal overlay |
| File Browser | `src/components/file-browser.ts` | File system navigation |
| Menu Bar | `src/components/menu-bar.ts` | Horizontal menu container |
| Menu | `src/components/menu.ts` | Dropdown menu |
| Menu Item | `src/components/menu-item.ts` | Menu entry |
| Menu Separator | `src/components/menu-separator.ts` | Visual separator in menus |
| Canvas | `src/components/canvas.ts` | Pixel graphics via sextant chars, onPaint, dither modes |
| Video | `src/components/video.ts` | Video playback (extends Canvas) |
| Markdown | `src/components/markdown.ts` | Markdown text rendering |
| Checkbox | `src/components/checkbox.ts` | Toggle checkbox |
| Radio | `src/components/radio.ts` | Radio button |
| List | `src/components/list.ts` | List container |
| Li | `src/components/li.ts` | List item |

**Utilities:**
- `src/components/mod.ts` - Component exports
- `src/components/color-utils.ts` - RGBA color packing/unpacking, CSS parsing

## Key Files

| File | Purpose |
|------|---------|
| `src/engine.ts` | Main application engine, lifecycle, event handling |
| `src/layout.ts` | Flexbox layout calculations |
| `src/rendering.ts` | Render pipeline, overlay handling |
| `src/buffer.ts` | Dual-buffer system |
| `src/renderer.ts` | ANSI terminal output |
| `src/focus.ts` | Focus management, tab navigation |
| `src/theme.ts` | Theming system, color palettes |
| `src/input.ts` | Raw terminal input, mouse events |
| `src/template.ts` | Template literal syntax, .melker file parsing |
| `src/element.ts` | Element creation, component registry |
| `src/document.ts` | Document class, element registry, focus |
| `src/events.ts` | Event system, EventManager |
| `src/types.ts` | Core type definitions |
| `src/sizing.ts` | Box model, border-box sizing |
| `src/viewport.ts` | Viewport management for scrolling |
| `src/viewport-buffer.ts` | Viewport buffer proxies |
| `src/content-measurer.ts` | Content size measurement |
| `src/resize.ts` | Terminal resize handling |
| `src/stylesheet.ts` | CSS-like stylesheet system |
| `src/serialization.ts` | Element serialization/deserialization |
| `src/logging.ts` | File-based logging system |
| `src/debug-server.ts` | WebSocket debug server |
| `src/headless.ts` | Headless mode for testing |
| `melker.ts` | Main entry point, exports |
| `src/melker-main.ts` | .melker file runner (supports URLs) |
| `src/lint.ts` | Lint mode validation, schemas |
| `src/lsp.ts` | Language Server Protocol for .melker files |

**Video Processing (`src/video/`):**
| File | Purpose |
|------|---------|
| `src/video/mod.ts` | Video module exports |
| `src/video/ffmpeg.ts` | FFmpeg integration |
| `src/video/dither.ts` | Dithering algorithms (auto, sierra-stable, floyd-steinberg, ordered) |
| `src/video/subtitle.ts` | Subtitle handling |
| `src/video/waveform.ts` | Audio waveform visualization |

## Style Inheritance

Only these properties inherit to children:
- `color`
- `backgroundColor`
- `fontWeight`
- `borderColor`

Element-specific properties (borders, padding, margin) do NOT cascade.

## Logging

**CRITICAL**: Never use `console.log()` - it interferes with terminal UI.

Use file-based logging:
```typescript
import { getLogger } from './logging.ts';
const logger = getLogger('MyComponent');
logger.debug('message', { context });
```

Configure via `MELKER_LOG_FILE` and `MELKER_LOG_LEVEL` env vars.
