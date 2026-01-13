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

| Level | Use For |
|-------|---------|
| `DEBUG` | Detailed debugging info, variable dumps |
| `INFO` | General operational messages |
| `WARN` | Potential issues, recoverable errors |
| `ERROR` | Errors that need attention |
| `FATAL` | Critical errors, application termination |

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

If not configured: `./logs/melker.log`

## Performance Dialog (`src/performance-dialog.ts`)

A built-in movable, non-modal dialog showing live performance statistics.

### Toggle

Press `F6` to toggle visibility (also: `F10`, `F11`, `Shift+F12`).

### Features

- **Draggable**: Click and drag the title bar to move
- **Non-modal**: Doesn't block UI interaction
- **Live stats**: Updates on every render

### Displayed Metrics

| Metric | Description |
|--------|-------------|
| Max FPS | Theoretical max FPS (1000 / avgRenderTime) |
| Renders/s | Actual renders per second (activity rate) |
| Render | Last render time (ms) |
| Render avg | Average render time over 60 frames |
| Layout | Last layout time (ms) |
| Layout avg | Average layout time over 60 frames |
| Input lat | Input-to-render latency (ms) |
| Input avg | Average input latency over 60 samples |
| Breakdown | Latency breakdown (h+w+l+b+a) |
| Nodes | Number of layout nodes |
| Cells | Changed/total buffer cells |
| Memory | Estimated memory usage |
| Renders | Total render count |
| Errors | Component error count |

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
- **Event injection** - Simulate keyboard/mouse via debug server
- **Resizable** - Change virtual terminal size at runtime

### Headless + Debug Server

Combine for remote testing:
```bash
MELKER_HEADLESS=true MELKER_DEBUG_PORT=8080 ./melker.ts app.melker
```

## Debug Server (`src/debug-server.ts`)

WebSocket server for remote debugging and automation.

### Enable Debug Server

```bash
MELKER_DEBUG_PORT=8080 ./melker.ts app.melker
```

Access at: `http://localhost:8080` (web UI) or `ws://localhost:8080` (WebSocket)

### Available Commands

Send JSON messages via WebSocket:

| Command | Purpose |
|---------|---------|
| `get-engine-state` | Get engine status, element count, focus |
| `get-buffer` | Get current buffer snapshot |
| `get-document-tree` | Get element tree structure |
| `inject-event` | Inject keyboard/mouse events |
| `trigger-render` | Force a re-render |
| `get-headless-status` | Headless mode info |
| `get-terminal-output` | Get captured terminal output |

### Event Injection Examples

```json
// Inject keypress
{"type": "inject-event", "data": {"type": "keypress", "key": "Enter"}}

// Inject click at x=10, y=5
{"type": "inject-event", "data": {"type": "click", "x": 10, "y": 5}}
```

### Subscriptions

Subscribe to real-time updates:
- `buffer-updates` - Buffer changes
- `engine-state` - State changes
- `render-notifications` - Re-render events
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

### 4. Use Debug Server for Interaction
```bash
# In another terminal
MELKER_DEBUG_PORT=8080 MELKER_LOG_FILE=/tmp/app.log ./melker.ts app.melker
```

### 5. Disable Alternate Screen (See Raw Output)
```bash
MELKER_NO_ALTERNATE_SCREEN=1 ./melker.ts app.melker
```

This keeps output in main buffer for scrollback review.

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
- Use debug server to inject events
- Check hit testing logs: `Hit test triggered | mouseX=10, mouseY=5`

### Focus Issues
- Look for focus registration: `Successfully registered focusable element: myButton`
- Check focus changes in logs

### Rendering Issues
- Use `MELKER_NO_ALTERNATE_SCREEN=1` to see raw ANSI output
- Use debug server's `get-buffer` to inspect buffer state

### Video Exit Issues (Garbage on Exit)
If video frame data (sextant characters) appears on the terminal after exit:
- This is a race condition: video frame renders after alternate screen exit
- The engine has render guards that check `_isInitialized` before `writeSync()`
- Guards are in `render()`, `forceRender()`, `_renderOptimized()`, `_renderFullScreen()`
- See `src/engine.ts` and `agent_docs/implementation-details.md` for details

## Dev Tools (F12)

Press **F12** at runtime to open the Dev Tools dialog.

### Tabs

| Tab | Description |
|-----|-------------|
| Help | App help text (if provided) |
| Source | Original `.melker` source or converted content for `.md` files |
| Policy | App permissions and Deno flags |
| Markdown | Original markdown (for `.md` files only) |
| System | Build info, scripts, bundle details |
| Config | Current configuration with sources (schema + app-defined) |
| Inspect | Live document tree view with Refresh button |
| Actions | Performance Monitor, Exit Application |

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

## Key Files

| File | Purpose |
|------|---------|
| `src/logging.ts` | Logger class, getLogger(), log levels |
| `src/headless.ts` | HeadlessTerminal, HeadlessManager |
| `src/debug-server.ts` | MelkerDebugServer, WebSocket API |
| `src/dev-tools.ts` | DevToolsManager, F12 overlay |
