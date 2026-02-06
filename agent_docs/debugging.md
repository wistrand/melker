# Debugging Melker Applications

## Console Logging (App Code Only)

**Important:** This section applies to **app code** (`.melker` files, examples). For **Melker internal development** (files in `src/`, `mod.ts`, `melker-*.ts`), see the "Logging System" section below - `console.log()` is **strictly forbidden** in Melker source code.

In Melker scripts, `console.log()` is automatically redirected to `$melker.logger.info()`, so it won't break the TUI. Objects are formatted using `Deno.inspect()` for safe, readable output.

```javascript
// All safe - redirected to logger
console.log("debug info");
console.log("user:", { name: "John" });  // objects formatted nicely
console.warn("warning");
console.error("error");
```

**Mapping:**
- `console.log`, `console.info` → `$melker.logger.info()`
- `console.warn` → `$melker.logger.warn()`
- `console.error` → `$melker.logger.error()`
- `console.debug` → `$melker.logger.debug()`

**Disable override** (for debugging, outputs to terminal):
```bash
./melker.ts --no-console-override app.melker
# or
MELKER_NO_CONSOLE_OVERRIDE=1 ./melker.ts app.melker
```

For more control, use the logger directly:

## Logging System (`src/logging.ts`)

**CRITICAL for Melker Development:** When working on Melker's internal code (files in `src/`, `mod.ts`, `melker-*.ts`), you **MUST** use the logging system. **NEVER use `console.log()` in Melker source code** - this is strictly forbidden. Only app code (`.melker` files, examples) can use the overridden `console.log()`.

### Basic Usage

```typescript
import { getLogger } from './logging.ts';

const logger = getLogger('MyComponent');

logger.debug('Debug message', { data: 'value' });
logger.info('Info message');
logger.warn('Warning message');
logger.error('Error message');
```

### Log Levels

| Level   | Use For                                   |
|---------|-------------------------------------------|
| `TRACE` | Very detailed tracing, performance paths  |
| `DEBUG` | Detailed debugging info, variable dumps   |
| `INFO`  | General operational messages              |
| `WARN`  | Potential issues, recoverable errors      |
| `ERROR` | Errors that need attention                |
| `FATAL` | Critical errors, application termination  |

Log level names are **case-insensitive** on the CLI (`--log-level=debug` works).

### Configuration

Use CLI flags (highest priority), environment variables, or config file:

```bash
# Via CLI flags (highest priority)
./melker.ts --log-file /tmp/debug.log --log-level DEBUG app.melker

# Via environment variables
MELKER_LOG_FILE=/tmp/debug.log MELKER_LOG_LEVEL=DEBUG ./melker.ts app.melker

# Via config file (~/.config/melker/config.json)
# { "log": { "level": "DEBUG", "file": "/tmp/debug.log" } }

# Show current config with sources
./melker.ts --print-config
```

Priority order: `default < policy < file < env < cli`

### Log Output Format

Logs are written in structured format:
```
2024-01-15T10:30:45.123Z [DEBUG] MyComponent: Message here | key="value", count=42
```

### Default Log Location

If not configured: `~/.cache/melker/logs/melker.log`

### In-Memory Log Buffer

Log entries are also kept in an in-memory FIFO buffer for the DevTools Log tab. Configure the buffer size:

```bash
# Via environment variable
MELKER_LOG_BUFFER_SIZE=1000 ./melker.ts app.melker

# Via config file (~/.config/melker/config.json)
# { "log": { "bufferSize": 1000 } }
```

Default: 500 entries, range: 10-10000.

Access programmatically:
```typescript
import { getRecentLogEntries, clearLogBuffer, getLogBufferSize } from './logging.ts';

const entries = getRecentLogEntries();      // Get all entries
const last100 = getRecentLogEntries(100);   // Get last 100 entries
clearLogBuffer();                            // Clear the buffer
const size = getLogBufferSize();             // Current entry count
```

## Performance Dialog (`src/performance-dialog.ts`)

A built-in movable, non-modal dialog showing live performance statistics.

### Toggle

Press `F6` to toggle visibility (also: `F10`, `F11`, `Shift+F12`).

### Features

- **Draggable**: Click and drag the title bar to move
- **Non-modal**: Doesn't block UI interaction
- **Live stats**: Updates on every render

### Displayed Metrics

