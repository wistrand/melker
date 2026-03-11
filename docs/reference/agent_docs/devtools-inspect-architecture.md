# DevTools Architecture

## Summary

- F12 opens the Dev Tools dialog with tabbed panels for debugging and introspection
- Tabs are conditionally included based on app state (e.g. I18n tab only when i18n is active)
- Split-pane Inspect tab with element tree + detail panel with property/style editing
- Detail panel rebuilt on demand per selection — no pre-allocated element pools

## Tab Overview

All tabs are defined in `DevToolsManager._buildDevToolsUI()` in [src/dev-tools.ts](../src/dev-tools.ts).

| Tab         | Title      | Condition                  | Description                                            |
|-------------|------------|----------------------------|--------------------------------------------------------|
| Source      | Source     | Always (for .melker files) | Raw source content of the app file                     |
| Help        | Help       | `<help>` element present   | Rendered help markdown                                 |
| Policy      | Policy     | Policy present             | Formatted policy + Deno permission flags               |
| Markdown    | Markdown   | `.md` file type            | Rendered markdown content                              |
| Mermaid     | Mermaid    | `.mmd` file type           | Raw mermaid source                                     |
| System      | System     | System info available      | System info (terminal, runtime, etc.)                  |
| Config      | Config     | Always                     | Formatted config values with sources                   |
| Edit Config | Edit       | Policy has `configSchema`  | Interactive config editing                             |
| CSS Vars    | Vars       | Always                     | CSS variables data-table with current values           |
| Inspect     | Inspect    | Always                     | Element tree + detail panel (see below)                |
| I18n        | I18n       | i18n engine active         | Locale picker + message keys data-table (see below)    |
| State       | State      | `createState()` used       | State values data-table                                |
| Log         | Log        | Always                     | Recent log entries                                     |
| Actions     | Actions    | Always                     | Performance monitor, exit app buttons                  |

## Inspect Tab

| Property    | Value                                                          |
|-------------|----------------------------------------------------------------|
| Location    | F12 Dev Tools > Inspect tab                                    |
| Components  | `<split-pane>`, `<data-tree>`, `<input>`, `<button>`, `<text>` |
| Entry point | `DevToolsManager._buildInspectTab()`                           |

## Layout

```
┌─── Element Tree (2/5) ────┬─── Detail Panel (3/5) ──────┐
│ └─v container              │ container#main               │
│   ├─v container.header     │ Position: x=0, y=1  Size: …│
│   │ ├─> container          │                              │
│   │ └─  text#status        │ Props                        │
│   ├─v split-pane           │  scrollable:     true        │
│   └─v container.footer     │                              │
│     └─  text#lastUpdate    │ Style                        │
│                            │  flexDirection:  column      │
│                            │  width:          fill        │
│                            │          [ Apply Style ]     │
└────────────────────────────┴──────────────────────────────┘
                                                  [ Refresh ]
```

Uses `<split-pane sizes="2,3">` for the 40/60 split. The detail container is scrollable with `padding: 1`.

## Element Tree

The left panel uses `<data-tree selectable="single">` built by `_buildElementNodes()`.

| Aspect      | Detail                                                                |
|-------------|-----------------------------------------------------------------------|
| Data source | Recursive walk of `document.root`, skipping `dev-tools-*` elements    |
| Node label  | `type#id.class1.class2` (auto-generated `el-*` IDs hidden)           |
| Node value  | `element.id` or path-based key (e.g., `container-0/text-1`)          |
| Expansion   | First 2 levels auto-expanded                                         |
| Lookup      | `Map<string, Element>` populated during tree build for O(1) selection |

On selection change, `_updateInspectDetail(element)` rebuilds the right panel.

## Detail Panel

Rebuilt from scratch on each tree selection. The method `_updateInspectDetail()` constructs new children and replaces `detailContainer.children`, then calls `registerElementsWithDocument()` and `render()`.

### Sections

| Section  | Content                                                        |
|----------|----------------------------------------------------------------|
| Identity | `type#id.class1.class2` with focus/visibility flags            |
| Bounds   | `Position: x=N, y=N  Size: W x H` from `element.getBounds()` |
| Props    | Editable scalar props with input fields (if any exist)         |
| Style    | Editable inline style properties with input fields             |

The Props section is omitted entirely when the element has no editable props.

### Filtered Props

Props are filtered by `_skipEditProps` — a static `Set` excluding:

- `style`, `classList`, `children`, `id`, `class`, `tabIndex`
- Binding props: `bind`, `bind-mode`, `bind:selection`, `persist`
- ARIA attributes: `role`, `aria-*`
- Command palette: `palette`, `palette-shortcut`, `palette-group`
- Tooltip: `tooltip`, `onTooltip`
- Event handlers: `on*` prefixed props
- Internal: `__` prefixed props
- Non-scalar values: objects, functions, undefined

### Style Editing

All entries from `element.props.style` are shown as label + input rows. Each section also includes:

- **Add new** — name/value input pair for adding properties not currently set
- **Apply button** — reads all inputs, parses values, writes to element

### Value Parsing

Input values are parsed with type inference:

| Input     | Result    |
|-----------|-----------|
| `"true"`  | `true`    |
| `"false"` | `false`   |
| `"42"`    | `42`      |
| `"3.14"`  | `3.14`    |
| `"hello"` | `"hello"` |
| `""`      | skipped   |

## Inspect Key Methods

| Method                               | Purpose                                                   |
|--------------------------------------|-----------------------------------------------------------|
| `_buildInspectTab()`                 | Creates split-pane with tree and empty detail container   |
| `_buildElementNodes(el, map, depth)` | Recursively builds `TreeNode[]`, populates element lookup |
| `_updateInspectDetail(el)`           | Rebuilds detail panel children for selected element       |

## Refresh

| Trigger        | Behavior                                         |
|----------------|--------------------------------------------------|
| Refresh button | Rebuilds tree from current document state        |
| Tab re-entry   | Same rebuild via shared `onRefresh` callback     |
| Element select | Rebuilds detail panel only (tree unchanged)      |

No auto-refresh per frame — manual refresh keeps it simple and avoids performance overhead.

## Design Decisions

**Dynamic rebuild vs element pool**: The detail panel was originally implemented with pre-allocated hidden rows (15 prop rows + 20 style rows) that were shown/hidden on selection. This was replaced with on-demand child creation because:
- Hidden elements complicated layout measurement and caused spacing bugs
- Pool size limited the number of visible properties
- Show/hide logic was complex and error-prone
- Rebuilding is cheap — it only happens on user-initiated tree clicks

## I18n Tab

Only appears when `getI18nEngine()` returns a non-null engine (i.e., the app uses `<messages>` elements or has `i18n.messagesDir` configured).

| Property    | Value                                    |
|-------------|------------------------------------------|
| Entry point | `DevToolsManager._buildI18nTab()`        |
| Components  | `<select>`, `<data-table>`, `<text>`     |
| Dependency  | `DevToolsDependencies.getI18nEngine`     |

### Layout

- **Locale picker** — `<select>` populated with `availableLocales`, using `getLanguageName()` for display labels. Switching locale triggers `setLocale()` + re-render.
- **Message keys table** — `<data-table>` with two columns: Key and Value. Shows all flattened message keys for the current locale, resolved via `t()`.
- **Footer** — locale count and key count summary.

### Refresh

Rebuild on tab entry and after locale switch. The Refresh button rebuilds the data-table with current locale's resolved values.
