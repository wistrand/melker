# DevTools Inspect Tab Architecture

## Summary

- Interactive element inspector inside the F12 Dev Tools dialog
- Split-pane layout: element tree (left) + detail panel with property/style editing (right)
- Detail panel rebuilt on demand per selection — no pre-allocated element pools
- Supports editing props and inline styles at runtime with immediate visual feedback

## Overview

| Property    | Value                                                          |
|-------------|----------------------------------------------------------------|
| Location    | F12 Dev Tools > Inspect tab                                    |
| File        | [src/dev-tools.ts](../src/dev-tools.ts)                        |
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

## Key Methods

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