| Metric     | Description                                 |
|------------|---------------------------------------------|
| Max FPS    | Theoretical max FPS (1000 / avgRenderTime)  |
| Renders/s  | Actual renders per second (activity rate)   |
| Render     | Last render time (ms)                       |
| Render avg | Average render time over 60 frames          |
| Layout     | Last layout time (ms)                       |
| Layout avg | Average layout time over 60 frames          |
| Input lat  | Input-to-render latency (ms)                |
| Input avg  | Average input latency over 60 samples       |
| Breakdown  | Latency breakdown (h+w+l+b+a)               |
| Nodes      | Number of layout nodes                      |
| Cells      | Changed/total buffer cells                  |
| Memory     | Estimated memory usage                      |
| Renders    | Total render count                          |
| Errors     | Component error count                       |

### Input Latency Breakdown

The `h+w+l+b+a` format shows (each padded to 2 chars for stability):
- **h** (handler): Time in event handler (ms)
- **w** (wait): Debounce wait time (ms)
- **l** (layout): Layout calculation time (ms)
- **b** (buffer): Buffer rendering time (ms)
- **a** (apply): Terminal output time (ms)

Example: ` 1+16+ 2+ 1+ 0` = 1ms handler + 16ms wait + 2ms layout + 1ms buffer + 0ms apply

### Color Coding

- **Green**: Good performance (Max FPS >= 60, render < 16ms)
- **Yellow**: Acceptable (Max FPS 30-60, render 16-33ms)
- **Red**: Needs attention (Max FPS < 30, render > 33ms)

## Headless Mode (`src/headless.ts`)

Run Melker apps without a real terminal - useful for testing and CI.

### Enable Headless Mode

```bash
MELKER_HEADLESS=true ./melker.ts app.melker
```

### Features

- **Virtual terminal** - Default 80x24, configurable
- **Output capture** - All terminal output stored for inspection
- **Event injection** - Simulate keyboard/mouse via server
- **Resizable** - Change virtual terminal size at runtime

### Headless + Server

Combine for remote testing:
```bash
MELKER_HEADLESS=true ./melker.ts --server-port 8080 app.melker
```

## Server (`src/server.ts`)

WebSocket server for remote debugging and automation with a full-featured web UI.

### Enable Server

```bash
./melker.ts --server-port 8080 app.melker
```

Access at: `http://localhost:8080/?token=<token>` (web UI) or `ws://localhost:8080/?token=<token>` (WebSocket)

The token is auto-generated at startup and displayed in the terminal. You can also set it explicitly:
```bash
./melker.ts --server-port 8080 --server-token mytoken app.melker
```

### Web UI Features

The server provides a browser-based interface with:

**Terminal Mirror (Primary View)**
- Real-time terminal rendering with full ANSI color support
- Click to inject mouse events (when input enabled)
- Keyboard input forwarding (when terminal focused)
- Shift-click to inspect element at coordinates

**Tabbed Panels**

| Tab      | Features                                                    |
|----------|-------------------------------------------------------------|
| Elements | Document tree, expand/collapse, click to select, hover to highlight, mouse tracking mode |
| Events   | Named event dispatch, quick keys (Tab/Enter/Esc/arrows), modifier toggles, event history |
| Logs     | Real-time log streaming, level filtering (DEBUG/INFO/WARN/ERROR) |
| State    | Engine state, terminal size, connection status, force render action |

**Element Inspector**
- Click element in tree to highlight bounds on terminal
- Hover element in tree to preview highlight
- Enable "Track Mouse" to inspect elements by hovering on terminal
- Shift-click on terminal to reveal element in tree

**Keyboard Shortcuts**
- `Ctrl+1/2/3/4` - Switch tabs
- Click collapse button to minimize panel
- Drag resize handle to adjust panel height

### Available Commands

Send JSON messages via WebSocket:

| Command                | Purpose                                   |
|------------------------|-------------------------------------------|
| `get-engine-state`     | Get engine status, element count, focus   |
| `get-buffer`           | Get current buffer snapshot (RLE or delta)|
| `get-document-tree`    | Get element tree structure                |
| `get-element-bounds`   | Get layout bounds for an element          |
| `get-element-at`       | Get element at (x, y) coordinates         |
| `dispatch-named-event` | Dispatch custom named event               |
| `inject-click`         | Inject mouse click                        |
| `inject-key`           | Inject keyboard event                     |
| `trigger-render`       | Force a re-render                         |
| `get-headless-status`  | Headless mode info                        |
| `get-terminal-output`  | Get captured terminal output              |

### Event Injection

Event injection requires either headless mode or the `--server-allow-input` flag:

```bash
# Enable remote input for non-headless mode
./melker.ts --server-port 8080 --server-allow-input app.melker
```

### Subscriptions

Subscribe to real-time updates:
- `render-notifications` - Notified on each re-render (push-based, no polling)
- `buffer-updates` - Buffer changes
- `engine-state` - State changes
- `terminal-resize` - Terminal size changes
- `log-stream` - Log entries
- `event-stream` - Input events

## Debugging Workflow

