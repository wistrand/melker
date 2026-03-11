# TUI Framework Comparison

Comparison of terminal UI libraries across languages. Last updated: March 11, 2026.

## Overview

| Library                                                    | Language        | Stars  | Paradigm              | Layout         |
|------------------------------------------------------------|-----------------|--------|-----------------------|----------------|
| **Melker**                                                 | TypeScript/Deno+Node | New    | HTML-like declarative | Flexbox        |
| [Ink](https://github.com/vadimdemedes/ink)                 | JavaScript/Node | 35.4k  | React components      | Flexbox (Yoga) |
| [OpenTUI](https://github.com/sst/opentui)                 | TypeScript+Zig/Bun | 9.1k | React/SolidJS/Vue     | Flexbox (Yoga) |
| [Blessed](https://github.com/chjj/blessed)                | JavaScript/Node | 11.8k  | Imperative widgets    | CSS-like       |
| [Bubble Tea](https://github.com/charmbracelet/bubbletea)  | Go              | 40.2k  | Elm architecture      | CSS-like       |
| [tview](https://github.com/rivo/tview)                    | Go              | 13.6k  | Imperative widgets    | Grid/Flex      |
| [Textual](https://github.com/Textualize/textual)          | Python          | 34.6k  | Async widgets         | CSS/Grid       |
| [Ratatui](https://github.com/ratatui/ratatui)             | Rust            | 18.8k  | Immediate mode        | Constraints    |
| [Terminal.Gui](https://github.com/gui-cs/Terminal.Gui)    | C#/.NET         | 10.8k  | Imperative widgets    | Computed       |
| [FTXUI](https://github.com/ArthurSonzogni/FTXUI)          | C++             | 9.7k   | Functional/React-like | Flexbox        |
| [ncurses](https://invisible-island.net/ncurses/)          | C               | Legacy | Low-level             | Manual         |

## Feature Matrix

| Feature              | Melker | Ink | OpenTUI | Blessed | Bubble Tea | tview | Textual | Ratatui | Terminal.Gui | FTXUI |
|----------------------|:------:|:---:|:-------:|:-------:|:----------:|:-----:|:-------:|:-------:|:------------:|:-----:|
| No build step        |   Y    |  -  |    -    |    Y    |     -      |   -   |    Y    |    -    |      -       |   -   |
| Single binary        |   -    |  -  |    -    |    -    |     Y      |   Y   |    -    |    Y    |      Y       |   Y   |
| React ecosystem      |   -    |  Y  |    Y    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Auto color degrade   |   Y    |  Y  |    Y    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |   Y   |
| Mouse support        |   Y    |  ~  |    Y    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |   Y   |
| Animations           |   Y    |  Y  |    Y    |    Y    |     Y      |   -   |    Y    |    Y    |      -       |   Y   |
| 16M colors           |   Y    |  Y  |    Y    |    Y    |     Y      |   Y   |    Y    |    Y    |      ~       |   Y   |
| Pixel canvas         |   Y    |  -  |    -    |    -    |     -      |   -   |    ~    |    Y    |      -       |   Y   |
| Sixel/Kitty graphics |   Y    | Y*  |    -    |    -    |     -      |   -   |   Y*    |   Y*    |      -       |   -   |
| CSS styling          |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   -   |
| Web browser target   |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    Y    |      -       |   Y   |
| Command palette      |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   -   |
| No_std/embedded      |   -    |  -  |    -    |    -    |     -      |   -   |    -    |    Y    |      -       |   -   |
| SSH/network serve    |   Y    |  -  |    -    |    -    |     Y      |   -   |    Y    |    -    |      -       |   -   |
| i18n (built-in)      |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Node.js compat       |   Y    |  -  |    -    |    Y    |     -      |   -   |    -    |    -    |      -       |   -   |
| Sync output (2026)   |   Y    |  Y  |    Y    |    -    |     Y      |   -   |    -    |    -    |      -       |   -   |
| Maintained (Mar 2026)|   Y    |  Y  |    Y    |    -    |     Y      |   ~   |    Y    |    Y    |      Y       |   Y   |

Y = Full support, ~ = Partial/limited, - = Not available, Y* = Via extension

**Notes:**
- **Ink mouse**: Requires third-party package (ink-mouse)
- **Sixel/Kitty**: Ink via ink-picture, Textual via textual-image, Ratatui via ratatui-image
- **Terminal.Gui 16M colors**: v2 adds true color; v1 limited to 16 colors
- **Textual**: Textualize wound down May 2025; McGugan maintains as open source with undiminished pace

## Scripting & Code Style

| Library            | UI Definition             | Event Handling                  | State Management      |
|--------------------|---------------------------|---------------------------------|-----------------------|
| **Melker**         | HTML-like `.melker` files | Inline `onClick="..."` handlers | Mutable element props |
| **Ink**            | JSX components            | React event props               | useState/useReducer   |
| **OpenTUI**        | JSX/SolidJS/Vue components | React/Solid/Vue event props    | useState/signals      |
| **Blessed**        | JS object creation        | `.on('event', fn)`              | Direct mutation       |
| **Bubble Tea**     | Go structs + View()       | Msg -> Update()                 | Immutable Model       |
| **tview**          | Go constructors           | SetInputCapture()               | Direct mutation       |
| **Textual**        | Python classes            | `@on` decorators                | Reactive attributes   |
| **Ratatui**        | Rust widget structs       | Match on events                 | Immutable state       |
| **Terminal.Gui**   | C# class creation         | Event delegates                 | Direct mutation       |
| **FTXUI**          | C++ function composition  | Lambdas                         | Captured refs         |

### Code Examples

**Melker** - Declarative HTML-like:
```xml
<button label="Click" onClick="count++; render()" />
```

**Ink** - React JSX:
```jsx
<Box><Text onClick={() => setCount(c => c + 1)}>Click</Text></Box>
```

**OpenTUI** - React reconciler:
```tsx
import { Box, Text } from "@opentui/core";
<Box><Text>Count: {count}</Text></Box>
```

**Bubble Tea** - Elm architecture:
```go
func (m model) Update(msg tea.Msg) (tea.Model, tea.Cmd) {
    switch msg := msg.(type) {
    case tea.KeyMsg: m.count++
    }
    return m, nil
}
```

**Textual** - Python decorators:
```python
@on(Button.Pressed)
def handle_press(self): self.count += 1
```

**Ratatui** - Rust match:
```rust
if let Event::Key(key) = event {
    match key.code { KeyCode::Enter => state.count += 1, _ => {} }
}
```

**Terminal.Gui** - C# event delegates:
```csharp
var btn = new Button { Text = "Click" };
btn.Accept += (s, e) => { count++; };
Application.Run(new Toplevel { btn });
```

**FTXUI** - C++ lambdas:
```cpp
auto button = Button("Click", [&] { count++; });
```

## Styling Approaches

| Library            | Method              | Syntax                       | Theming                       |
|--------------------|---------------------|------------------------------|-------------------------------|
| **Melker**         | CSS inline + `<style>` | `border: thin; color: red`   | Auto-detect + manual themes   |
| **Ink**            | Props on components | `<Box borderStyle="round">`  | Via ink-ui                    |
| **OpenTUI**        | Props on components | `<Box border="round">`       | Manual                        |
| **Blessed**        | Options object      | `{border: {type: 'line'}}`   | Manual                        |
| **Lip Gloss**      | Chained methods     | `.Bold(true).Padding(1)`     | Auto color degrade            |
| **tview**          | Inline tags         | `[red]text[-]`               | tcell.Style                   |
| **Textual**        | External CSS files  | `.button { color: red; }`    | CSS variables                 |
| **Ratatui**        | Style struct        | `Style::new().fg(Red)`       | Manual                        |
| **Terminal.Gui**   | ColorScheme object  | `new ColorScheme(...)`       | Preset themes (v2)            |
| **FTXUI**          | Pipe decorators     | `text \| bold \| color(Red)` | Manual                        |

## By Language

|            | Melker      | Ink         | OpenTUI     | Blessed     | Bubble Tea  | tview       | Textual     | Ratatui     | Terminal.Gui | FTXUI       |
|------------|-------------|-------------|-------------|-------------|-------------|-------------|-------------|-------------|--------------|-------------|
| Language   | TS/Deno+Node| JS/Node     | TS+Zig/Bun  | JS/Node     | Go          | Go          | Python      | Rust        | C#/.NET      | C++          |
| Stars      | New         | 35.4k       | 9.1k        | 11.8k       | 40.2k       | 13.6k       | 34.6k       | 18.8k       | 10.8k        | 9.7k        |
| Paradigm   | Declarative | React       | React/Solid/Vue | Imperative | Elm/MVU    | Imperative  | Async       | Immediate   | Imperative   | Functional  |
| Build step | None        | Required    | Required    | None        | Required    | Required    | None        | Required    | Required     | Required    |
| Widgets    | 30+         | ~15         | ~12         | 27+         | Via Bubbles | 15+         | 35+         | Via crates  | 40+          | 10+         |
| Maintained | Y           | Y           | Y (pre-1.0) | Dead        | Y           | ~           | Y           | Y           | Y            | Y           |
| Used by    | -           | Claude Code, Gemini CLI | OpenCode, terminal.shop | - | GitHub, GitLab | K9s, gh CLI | Posting, Toad | gitui    | .NET CLI tools | -          |

## Component Comparison

| Component        | Melker | Ink | OpenTUI | Blessed | Bubble Tea | tview | Textual | Ratatui | Terminal.Gui | FTXUI |
|------------------|:------:|:---:|:-------:|:-------:|:----------:|:-----:|:-------:|:-------:|:------------:|:-----:|
| **Layout**       |        |     |         |         |            |       |         |         |              |       |
| Container/Box    |   Y    |  Y  |    Y    |    Y    |     -      |   Y   |    Y    |    Y    |      Y       |   Y   |
| Flexbox          |   Y    |  Y  |    Y    |    -    |     -      |   Y   |    -    |    -    |      -       |   Y   |
| Grid             |   -    |  -  |    -    |    -    |     -      |   Y   |    Y    |    -    |      -       |   Y   |
| Tabs             |   Y    |  -  |    Y    |    -    |     -      |   Y   |    Y    |    Y    |      Y       |   Y   |
| Collapsible      |   -    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   Y   |
| Split panes      |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      Y       |   Y   |
| **Text**         |        |     |         |         |            |       |         |         |              |       |
| Text/Label       |   Y    |  Y  |    Y    |    Y    |     -      |   Y   |    Y    |    Y    |      Y       |   Y   |
| Markdown         |   Y    |  -  |    -    |    -    |    Y*      |   -   |    Y    |    -    |      -       |   -   |
| Big text         |   -    |  -  |    Y    |    Y    |     -      |   -   |    Y    |   Y*    |      -       |   -   |
| **Input**        |        |     |         |         |            |       |         |         |              |       |
| Text input       |   Y    |  Y  |    Y    |    Y    |     Y      |   Y   |    Y    |    -    |      Y       |   Y   |
| Textarea         |   Y    |  -  |    Y    |    Y    |     Y      |   Y   |    Y    |   Y*    |      Y       |   -   |
| Checkbox         |   Y    |  -  |    -    |    Y    |     -      |   Y   |    Y    |   Y*    |      Y       |   Y   |
| Radio            |   Y    |  -  |    -    |    Y    |     -      |   -   |    Y    |    -    |      Y       |   Y   |
| Select/Dropdown  |   Y    |  Y  |    Y    |    -    |     -      |   Y   |    Y    |    -    |      Y       |   Y   |
| Slider           |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      Y       |   Y   |
| **Data**         |        |     |         |         |            |       |         |         |              |       |
| Table            |   Y    | Y*  |    -    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |   -   |
| Tree             |   Y    |  -  |    -    |    Y    |     -      |   Y   |    Y    |    -    |      Y       |   -   |
| List             |   Y    |  Y  |    -    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |   Y   |
| **Feedback**     |        |     |         |         |            |       |         |         |              |       |
| Progress bar     |   Y    |  Y  |    -    |    Y    |     Y      |   -   |    Y    |    Y    |      Y       |   Y   |
| Spinner          |   Y    |  Y  |    -    |    Y    |     Y      |   -   |    Y    |    -    |      Y       |   -   |
| Toast            |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   -   |
| Sparkline        |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    Y    |      -       |   -   |
| **Navigation**   |        |     |         |         |            |       |         |         |              |       |
| Button           |   Y    |  -  |    -    |    Y    |     -      |   Y   |    Y    |    -    |      Y       |   Y   |
| Dialog/Modal     |   Y    |  -  |    -    |    Y    |     -      |   Y   |    Y    |    -    |      Y       |   -   |
| **Graphics**     |        |     |         |         |            |       |         |         |              |       |
| Canvas           |   Y    |  -  |    -    |    -    |     -      |   -   |    ~    |    Y    |      -       |   Y   |
| Image            |  Y*    |  -  |    -    |    Y    |     -      |   Y   |    -    |   Y*    |      -       |   -   |
| Bar chart        |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    Y    |      -       |   Y   |
| **Special**      |        |     |         |         |            |       |         |         |              |       |
| File browser     |   Y    |  -  |    -    |    Y    |     Y      |   -   |    Y    |    -    |      Y       |   -   |
| Scrollbar        |   Y    |  -  |    Y    |    -    |     -      |   -   |    Y    |    Y    |      Y       |   -   |
| Syntax highlight |   -    |  -  |    Y    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |

Y = Built-in, Y* = Via extension/crate, ~ = Partial/limited, - = Not available

**Notes:**
- **Bubble Tea markdown**: Via Glamour library
- **Ratatui image/textarea/checkbox**: Via community crates
- **OpenTUI big text**: Via AsciiFont component with FIGlet-style fonts
- **OpenTUI**: Built-in Code component (tree-sitter highlighting) and Diff viewer
- **Terminal.Gui**: 40+ views including TableView, TreeView, TileView, DatePicker, ColorPicker

## Architecture Patterns

| Pattern             | Libraries                              |
|---------------------|----------------------------------------|
| **React/Component** | Ink, OpenTUI, FTXUI, Melker            |
| **Elm/MVU**         | Bubble Tea, Ratatui                    |
| **Imperative**      | Blessed, tview, ncurses, Terminal.Gui  |
| **Async/Reactive**  | Textual                                |
| **Immediate Mode**  | Ratatui                                |

## Rendering Strategies

| Strategy       | Libraries                  | Description                                    |
|----------------|----------------------------|------------------------------------------------|
| Immediate mode | Ratatui, FTXUI             | Redraw entire UI each frame (fast in Rust/C++) |
| Dual buffer    | Melker, Ratatui, OpenTUI   | Compare buffers, write diff                    |
| Damage buffer  | Blessed, Terminal.Gui      | Track changed regions                          |
| Yoga layout    | Ink, OpenTUI               | Facebook's flexbox engine                      |
| Virtual DOM    | Ink, OpenTUI               | React/SolidJS/Vue reconciliation               |

**Performance notes:**
- **Immediate mode** (Ratatui, FTXUI): Raw language speed makes full redraws fast
- **Retained mode** (Melker, Ink, Textual, OpenTUI, Terminal.Gui): Layout caching reduces work per frame
- **Ratatui**: Sub-millisecond rendering with zero-cost abstractions
- **OpenTUI**: Frame diffing computed in Zig via FFI, sub-ms frame times claimed

## Pixel Canvas

|                  | Melker         | Ratatui            | FTXUI          | Textual     |
|------------------|----------------|--------------------|----------------|-------------|
| Mode             | Retained       | Immediate          | Immediate      | Immediate   |
| Encoding         | Sextant (2x3)  | Braille/Sextant/Octant | Braille/Block  | Shapes only |
| Resolution       | 2x3 per cell   | Up to 2x4 per cell | 2x4 per cell   | N/A         |
| True color       | Y              | Y                  | Y              | -           |

**Ratatui canvas**: Quadrant (2x2), Sextant (2x3), Octant (2x4), Braille (2x4), HalfBlock (1x2). Braille can layer over Block symbols.

## Terminal Graphics Protocols (Sixel/Kitty)

|                    | Melker      | Ink         | Textual     | Ratatui     |
|--------------------|-------------|-------------|-------------|-------------|
| Sixel              | Y           | Y*          | Y*          | Y*          |
| Kitty protocol     | Y           | Y*          | Y*          | Y*          |
| iTerm2 protocol    | Y           | Y*          | -           | Y*          |
| Auto-detection     | Y           | Y*          | Y*          | Y*          |
| Fallback (Unicode) | Y (sextant) | Y* (braille)| Y* (Unicode)| Y (braille) |

Y = Built-in, Y* = Via extension library

**Extension libraries:**
- **Ink**: [ink-picture](https://github.com/endernoke/ink-picture)
- **Textual**: [textual-image](https://github.com/lnqs/textual-image)
- **Ratatui**: [ratatui-image](https://github.com/benjajaja/ratatui-image)

**Terminal support:**

| Terminal     | Sixel | Kitty | iTerm2 | Sextant |
|--------------|:-----:|:-----:|:------:|:-------:|
| Kitty        |   -   |   Y   |   -    |    Y    |
| iTerm2       |   Y   |   -   |   Y    |    Y    |
| WezTerm      |   Y   |   Y   |   Y    |    Y    |
| Ghostty      |   -   |   Y   |   -    |    Y    |
| foot         |   Y   |   -   |   -    |    Y    |
| Konsole      |   Y   |   ~   |   Y    |    Y    |
| VS Code term |   Y   |   -   |   -    |    Y    |
| xterm        |   Y   |   -   |   -    |    Y    |
| Windows Term |   ~   |   -   |   -    |    Y    |
| tmux         |  Y*   |   -   |   Y*   |    Y    |

## Unique Strengths

| Library            | Killer Feature                                                          |
|--------------------|-------------------------------------------------------------------------|
| **Melker**         | HTML-like markup files, permission sandbox, no build step, built-in i18n |
| **Ink**            | Full React ecosystem, used by Claude Code/Gemini CLI, 35k stars        |
| **OpenTUI**        | Zig FFI for sub-ms rendering, React+SolidJS+Vue reconcilers            |
| **Textual**        | Terminal + browser target, CSS styling, 35+ widgets, rapid releases     |
| **Ratatui**        | Rust safety, no_std/embedded, immediate mode performance, modular crates |
| **Bubble Tea**     | Elm architecture, 40k stars, SSH serving, huge ecosystem                |
| **tview**          | Battle-tested (K9s, gh CLI), rich widgets, backwards compatible         |
| **Terminal.Gui**   | .NET ecosystem, 40+ widgets, data validation, Swing-like API            |
| **FTXUI**          | Zero deps, WebAssembly, pixel canvas, pipe operator syntax              |

## Corporate Adoption

| Library            | Used By                                                                                                                              |
|--------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| **Ink**            | Claude Code (Anthropic), Gemini CLI (Google), GitHub Copilot CLI, Gatsby, Yarn, Prisma, Parcel, Shopify, Terraform CDK               |
| **OpenTUI**        | OpenCode (SST AI coding agent), terminal.shop                                                                                        |
| **Bubble Tea**     | GitHub, GitLab, NVIDIA, Sourcegraph, Charm (Glow, VHS, etc.)                                                                         |
| **tview**          | K9s (Kubernetes CLI), GitHub CLI (gh), podman-tui                                                                                    |
| **Textual**        | Posting (API client), Toad (AI coding UI), Harlequin (SQL IDE), Elia (LLM chat), Toolong                                            |
| **Ratatui**        | gitui, bottom, spotify-tui, jnv, termscp                                                                                             |
| **Terminal.Gui**   | PwshSpectreConsole, various .NET CLI tools                                                                                            |

## Choosing a Library

| If you want...             | Choose                                             |
|----------------------------|----------------------------------------------------|
| React knowledge reuse      | **Ink**, **OpenTUI**                               |
| Python + modern async      | **Textual**                                        |
| Rust performance           | **Ratatui**                                        |
| Go + Elm architecture      | **Bubble Tea**                                     |
| Go + quick widgets         | **tview**                                          |
| C++ + no deps              | **FTXUI**                                          |
| .NET / C# ecosystem        | **Terminal.Gui**                                   |
| HTML-like markup           | **Melker**                                         |
| Built-in i18n              | **Melker**                                         |
| CSS styling                | **Textual**, **Melker**                            |
| Browser + terminal         | **Textual**, **Ratatui** (Ratzilla), **FTXUI**     |
| Pixel graphics             | **FTXUI**, **Ratatui**, **Melker**                 |
| Embedded/no_std            | **Ratatui**                                        |
| SSH/network serving        | **Bubble Tea**, **Textual**, **Melker**             |
| Most GitHub stars          | **Bubble Tea** (40.2k), **Ink** (35.4k), **Textual** (34.6k) |

## Recent Updates (2025-2026)

| Library            | Version     | Notable Changes                                                                   |
|--------------------|-------------|-----------------------------------------------------------------------------------|
| **Melker**         | v2026.3.7   | i18n subsystem (@key sigils, message catalogs, plural/number/date), Node.js 25+ support, tile map (SVG overlays, disk cache), bind-selection, data boxplot, DevTools I18n tab |
| **Ink**            | v6.8.0      | `renderToString()`, Mode 2026 sync output, Kitty keyboard, `useCursor` API for IME |
| **OpenTUI**        | v0.1.86     | Very active pre-1.0. TS+Zig core, React/SolidJS/Vue reconcilers. 9.1k stars in ~8 months. Powers OpenCode. "Not ready for production use" per README |
| **Bubble Tea**     | v2.0.1      | v2.0.0 (Feb 2026): View struct API, declarative views, "Cursed Renderer" (ncurses), Mode 2027 wide Unicode, Kitty keyboard, native clipboard. Bubbles v1.0.0, Lip Gloss v2.0.0-beta.3 |
| **Textual**        | v8.0.2      | Rapid releases: 1.0 (Dec 2024) through 8.0.2 (Mar 2026). Catppuccin themes, screen mode signals. McGugan maintains as open source since Textualize wound down May 2025 |
| **Ratatui**        | v0.30.0     | "Biggest release ever" (Dec 2025). no_std for embedded, modular workspace, `ratatui::run()` API, Sextant/Octant markers. 18.7M crates.io downloads. Ratzilla v0.3.0 (WebAssembly) |
| **Terminal.Gui**   | v2 alpha    | v1.19 stable (Jun 2025). v2 beta at 99% (275/277 issues closed); v2 stable targeted Mar 31, 2026. True color, overhauled theming |
| **FTXUI**          | v6.1.9      | Text selection, color transparency. Last tagged release May 2025, active commits through Mar 2026 |
| **tview**          | Rolling     | Last commit Mar 2, 2026. Prior gap of 5+ months. K9s uses a fork (`derailed/tview`) |
| **Blessed**        | Dead        | Last commit January 2016. neo-blessed fork has limited maintenance                |

**Notes:**
- **Bubble Tea v2**: Major architecture overhaul with declarative View struct replacing string-based rendering
- **Ink adopters**: Claude Code (Anthropic, custom React renderer) and Gemini CLI (Google) both use Ink 6 + React 19
- **Mode 2026**: DEC synchronized output protocol adopted by Ink v6.7+ and Bubble Tea v2, making frame updates atomic
- **Terminal.Gui v2**: Multi-year rewrite with true color, flexible theming, 40+ views

## Emerging Frameworks

| Library                                                  | Language | Stars | Description                                            |
|----------------------------------------------------------|----------|-------|--------------------------------------------------------|
| [Mosaic](https://github.com/JakeWharton/mosaic)         | Kotlin   | 2.6k  | Terminal UI via Jetpack Compose compiler/runtime        |
| [libvaxis](https://github.com/rockorager/libvaxis)       | Zig      | 1.6k  | Modern TUI library with Flutter-like vxfw framework    |
| [iocraft](https://github.com/ccbrown/iocraft)           | Rust     | 1.1k  | React-like declarative TUI inspired by Ink and Dioxus  |
| [Cursive](https://github.com/gyscos/cursive)            | Rust     | 4.7k  | High-level TUI with views, menus, layers, themes       |
| [Brick](https://github.com/jtdaugherty/brick)           | Haskell  | 1.7k  | Declarative composable widgets, cross-platform (2.10)  |
| [Nocterm](https://github.com/nicholasgasior/nocterm)    | Dart     | 273   | Flutter-inspired TUI with widget tree and themes       |
| [Rezi](https://github.com/RtlZeroMemory/Rezi)          | TS/C     | 501   | Native C rendering engine, 56 widgets, JSX. Pre-alpha  |

**Trends (2025-2026):**
- **Declarative paradigms**: React (Ink, OpenTUI, iocraft), Compose (Mosaic), Elm (Bubbletea) — web/mobile UI patterns coming to the terminal
- **Hybrid native backends**: OpenTUI (Zig) and Rezi (C) delegate rendering to compiled languages while keeping TypeScript APIs
- **v2 rewrites**: Bubble Tea v2.0.0, Lip Gloss v2, Terminal.Gui v2, Brick v2 — major architecture overhauls
- **no_std / embedded**: Ratatui v0.30.0 added no_std for microcontrollers (ESP32, STM32H7)
- **WebAssembly targets**: FTXUI, Ratatui (Ratzilla), and Textual all support browser targets
- **AI-powered TUI development**: OpenCode uses OpenTUI, Charm's Crush uses Bubble Tea — AI tools shipping with custom TUIs

## Links

### TUI Frameworks
- [Awesome TUIs](https://github.com/rothgar/awesome-tuis) - Curated list
- [Ink](https://github.com/vadimdemedes/ink) - React for CLI
- [Ink UI](https://ink-ui.vadimdemedes.com/) - Component library for Ink
- [OpenTUI](https://github.com/sst/opentui) - TypeScript+Zig TUI with React/SolidJS/Vue reconcilers
- [OpenCode](https://github.com/sst/opencode) - AI coding agent built with OpenTUI
- [Blessed](https://github.com/chjj/blessed) - Node.js widgets (dead since 2016)
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) - Go Elm architecture
- [Bubbles](https://github.com/charmbracelet/bubbles) - Components for Bubble Tea
- [Lip Gloss](https://github.com/charmbracelet/lipgloss) - Go styling
- [tview](https://github.com/rivo/tview) - Go widgets
- [Textual](https://github.com/Textualize/textual) - Python async TUI
- [Ratatui](https://github.com/ratatui/ratatui) - Rust immediate mode
- [Ratzilla](https://github.com/ratatui/ratzilla) - Ratatui WebAssembly backend
- [Terminal.Gui](https://github.com/gui-cs/Terminal.Gui) - C#/.NET cross-platform TUI
- [FTXUI](https://github.com/ArthurSonzogni/FTXUI) - C++ functional
- [Cursive](https://github.com/gyscos/cursive) - Rust high-level TUI
- [Brick](https://github.com/jtdaugherty/brick) - Haskell declarative TUI
- [Mosaic](https://github.com/JakeWharton/mosaic) - Kotlin terminal UI via Jetpack Compose
- [iocraft](https://github.com/ccbrown/iocraft) - Rust React-like declarative TUI
- [libvaxis](https://github.com/rockorager/libvaxis) - Zig modern TUI
- [OSS Insight TUI Rankings](https://ossinsight.io/collections/tui-framework/) - Live star rankings

### Terminal Graphics
- [Are We Sixel Yet?](https://www.arewesixelyet.com/) - Terminal Sixel support tracker
- [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) - Protocol specification
- [ratatui-image](https://github.com/benjajaja/ratatui-image) - Ratatui image widget
- [textual-image](https://github.com/lnqs/textual-image) - Textual image widget
- [ink-picture](https://github.com/endernoke/ink-picture) - Ink image component
