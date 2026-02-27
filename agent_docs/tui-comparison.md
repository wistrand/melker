# TUI Framework Comparison

Comprehensive comparison of terminal UI libraries across languages. Last updated: February 27, 2026.

## Overview

| Library                                                    | Language        | Stars  | Paradigm              | Layout         |
|------------------------------------------------------------|-----------------|--------|-----------------------|----------------|
| **Melker**                                                 | TypeScript/Deno | New    | HTML-like declarative | Flexbox        |
| [Ink](https://github.com/vadimdemedes/ink)                 | JavaScript/Node | 35.2k  | React components      | Flexbox (Yoga) |
| [OpenTUI](https://github.com/sst/opentui)                 | TypeScript+Zig/Bun | 9k  | React/SolidJS/Vue     | Flexbox (Yoga) |
| [Blessed](https://github.com/chjj/blessed)                | JavaScript/Node | 11.8k  | Imperative widgets    | CSS-like       |
| [Bubble Tea](https://github.com/charmbracelet/bubbletea)  | Go              | 40k    | Elm architecture      | CSS-like       |
| [tview](https://github.com/rivo/tview)                    | Go              | 13.6k  | Imperative widgets    | Grid/Flex      |
| [Textual](https://github.com/Textualize/textual)          | Python          | 34.5k  | Async widgets         | CSS/Grid       |
| [Ratatui](https://github.com/ratatui/ratatui)             | Rust            | 18.7k  | Immediate mode        | Constraints    |
| [Terminal.Gui](https://github.com/gui-cs/Terminal.Gui)    | C#/.NET         | 10.8k  | Imperative widgets    | Computed       |
| [FTXUI](https://github.com/ArthurSonzogni/FTXUI)          | C++             | 9.7k   | Functional/React-like | Flexbox        |
| [ncurses](https://invisible-island.net/ncurses/)          | C               | Legacy | Low-level             | Manual         |

## Feature Matrix

| Feature              | Melker | Ink | OpenTUI | Blessed | Bubble Tea | tview | Textual | Ratatui | Terminal.Gui | FTXUI |
|----------------------|:------:|:---:|:-------:|:-------:|:----------:|:-----:|:-------:|:-------:|:------------:|:-----:|
| No-build run         |   Y    |  -  |    -    |    Y    |     -      |   -   |    Y    |    -    |      -       |   -   |
| Run from URL         |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| App approval system  |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Permission sandbox   |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| AI accessibility     |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| OAuth built-in       |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| State persistence    |   Y    |  -  |    -    |    -    |     -      |   -   |    ~    |    -    |      -       |   -   |
| LSP support          |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Web browser          |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    Y    |      -       |   Y   |
| React ecosystem      |   -    |  Y  |    Y    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Single binary        |   -    |  -  |    -    |    -    |     Y      |   Y   |    -    |    Y    |      Y       |   Y   |
| Auto color degrade   |   Y    |  Y  |    Y    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |   Y   |
| Mouse support        |   Y    |  ~  |    Y    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |   Y   |
| Unicode/emoji        |   Y    |  Y  |    Y    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |   Y   |
| Animations           |   Y    |  Y  |    Y    |    Y    |     Y      |   -   |    Y    |    Y    |      -       |   Y   |
| 16M colors           |   Y    |  Y  |    Y    |    Y    |     Y      |   Y   |    Y    |    Y    |      ~       |   Y   |
| Video playback       |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Pixel canvas         |   Y    |  -  |    -    |    -    |     -      |   -   |    ~    |    Y    |      -       |   Y   |
| Sixel/Kitty graphics |   Y    | Y*  |    -    |    -    |     -      |   -   |   Y*    |   Y*    |      -       |   -   |
| Mermaid diagrams     |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Literate UI (.md)    |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Command palette      |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   -   |
| Media queries        |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Container queries    |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| CSS animations       |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   -   |
| No_std/embedded      |   -    |  -  |    -    |    -    |     -      |   -   |    -    |    Y    |      -       |   -   |
| SSH/network serve    |   Y    |  -  |    -    |    -    |     Y      |   -   |    Y    |    -    |      -       |   -   |
| Debug/remote inspect |   Y    |  Y  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   -   |
| Maintained (Feb 2026)|   Y    |  Y  |    Y    |    -    |     Y      |   ~   |    Y    |    Y    |      Y       |   Y   |

Y = Full support, ~ = Partial/limited support, - = Not available

**Notes:**
- **Ink mouse**: Requires third-party package (ink-mouse)
- **Melker animations**: CSS `@keyframes` animations (color, numeric, spacing interpolation) plus canvas shaders
- **OpenTUI animations**: Timeline-based animation API with easing functions
- **OpenTUI reconcilers**: React, SolidJS, and Vue reconcilers available
- **Textual state**: Reactive attributes, not automatic persistence like Melker. Textualize (company) wound down May 2025; McGugan maintains as open source with undiminished pace
- **Ratatui canvas**: Quadrant (2x2), Sextant (2x3), Octant (2x4), Braille (2x4), HalfBlock (1x2)
- **Ratatui no_std**: Added in v0.30.0 for embedded targets
- **Sixel/Kitty**: Ink via ink-picture, Textual via textual-image, Ratatui via ratatui-image
- **Textual CSS animations**: Supports `@keyframes` with `animation` shorthand in external CSS
- **Mermaid**: Melker has native `<graph>` component; others require external CLI tools
- **Terminal.Gui 16M colors**: v2 (beta due Feb 2026) adds true color support; v1 limited to 16 colors

## Abstraction Levels

| Level            | Description               | Libraries                         |
|------------------|---------------------------|-----------------------------------|
| **Low-level**    | Direct terminal control   | ncurses, Termbox                  |
| **Programmatic** | createElement/widget APIs | All frameworks                    |
| **Declarative**  | Markup files (HTML/JSX)   | Melker, Ink, OpenTUI, Textual     |
| **Literate**     | Prose + embedded UI       | Melker only                       |

**Melker's three levels:**

1. **Programmatic** - TypeScript createElement API:
```typescript
const btn = createElement('button', { label: 'Click', onClick: () => count++ });
root.appendChild(btn);
```

2. **Declarative** - `.melker` HTML-like files:
```xml
<button label="Click" onClick="count++" />
```

3. **Literate** - `.melker.md` Markdown with embedded UI:
```markdown
# My App

This button increments a counter:

<button label="Click" onClick="count++" />

The count is displayed below.
```

Most frameworks only offer programmatic APIs. Ink adds JSX but requires a build step. Textual has external CSS but Python-only UI. Melker uniquely supports literate programming where documentation and UI coexist.

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
| **Melker**         | CSS inline + `<style>` | `border: thin; color: red`   | Auto-detect + 8 manual themes |
| **Ink**            | Props on components | `<Box borderStyle="round">`  | Via ink-ui                    |
| **OpenTUI**        | Props on components | `<Box border="round">`       | Manual                        |
| **Blessed**        | Options object      | `{border: {type: 'line'}}`   | Manual                        |
| **Lip Gloss**      | Chained methods     | `.Bold(true).Padding(1)`     | Auto color degrade            |
| **tview**          | Inline tags         | `[red]text[-]`               | tcell.Style                   |
| **Textual**        | External CSS files  | `.button { color: red; }`    | CSS variables                 |
| **Ratatui**        | Style struct        | `Style::new().fg(Red)`       | Manual                        |
| **Terminal.Gui**   | ColorScheme object  | `new ColorScheme(...)`       | Preset themes (v2)            |
| **FTXUI**          | Pipe decorators     | `text \| bold \| color(Red)` | Manual                        |

### Style Examples

**Melker** - CSS-like inline:
```xml
<container style="border: rounded; padding: 1; color: cyan; background-color: #222">
```

**Ink** - React props:
```jsx
<Box borderStyle="round" padding={1}><Text color="cyan">Hi</Text></Box>
```

**Lip Gloss** - Method chaining:
```go
style := lipgloss.NewStyle().Border(lipgloss.RoundedBorder()).Padding(1).Foreground(lipgloss.Color("cyan"))
```

**tview** - Tag markup:
```go
textView.SetText("[cyan]Hello [red::b]World[-:-:-]")
```

**Textual** - External CSS:
```css
Button { background: $primary; border: round; }
```

**Ratatui** - Struct builder:
```rust
Paragraph::new("Hi").style(Style::new().fg(Color::Cyan)).block(Block::bordered())
```

**Terminal.Gui** - ColorScheme:
```csharp
button.ColorScheme = new ColorScheme(
    normal: new(Color.White, Color.Blue),
    focus: new(Color.Black, Color.Cyan));
```

**FTXUI** - Pipe operator:
```cpp
text("Hello") | border | color(Color::Cyan)
```

## By Language

|            | Melker      | Ink         | OpenTUI     | Blessed     | Bubble Tea  | tview       | Textual     | Ratatui     | Terminal.Gui | FTXUI       |
|------------|-------------|-------------|-------------|-------------|-------------|-------------|-------------|-------------|--------------|-------------|
| Language   | TS/Deno     | JS/Node     | TS+Zig/Bun  | JS/Node     | Go          | Go          | Python      | Rust        | C#/.NET      | C++          |
| Stars      | New         | 35.2k       | 9k          | 11.8k       | 40k         | 13.6k       | 34.5k       | 18.7k       | 10.8k        | 9.7k        |
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
| Combobox         |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      Y       |   -   |
| Autocomplete     |   Y    |  -  |    -    |    -    |     -      |   Y   |    Y    |    -    |      ~       |   -   |
| Slider           |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      Y       |   Y   |
| Masked input     |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   -   |
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
| Menu             |   Y    |  -  |    -    |    Y    |     -      |   -   |    -    |    -    |      Y       |   Y   |
| Menu bar         |   Y    |  -  |    -    |    Y    |     -      |   -   |    -    |    -    |      Y       |   -   |
| Link             |   -    |  Y  |    -    |    -    |     -      |   -   |    Y    |    -    |      -       |   -   |
| **Dialogs**      |        |     |         |         |            |       |         |         |              |       |
| Dialog/Modal     |   Y    |  -  |    -    |    Y    |     -      |   Y   |    Y    |    -    |      Y       |   -   |
| Prompt           |   Y    |  Y  |    -    |    Y    |     -      |   -   |    -    |    -    |      -       |   -   |
| Confirm          |   Y    |  -  |    -    |    Y    |     -      |   -   |    -    |    -    |      Y       |   -   |
| Alert            |   Y    |  -  |    -    |    Y    |     -      |   -   |    -    |    -    |      Y       |   -   |
| **Graphics**     |        |     |         |         |            |       |         |         |              |       |
| Canvas           |   Y    |  -  |    -    |    -    |     -      |   -   |    ~    |    Y    |      -       |   Y   |
| Shaders          |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |   Y*    |      -       |   -   |
| Image            |  Y*    |  -  |    -    |    Y    |     -      |   Y   |    -    |   Y*    |      -       |   -   |
| Video            |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Chart            |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    Y    |      -       |   Y   |
| **Special**      |        |     |         |         |            |       |         |         |              |       |
| File browser     |   Y    |  -  |    -    |    Y    |     Y      |   -   |    Y    |    -    |      Y       |   -   |
| Calendar         |   -    |  -  |    -    |    -    |     -      |   -   |    -    |    Y    |      Y       |   -   |
| Scrollbar        |   Y    |  -  |    Y    |    -    |     -      |   -   |    Y    |    Y    |      Y       |   -   |
| Syntax highlight |   -    |  -  |    Y    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |
| Diff viewer      |   -    |  -  |    Y    |    -    |     -      |   -   |    -    |    -    |      -       |   -   |

Y = Built-in, Y* = Via extension/crate, ~ = Partial/limited, - = Not available

**Notes:**
- **Bubble Tea markdown**: Via Glamour library from Charmbracelet
- **Ratatui shaders**: Via tachyonfx crate for shader-like effects
- **Ratatui image**: Via ratatui-image crate with sixel/halfblock support
- **Melker tree**: Native `<data-tree>` component with expand/collapse, selection, multi-column, virtual scrolling
- **OpenTUI Code**: Built-in `Code` component with tree-sitter syntax highlighting
- **OpenTUI Diff**: Built-in `Diff` component for displaying code diffs
- **OpenTUI AsciiFont**: Built-in large text rendering via FIGlet-style fonts
- **OpenTUI big text**: Via AsciiFont component
- **Terminal.Gui widgets**: 40+ views including TableView, TreeView, TileView (split panes), TabView, DatePicker, ColorPicker, SpinnerView, Slider
- **Terminal.Gui autocomplete**: ComboBox has basic autocomplete behavior; no standalone autocomplete widget

## Architecture Patterns

| Pattern             | Libraries                              |
|---------------------|----------------------------------------|
| **React/Component** | Ink, OpenTUI, FTXUI, Melker            |
| **Elm/MVU**         | Bubble Tea, Ratatui                    |
| **Imperative**      | Blessed, tview, ncurses, Terminal.Gui  |
| **Async/Reactive**  | Textual                                |
| **Immediate Mode**  | Ratatui                                |

## Artifact Model & Permissions

| Library            | Language | Paradigm      | Artifact Model       | Permissions |
|--------------------|----------|---------------|----------------------|-------------|
| **Melker**         | TS/Deno  | Declarative   | Document + execution | Declared    |
| Ink                | JS       | React         | Program              | Inherited   |
| OpenTUI            | TS/Bun   | React/Solid   | Program              | Inherited   |
| Bubble Tea         | Go       | Elm           | Program              | Inherited   |
| Textual            | Python   | Async widgets | Program              | Inherited   |
| Ratatui            | Rust     | Immediate     | Program              | Inherited   |
| Terminal.Gui       | C#       | Imperative    | Program              | Inherited   |

**Artifact Model:**
- **Document + execution**: UI defined as a document (`.melker` file) containing markup and behavior, executed by a runtime. Similar to HTML in a browser.
- **Program**: Compiled/interpreted code that produces TUI output. The artifact IS the program.

**Permissions:**
- **Declared**: Permissions declared in the artifact via `<policy>` tag; runtime enforces sandbox. User approves on first run.
- **Inherited**: Program inherits whatever permissions the user/OS grants at execution time. No built-in sandboxing.

This distinction mirrors web vs native: Melker treats TUI apps like web pages (sandboxed documents), while traditional TUI libraries produce native programs with full inherited authority.

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
- **Melker's fast input path**: Bypasses layout for text input, renders at cached bounds
- **Ratatui**: Sub-millisecond rendering with zero-cost abstractions
- **OpenTUI**: Frame diffing computed in Zig via FFI, sub-ms frame times claimed
- **Terminal.Gui**: ConsoleDriver abstraction with dirty-region tracking; v2 overhauls rendering pipeline

## Pixel Canvas

|                  | Melker         | Ratatui            | FTXUI          | Textual     | OpenTUI    |
|------------------|----------------|--------------------|----------------|-------------|------------|
| Mode             | Retained       | Immediate          | Immediate      | Immediate   | -          |
| Encoding         | Sextant (2x3)  | Braille/Sextant/Octant | Braille/Block  | Shapes only | -          |
| Resolution       | 2x3 per cell   | Up to 2x4 per cell | 2x4 per cell   | N/A         | -          |
| True color       | Y              | Y              | Y              | -           | -          |
| Auto-dither      | Y              | -              | -              | -           | -          |
| onPaint callback | Y              | -              | -              | -           | -          |
| Shader support   | Y              | Y*             | -              | -           | -          |

**Retained vs Immediate mode:**
- **Retained**: Canvas maintains pixel buffer; framework handles when to redraw (`onPaint` callback)
- **Immediate**: App redraws entire canvas each frame in render loop

**Melker** - Retained mode with sextant chars:
```xml
<canvas id="c" width="60" height="30" onPaint="draw(event.canvas)" />
```
```typescript
function draw(canvas) {
  canvas.setPixel(x, y, 0xFF0000FF);  // RGBA packed
  canvas.line(0, 0, 59, 29, color);
  canvas.rect(10, 10, 20, 15, color);
}
```

**Melker** - Shader-based animation (TypeScript callback, not GLSL):
```xml
<canvas id="c" width="60" height="30" shaderFps="30"
  onShader="(x, y, time, res, src, utils) => {
    const n = utils.fbm(x * 0.05 + time, y * 0.05);
    return utils.palette(n, [0.5,0.5,0.5], [0.5,0.5,0.5], [1,1,1], [0,0.33,0.67]);
  }"
/>
```

**Ratatui** - Immediate mode with braille:
```rust
let canvas = Canvas::default()
    .paint(|ctx| {
        ctx.draw(&Line { x1: 0.0, y1: 0.0, x2: 10.0, y2: 10.0, color: Color::Red });
    });
```

**FTXUI** - Immediate mode with braille/block:
```cpp
auto c = Canvas(100, 100);
c.DrawPoint(x, y, Color::Red);
c.DrawPointLine(x1, y1, x2, y2);
```

## Terminal Graphics Protocols (Sixel/Kitty)

Modern terminals support pixel-perfect image rendering via specialized protocols.

|                    | Melker      | Ink         | OpenTUI     | Textual     | Ratatui     | Bubble Tea | tview | FTXUI |
|--------------------|-------------|-------------|-------------|-------------|-------------|------------|-------|-------|
| Sixel              | Y           | Y*          | -           | Y*          | Y*          | -          | -     | -     |
| Kitty protocol     | Y           | Y*          | -           | Y*          | Y*          | -          | -     | -     |
| iTerm2 protocol    | Y           | Y*          | -           | -           | Y*          | -          | -     | -     |
| Auto-detection     | Y           | Y*          | -           | Y*          | Y*          | -          | -     | -     |
| Fallback (Unicode) | Y (sextant) | Y* (braille) | -           | Y* (Unicode) | Y (braille) | -          | -     | -     |

Y = Built-in, Y* = Via extension/library, - = Not available

**Protocol notes:**
- **Sixel**: DEC VT340 protocol (1980s), wide terminal support, limited to 256 colors, no alpha
- **Kitty**: Modern protocol with full RGBA, requires Kitty 0.28+, also supported by WezTerm, Ghostty
- **iTerm2**: macOS-focused protocol, also supported by WezTerm, Rio, Konsole; no size limits

**Extension libraries:**
- **Ink**: [ink-picture](https://github.com/endernoke/ink-picture) - sixel, kitty, iTerm2, auto-detection
- **Textual**: [textual-image](https://github.com/lnqs/textual-image) - Kitty TGP, Sixel with fallback
- **Ratatui**: [ratatui-image](https://github.com/benjajaja/ratatui-image) - sixel, kitty, iTerm2, halfblock fallback

**Terminal support:**

| Terminal     | Sixel | Kitty | iTerm2 | Sextant |
|--------------|:-----:|:-----:|:------:|:-------:|
| Kitty        |   -   |   Y   |   -    |    Y    |
| iTerm2       |   Y   |   -   |   Y    |    Y    |
| WezTerm      |   Y   |   Y   |   Y    |    Y    |
| Ghostty      |   -   |   Y   |   -    |    Y    |
| foot         |   Y   |   -   |   -    |    Y    |
| Konsole      |   Y   |   ~   |   Y    |    Y    |
| Rio          |   -   |   -   |   Y    |    -    |
| VS Code term |   Y   |   -   |   -    |    Y    |
| xterm        |   Y   |   -   |   -    |    Y    |
| Windows Term |   ~   |   -   |   -    |    Y    |
| tmux         |  Y*   |   -   |   Y*   |    Y    |

Y = Full support, ~ = Partial, Y* = Passthrough depends on underlying terminal

**Sextant note:** Rio terminal does not render Unicode Sextant Block characters (U+1FB00-U+1FB3F). Use `MELKER_GFX_MODE=iterm2` or run `melker --debug-sextant` to test your terminal.

## Mermaid Diagram Support

Mermaid is a popular diagramming language for flowcharts, sequence diagrams, class diagrams, etc.

|                       | Melker | Ink | OpenTUI | Textual | Ratatui | Bubble Tea | tview | FTXUI |
|-----------------------|:------:|:---:|:-------:|:-------:|:-------:|:----------:|:-----:|:-----:|
| Native Mermaid        |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |
| Flowchart             |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |
| Sequence diagram      |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |
| Class diagram         |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |
| State diagram         |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |
| ER diagram            |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |
| Run .mmd files        |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |
| Unicode box-drawing   |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |
| Interactive/scrollable |   Y    |  -  |    -    |    -    |    -    |     -      |   -   |   -   |

**Melker** - Native `<graph>` component:
```xml
<!-- Inline Mermaid -->
<graph type="mermaid" text="
graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Do something]
    B -->|No| D[Do something else]
" style="overflow: scroll" />

<!-- From file -->
<graph type="mermaid" src="./diagram.mmd" />
```

**Run .mmd files directly:**
```bash
./melker.ts diagram.mmd  # No approval needed for plain .mmd files
```

**External CLI tools** (not TUI-integrated):
- [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii) - Go CLI, ASCII output
- [mermaidtui](https://github.com/tariqshams/mermaidtui) - TypeScript, Unicode box-drawing
- [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) - TypeScript, SVG + ASCII dual output
- [mermaid-cli](https://github.com/mermaid-js/mermaid-cli) - Official CLI, SVG/PNG/PDF (not ASCII)

**Note:** Melker is currently the only TUI framework with native, integrated Mermaid rendering. Other frameworks would require shelling out to external CLI tools or custom implementation.

## Table Creation

| Library            | Approach                                     | Features                                                   |
|--------------------|----------------------------------------------|------------------------------------------------------------|
| **Melker**         | Native `<table>` + `<data-table>` + Markdown | Scrollable tbody, auto column widths, sorting, clickable   |
| **Ink**            | ink-table package                            | React component, column config                             |
| **OpenTUI**        | No built-in                                  | Manual Box/Text composition                                |
| **Blessed**        | listtable widget                             | Row selection, column widths                               |
| **Bubble Tea**     | bubbles/table                                | Styles, selection, pagination                              |
| **tview**          | Table widget                                 | Cells, selection, custom drawing                           |
| **Textual**        | DataTable widget                             | Columns, rows, sorting, CSS styling                        |
| **Ratatui**        | Table widget                                 | Headers, rows, widths, selection                           |
| **Terminal.Gui**   | TableView widget                             | Columns, rows, sorting, cell editing, scrolling            |
| **FTXUI**          | No built-in                                  | Manual grid layout                                         |

### Table Examples

**Melker** - Native table element (supports scrolling tbody):
```xml
<table style="width: fill; height: 10;">
  <thead>
    <tr><th>Name</th><th>Role</th></tr>
  </thead>
  <tbody style="overflow: scroll">
    <tr><td>Alice</td><td>Admin</td></tr>
    <tr><td>Bob</td><td>User</td></tr>
  </tbody>
</table>
```

**Melker** - Data-driven table (from arrays):
```xml
<data-table
  columns='[{"key":"name","label":"Name"},{"key":"role","label":"Role"}]'
  rows='[{"name":"Alice","role":"Admin"},{"name":"Bob","role":"User"}]'
  selectable="true"
  onSelect="handleSelect(event)"
/>
```

**Melker** - Markdown syntax (simpler, non-scrollable):
```xml
<markdown text="
| Name  | Role    |
|-------|---------|
| Alice | Admin   |
| Bob   | User    |
" />
```

**Ink** - React component (ink-table):
```jsx
import Table from 'ink-table';
const data = [{name: 'Alice', role: 'Admin'}, {name: 'Bob', role: 'User'}];
<Table data={data} />
```

**Blessed** - Widget creation:
```javascript
const table = blessed.listtable({
  data: [['Name', 'Role'], ['Alice', 'Admin'], ['Bob', 'User']],
  border: 'line',
  align: 'left',
  style: { header: { bold: true } }
});
```

**Bubble Tea** - bubbles/table:
```go
columns := []table.Column{{Title: "Name", Width: 10}, {Title: "Role", Width: 10}}
rows := []table.Row{{"Alice", "Admin"}, {"Bob", "User"}}
t := table.New(table.WithColumns(columns), table.WithRows(rows))
```

**tview** - Table widget:
```go
table := tview.NewTable().SetBorders(true)
table.SetCell(0, 0, tview.NewTableCell("Name").SetAttributes(tcell.AttrBold))
table.SetCell(0, 1, tview.NewTableCell("Role").SetAttributes(tcell.AttrBold))
table.SetCell(1, 0, tview.NewTableCell("Alice"))
table.SetCell(1, 1, tview.NewTableCell("Admin"))
```

**Textual** - DataTable widget:
```python
class MyApp(App):
    def compose(self):
        table = DataTable()
        table.add_columns("Name", "Role")
        table.add_rows([("Alice", "Admin"), ("Bob", "User")])
        yield table
```

**Ratatui** - Table widget:
```rust
let rows = vec![
    Row::new(vec!["Alice", "Admin"]),
    Row::new(vec!["Bob", "User"]),
];
let table = Table::new(rows, [Constraint::Length(10), Constraint::Length(10)])
    .header(Row::new(vec!["Name", "Role"]).bold())
    .block(Block::bordered());
```

**Terminal.Gui** - TableView:
```csharp
var dt = new DataTable();
dt.Columns.Add("Name"); dt.Columns.Add("Role");
dt.Rows.Add("Alice", "Admin"); dt.Rows.Add("Bob", "User");
var table = new TableView(dt) { Width = Dim.Fill(), Height = Dim.Fill() };
```

**FTXUI** - Manual grid (no table widget):
```cpp
auto table = vbox({
    hbox({text("Name") | bold | size(WIDTH, EQUAL, 10), text("Role") | bold}),
    separator(),
    hbox({text("Alice") | size(WIDTH, EQUAL, 10), text("Admin")}),
    hbox({text("Bob") | size(WIDTH, EQUAL, 10), text("User")}),
}) | border;
```

### Table Feature Comparison

| Feature          | Melker | Ink | OpenTUI | Blessed | Bubble Tea | tview | Textual | Ratatui | Terminal.Gui |
|------------------|:------:|:---:|:-------:|:-------:|:----------:|:-----:|:-------:|:-------:|:------------:|
| Header styling   |   Y    |  Y  |    -    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |
| Row selection    |   Y    |  -  |    -    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |
| Column widths    | Auto   | Auto |   -    | Manual  |   Manual   | Manual |  Auto  | Manual  |     Auto     |
| Borders          |   Y    |  -  |    -    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |
| Scrolling        |   Y    |  -  |    -    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |
| Sorting          |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      Y       |
| Cell editing     |   -    |  -  |    -    |    -    |     -      |   Y   |    -    |    -    |      Y       |
| Clickable cells  |   Y    |  -  |    -    |    Y    |     -      |   Y   |    Y    |    -    |      Y       |
| Markdown source  |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |
| HTML-like syntax |   Y    |  -  |    -    |    -    |     -      |   -   |    -    |    -    |      -       |
| Scrollable body  |   Y    |  -  |    -    |    -    |     -      |   -   |    Y    |    -    |      Y       |
| Alignment        |   Y    |  Y  |    -    |    Y    |     Y      |   Y   |    Y    |    Y    |      Y       |

## Unique Strengths

| Library            | Killer Feature                                                          |
|--------------------|-------------------------------------------------------------------------|
| **Melker**         | Run `.melker` from URL, AI assistant, permission sandbox, literate UI, container queries |
| **Ink**            | Full React ecosystem, DevTools, used by 10k+ projects, React 19 support |
| **OpenTUI**        | Zig FFI for sub-ms rendering, React+SolidJS+Vue reconcilers, timeline animations |
| **Textual**        | Terminal + browser, CSS styling, command palette, 35+ widgets, rapid releases |
| **Ratatui**        | Rust safety, no_std support, immediate mode performance, modular crates |
| **Bubble Tea**     | Elm architecture, 40k stars, SSH/network serving, v2 declarative views  |
| **tview**          | Battle-tested (K9s, gh CLI), rich widgets, backwards compatible         |
| **Terminal.Gui**   | .NET ecosystem, 40+ widgets, data validation, theming, Swing-like API   |
| **FTXUI**          | Zero deps, WebAssembly, pixel canvas, pipe operator syntax              |

## Corporate Adoption

| Library            | Used By                                                                                                                              |
|--------------------|--------------------------------------------------------------------------------------------------------------------------------------|
| **Ink**            | Claude Code (Anthropic), Gemini CLI (Google), GitHub Copilot CLI, Gatsby, Yarn, Prisma, Parcel, Shopify, New York Times, Terraform CDK |
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
| Accessible TUI apps        | **Melker**                                         |
| Sandboxed distribution     | **Melker**                                         |
| Browser + terminal         | **Textual**, **Ratatui** (Ratzilla), **FTXUI**     |
| Auto theme detection       | All (except ncurses)                               |
| Pixel graphics (retained)  | **Melker**                                         |
| Pixel graphics (immediate) | **FTXUI**, **Ratatui**                             |
| Literate programming       | **Melker**                                         |
| CSS animations + queries   | **Melker**, **Textual**                            |
| Embedded/no_std            | **Ratatui**                                        |
| SSH/network serving        | **Bubble Tea**, **Textual**, **Melker**             |
| Sub-ms Zig rendering       | **OpenTUI**                                        |
| Most GitHub stars          | **Bubble Tea** (40k), **Ink** (35.2k), **Textual** (34.5k) |

## Recent Updates (2025-2026)

| Library            | Version     | Notable Changes                                                                   |
|--------------------|-------------|-----------------------------------------------------------------------------------|
| **Ink**            | v6.8.0      | `renderToString()` for server-side/testing, incremental rendering, Mode 2026 synchronized output, opt-in Kitty keyboard protocol, `useCursor` API for IME. Steady monthly releases throughout v6 |
| **OpenTUI**        | v0.1.80+    | Very active (pre-1.0). TS+Zig core with React, SolidJS, and Vue reconcilers. Hover cursor via OSC 22, streaming markdown, grapheme stability fixes. 9k stars in ~8 months since creation (Jul 2025). Powers OpenCode. "Not ready for production use" per README |
| **Bubble Tea**     | v2.0.0      | v2.0.0 released (Feb 2026) with View struct API (not string), declarative views, Mode 2026 sync output, framerate renderer, Kitty keyboard, native clipboard (OSC52), `charm.land` module path. Bubbles v1.0.0 (Feb 2026), Lip Gloss v2.0.0-beta.3 |
| **Textual**        | v8.0.0      | Rapid releases: 1.0 (Dec 2024) through 8.0 (Feb 2026). Multi-mode screen management, Catppuccin theme variants, `pointer` CSS rule, `Widget.BLANK` optimization. Textualize wound down May 2025; McGugan maintains as open source with undiminished pace |
| **Ratatui**        | v0.30.0     | "Biggest release ever" (Dec 2025). no_std for embedded, modular workspace (ratatui-core, ratatui-widgets), `ratatui::run()` API, Sextant/Octant canvas markers, Rust 2024 edition. Ratzilla v0.3.0 (WebAssembly, ~1.2k stars) |
| **Terminal.Gui**   | v1.19.0     | v1.19 stable (Jun 2025). v2 beta targeted Feb 20, 2026 (6 open issues remaining); v2 stable release targeted Mar 31, 2026. True color, overhauled theming, rendering pipeline rewrite |
| **FTXUI**          | v6.1.9      | Text selection, color transparency. Last tagged release May 2025, but active commits through Feb 2026 (table border fixes, gridbox improvements). WebAssembly still supported |
| **tview**          | v0.42.0     | Adopted semver tagging. Last commit Sep 2025 (5+ month gap). K9s uses a fork (`derailed/tview`). gh CLI still depends on it |
| **Blessed**        | Dead        | Last commit January 2016. neo-blessed fork has limited maintenance                |

**Notes:**
- **Textual**: Textualize (the company) wound down in May 2025. Will McGugan continues maintaining Textual as open source with a rapid release cadence (v1.0 through v8.0 in 14 months).
- **Bubble Tea v2**: v2.0.0 released Feb 2026 with declarative View struct API, Kitty keyboard, clipboard support. Bubbles v1.0.0 (Feb 2026), Lip Gloss v2.0.0-beta.3 (v1.1.0 stable).
- **Ink adopters**: Claude Code (Anthropic, with custom React renderer) and Gemini CLI (Google) both use Ink 6 + React 19.
- **Ratatui canvas**: Supports Quadrant (2x2), Sextant (2x3), Octant (2x4), Braille (2x4), and HalfBlock (1x2) markers. Braille can now layer over Block symbols.
- **Terminal.Gui v2**: Multi-year rewrite approaching beta (Feb 2026). True color, flexible theming, 40+ views. v2 stable targeted for Mar 31, 2026.
- **Mode 2026**: DEC terminal synchronized output protocol adopted by both Ink v6.7+ and Bubble Tea v2.0.0, making frame updates atomic to eliminate tearing.

## Emerging Frameworks

Notable newer TUI libraries gaining traction:

| Library                                                  | Language | Stars | Description                                            |
|----------------------------------------------------------|----------|-------|--------------------------------------------------------|
| [Mosaic](https://github.com/JakeWharton/mosaic)         | Kotlin   | 2.6k  | Terminal UI via Jetpack Compose compiler/runtime        |
| [libvaxis](https://github.com/rockorager/libvaxis)       | Zig      | 1.6k  | Modern TUI library with Flutter-like vxfw framework    |
| [iocraft](https://github.com/ccbrown/iocraft)           | Rust     | 1.1k  | React-like declarative TUI inspired by Ink and Dioxus  |
| [Cursive](https://github.com/gyscos/cursive)            | Rust     | 4.7k  | High-level TUI with views, menus, layers, themes       |
| [Brick](https://github.com/jtdaugherty/brick)           | Haskell  | 1.7k  | Declarative composable widgets, cross-platform (2.10)  |
| [Nocterm](https://github.com/nicholasgasior/nocterm)    | Dart     | 273   | Flutter-inspired TUI with widget tree, themes, and layout engine         |
| [Rezi](https://github.com/RtlZeroMemory/Rezi)          | TS/C     | New   | Native C rendering engine ("Zireael"), 49 widgets, JSX. Alpha (Feb 2026) |

**Trends (2025-2026):**
- **Declarative paradigms everywhere**: React (Ink, OpenTUI, iocraft), Compose (Mosaic), SwiftUI (SwiftTUI), Elm (Bubbletea) - all bringing web/mobile UI patterns to the terminal
- **Hybrid native backends**: OpenTUI (Zig core) and Rezi (C rendering engine) both delegate performance-critical rendering to a compiled language while keeping a TypeScript developer API — mirroring the "fast native core, ergonomic surface" trend seen in tools like Bun and esbuild
- **v2 rewrites**: Bubble Tea v2.0.0 (Feb 2026), Lip Gloss, Terminal.Gui, and Brick all shipped or are shipping major v2 architecture overhauls. Terminal.Gui v2 beta due Feb 2026
- **Mode 2026 adoption**: Synchronized output protocol (DEC private mode) adopted by Ink v6.7 and Bubble Tea v2, making terminal frame updates atomic
- **`no_std` / embedded**: Ratatui v0.30.0 added `no_std` support, enabling TUI on microcontrollers (ESP32, STM32H7) and bare-metal targets
- **WebAssembly targets**: FTXUI, Ratatui (Ratzilla ~1.2k stars), and Textual all support running TUI apps in web browsers
- **Modular architectures**: Ratatui split into ratatui-core + ratatui-widgets; Charm ecosystem spreads across Bubbletea + Bubbles + Lip Gloss
- **OpenTUI breakout**: 9k stars in ~8 months since creation (Jul 2025), driven by the SST/OpenCode ecosystem
- **Flutter-to-terminal**: Nocterm brings Flutter's widget tree model to Dart terminal apps, joining the cross-paradigm migration trend

## Links

### TUI Frameworks
- [Awesome TUIs](https://github.com/rothgar/awesome-tuis) - Curated list
- [Ink](https://github.com/vadimdemedes/ink) - React for CLI
- [Ink UI](https://ink-ui.vadimdemedes.com/) - Component library for Ink
- [OpenTUI](https://github.com/sst/opentui) - TypeScript+Zig TUI with React/SolidJS/Vue reconcilers (by SST team)
- [OpenCode](https://github.com/sst/opencode) - AI coding agent built with OpenTUI
- [Blessed](https://github.com/chjj/blessed) - Node.js widgets (dead since 2016)
- [neo-blessed](https://github.com/embarklabs/neo-blessed) - Blessed fork (limited maintenance)
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) - Go Elm architecture
- [Bubbles](https://github.com/charmbracelet/bubbles) - Components for Bubble Tea
- [Lip Gloss](https://github.com/charmbracelet/lipgloss) - Go styling
- [tview](https://github.com/rivo/tview) - Go widgets
- [Textual](https://github.com/Textualize/textual) - Python async TUI (maintained by Will McGugan since Textualize wound down May 2025)
- [Rich](https://github.com/Textualize/rich) - Python terminal formatting (Textual's foundation)
- [Toad](https://github.com/willmcgugan/toad) - Universal UI for AI coding agents (built with Textual)
- [Ratatui](https://github.com/ratatui/ratatui) - Rust immediate mode
- [Ratzilla](https://github.com/ratatui/ratzilla) - Ratatui WebAssembly backend (v0.3.0, ~1.2k stars, DOM + WebGL2 backends)
- [Mousefood](https://github.com/ratatui/mousefood) - Ratatui embedded-graphics backend for microcontrollers
- [awesome-ratatui](https://github.com/ratatui/awesome-ratatui) - Ratatui ecosystem
- [Terminal.Gui](https://github.com/gui-cs/Terminal.Gui) - C#/.NET cross-platform TUI (v2 beta due Feb 2026)
- [FTXUI](https://github.com/ArthurSonzogni/FTXUI) - C++ functional
- [Cursive](https://github.com/gyscos/cursive) - Rust high-level TUI with views and themes
- [Brick](https://github.com/jtdaugherty/brick) - Haskell declarative TUI
- [Mosaic](https://github.com/JakeWharton/mosaic) - Kotlin terminal UI via Jetpack Compose
- [iocraft](https://github.com/ccbrown/iocraft) - Rust React-like declarative TUI
- [libvaxis](https://github.com/rockorager/libvaxis) - Zig modern TUI with vxfw framework
- [Rezi](https://github.com/RtlZeroMemory/Rezi) - TypeScript+C hybrid TUI with native rendering engine (alpha)
- [Nocterm](https://github.com/nicholasgasior/nocterm) - Dart Flutter-inspired TUI with widget tree and themes
- [Clack](https://github.com/bombshell-dev/clack) - TypeScript CLI prompts (not a full TUI framework)
- [OSS Insight TUI Rankings](https://ossinsight.io/collections/tui-framework/) - Live star rankings

### Terminal Graphics (Sixel/Kitty)
- [Are We Sixel Yet?](https://www.arewesixelyet.com/) - Terminal Sixel support tracker
- [Kitty Graphics Protocol](https://sw.kovidgoyal.net/kitty/graphics-protocol/) - Protocol specification
- [ratatui-image](https://github.com/benjajaja/ratatui-image) - Ratatui image widget (sixel, kitty, iTerm2)
- [textual-image](https://github.com/lnqs/textual-image) - Textual image widget (Kitty, Sixel)
- [ink-picture](https://github.com/endernoke/ink-picture) - Ink image component (sixel, kitty, iTerm2)
- [libsixel](https://saitoha.github.io/libsixel/) - Reference Sixel implementation

### Mermaid in Terminal
- [mermaid-ascii](https://github.com/AlexanderGrooff/mermaid-ascii) - Go CLI for ASCII Mermaid diagrams
- [mermaidtui](https://github.com/tariqshams/mermaidtui) - TypeScript Unicode Mermaid renderer
- [beautiful-mermaid](https://github.com/lukilabs/beautiful-mermaid) - SVG + ASCII dual output
- [mermaid-cli](https://github.com/mermaid-js/mermaid-cli) - Official Mermaid CLI (SVG/PNG/PDF)