### 1. Enable Logging
```bash
MELKER_LOG_FILE=/tmp/app.log MELKER_LOG_LEVEL=DEBUG ./melker.ts app.melker
```

### 2. Watch Log File
```bash
tail -f /tmp/app.log
```

### 3. Watch Mode for Development
```bash
# Auto-reload on file changes (local files only)
MELKER_LOG_FILE=/tmp/app.log MELKER_LOG_LEVEL=DEBUG ./melker.ts --watch app.melker
```

Watch mode monitors the source file and automatically reloads the application when changes are detected. File change events are logged to the log file.

### 4. Use Server for Interaction
```bash
# In another terminal
MELKER_LOG_FILE=/tmp/app.log ./melker.ts --server-port 8080 app.melker
```

### 5. Disable Alternate Screen (See Raw Output)
```bash
MELKER_NO_ALTERNATE_SCREEN=1 ./melker.ts app.melker
```

This keeps output in main buffer for scrollback review.

### 6. Stdout Mode (Single Frame Output)

Output a rendered frame directly to stdout without any terminal control:

```bash
# Basic stdout mode (waits 500ms, then outputs and exits)
./melker.ts --stdout --trust app.melker

# Custom timeout (100ms)
./melker.ts --stdout --stdout-timeout 100 --trust app.melker

# Custom dimensions (60x20) - defaults to terminal size if not specified
./melker.ts --stdout --stdout-width 60 --stdout-height 20 --trust app.melker

# Black and white output (no colors)
MELKER_THEME=bw-std ./melker.ts --stdout --trust app.melker

# Pipe to file or other tools
./melker.ts --stdout --trust app.melker > output.txt

# Trim trailing spaces and newlines from output
./melker.ts --stdout --stdout-trim=both --trust app.melker

# Force ANSI colors when piping (e.g., to less -R)
./melker.ts --color=always --trust app.melker | less -R
```

**CLI Flags:**

| Flag               | Description                                       |
|--------------------|---------------------------------------------------|
| `--stdout`         | Enable stdout mode                                |
| `--stdout-width`   | Output width in columns (default: terminal width) |
| `--stdout-height`  | Output height in rows (default: terminal height)  |
| `--stdout-timeout` | Wait time in ms before output (default: 500)      |
| `--stdout-trim`    | Trim output: `none`, `right`, `bottom`, `both`    |
| `--color`          | ANSI color output: `auto`, `always`, `never`      |
| `--interactive`    | Force TUI mode even when piped                    |

**Environment Variables:**

| Variable                | Description                                     |
|-------------------------|-------------------------------------------------|
| `MELKER_STDOUT_WIDTH`   | Output width in columns                         |
| `MELKER_STDOUT_HEIGHT`  | Output height in rows                           |
| `MELKER_STDOUT_TIMEOUT` | Wait time in ms before output                   |
| `MELKER_STDOUT_TRIM`    | Trim output: `none`, `right`, `bottom`, `both`  |
| `MELKER_STDOUT_COLOR`   | ANSI color: `auto`, `always`, `never`           |
| `MELKER_THEME`          | Use `bw-std` for black and white output         |

**Color modes:**
- `--color=auto` (default): Strip ANSI when piped (not a TTY), keep when TTY
- `--color=always`: Force ANSI colors even when piped
- `--color=never`: Strip ANSI colors even on TTY

**Features:**
- Terminal stays in normal mode (no raw mode, no alternate screen)
- No terminal detection queries (sixel/kitty)
- No input reading or resize handling
- Output uses ANSI style sequences (colors, bold) but NO cursor positioning
- Each row printed as a line with newline separator
- App exits immediately after output
- Auto-detects non-TTY and enables stdout mode (use `--interactive` to override)

**Use cases:**
- Quick visual debugging of layout issues
- Capturing rendered output for comparison/testing
- Piping output to other tools for analysis
- CI/automated testing of visual output

## Common Debug Scenarios

### Permission Issues

**Env var access denied warnings:**
When your app tries to read an env var it doesn't have permission for, a warning is logged once per var:
```
[Env] WARN: Access denied for env var: MY_VAR (add to policy permissions or configSchema)
```

Fix by either:
1. Adding to policy permissions: `"env": ["MY_VAR"]`
2. Adding to configSchema (auto-adds permission): `"configSchema": { "my.key": { "env": "MY_VAR" } }`

### Layout Issues
- Enable DEBUG logging to see layout calculations
- Check bounds in log: `Bounds calculated for button | bounds={"x":2,"y":7,"width":16,"height":1}`

### Event Issues
- Use server to inject events
- Check hit testing logs: `Hit test triggered | mouseX=10, mouseY=5`

### Focus Issues
- Look for focus registration: `Successfully registered focusable element: myButton`
- Check focus changes in logs

