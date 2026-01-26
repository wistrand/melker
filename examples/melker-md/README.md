# Melker Markdown Examples

**Melker** - *Run text with meaning*

An **optional** way to write melker apps using ASCII box diagrams in markdown files.

## When to Use Markdown vs .melker

| Use Case | Format | Why |
|----------|--------|-----|
| Production apps | `.melker` | Precise, easy to edit and maintain |
| Examples & tutorials | `.md` | Self-documenting, visual layout aids understanding |
| Quick prototypes | `.md` | Sketch layouts visually before refining |
| README demos | `.md` | Readers can see and run the code |

The `.md` format is a **literate programming layer** that compiles to `.melker`. It's ideal when documentation and visual clarity matter more than editing convenience.

## Running Examples

```bash
# Direct execution (melker.ts has executable shebang)
./melker.ts examples/melker-md/hello.md

# Or via deno run
deno run --allow-all melker.ts examples/melker-md/hello.md

# Convert to .melker format (prints to stdout)
./melker.ts --convert examples/melker-md/counter.md

# Convert and save to file
./melker.ts --convert examples/melker-md/counter.md > counter.melker
```

## Example Files

- `hello.md` - Minimal hello world example
- `counter.md` - Interactive counter with buttons and event handlers
- `form-demo.md` - Form with inputs, radio buttons, checkboxes, buttons
- `markdown-viewer.md` - Markdown file viewer with navigation history
- `analog-clock.md` - Canvas-based analog clock with visual ASCII layout
- `color-selector.md` - HSL color picker with interactive canvas
- `tabs-demo.md` - Tabbed interface with multiple panels
- `nested_tabs-demo.md` - Nested tabs with settings panels
- `oauth-demo.md` - OAuth2 PKCE login with external script
- `shorthand-demo.md` - Shorthand type syntax for buttons, text, inputs

## Syntax Overview

### Layout Blocks

All layouts use `melker-block`. The first block is the root, subsequent blocks are components.

````markdown
```melker-block
+--App-----------------------+
| style: border: thin        |
| +--Header----------------+ |
| +--Content---------------+ |
+----------------------------+
```
````

### Box Name Syntax

Box names support both ID and display name: `+--id Display Name--+`

- First word = element ID (for CSS `#id` targeting and component references)
- Rest = display name (used as document title for root block)

````markdown
```melker-block
+--root My Application Title--+
| : c f                       |
| +--header-----------------+ |
+-----------------------------+
```
````

This generates:
- `<title>My Application Title</title>`
- `<container id="root" ...>`

### Shorthand Type Syntax

Use special delimiters in box names to define element types without `type:` property lines:

| Syntax | Element | Example |
|--------|---------|---------|
| `+--[Title]--+` | button | `+--[Click Me]--+` → `<button label="Click Me" />` |
| `+--"content"--+` | text | `+--"Hello!"--+` → `<text>Hello!</text>` |
| `+--{id}--+` | input | `+--{username}--+` → `<input id="username" />` |
| `+--<type> content--+` | explicit | `+--<checkbox> Remember--+` → `<checkbox title="Remember" />` |
| `+--<type(param)> content--+` | with param | `+--<radio(plan)> Free--+` → `<radio title="Free" name="plan" />` |

**Examples:**

````markdown
```melker-block
+--form--------------------------------------+
| : c 1                                      |
| +--"Enter your credentials:"-------------+ |
| +--{username}----------------------------+ |
| +--{password}----------------------------+ |
| +--<checkbox> Remember me----------------+ |
| +--[Login]--+ +--[Cancel]--+               |
+--------------------------------------------+
```
````

The explicit `<type>` syntax supports any element type:
- `<checkbox>`, `<radio>` → `title` prop
- `<button>` → `label` prop
- `<radio(name)>` → `title` prop + `name` prop for radio group
- `<text>`, `<markdown>` → `text` prop (content)
- `<input>`, `<textarea>` → `placeholder` prop

IDs are auto-generated from content (lowercase, hyphens for spaces).

### Component Definitions and References

Components are defined in subsequent `melker-block` blocks. Any box ID matching a component is automatically expanded:

````markdown
```melker-block
+--header--------------------+
| +--Title-----------------+ |
| | type: text             | |
| | text: My App           | |
| +------------------------+ |
+----------------------------+
```
````

**Component references work at ANY nesting level:**

````markdown
```melker-block
+--root App------------------------------------------+
| : c f                                              |
| +--header----------------------------------------+ |
| +--main------------------------------------------+ |
| | : r                                            | |
| | +--sidebar---------+ +--content--------------+ | |
| +----------------------------------------------------+ |
+--------------------------------------------------------+
```

```melker-block
+--sidebar-----------------+
| +--nav-----------------+ |
+--------------------------+
```

```melker-block
+--nav---------------------+
| type: text               |
| text: Navigation         |
+--------------------------+
```
````

In this example:
- `header`, `sidebar`, and `nav` are all expanded from their component definitions
- `sidebar` contains `nav`, which is also expanded (nested references work)
- Cycle detection prevents infinite loops (A -> B -> A)

### Visual ASCII Art in Layouts

You can include decorative ASCII art inside boxes to visually represent the UI. Only `+--id--+` patterns are parsed as boxes:

