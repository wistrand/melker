# Server Architecture

WebSocket-based server providing a browser UI for remote inspection and automation of Melker applications.

## Overview

The server (`src/server.ts`) exposes a web interface for:
- Real-time terminal mirroring
- Element inspection and highlighting
- Event injection (keyboard, mouse, custom events)
- Log streaming
- Engine state monitoring

## File Structure

```
src/
├── server.ts      # Server implementation, WebSocket handling
└── server-ui/
    ├── index.html      # HTML structure
    ├── index.css       # Styles (dark theme, VS Code inspired)
    └── index.js        # Client-side logic, WebSocket, rendering
```

## Enabling the Server

```bash
# Basic usage
./melker.ts --server-port 8080 app.melker

# With explicit token
./melker.ts --server-port 8080 --server-token mytoken app.melker

# With remote input enabled (non-headless)
./melker.ts --server-port 8080 --server-allow-input app.melker
```

Access at: `http://localhost:8080/?token=<token>`

## Web UI Layout

```
┌────────────────────────────────────────────────────────────┐
│ Header: Melker Debug | [●] Connected | Input: Enabled      │
├────────────────────────────────────────────────────────────┤
│                                                            │
│                    Terminal Mirror                         │
│                (Full width, primary focus)                 │
│            Click + keyboard when focused (if enabled)      │
│                                                            │
├────────────────────────────────────────────────────────────┤
│ ┌──────────┬──────────┬──────────┬──────────┐    [▼]      │
│ │ Elements │ Events   │ Logs     │ State    │             │
│ ├──────────┴──────────┴──────────┴──────────┴─────────────┤
│ │   [Active tab content - resizable via drag handle]      │
│ └──────────────────────────────────────────────────────────┘
└────────────────────────────────────────────────────────────┘
```

## Tab Panels

### Elements Tab

Inspect the document tree with live highlighting.

**Features:**
- Collapsible document tree with expand/collapse all
- Click element to select and highlight bounds on terminal
- Hover element to preview highlight
- "Track Mouse" mode: hover on terminal to inspect elements
- Shift-click on terminal to reveal element in tree
- Props and bounds display for selected element

**Tree Interactions:**
| Action                    | Result                                    |
|---------------------------|-------------------------------------------|
| Click tree node           | Select element, show highlight            |
| Hover tree node           | Preview highlight on terminal             |
| Click expand/collapse     | Toggle children visibility                |
| Enable "Track Mouse"      | Inspect by hovering on terminal           |
| Shift-click on terminal   | Reveal and select element in tree         |

### Events Tab

Inject events and view event history.

**Features:**
- Named event dispatch with JSON payload
- Modifier key toggles (Ctrl, Alt, Shift)
- Quick key buttons: Tab, Shift+Tab, Enter, Escape, Arrows, F1-F12
- Event history log with timestamps

### Logs Tab

Real-time log streaming from the application.

**Features:**
- Level filtering (DEBUG, INFO, WARN, ERROR)
- Auto-scroll to latest entries
- Clear button
- Entry count display

### State Tab

Engine and connection state monitoring.

**Cards:**
- **Engine**: Running status, element count, focused element
- **Terminal**: Size, headless mode, input status
- **Connection**: WebSocket status, retry count
- **Actions**: Force Render button

## WebSocket Protocol

### Message Types (Client → Server)

| Message Type           | Data                              | Purpose                          |
|------------------------|-----------------------------------|----------------------------------|
| `get-buffer`           | -                                 | Request buffer snapshot          |
| `get-document-tree`    | -                                 | Request element tree             |
| `get-engine-state`     | -                                 | Request engine state             |
| `get-element-bounds`   | `{ elementId }`                   | Get element layout bounds        |
| `get-element-at`       | `{ x, y }`                        | Get element at coordinates       |
| `dispatch-named-event` | `{ name, detail? }`               | Dispatch custom event            |
| `inject-click`         | `{ x, y, button }`                | Inject mouse click               |
| `inject-key`           | `{ key, code, modifiers, type }`  | Inject keyboard event            |
| `trigger-render`       | -                                 | Force re-render                  |
| `subscribe`            | `{ subscriptions: [...] }`        | Subscribe to update types        |
| `unsubscribe`          | `{ subscriptions: [...] }`        | Unsubscribe from updates         |

### Message Types (Server → Client)

