# CLAUDE.md

Guidance for Claude Code when working with Melker.

## Project Overview

**Melker** - *Run text with meaning*

Website: https://melker.sh

Melker is a Deno library for creating rich Terminal UI interfaces using an HTML-inspired document model. It renders component trees to ANSI terminals using a dual-buffer system.

## Quick Reference

| What                | Where                                                      |
|---------------------|------------------------------------------------------------|
| Getting started     | [getting-started.md](agent_docs/getting-started.md)        |
| .melker file format | [melker-file-format.md](agent_docs/melker-file-format.md)  |
| First app tutorial  | [tutorial.html](docs/tutorial.html)                        |
| Examples            | [examples/](examples/) (basics, components, layout, canvas) |
| **AI Agent Skill**  | [skills/creating-melker-apps/](skills/creating-melker-apps/) |
| CLI reference       | [cli-reference.md](agent_docs/cli-reference.md)            |
| Internals reference | [internals-reference.md](agent_docs/internals-reference.md) |

## Documentation Index

### For App Developers

| Topic                          | Doc                                                    |
|--------------------------------|--------------------------------------------------------|
| Script context ($melker, $app) | [script_usage.md](agent_docs/script_usage.md)          |
| Graphics modes                 | [gfx-modes.md](agent_docs/gfx-modes.md)                |
| Debugging & logging            | [debugging.md](agent_docs/debugging.md)                |
| Common mistakes                | [dx-footguns.md](agent_docs/dx-footguns.md)            |
| AI assistant                   | [ai-accessibility.md](agent_docs/ai-accessibility.md)  |

### Component Reference

| Component                                         | Doc                                                                            |
|---------------------------------------------------|--------------------------------------------------------------------------------|
| Filterable lists (combobox, select, autocomplete) | [filterable-list-architecture.md](agent_docs/filterable-list-architecture.md)  |
| File browser                                      | [file-browser-architecture.md](agent_docs/file-browser-architecture.md)        |
| Data table                                        | [data-table.md](agent_docs/data-table.md)                                      |
| Data bars (charts)                                | [data-bars.md](agent_docs/data-bars.md)                                        |
| Data heatmap                                      | [data-heatmap-architecture.md](agent_docs/data-heatmap-architecture.md)        |
| Data tree                                         | [data-tree-architecture.md](agent_docs/data-tree-architecture.md)              |
| Split pane                                        | [split-pane-architecture.md](agent_docs/split-pane-architecture.md)            |
| Spinner                                           | [spinner-architecture.md](agent_docs/spinner-architecture.md)                  |
| Toast notifications                               | [toast-architecture.md](agent_docs/toast-architecture.md)                      |
| Tooltips                                          | [tooltip-architecture.md](agent_docs/tooltip-architecture.md)                  |
| Mermaid diagrams in markdown                      | [mermaid-support.md](agent_docs/mermaid-support.md)                            |

### For Contributors (Internals)

| Topic               | Doc                                                                  |
|---------------------|----------------------------------------------------------------------|
| Project structure   | [project-structure.md](agent_docs/project-structure.md)              |
| Core architecture   | [architecture.md](agent_docs/architecture.md)                        |
| Component reference | [component-reference.md](agent_docs/component-reference.md)          |
| Embedded assets     | [embedded-assets-architecture.md](agent_docs/embedded-assets-architecture.md) |
| Config system       | [config-architecture.md](agent_docs/config-architecture.md)          |
| Policy system       | [policy-architecture.md](agent_docs/policy-architecture.md)          |
| Server              | [server-architecture.md](agent_docs/server-architecture.md)          |
| Keyboard & focus    | [keyboard-focus-navigation-architecture.md](agent_docs/keyboard-focus-navigation-architecture.md) |
| Command element     | [command-element-architecture.md](agent_docs/command-element-architecture.md)                      |
| Graph/diagrams      | [graph-architecture.md](agent_docs/graph-architecture.md)            |
| Graphics pipeline   | [graphics-architecture.md](agent_docs/graphics-architecture.md)      |
| Isolines mode       | [isolines-architecture.md](agent_docs/isolines-architecture.md)      |
| Sixel protocol      | [sixel-architecture.md](agent_docs/sixel-architecture.md)            |
| Kitty protocol      | [kitty-architecture.md](agent_docs/kitty-architecture.md)            |
| iTerm2 protocol     | [iterm2-architecture.md](agent_docs/iterm2-architecture.md)          |
| Benchmarks          | [benchmark-architecture.md](agent_docs/benchmark-architecture.md)    |
| Media queries       | [architecture-media-queries.md](agent_docs/architecture-media-queries.md) |
| CSS & animations    | [css-animation-architecture.md](agent_docs/css-animation-architecture.md) |
| Pseudo-classes & transitions | [css-pseudo-classes-transitions-architecture.md](agent_docs/css-pseudo-classes-transitions-architecture.md) |
| Container queries   | [container-query-architecture.md](agent_docs/container-query-architecture.md) |
| CSS variables        | [css-variables-architecture.md](agent_docs/css-variables-architecture.md) |
| CSS themes           | [css-themes-architecture.md](agent_docs/css-themes-architecture.md)       |
| CSS nesting         | [css-nesting-architecture.md](agent_docs/css-nesting-architecture.md) |
| JSR distribution    | [jsr.md](agent_docs/jsr.md)                                           |