### Rendering Issues
- Use `MELKER_NO_ALTERNATE_SCREEN=1` to see raw ANSI output
- Use server's `get-buffer` to inspect buffer state

### Video Exit Issues (Garbage on Exit)
If video frame data (sextant characters) appears on the terminal after exit:
- This is a race condition: video frame renders after alternate screen exit
- The engine has render guards that check `_isInitialized` before `writeSync()`
- Guards are in `render()`, `forceRender()`, `_renderOptimized()`, `_renderFullScreen()`
- See `src/engine.ts` for details on render guards

## Dev Tools (F12)

Press **F12** at runtime to open the Dev Tools dialog.

### Tabs

| Tab      | Description                                                        |
|----------|--------------------------------------------------------------------|
| Help     | App help text (if provided)                                        |
| Source   | Original `.melker` source or converted content for `.md` files     |
| Policy   | App permissions and Deno flags                                     |
| Markdown | Original markdown (for `.md` files only)                           |
| System   | Build info, scripts, bundle details                                |
| Config   | Current configuration with sources (schema + app-defined)          |
| Inspect  | Live document tree view with Refresh button                        |
| Log      | Recent log entries in data-table with sorting, shows log file path |
| Actions  | Performance Monitor, Exit Application                              |

### Features

- Scrollable content areas with keyboard navigation
- Tab buttons clickable with mouse or keyboard
- **AI Assistant button**: Opens the AI accessibility dialog
- **Config tab**: Shows same info as `--print-config` - schema config plus app-defined config from policy (shown under `[Category (app)]` sections)
- Close with button click, Escape key, or F12 toggle

### Enabling Dev Tools

The engine's `setSource()` method must be called with the source content:

```typescript
const engine = await createApp(root);
engine.setSource(sourceContent, '/path/to/file.melker', 'melker');
// or for markdown files (with converted content for Source tab):
engine.setSource(mdContent, '/path/to/file.md', 'md', convertedMelkerContent);
```

The `melker-runner.ts` runner automatically enables this for `.melker` and `.md` files.

### Implementation

Dev Tools is managed by `DevToolsManager` (`src/dev-tools.ts`):
- Creates a dialog overlay with tabbed content
- Config tab uses `MelkerConfig.getConfigText()` for formatted display
- Uses the `melker` template literal for clean element creation
- Properly registers/unregisters elements from the document on open/close

## V8 Inspector Debugging

Melker forwards V8 inspector flags to subprocesses for Chrome DevTools debugging.

### Enable Inspector

```bash
# Start with inspector (executes immediately)
./melker.ts --inspect app.melker

# Wait for debugger before executing
./melker.ts --inspect-wait app.melker

# Break at first line
./melker.ts --inspect-brk app.melker
```

Then open `chrome://inspect` in Chrome and click "inspect" on the Deno target.

### Supported Flags

| Flag             | Behavior                               |
|------------------|----------------------------------------|
| `--inspect`      | Enable inspector, execute immediately  |
| `--inspect-wait` | Enable inspector, wait for connection  |
| `--inspect-brk`  | Enable inspector, break at first line  |

### Known Issues with Profiling

When using Chrome DevTools Performance profiling, rendering may appear corrupted. This is caused by:

1. **Partial stdout writes** - Under profiling load, `Deno.stdout.writeSync()` may not write all bytes in a single call
2. **GC pauses** - Profiling increases garbage collection, which can pause execution mid-render
3. **Synchronized update mode** - ANSI escape sequences (`\x1b[?2026h`...`\x1b[?2026l`) may be split

**Mitigation:** The engine uses a write loop that completes partial writes (see `_writeAllSync()` in `src/engine.ts`). Partial write events are logged at DEBUG level for diagnostics.

## Key Files

| File                     | Purpose                                |
|--------------------------|----------------------------------------|
| `src/logging.ts`         | Logger class, getLogger(), log levels  |
| `src/headless.ts`        | HeadlessTerminal, HeadlessManager      |
| `src/stdout.ts`          | Stdout mode, bufferToStdout()          |
| `src/server.ts`            | MelkerServer, WebSocket API            |
| `src/server-ui/index.html` | Server web UI HTML structure           |
| `src/server-ui/index.css`  | Server web UI styles                   |
| `src/server-ui/index.js`   | Server web UI client logic             |
| `src/dev-tools.ts`       | DevToolsManager, F12 overlay           |

## See Also

- [architecture.md](architecture.md) — Core architecture, render pipeline
- [script_usage.md](script_usage.md) — $melker context and logging API
- [config-architecture.md](config-architecture.md) — Configuration system
- [server-architecture.md](server-architecture.md) — Server architecture and protocol