| Message Type                  | Data                        | Purpose                    |
|-------------------------------|-----------------------------|----------------------------|
| `welcome`                     | `{ capabilities }`          | Connection established     |
| `buffer-snapshot-rle`         | RLE-compressed buffer       | Full buffer (compressed)   |
| `buffer-delta`                | Changed cells only          | Incremental update         |
| `document-tree`               | `{ tree }`                  | Element tree structure     |
| `engine-state`                | State object                | Engine status              |
| `response`                    | Request-specific data       | Response to queries        |
| `render-notifications-update` | -                           | Re-render occurred         |
| `log-stream-update`           | Log entry                   | New log entry              |
| `terminal-resize-update`      | `{ width, height }`         | Terminal resized           |

### Subscriptions

| Type                   | Updates                              |
|------------------------|--------------------------------------|
| `render-notifications` | Notified on each re-render           |
| `buffer-updates`       | Buffer content changes               |
| `engine-state`         | Engine state changes                 |
| `terminal-resize`      | Terminal size changes                |
| `log-stream`           | Log entries                          |
| `event-stream`         | Input events                         |

## Buffer Transmission

### RLE Compression

Full buffer snapshots use run-length encoding for efficiency:

```json
{
  "width": 120,
  "height": 40,
  "styles": [
    { "f": "#ffffff", "b": "#000000" },
    { "f": "#ff0000", "o": true }
  ],
  "rows": {
    "0": [[0, 10, " ", 0], [10, 5, "H", 1], ...],
    "1": [...]
  }
}
```

Each run: `[startX, length, char, styleIndex]`

### Delta Updates

When <30% of cells change, only changed cells are sent:

```json
{
  "styles": [...],
  "rows": {
    "5": [[10, "X", 0], [11, "Y", 1]],
    "6": [[0, "Z", 0]]
  }
}
```

Each cell: `[x, char, styleIndex]`

## Security Model

### Token Authentication

All connections require a valid token:

```
http://localhost:8080/?token=<token>
ws://localhost:8080/?token=<token>
```

**Token sources (priority order):**
1. `--server-token` CLI flag (also settable via `MELKER_SERVER_TOKEN` env var)
2. Auto-generated UUID (displayed at startup)

Requests without valid token receive 401 Unauthorized.

### Event Injection

Event injection (keyboard, mouse, custom events) requires one of:
- Headless mode (`--headless`)
- Explicit opt-in (`--server-allow-input`)

The UI displays input status prominently:
- Green "Input: Enabled" when allowed
- Orange "Input: Disabled" when blocked

## Engine Integration

### Required Engine Methods

```typescript
// Dispatch custom named events
engine.dispatchNamedEvent(name: string, detail?: unknown): void

// Get element layout bounds
engine.getElementBounds(elementId: string): { x, y, width, height } | null

// Get element at screen coordinates (hit testing)
engine.getElementAt(x: number, y: number): { id, type, bounds, props } | null
```

### Buffer Access

The server accesses the display buffer via:
```typescript
const buffer = engine.getBuffer();
const displayBuffer = buffer.getDisplayBuffer();
const cell = displayBuffer.getCell(x, y);
```

## Highlight System

Element highlighting uses dynamically measured character dimensions:

```javascript
// Measure from actual rendered characters
const charEl = document.querySelector('.terminal-char');
const rect = charEl.getBoundingClientRect();
measuredCharWidth = rect.width;
measuredLineHeight = rect.height;

// Calculate highlight position
const left = bounds.x * charWidth + padding;
const top = bounds.y * lineHeight + padding;
```

Measurements are cached and invalidated on terminal re-render.

## Keyboard Shortcuts

| Shortcut    | Action              |
|-------------|---------------------|
| Ctrl+1      | Switch to Elements  |
| Ctrl+2      | Switch to Events    |
| Ctrl+3      | Switch to Logs      |
| Ctrl+4      | Switch to State     |
| Shift+Click | Inspect element     |

## Configuration

| CLI Flag               | Env Variable                 | Purpose                                      |
|------------------------|------------------------------|----------------------------------------------|
| `--server-port`        | `MELKER_SERVER_PORT`         | Server port (enables server)                 |
| `--server-token`       | `MELKER_SERVER_TOKEN`        | Connection token (auto-generated if not set) |
| `--server-allow-input` | `MELKER_ALLOW_SERVER_INPUT`  | Allow event injection in non-headless mode   |

## See Also

- [debugging.md](debugging.md) - General debugging guide
- [project-structure.md](project-structure.md) - File locations
- [architecture.md](architecture.md) - Core engine architecture