### Deep Dives

| Topic              | Doc                                                                  |
|--------------------|----------------------------------------------------------------------|
| Dirty row tracking | [dirty-row-tracking.md](agent_docs/dirty-row-tracking.md)            |
| Fast input render  | [fast-input-render.md](agent_docs/fast-input-render.md)              |
| Env permissions    | [env-permission-analysis.md](agent_docs/env-permission-analysis.md)  |
| Layout engine      | [layout-engine-notes.md](agent_docs/layout-engine-notes.md)          |

### Examples & Patterns

| Example    | Doc                                        |
|------------|--------------------------------------------|
| Map viewer | [map-example.md](agent_docs/map-example.md) |

### Project

| Topic            | Doc                                                          |
|------------------|--------------------------------------------------------------|
| Timeline         | [project-timeline.md](agent_docs/project-timeline.md)        |
| Release scheme   | [calver-release.md](agent_docs/calver-release.md)            |
| TUI comparison   | [tui-comparison.md](agent_docs/tui-comparison.md)            |

## Technology Stack

- **Runtime**: Deno 2.5+ (required, Node.js/Bun not supported)
- **Package**: @wistrand/melker
- **Target**: ANSI-compatible terminals

## Development Commands

```bash
deno task test         # Run tests
deno task check        # Type check
deno task build        # Build all (embedded assets, completions, skill zip, docs)
```

## Code Style

2-space indent, single quotes, semicolons, 100 char width.

## Documentation Style

- **Use markdown links** for file references: `[doc.md](path/to/doc.md)` not `` `path/to/doc.md` ``
- **Align table columns** by padding cells to consistent widths

## Critical Rules

1. **NO console.log in Melker source code** - When developing Melker itself (files in `src/`, `mod.ts`, `melker-*.ts`), **NEVER use `console.log()`**. Always use the logging system: `logger.debug()`, `logger.info()`, `logger.warn()`, `logger.error()`. Only app code (`.melker` files, examples) can use the overridden `console.log()` which redirects to the logger.
2. **Console redirects to logger (app code only)** - In `.melker` app code, `console.log()` redirects to `$melker.logger.info()` (won't break TUI), but prefer explicit `$melker.logger.debug()` etc.
3. **`alert()` shows a modal dialog** - Works like browser alert but as a TUI dialog (dismiss with OK button or Escape)
4. **Button label** - Use `<button>Label</button>` or `label="Label"` (not `title`)
5. **Don't add border to buttons** - Buttons render with `[ ]` brackets by default; adding border creates `[ [ Button ] ]`
6. **Avoid specifying colors** - Let the theme engine handle colors for best appearance across themes
7. **Input type is `'input'`** - Not `'text-input'`
8. **Auto-render in .melker handlers** - Event handlers auto-render after completion (call `$melker.skipRender()` to skip)
9. **Avoid emojis** - They break terminal layout
10. **Update component props explicitly** - In .melker files, there are no reactive bindings like `${$app.var}` . To update props dynamically, use `$melker.getElementById('id').props.propName = value`
11. **flex-direction is a style** - Use `style="flex-direction: row"` not `direction="row"`. Wrap select/combobox in row container to prevent cross-axis stretching.
12. **Primitive exports are copied by value** - `$app.varName = value` modifies a copy, not the original. Use setter functions: `export function setVar(v) { varName = v; }`
13. **Don't run `deno fmt` or `deno lint`** - User preference
14. **Always use `deno task test`** - Never manually construct `deno test ...` commands
15. **Never execute git add, commit or push commands**