````markdown
```melker-block
+--root Analog Clock-------------------------------------------+
| : c = f                                                      |
|                      +--title--+                             |
|                                                              |
| +--canvas-container----------------------------------------+ |
| |                         12                               | |
| |                    .----'----.                           | |
| |                   /    |    / \                          | |
| |                9 |     +--'    | 3                       | |
| |                   \          /                           | |
| |                    `----.---'                            | |
| |                         6                                | |
| +----------------------------------------------------------+ |
|                                                              |
| +--button-row----------------------------------------------+ |
| | +--status-btn---+                       +--exit-btn----+ | |
| +----------------------------------------------------------+ |
+--------------------------------------------------------------+
```
````

The clock illustration is decorative - only `title`, `canvas-container`, `button-row`, `status-btn`, and `exit-btn` are parsed as elements.

### Compact Layout Hints

Use `: ` lines for layout control:

```
| : r 1 =     |  -> row, gap 1, justify center
| : c 2 < ^   |  -> column, gap 2, justify start, align start
| : *2 f      |  -> flex 2, fill both dimensions
```

Hint codes:
- `r`/`c` - row/column direction (optional - auto-detected from child positions)
- `0`-`9` - gap value
- `<`/`=`/`>`/`~` - justify start/center/end/space-between
- `^`/`-`/`v`/`+` - align start/center/end/stretch
- `*N` - flex value
- `wN`/`hN` - width/height
- `f` - fill both dimensions

**Auto-detection:** Flex direction is inferred from child box positions:
- Children stacked vertically → column
- Children side by side → row

Use `r`/`c` hints only to override auto-detection.

### Tab Bar Syntax

Use `│ Tab1 │ Tab2 │` lines to create a tabbed interface. The asterisk (`*`) marks the active tab:

````markdown
```melker-block
+--settings Settings Dialog------------------+
| │ General* │ Advanced │ About │            |
| +--general-content-----------------------+ |
| +--advanced-content----------------------+ |
| +--about-content-------------------------+ |
+--------------------------------------------+
```
````

This generates a `<tabs>` element with `<tab>` children:

```xml
<tabs id="settings">
  <tab id="general" title="General">...</tab>
  <tab id="advanced" title="Advanced">...</tab>
  <tab id="about" title="About">...</tab>
</tabs>
```

**Features:**
- `*` suffix marks the active tab (e.g., `General*`)
- If no tab is marked active, the first tab is active by default
- Child boxes are mapped to tabs in order (top to bottom)
- Tab titles come from the tab bar line, not from child box IDs
- Child boxes can be component references (defined in separate `melker-block` blocks)

See `tabs-demo.md` for a complete example.

### Scripts

Use standard `typescript` (or `ts`, `javascript`, `js`) code blocks with directive comments:

````markdown
```typescript
// @melker script
let count = 0;
function update() { ... }
export { update };  // Accessible as $app.update()
```
````

### Styles

Use standard `css` code blocks with directive comments:

````markdown
```css
/* @melker style */
#count { font-weight: bold; }
```
````

### Event Handlers

Connect handlers to specific elements using the `// @melker handler` directive:

````markdown
```typescript
// @melker handler #dec.onClick
count--;
update();
```
````

### Element Properties via JSON

Use `@target` to apply properties to a specific element:

````markdown
```json
{
  "@target": "#dec",
  "flex": 2,
  "style": "border: thin"
}
```
````

### Named JSON Data

Use `@name` to create named JSON data accessible from scripts:

````markdown
```json
{
  "@name": "config",
  "maxCount": 100,
  "minCount": 0
}
```
````

### Document Title

The document title is automatically set from the root block's display name.
Use `@title` to override:

````markdown
```json
{ "@title": "My App - ${argv[1]}" }
```
````

### External Scripts

Use a `## Scripts` section with markdown links to reference external TypeScript files:

````markdown
## Scripts
- [handlers](./handlers.ts)
- [utils](./utils.ts)
````

Each link generates a `<script src="..." />` tag. Script paths are resolved relative to the markdown file.

### OAuth Configuration

Use a `json oauth` fenced block for OAuth2 PKCE configuration:

````markdown
```json oauth
{
  "wellknown": "$ENV{MELKER_OAUTH_WELLKNOWN}",
  "clientId": "$ENV{MELKER_OAUTH_CLIENT_ID}",
  "audience": "$ENV{MELKER_OAUTH_AUDIENCE}",
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

Generates an `<oauth ... />` element. See `oauth-demo.md` for a complete example.

## Block Type Summary

| Block Type | Language | Directive | Purpose |
|------------|----------|-----------|---------|
| Layout | `melker-block` | - | First = root, rest = components |
| Script | `typescript` | `// @melker script` | Global application code |
| Handler | `typescript` | `// @melker handler #id.event` | Element event handler |
| Style | `css` | `/* @melker style */` | CSS styling |
| Properties | `json` | `{ "@target": "#id", ... }` | Element properties |
| Data | `json` | `{ "@name": "name", ... }` | Named JSON data |
| Title | `json` | `{ "@title": "..." }` | Document title (override) |
| OAuth | `json oauth` | - | OAuth2 PKCE configuration |
| Ext Scripts | `## Scripts` | `- [name](path)` | External script files |
