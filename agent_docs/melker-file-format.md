# .melker File Format

**Melker** - *Run text with meaning*

The `.melker` file format is an HTML-like declarative syntax for building Melker terminal UIs.

**Run with:**
```bash
deno run --allow-all melker.ts <file>.melker
deno run --allow-all melker.ts http://server/path/file.melker  # URL support
```

The launcher automatically adds `--unstable-bundle` if needed (for Deno's `Deno.bundle()` API).

## Structure

Files can use either a `<melker>` wrapper (for scripts/styles) or a direct root component:

```xml
<melker>
  <title>App Title</title>

  <style>
    button { background-color: blue; }
    #myId { color: red; }
    .myClass { border: thin; }
  </style>

  <script type="typescript">
    // TypeScript code - export functions via: export { fn1, fn2 }
  </script>

  <container><!-- UI --></container>
</melker>
```

## Special Tags

| Tag | Description |
|-----|-------------|
| `<melker>` | Root wrapper (optional) |
| `<title>` | Window/terminal title |
| `<style>` | CSS-like stylesheet rules (selector { props }) |
| `<script>` | TypeScript/JavaScript code block |
| `<oauth>` | OAuth2 PKCE configuration |
| `<policy>` | Permission policy declaration |

## Components

| Component | Key Props | Notes |
|-----------|-----------|-------|
| `<container>` | style, scrollable | Flexbox layout container |
| `<text>` | id, style | Inner content or `text` prop |
| `<input>` | id, placeholder, value, format, onKeyPress, onInput | Single-line text input (format: 'text'\|'password') |
| `<textarea>` | id, placeholder, value, rows, cols, wrap, maxLength | Multi-line text input |
| `<button>` | id, title, onClick | Uses `title` not `label` |
| `<dialog>` | id, title, open, modal, backdrop, draggable, width, height | Modal overlay (draggable via title bar) |
| `<file-browser>` | id, path | File system navigation |
| `<checkbox>` | id, title, checked, onChange | Toggle checkbox |
| `<radio>` | id, title, value, checked, name, onChange | Radio button |
| `<list>` | style | List container |
| `<li>` | style | List item |
| `<tabs>` | id, activeTab, onTabChange | Tabbed container |
| `<tab>` | title, disabled | Tab panel (child of tabs) |
| `<canvas>` | width, height, dither, ditherBits, onPaint | Pixel graphics (sextant chars) |
| `<img>` | src, alt, width, height, objectFit, dither, onLoad, onError | Image display (extends canvas) |
| `<markdown>` | | Markdown text rendering |

## Styling

CSS-like properties in `style` attribute:

- **Layout:** width, height, display (flex/block), flex-direction, flex, padding, margin, overflow
- **Borders:** border (none/thin/thick/double/rounded/dashed/dashed-rounded/ascii/ascii-rounded), border-top/right/bottom/left, border-color
- **Colors:** color, background-color (names or hex like `#00d9ff`)
- **Text:** font-weight (bold/normal), text-align, text-wrap

## Events & Context

**Events:** onClick, onKeyPress (event.key), onInput (event.value), onFocus, onBlur, onPaint (canvas)

**Auto-render:** Event handlers automatically trigger a re-render after completion. No need to call `$melker.render()` manually.

```xml
<!-- Auto-renders after handler completes -->
<button onClick="counterEl.props.text = String(count + 1)" />

<!-- Return false to skip auto-render -->
<button onClick="console.log('no changes'); return false" />

<!-- Async handlers also auto-render when the promise resolves -->
<button onClick="
  statusEl.props.text = 'Loading...';
  $melker.render();  // explicit render for intermediate state
  await fetchData();
  statusEl.props.text = 'Done';
  // auto-renders here
" />
```

**Context API:**
- `$melker.url` - Source file URL (e.g. `file:///path/to/app.melker`)
- `$melker.dirname` - Source directory path (e.g. `/path/to`)
- `$melker.exports` / `$app` - User exports namespace (script exports are added here)
- `$melker.getElementById(id)` - Get element by ID
- `$melker.render()` - Trigger re-render (for intermediate updates in async handlers)
- `$melker.exit()` - Exit application
- `$melker.copyToClipboard(text)` - Copy text to system clipboard (returns `true` on success)
- `$melker.alert(message)` - Show modal alert dialog
- `$melker.setTitle(title)` - Set window/terminal title
- Exported script functions available as `$app.functionName()` (or `$melker.exports.functionName()`)

## State Persistence

Melker apps automatically persist UI state across restarts. The following element types and properties are saved:

| Element | Property | Condition |
|---------|----------|-----------|
| `<input>` | value | Except password inputs |
| `<textarea>` | value | Always |
| `<checkbox>` | checked | Always |
| `<radio>` | checked | Always |
| `<tabs>` | activeTab | Always |
| `<container>` | scrollY, scrollX | When `scrollable="true"` |

**How it works:**
- State is saved to `~/.melker/state/<app-id>.json` (app-id is a hash of the file path)
- State is saved automatically after each render (debounced, 500ms delay)
- State is saved immediately on exit
- When the app starts, saved state is restored during element creation

**Opt-out:** Add `persist="false"` to any element to exclude it from persistence:
```xml
<input id="tempField" persist="false" placeholder="Not saved" />
```

**Password inputs:** Use `format="password"` to mask characters with `*`. Password inputs are **automatically excluded** from persistence for security - no need to add `persist="false"`.

**Element ID requirement:** Only elements with an `id` attribute are persisted. Anonymous elements are skipped.

**Element Bounds:**
All elements have `getBounds()` method that returns `{ x, y, width, height }` after layout:
```typescript
const canvas = $melker.getElementById('myCanvas');
const bounds = canvas.getBounds();
if (bounds) {
  canvas.setSize(bounds.width, bounds.height);
}
```

## Canvas Component

Canvas uses Unicode sextant characters (2x3 pixel blocks per terminal character).

**Props:**
- `width`, `height` - Dimensions in terminal columns/rows
- `dither` - Dithering mode: `'auto'` | `'sierra-stable'` | `'floyd-steinberg'` | `'ordered'` | `'none'`
- `ditherBits` - Color depth (1-8, default: 1 for B&W)
- `onPaint` - Called before render with `{ canvas, bounds }`
- `src` - Load image from file path

**Dither modes:**
- `'auto'` - Uses sierra-stable for bw/color themes, no dither for fullcolor
- `'none'` - No dithering (true color)

**Aspect-ratio corrected drawing:**
```typescript
// Work in visual coordinates (equal units in both dimensions)
const visSize = canvas.getVisualSize();
const visCenterX = visSize.width / 2;
const visCenterY = visSize.height / 2;

// Convert to pixel for drawCircleCorrected
const [pxCenterX, pxCenterY] = canvas.visualToPixel(visCenterX, visCenterY);
canvas.drawCircleCorrected(pxCenterX, pxCenterY, radius);

// Lines use visual coordinates directly
canvas.drawLineCorrected(x1, y1, x2, y2);
```

## Examples

See `examples/melker/` for complete examples:
- `hello.melker` - Simple hello world
- `counter.melker` - Basic counter with buttons
- `dialog_demo.melker` - Dialog variants
- `tabs_demo.melker` - Tabbed interface
- `input-demo.melker` - Input fields
- `textarea_demo.melker` - Multi-line text input
- `flex-demo.melker` - Flexbox layout examples
- `canvas_test.melker` - Canvas graphics
- `analog-clock.melker` - Canvas-based analog clock
- `color_selector.melker` - HSL color picker with canvas
- `image_demo.melker` - Image component with fixed and percentage dimensions
- `chrome_collapse_demo.melker` - Progressive chrome collapse when space is tight
- `markdown_viewer.melker` - Markdown rendering

## Running

```bash
# Simple launch (auto-detects and adds required flags)
deno run --allow-all melker.ts examples/melker/counter.melker

# From URL
deno run --allow-all melker.ts http://localhost:1990/melker/counter.melker

# With lint validation
deno run --allow-all melker.ts --lint examples/melker/counter.melker

# Watch mode (auto-reload on file changes, local files only)
deno run --allow-all melker.ts --watch examples/melker/counter.melker

# Debug mode (shows bundler info, retains temp files at /tmp/melker-*.{ts,js})
deno run --allow-all melker.ts --debug examples/melker/counter.melker

# Enable bundle caching (disabled by default)
deno run --allow-all melker.ts --cache examples/melker/counter.melker

# Show app policy and exit
deno run --allow-all melker.ts --show-policy examples/melker/counter.melker

# Ignore policy, run with full permissions
deno run --allow-all melker.ts --trust examples/melker/counter.melker

# With logging
MELKER_LOG_FILE=/tmp/debug.log MELKER_LOG_LEVEL=debug deno run --allow-all melker.ts app.melker

# With theme (auto-detected by default, or specify manually)
MELKER_THEME=fullcolor-dark deno run --allow-all melker.ts app.melker
MELKER_THEME=auto-dark deno run --allow-all melker.ts app.melker

# Start LSP server (for editor integration)
deno run --allow-all melker.ts --lsp
```

## Markdown Format (.md) - Optional

Melker apps can **optionally** be written in markdown files using ASCII box diagrams. This is a **documentation-friendly layer** on top of `.melker` files, not a replacement.

| Use Case | Recommended Format |
|----------|-------------------|
| Production apps | `.melker` - precise, easy to edit |
| Examples & tutorials | `.md` - self-documenting, visual |
| Quick prototypes | `.md` - sketch layouts visually |
| Generated/tooling | `.melker` - machine-friendly |

The markdown format compiles to `.melker` and provides:
- Visual ASCII layout diagrams that match the rendered output
- Documentation alongside code (literate programming style)
- Editor syntax highlighting for TypeScript/CSS/JSON blocks

### Running Markdown Files

```bash
# Run directly
deno run --allow-all melker.ts examples/melker-md/counter.md

# Convert to .melker format (prints to stdout)
deno run --allow-all melker.ts --convert examples/melker-md/counter.md
```

### Layout Blocks

Use `melker-block` code blocks. The **first block is the root**, subsequent blocks are **component definitions**.

````markdown
```melker-block
+--root My App Title--+
| : c f               |
| +--header---------+ |
| +--content--------+ |
+---------------------+
```
````

### Box Name Syntax

`+--id Display Name--+` where:
- **First word** = element ID (for CSS `#id` and component references)
- **Rest** = display name (root's display name becomes document title)

### Shorthand Type Syntax

Use special delimiters to define element types without `type:` property lines:

| Syntax | Element | Example |
|--------|---------|---------|
| `+--[Title]--+` | button | `+--[Click Me]--+` → `<button title="Click Me" />` |
| `+--"content"--+` | text | `+--"Hello!"--+` → `<text>Hello!</text>` |
| `+--{id}--+` | input | `+--{username}--+` → `<input id="username" />` |
| `+--<type> content--+` | explicit | `+--<checkbox> Remember--+` → `<checkbox title="Remember" />` |
| `+--<type(param)> content--+` | with param | `+--<radio(plan)> Free--+` → `<radio title="Free" name="plan" />` |

The explicit `<type>` syntax maps content to appropriate props:
- `<checkbox>`, `<radio>`, `<button>` → `title` prop
- `<radio(name)>` → `title` prop + `name` prop for radio group
- `<text>`, `<markdown>` → `text` prop
- `<input>`, `<textarea>` → `placeholder` prop

IDs are auto-generated from content (lowercase, hyphens for spaces).

### Component References

Any box ID that matches a component definition is automatically expanded. Works at any nesting level:

````markdown
```melker-block
+--root App---------------------------------+
| : c f                                     |
| +--header-------------------------------+ |
| +--main---------------------------------+ |
| | +--sidebar--+ +--content------------+ | |
| +-------------------------------------------+ |
+-----------------------------------------------+
```

```melker-block
+--header------------------+
| type: text               |
| text: Header             |
+--------------------------+
```

```melker-block
+--sidebar-----------------+
| +--nav-----------------+ |
+--------------------------+
```
````

Cycle detection prevents infinite loops (A -> B -> A).

### Layout Hints

Compact hints on lines starting with `: `:

| Hint | Meaning |
|------|---------|
| `r` / `c` | row / column direction (optional - auto-detected) |
| `0`-`9` | gap value |
| `<` `=` `>` `~` | justify: start / center / end / space-between |
| `^` `-` `v` `+` | align: start / center / end / stretch |
| `*N` | flex: N |
| `f` | fill (width + height 100%) |

**Auto-detection:** Flex direction is inferred from child positions - children stacked vertically → column, side by side → row.

### Tab Bar Syntax

Use `│ Tab1 │ Tab2 │` lines to create tabs. Mark the active tab with `*`:

````markdown
```melker-block
+--settings Settings-----------------------+
| │ General* │ Advanced │ About │          |
| +--general-content---------------------+ |
| +--advanced-content--------------------+ |
| +--about-content-----------------------+ |
+------------------------------------------+
```
````

Generates `<tabs>` with `<tab>` children. Child boxes map to tabs in order.

### Code Blocks

Use directive comments for editor compatibility:

````markdown
```typescript
// @melker script
let count = 0;
export const inc = () => count++;  // Accessible as $app.inc()
```

```typescript
// @melker handler #btn.onClick
count++;
$melker.render();
```

```css
/* @melker style */
#count { font-weight: bold; }
```

```json
{
  "@target": "#btn",
  "style": "background-color: blue"
}
```
````

### External Scripts

Use a `## Scripts` section with markdown links to reference external TypeScript files:

````markdown
## Scripts
- [handlers](./handlers.ts)
- [utils](./utils.ts)
````

Generates `<script src="./handlers.ts" />` for each link.

### OAuth Configuration

Use a `json oauth` fenced block for OAuth2 PKCE configuration:

````markdown
```json oauth
{
  "wellknown": "${OAUTH_WELLKNOWN}",
  "clientId": "${OAUTH_CLIENT_ID}",
  "audience": "${OAUTH_AUDIENCE}",
  "autoLogin": true,
  "onLogin": "$app.onLoginCallback(event)",
  "onLogout": "$app.onLogoutCallback(event)",
  "onFail": "$app.onFailCallback(event)"
}
```
````

**OAuth Event Structure:** All OAuth callbacks receive a unified `OAuthEvent`:
```typescript
interface OAuthEvent {
  type: 'oauth';
  action: 'login' | 'logout' | 'fail';
  error?: Error;  // Only present for 'fail' events
}
```

See `examples/melker-md/oauth_demo.md` for a complete example.

## Policy (Permission Sandboxing)

Apps can declare required permissions. When a policy is found, the app runs in a subprocess with only those permissions.

### Inline Policy

```xml
<melker>
  <policy>
  {
    "name": "My App",
    "description": "What the app does",
    "permissions": {
      "read": ["."],
      "net": ["api.example.com"],
      "run": ["ffmpeg"]
    }
  }
  </policy>
  <!-- UI content -->
</melker>
```

### External Policy File

```xml
<policy src="app.policy.json"></policy>
```

### Permission Types

| Permission | Example | Deno Flag |
|------------|---------|-----------|
| `read` | `["."]` or `["*"]` | `--allow-read` |
| `write` | `["/data"]` or `["*"]` | `--allow-write` |
| `net` | `["api.example.com"]` or `["*"]` | `--allow-net` |
| `run` | `["ffmpeg", "ffprobe"]` or `["*"]` | `--allow-run` |
| `env` | `["MY_VAR"]` or `["*"]` | `--allow-env` |
| `ffi` | `["libfoo.so"]` or `["*"]` | `--allow-ffi` |

### Permission Shortcuts

| Shortcut | Description |
|----------|-------------|
| `ai` | AI/media: swift, ffmpeg, ffprobe, pactl, ffplay + openrouter.ai |
| `clipboard` | Clipboard: pbcopy, xclip, xsel, wl-copy, clip.exe |
| `keyring` | Credentials: security, secret-tool, powershell |
| `browser` | Browser opening: open, xdg-open, cmd |

```json
{
  "permissions": {
    "read": ["."],
    "ai": true,
    "clipboard": true,
    "keyring": true,
    "browser": true
  }
}
```

### Environment Variables in Policy

Use `${VAR}` or `${VAR:-default}` syntax in policy JSON:

```json
{
  "permissions": {
    "net": ["${API_HOST:-api.example.com}"]
  }
}
```

### OAuth Auto-Permissions

When an `<oauth>` tag is present, the policy automatically includes:
- `localhost` in net permissions (for callback server)
- `browser: true` (for opening authorization URL)
- All hosts discovered from the wellknown endpoint

### CLI Options

```bash
# Show policy and exit
deno run --allow-all melker.ts --show-policy app.melker

# Ignore policy, run with full permissions (required for scripts/agents)
deno run --allow-all melker.ts --trust app.melker

# Clear all cached approvals
deno run --allow-all melker.ts --clear-approvals

# Revoke approval for specific path or URL
deno run --allow-all melker.ts --revoke-approval /path/to/app.melker

# Show cached approval
deno run --allow-all melker.ts --show-approval /path/to/app.melker
```

### App Approval System

All .melker files require first-run approval (use `--trust` to bypass).

**Local files:**
- Policy tag is optional (uses auto-policy with all permissions if missing)
- Approval is path-based (persists across file edits for dev experience)
- Re-approval only needed if file is moved/renamed

**Remote files (http:// or https://):**
- Policy tag is mandatory (fails without it)
- Approval is hash-based (content + policy + deno flags)
- Re-approval required if app content, policy, or Deno flags change

Approvals are cached in `~/.cache/melker/approvals/`.

See `examples/melker/markdown_viewer.melker` and `examples/melker/video_demo.melker` for policy examples.

See `examples/melker-md/` for complete examples and `examples/melker-md/README.md` for full syntax reference.
