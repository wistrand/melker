# TUI Framework Comparison

Comprehensive comparison of terminal UI libraries across languages. Last updated: February 2026.

## Overview

| Library                                                  | Language        | Stars  | Paradigm              | Layout         |
|----------------------------------------------------------|-----------------|--------|-----------------------|----------------|
| **Melker**                                               | TypeScript/Deno | New    | HTML-like declarative | Flexbox        |
| [Ink](https://github.com/vadimdemedes/ink)               | JavaScript/Node | 35k    | React components      | Flexbox (Yoga) |
| [Blessed](https://github.com/chjj/blessed)               | JavaScript/Node | 12k    | Imperative widgets    | CSS-like       |
| [Bubble Tea](https://github.com/charmbracelet/bubbletea) | Go              | 39k    | Elm architecture      | CSS-like       |
| [tview](https://github.com/rivo/tview)                   | Go              | 13k    | Imperative widgets    | Grid/Flex      |
| [Textual](https://github.com/Textualize/textual)         | Python          | 34k    | Async widgets         | CSS/Grid       |
| [Ratatui](https://github.com/ratatui/ratatui)            | Rust            | 18k    | Immediate mode        | Constraints    |
| [FTXUI](https://github.com/ArthurSonzogni/FTXUI)         | C++             | 10k    | Functional/React-like | Flexbox        |
| [ncurses](https://invisible-island.net/ncurses/)         | C               | Legacy | Low-level             | Manual         |

## Feature Matrix

| Feature              | Melker | Ink | Blessed | Bubble Tea | tview | Textual | Ratatui | FTXUI |
|----------------------|:------:|:---:|:-------:|:----------:|:-----:|:-------:|:-------:|:-----:|
| No-build run         |   Y    |  -  |    Y    |     -      |   -   |    Y    |    -    |   -   |
| Run from URL         |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| App approval system  |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| Permission sandbox   |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| AI accessibility     |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| OAuth built-in       |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| State persistence    |   Y    |  -  |    -    |     -      |   -   |    ~    |    -    |   -   |
| LSP support          |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| Web browser          |   Y    |  -  |    -    |     -      |   -   |    Y    |    Y    |   Y   |
| React ecosystem      |   -    |  Y  |    -    |     -      |   -   |    -    |    -    |   -   |
| Single binary        |   -    |  -  |    -    |     Y      |   Y   |    -    |    Y    |   Y   |
| Auto color degrade   |   Y    |  Y  |    Y    |     Y      |   Y   |    Y    |    Y    |   Y   |
| Mouse support        |   Y    |  ~  |    Y    |     Y      |   Y   |    Y    |    Y    |   Y   |
| Unicode/emoji        |   Y    |  Y  |    Y    |     Y      |   Y   |    Y    |    Y    |   Y   |
| Animations           |   ~    |  Y  |    Y    |     Y      |   -   |    Y    |    Y    |   Y   |
| 16M colors           |   Y    |  Y  |    Y    |     Y      |   Y   |    Y    |    Y    |   Y   |
| Video playback       |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| Pixel canvas         |   Y    |  -  |    -    |     -      |   -   |    ~    |    Y    |   Y   |
| Sixel/Kitty graphics |   Y    | Y*  |    -    |     -      |   -   |   Y*    |   Y*    |   -   |
| Mermaid diagrams     |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| Literate UI (.md)    |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| Command palette      |   Y    |  -  |    -    |     -      |   -   |    Y    |    -    |   -   |
| No_std/embedded      |   -    |  -  |    -    |     -      |   -   |    -    |    Y    |   -   |
| SSH/network serve    |   -    |  -  |    -    |     Y      |   -   |    Y    |    -    |   -   |
| Debug/remote inspect |   Y    |  Y  |    -    |     -      |   -   |    Y    |    -    |   -   |
| Maintained (2026)    |   Y    |  Y  |    -    |     Y      |   Y   |    Y    |    Y    |   Y   |

Y = Full support, ~ = Partial/limited support, - = Not available

**Notes:**
- **Ink mouse**: Requires additional package (ink-tap or similar)
- **Melker animations**: Via canvas shaders, not general UI animations
- **Textual state**: Reactive attributes, not automatic persistence like Melker
- **Ratatui canvas**: Uses braille characters (2x4 per cell)
- **Ratatui no_std**: Added in v0.30.0 for embedded targets
- **Sixel/Kitty**: Ink via ink-picture, Textual via textual-image, Ratatui via ratatui-image
- **Mermaid**: Melker has native `<graph>` component; others require external CLI tools

## Abstraction Levels

| Level            | Description               | Libraries              |
|------------------|---------------------------|------------------------|
| **Low-level**    | Direct terminal control   | ncurses, Termbox       |
| **Programmatic** | createElement/widget APIs | All frameworks         |
| **Declarative**  | Markup files (HTML/JSX)   | Melker, Ink, Textual   |
| **Literate**     | Prose + embedded UI       | Melker only            |

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

| Library        | UI Definition             | Event Handling                  | State Management      |
|----------------|---------------------------|---------------------------------|-----------------------|
| **Melker**     | HTML-like `.melker` files | Inline `onClick="..."` handlers | Mutable element props |
| **Ink**        | JSX components            | React event props               | useState/useReducer   |
| **Blessed**    | JS object creation        | `.on('event', fn)`              | Direct mutation       |
| **Bubble Tea** | Go structs + View()       | Msg -> Update()                 | Immutable Model       |
| **tview**      | Go constructors           | SetInputCapture()               | Direct mutation       |
| **Textual**    | Python classes            | `@on` decorators                | Reactive attributes   |
| **Ratatui**    | Rust widget structs       | Match on events                 | Immutable state       |
| **FTXUI**      | C++ function composition  | Lambdas                         | Captured refs         |

### Code Examples

**Melker** - Declarative HTML-like:
```xml
<button label="Click" onClick="count++; render()" />
```

**Ink** - React JSX:
```jsx
<Box><Text onClick={() => setCount(c => c + 1)}>Click</Text></Box>
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

**FTXUI** - C++ lambdas:
```cpp
auto button = Button("Click", [&] { count++; });
```

## Styling Approaches

| Library       | Method              | Syntax                       | Theming                       |
|---------------|---------------------|------------------------------|-------------------------------|
| **Melker**    | CSS in `style=""`   | `border: thin; color: red`   | Auto-detect + 8 manual themes |
| **Ink**       | Props on components | `<Box borderStyle="round">`  | Via ink-ui                    |
| **Blessed**   | Options object      | `{border: {type: 'line'}}`   | Manual                        |
| **Lip Gloss** | Chained methods     | `.Bold(true).Padding(1)`     | Auto color degrade            |
| **tview**     | Inline tags         | `[red]text[-]`               | tcell.Style                   |
| **Textual**   | External CSS files  | `.button { color: red; }`    | CSS variables                 |
| **Ratatui**   | Style struct        | `Style::new().fg(Red)`       | Manual                        |
| **FTXUI**     | Pipe decorators     | `text \| bold \| color(Red)` | Manual                        |

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

**FTXUI** - Pipe operator:
```cpp
text("Hello") | border | color(Color::Cyan)
```

## By Language

|            | Melker      | Ink         | Blessed     | Bubble Tea  | tview       | Textual     | Ratatui     | FTXUI       |
|------------|-------------|-------------|-------------|-------------|-------------|-------------|-------------|-------------|
| Language   | TS/Deno     | JS/Node     | JS/Node     | Go          | Go          | Python      | Rust        | C++         |
| Stars      | New         | 35k         | 12k         | 39k         | 13k         | 34k         | 18k         | 10k         |
| Paradigm   | Declarative | React       | Imperative  | Elm/MVU     | Imperative  | Async       | Immediate   | Functional  |
| Build step | None        | Required    | None        | Required    | Required    | None        | Required    | Required    |
| Widgets    | 30+         | ~15         | 27+         | Via Bubbles | 15+         | 35+         | Via crates  | 10+         |
| Maintained | Y           | Y           | Dormant     | Y           | Y           | Y           | Y           | Y           |
| Used by    | -           | Gatsby, Yarn | -          | GitHub, GitLab | K9s, gh CLI | Posting   | gitui       | -           |

## Component Comparison

| Component        | Melker | Ink | Blessed | Bubble Tea | tview | Textual | Ratatui | FTXUI |
|------------------|:------:|:---:|:-------:|:----------:|:-----:|:-------:|:-------:|:-----:|
| **Layout**       |        |     |         |            |       |         |         |       |
| Container/Box    |   Y    |  Y  |    Y    |     -      |   Y   |    Y    |    Y    |   Y   |
| Flexbox          |   Y    |  Y  |    -    |     -      |   Y   |    -    |    -    |   Y   |
| Grid             |   -    |  -  |    -    |     -      |   Y   |    Y    |    -    |   Y   |
| Tabs             |   Y    |  -  |    -    |     -      |   Y   |    Y    |    Y    |   Y   |
| Collapsible      |   -    |  -  |    -    |     -      |   -   |    Y    |    -    |   Y   |
| Split panes      |   -    |  -  |    -    |     -      |   -   |    -    |    -    |   Y   |
| **Text**         |        |     |         |            |       |         |         |       |
| Text/Label       |   Y    |  Y  |    Y    |     -      |   Y   |    Y    |    Y    |   Y   |
| Markdown         |   Y    |  -  |    -    |    Y*      |   -   |    Y    |    -    |   -   |
| Big text         |   -    |  -  |    Y    |     -      |   -   |    Y    |   Y*    |   -   |
| **Input**        |        |     |         |            |       |         |         |       |
| Text input       |   Y    |  Y  |    Y    |     Y      |   Y   |    Y    |    -    |   Y   |
| Textarea         |   Y    |  -  |    Y    |     Y      |   Y   |    Y    |   Y*    |   -   |
| Checkbox         |   Y    |  -  |    Y    |     -      |   Y   |    Y    |   Y*    |   Y   |
| Radio            |   Y    |  -  |    Y    |     -      |   -   |    Y    |    -    |   Y   |
| Select/Dropdown  |   Y    |  Y  |    -    |     -      |   Y   |    Y    |    -    |   Y   |
| Combobox         |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |   -   |
| Autocomplete     |   Y    |  -  |    -    |     -      |   Y   |    Y    |    -    |   -   |
| Slider           |   Y    |  -  |    -    |     -      |   -   |    Y    |    -    |   Y   |
| Masked input     |   Y    |  -  |    -    |     -      |   -   |    Y    |    -    |   -   |
| **Data**         |        |     |         |            |       |         |         |       |
| Table            |   Y    | Y*  |    Y    |     Y      |   Y   |    Y    |    Y    |   -   |
| Tree             |   -    |  -  |    Y    |     -      |   Y   |    Y    |    -    |   -   |
| List             |   Y    |  Y  |    Y    |     Y      |   Y   |    Y    |    Y    |   Y   |
| **Feedback**     |        |     |         |            |       |         |         |       |
| Progress bar     |   Y    |  Y  |    Y    |     Y      |   -   |    Y    |    Y    |   Y   |
| Spinner          |   Y    |  Y  |    Y    |     Y      |   -   |    Y    |    -    |   -   |
| Toast            |   Y    |  -  |    -    |     -      |   -   |    Y    |    -    |   -   |
| Sparkline        |   Y    |  -  |    -    |     -      |   -   |    Y    |    Y    |   -   |
| **Navigation**   |        |     |         |            |       |         |         |       |
| Button           |   Y    |  -  |    Y    |     -      |   Y   |    Y    |    -    |   Y   |
| Menu             |   Y    |  -  |    Y    |     -      |   -   |    -    |    -    |   Y   |
| Menu bar         |   Y    |  -  |    Y    |     -      |   -   |    -    |    -    |   -   |
| Link             |   -    |  Y  |    -    |     -      |   -   |    Y    |    -    |   -   |
| **Dialogs**      |        |     |         |            |       |         |         |       |
| Dialog/Modal     |   Y    |  -  |    Y    |     -      |   Y   |    Y    |    -    |   -   |
| Prompt           |   Y    |  Y  |    Y    |     -      |   -   |    -    |    -    |   -   |
| Confirm          |   Y    |  -  |    Y    |     -      |   -   |    -    |    -    |   -   |
| Alert            |   Y    |  -  |    Y    |     -      |   -   |    -    |    -    |   -   |
| **Graphics**     |        |     |         |            |       |         |         |       |
| Canvas           |   Y    |  -  |    -    |     -      |   -   |    ~    |    Y    |   Y   |
| Shaders          |   Y    |  -  |    -    |     -      |   -   |    -    |   Y*    |   -   |
| Image            |  Y*    |  -  |    Y    |     -      |   Y   |    -    |   Y*    |   -   |
| Video            |   Y    |  -  |    Y    |     -      |   -   |    -    |    -    |   -   |
| Chart            |   Y    |  -  |    -    |     -      |   -   |    -    |    Y    |   Y   |
| **Special**      |        |     |         |            |       |         |         |       |
| File browser     |   Y    |  -  |    Y    |     Y      |   -   |    Y    |    -    |   -   |
| Calendar         |   -    |  -  |    -    |     -      |   -   |    -    |    Y    |   -   |
| Scrollbar        |   Y    |  -  |    -    |     -      |   -   |    Y    |    Y    |   -   |

Y = Built-in, Y* = Via extension/crate, ~ = Partial/limited, - = Not available

**Notes:**
- **Bubble Tea markdown**: Via Glamour library from Charmbracelet
- **Ratatui shaders**: Via tachyonfx crate for shader-like effects
- **Ratatui image**: Via ratatui-image crate with sixel/halfblock support
- **Melker gaps (high priority)**: Tree

## Architecture Patterns

| Pattern             | Libraries                 |
|---------------------|---------------------------|
| **React/Component** | Ink, FTXUI, Melker        |
| **Elm/MVU**         | Bubble Tea, Ratatui       |
| **Imperative**      | Blessed, tview, ncurses   |
| **Async/Reactive**  | Textual                   |
| **Immediate Mode**  | Ratatui                   |

## Artifact Model & Permissions

| Library        | Language | Paradigm      | Artifact Model       | Permissions |
|----------------|----------|---------------|----------------------|-------------|
| **Melker**     | TS/Deno  | Declarative   | Document + execution | Declared    |
| Ink            | JS       | React         | Program              | Inherited   |
| Bubble Tea     | Go       | Elm           | Program              | Inherited   |
| Textual        | Python   | Async widgets | Program              | Inherited   |
| Ratatui        | Rust     | Immediate     | Program              | Inherited   |

**Artifact Model:**
- **Document + execution**: UI defined as a document (`.melker` file) containing markup and behavior, executed by a runtime. Similar to HTML in a browser.
- **Program**: Compiled/interpreted code that produces TUI output. The artifact IS the program.

**Permissions:**
- **Declared**: Permissions declared in the artifact via `<policy>` tag; runtime enforces sandbox. User approves on first run.
- **Inherited**: Program inherits whatever permissions the user/OS grants at execution time. No built-in sandboxing.

This distinction mirrors web vs native: Melker treats TUI apps like web pages (sandboxed documents), while traditional TUI libraries produce native programs with full inherited authority.

## Rendering Strategies

| Strategy       | Libraries       | Description                                    |
|----------------|-----------------|------------------------------------------------|
| Immediate mode | Ratatui, FTXUI  | Redraw entire UI each frame (fast in Rust/C++) |
| Dual buffer    | Melker, Ratatui | Compare buffers, write diff                    |
| Damage buffer  | Blessed         | Track changed regions                          |
| Yoga layout    | Ink             | Facebook's flexbox engine                      |
| Virtual DOM    | Ink             | React reconciliation                           |

**Performance notes:**
- **Immediate mode** (Ratatui, FTXUI): Raw language speed makes full redraws fast
- **Retained mode** (Melker, Ink, Textual): Layout caching reduces work per frame
- **Melker's fast input path**: Bypasses layout for text input, renders at cached bounds
- **Ratatui**: Sub-millisecond rendering with zero-cost abstractions

## Pixel Canvas

|                  | Melker         | Ratatui        | FTXUI          | Textual     |
|------------------|----------------|----------------|----------------|-------------|
| Mode             | Retained       | Immediate      | Immediate      | Immediate   |
| Encoding         | Sextant (2x3)  | Braille (2x4)  | Braille/Block  | Shapes only |
| Resolution       | 2x3 per cell   | 2x4 per cell   | 2x4 per cell   | N/A         |
| True color       | Y              | Y              | Y              | -           |
| Auto-dither      | Y              | -              | -              | -           |
| onPaint callback | Y              | -              | -              | -           |
| Shader support   | Y              | Y*             | -              | -           |

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

|                    | Melker      | Ink         | Textual     | Ratatui     | Bubble Tea | tview | FTXUI |
|--------------------|-------------|-------------|-------------|-------------|------------|-------|-------|
| Sixel              | Y           | Y*          | Y*          | Y*          | -          | -     | -     |
| Kitty protocol     | Y           | Y*          | Y*          | Y*          | -          | -     | -     |
| iTerm2 protocol    | Y           | Y*          | -           | Y*          | -          | -     | -     |
| Auto-detection     | Y           | Y*          | Y*          | Y*          | -          | -     | -     |
| Fallback (Unicode) | Y (sextant) | Y* (braille) | Y* (Unicode) | Y (braille) | -          | -     | -     |

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

|                       | Melker | Ink | Textual | Ratatui | Bubble Tea | tview | FTXUI |
|-----------------------|:------:|:---:|:-------:|:-------:|:----------:|:-----:|:-----:|
| Native Mermaid        |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |
| Flowchart             |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |
| Sequence diagram      |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |
| Class diagram         |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |
| State diagram         |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |
| ER diagram            |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |
| Run .mmd files        |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |
| Unicode box-drawing   |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |
| Interactive/scrollable |   Y    |  -  |    -    |    -    |     -      |   -   |   -   |

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

| Library        | Approach                                     | Features                                                   |
|----------------|----------------------------------------------|------------------------------------------------------------|
| **Melker**     | Native `<table>` + `<data-table>` + Markdown | Scrollable tbody, auto column widths, sorting, clickable   |
| **Ink**        | ink-table package                            | React component, column config                             |
| **Blessed**    | listtable widget                             | Row selection, column widths                               |
| **Bubble Tea** | bubbles/table                                | Styles, selection, pagination                              |
| **tview**      | Table widget                                 | Cells, selection, custom drawing                           |
| **Textual**    | DataTable widget                             | Columns, rows, sorting, CSS styling                        |
| **Ratatui**    | Table widget                                 | Headers, rows, widths, selection                           |
| **FTXUI**      | No built-in                                  | Manual grid layout                                         |

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

| Feature          | Melker | Ink | Blessed | Bubble Tea | tview | Textual | Ratatui |
|------------------|:------:|:---:|:-------:|:----------:|:-----:|:-------:|:-------:|
| Header styling   |   Y    |  Y  |    Y    |     Y      |   Y   |    Y    |    Y    |
| Row selection    |   Y    |  -  |    Y    |     Y      |   Y   |    Y    |    Y    |
| Column widths    | Auto   | Auto | Manual |   Manual   | Manual |  Auto  | Manual  |
| Borders          |   Y    |  -  |    Y    |     Y      |   Y   |    Y    |    Y    |
| Scrolling        |   Y    |  -  |    Y    |     Y      |   Y   |    Y    |    Y    |
| Sorting          |   Y    |  -  |    -    |     -      |   -   |    Y    |    -    |
| Cell editing     |   -    |  -  |    -    |     -      |   Y   |    -    |    -    |
| Clickable cells  |   Y    |  -  |    Y    |     -      |   Y   |    Y    |    -    |
| Markdown source  |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |
| HTML-like syntax |   Y    |  -  |    -    |     -      |   -   |    -    |    -    |
| Scrollable body  |   Y    |  -  |    -    |     -      |   -   |    Y    |    -    |
| Alignment        |   Y    |  Y  |    Y    |     Y      |   Y   |    Y    |    Y    |

## Unique Strengths

| Library        | Killer Feature                                                          |
|----------------|-------------------------------------------------------------------------|
| **Melker**     | Run `.melker` from URL, AI assistant, permission sandbox, literate UI   |
| **Ink**        | Full React ecosystem, DevTools, used by 10k+ projects, React 18 support |
| **Textual**    | Terminal + browser, CSS styling, command palette, 35+ widgets           |
| **Ratatui**    | Rust safety, no_std support, immediate mode performance, modular crates |
| **Bubble Tea** | Elm architecture, 39k stars, SSH/network serving, 10k+ apps built       |
| **tview**      | Battle-tested (K9s, gh CLI), rich widgets, backwards compatible         |
| **FTXUI**      | Zero deps, WebAssembly, pixel canvas, pipe operator syntax              |

## Corporate Adoption

| Library        | Used By                                                                                                                              |
|----------------|--------------------------------------------------------------------------------------------------------------------------------------|
| **Ink**        | Claude Code (Anthropic), Gemini CLI (Google), GitHub Copilot CLI, Gatsby, Yarn, Prisma, Parcel, Shopify, New York Times, Terraform CDK |
| **Bubble Tea** | GitHub, GitLab, NVIDIA, Sourcegraph, Charm (Glow, VHS, etc.)                                                                         |
| **tview**      | K9s (Kubernetes CLI), GitHub CLI (gh), podman-tui                                                                                    |
| **Textual**    | Posting (API client), Toad (AI coding frontend), Memray (Bloomberg), Toolong                                                         |
| **Ratatui**    | gitui, bottom, spotify-tui, jnv, termscp                                                                                             |

## Choosing a Library

| If you want...             | Choose                                             |
|----------------------------|----------------------------------------------------|
| React knowledge reuse      | **Ink**                                            |
| Python + modern async      | **Textual**                                        |
| Rust performance           | **Ratatui**                                        |
| Go + Elm architecture      | **Bubble Tea**                                     |
| Go + quick widgets         | **tview**                                          |
| C++ + no deps              | **FTXUI**                                          |
| Accessible TUI apps        | **Melker**                                         |
| Sandboxed distribution     | **Melker**                                         |
| Browser + terminal         | **Textual**, **Ratatui** (Ratzilla), **FTXUI**     |
| Auto theme detection       | All (except ncurses)                               |
| Pixel graphics (retained)  | **Melker**                                         |
| Pixel graphics (immediate) | **FTXUI**, **Ratatui**                             |
| Literate programming       | **Melker**                                         |
| Embedded/no_std            | **Ratatui**                                        |
| SSH/network serving        | **Bubble Tea**, **Textual**                        |
| Most GitHub stars          | **Bubble Tea** (39k), **Ink** (35k), **Textual** (34k) |

## Recent Updates (2025-2026)

| Library        | Notable Changes                                                                       |
|----------------|---------------------------------------------------------------------------------------|
| **Ink**        | Continued React 18 support, Ink UI component library, screen reader accessibility     |
| **Bubble Tea** | v2 beta with new View API, module moved to `charm.land/bubbletea/v2`                  |
| **Textual**    | Web serving via `textual serve`, expanded widget library to 35+                       |
| **Ratatui**    | v0.30.0 with no_std support, modular workspace architecture, ratzilla for WebAssembly |
| **FTXUI**      | v6.1.9, continued cross-platform support including WebAssembly                        |
| **tview**      | Stable maintenance, backwards compatible updates                                      |
| **Blessed**    | Dormant since March 2024, use neo-blessed fork for maintenance                        |

## Links

### TUI Frameworks
- [Awesome TUIs](https://github.com/rothgar/awesome-tuis) - Curated list
- [Ink](https://github.com/vadimdemedes/ink) - React for CLI
- [Ink UI](https://ink-ui.vadimdemedes.com/) - Component library for Ink
- [Blessed](https://github.com/chjj/blessed) - Node.js widgets (dormant)
- [neo-blessed](https://github.com/embarklabs/neo-blessed) - Blessed fork (limited maintenance)
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) - Go Elm architecture
- [Bubbles](https://github.com/charmbracelet/bubbles) - Components for Bubble Tea
- [Lip Gloss](https://github.com/charmbracelet/lipgloss) - Go styling
- [tview](https://github.com/rivo/tview) - Go widgets
- [Textual](https://github.com/Textualize/textual) - Python async TUI
- [Rich](https://github.com/Textualize/rich) - Python terminal formatting (Textual's foundation)
- [Ratatui](https://github.com/ratatui/ratatui) - Rust immediate mode
- [Ratzilla](https://github.com/ratatui/ratzilla) - Ratatui WebAssembly backend
- [awesome-ratatui](https://github.com/ratatui/awesome-ratatui) - Ratatui ecosystem
- [FTXUI](https://github.com/ArthurSonzogni/FTXUI) - C++ functional
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
