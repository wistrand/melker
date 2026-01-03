# TUI Framework Comparison

Comprehensive comparison of terminal UI libraries across languages.

## Overview

| Library | Language | Stars | Paradigm | Layout |
|---------|----------|-------|----------|--------|
| **Melker** | TypeScript/Deno | New | HTML-like declarative | Flexbox |
| [Ink](https://github.com/vadimdemedes/ink) | JavaScript/Node | 34k | React components | Flexbox (Yoga) |
| [Blessed](https://github.com/chjj/blessed) | JavaScript/Node | 12k | Imperative widgets | CSS-like |
| [Bubble Tea](https://github.com/charmbracelet/bubbletea) | Go | 38k | Elm architecture | CSS-like |
| [tview](https://github.com/rivo/tview) | Go | 13k | Imperative widgets | Grid/Flex |
| [Textual](https://github.com/Textualize/textual) | Python | 33k | Async widgets | CSS/Grid |
| [Ratatui](https://github.com/ratatui/ratatui) | Rust | 17k | Immediate mode | Constraints |
| [FTXUI](https://github.com/ArthurSonzogni/FTXUI) | C++ | 9k | Functional/React-like | Flexbox |
| [ncurses](https://invisible-island.net/ncurses/) | C | Legacy | Low-level | Manual |

## Feature Matrix

| Feature | Melker | Ink | Blessed | Bubble Tea | tview | Textual | Ratatui | FTXUI |
|---------|:------:|:---:|:-------:|:----------:|:-----:|:-------:|:-------:|:-----:|
| No-build run | Y | - | Y | - | - | Y | - | - |
| Run from URL | Y | - | - | - | - | - | - | - |
| App approval system | Y | - | - | - | - | - | - | - |
| Permission sandbox | Y | - | - | - | - | - | - | - |
| AI accessibility | Y | - | - | - | - | - | - | - |
| OAuth built-in | Y | - | - | - | - | - | - | - |
| State persistence | Y | - | - | - | - | - | - | - |
| LSP support | Y | - | - | - | - | - | - | - |
| Web browser | Y | - | - | - | - | Y | Y | Y |
| React ecosystem | - | Y | - | - | - | - | - | - |
| Single binary | - | - | - | Y | Y | - | Y | Y |
| Auto color degrade | Y | Y | Y | Y | Y | Y | Y | Y |
| Mouse support | Y | - | Y | Y | Y | Y | Y | Y |
| Unicode/emoji | Y | Y | Y | Y | Y | Y | Y | Y |
| Animations | - | Y | Y | Y | - | Y | Y | Y |
| 16M colors | Y | Y | Y | Y | Y | Y | Y | Y |
| Video playback | Y | - | - | - | - | - | - | - |
| Pixel canvas | Y | - | - | - | - | ~ | - | Y |
| Literate UI (.md) | Y | - | - | - | - | - | - | - |
| Command palette | - | - | - | - | - | Y | - | - |
| No_std/embedded | - | - | - | - | - | - | Y | - |
| SSH/network serve | - | - | - | Y | - | Y | - | - |
| Maintained (2026) | Y | Y | - | Y | Y | Y | Y | Y |

## Abstraction Levels

| Level | Description | Libraries |
|-------|-------------|-----------|
| **Low-level** | Direct terminal control | ncurses, Termbox |
| **Programmatic** | createElement/widget APIs | All frameworks |
| **Declarative** | Markup files (HTML/JSX) | Melker, Ink, Textual |
| **Literate** | Prose + embedded UI | Melker only |

**Melker's three levels:**

1. **Programmatic** - TypeScript createElement API:
```typescript
const btn = createElement('button', { title: 'Click', onClick: () => count++ });
root.appendChild(btn);
```

2. **Declarative** - `.melker` HTML-like files:
```xml
<button title="Click" onClick="count++" />
```

3. **Literate** - `.melker.md` Markdown with embedded UI:
```markdown
# My App

This button increments a counter:

<button title="Click" onClick="count++" />

The count is displayed below.
```

Most frameworks only offer programmatic APIs. Ink adds JSX but requires a build step. Textual has external CSS but Python-only UI. Melker uniquely supports literate programming where documentation and UI coexist.

## Scripting & Code Style

| Library | UI Definition | Event Handling | State Management |
|---------|---------------|----------------|------------------|
| **Melker** | HTML-like `.melker` files | Inline `onClick="..."` handlers | Mutable element props |
| **Ink** | JSX components | React event props | useState/useReducer |
| **Blessed** | JS object creation | `.on('event', fn)` | Direct mutation |
| **Bubble Tea** | Go structs + View() | Msg → Update() | Immutable Model |
| **tview** | Go constructors | SetInputCapture() | Direct mutation |
| **Textual** | Python classes | `@on` decorators | Reactive attributes |
| **Ratatui** | Rust widget structs | Match on events | Immutable state |
| **FTXUI** | C++ function composition | Lambdas | Captured refs |

### Code Examples

**Melker** - Declarative HTML-like:
```xml
<button title="Click" onClick="count++; render()" />
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

| Library | Method | Syntax | Theming |
|---------|--------|--------|---------|
| **Melker** | CSS in `style=""` | `border: thin; color: red` | Auto-detect + 8 manual themes |
| **Ink** | Props on components | `<Box borderStyle="round">` | Via ink-ui |
| **Blessed** | Options object | `{border: {type: 'line'}}` | Manual |
| **Lip Gloss** | Chained methods | `.Bold(true).Padding(1)` | Auto color degrade |
| **tview** | Inline tags | `[red]text[-]` | tcell.Style |
| **Textual** | External CSS files | `.button { color: red; }` | CSS variables |
| **Ratatui** | Style struct | `Style::new().fg(Red)` | Manual |
| **FTXUI** | Pipe decorators | `text \| bold \| color(Red)` | Manual |

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

| | Melker | Ink | Blessed | Bubble Tea | tview | Textual | Ratatui | FTXUI |
|-|--------|-----|---------|------------|-------|---------|---------|-------|
| Language | TS/Deno | JS/Node | JS/Node | Go | Go | Python | Rust | C++ |
| Stars | New | 34k | 12k | 38k | 13k | 33k | 17k | 9k |
| Paradigm | Declarative | React | Imperative | Elm/MVU | Imperative | Async | Immediate | Functional |
| Build step | None | Required | None | Required | Required | None | Required | Required |
| Widgets | 24+ | ~10 | 27+ | Via Bubbles | 15+ | 30+ | Via crates | 10+ |
| Maintained | Y | Y | Dormant | Y | Y | Y | Y | Y |
| Used by | - | Gatsby, Yarn | - | GitHub, NVIDIA | gh CLI | Posting | gitui | - |

## Component Comparison

| Component | Melker | Ink | Blessed | Bubble Tea | tview | Textual | Ratatui | FTXUI |
|-----------|:------:|:---:|:-------:|:----------:|:-----:|:-------:|:-------:|:-----:|
| **Layout** | | | | | | | | |
| Container/Box | Y | Y | Y | - | Y | Y | Y | Y |
| Flexbox | Y | Y | - | - | Y | - | - | Y |
| Grid | - | - | - | - | Y | Y | - | Y |
| Tabs | Y | - | - | - | Y | Y | Y | Y |
| Collapsible | - | - | - | - | - | Y | - | Y |
| Split panes | - | - | - | - | - | - | - | Y |
| **Text** | | | | | | | | |
| Text/Label | Y | Y | Y | - | Y | Y | Y | Y |
| Markdown | Y | - | - | - | - | Y | - | - |
| Big text | - | - | Y | - | - | Y | Y* | - |
| **Input** | | | | | | | | |
| Text input | Y | Y | Y | Y | Y | Y | - | Y |
| Textarea | Y | - | Y | Y | Y | Y | Y* | - |
| Checkbox | Y | - | Y | - | Y | Y | Y* | Y |
| Radio | Y | - | Y | - | - | Y | - | Y |
| Select/Dropdown | - | Y | - | - | Y | Y | - | Y |
| Slider | - | - | - | - | - | - | - | Y |
| Masked input | - | - | - | - | - | Y | - | - |
| **Data** | | | | | | | | |
| Table | Y | Y* | Y | Y | Y | Y | Y | - |
| Tree | - | - | Y | - | Y | Y | - | - |
| List | Y | Y | Y | Y | Y | Y | Y | Y |
| **Feedback** | | | | | | | | |
| Progress bar | Y | Y | Y | Y | - | Y | Y | Y |
| Spinner | - | Y | Y | Y | - | Y | - | - |
| Toast | - | - | - | - | - | Y | - | - |
| Sparkline | - | - | - | - | - | Y | Y | - |
| **Navigation** | | | | | | | | |
| Button | Y | - | Y | - | Y | Y | - | Y |
| Menu | Y | - | Y | - | - | - | - | Y |
| Menu bar | Y | - | Y | - | - | - | - | - |
| Link | - | - | - | - | - | Y | - | - |
| **Dialogs** | | | | | | | | |
| Dialog/Modal | Y | - | Y | - | Y | - | - | - |
| Prompt | Y | Y | Y | - | - | - | - | - |
| Confirm | Y | - | Y | - | - | - | - | - |
| Alert | Y | - | Y | - | - | - | - | - |
| **Graphics** | | | | | | | | |
| Canvas | Y | - | - | - | - | ~ | Y | Y |
| Image | - | - | Y | - | Y | - | Y* | - |
| Video | Y | - | Y | - | - | - | - | - |
| Chart | - | - | - | - | - | - | Y | Y |
| **Special** | | | | | | | | |
| File browser | Y | - | Y | Y | - | Y | - | - |
| Calendar | - | - | - | - | - | - | Y | - |
| Scrollbar | Y | - | - | - | - | - | Y | - |

Y = Built-in, Y* = Via extension/crate, ~ = Partial/limited, - = Not available

**Melker gaps (high priority):** Tree, Select/Dropdown, Spinner

## Architecture Patterns

| Pattern | Libraries |
|---------|-----------|
| **React/Component** | Ink, FTXUI, Melker |
| **Elm/MVU** | Bubble Tea, Ratatui |
| **Imperative** | Blessed, tview, ncurses |
| **Async/Reactive** | Textual |
| **Immediate Mode** | Ratatui |

## Rendering Strategies

| Strategy | Libraries | Description |
|----------|-----------|-------------|
| Dual buffer | Melker, Ratatui | Compare buffers, write diff |
| Damage buffer | Blessed | Track changed regions |
| Yoga layout | Ink | Facebook's flexbox engine |
| Virtual DOM | Ink | React reconciliation |

## Pixel Canvas

| | Melker | Ratatui | FTXUI | Textual |
|-|--------|---------|-------|---------|
| Mode | Retained | Immediate | Immediate | Immediate |
| Encoding | Sextant (2x3) | Braille (2x4) | Braille/Block | Shapes only |
| Resolution | 2x3 per cell | 2x4 per cell | 2x4 per cell | N/A |
| True color | Y | Y | Y | - |
| Auto-dither | Y | - | - | - |
| onPaint callback | Y | - | - | - |

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

## Table Creation

| Library | Approach | Features |
|---------|----------|----------|
| **Melker** | Native `<table>` + Markdown | Scrollable tbody, auto column widths, clickable |
| **Ink** | ink-table package | React component, column config |
| **Blessed** | listtable widget | Row selection, column widths |
| **Bubble Tea** | bubbles/table | Styles, selection, pagination |
| **tview** | Table widget | Cells, selection, custom drawing |
| **Textual** | DataTable widget | Columns, rows, sorting, CSS styling |
| **Ratatui** | Table widget | Headers, rows, widths, selection |
| **FTXUI** | No built-in | Manual grid layout |

### Table Examples

**Melker** - Native table element (supports scrollable tbody):
```xml
<table style="width: fill; height: 10;">
  <thead>
    <tr><th>Name</th><th>Role</th></tr>
  </thead>
  <tbody scrollable="true">
    <tr><td>Alice</td><td>Admin</td></tr>
    <tr><td>Bob</td><td>User</td></tr>
  </tbody>
</table>
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

| Feature | Melker | Ink | Blessed | Bubble Tea | tview | Textual | Ratatui |
|---------|:------:|:---:|:-------:|:----------:|:-----:|:-------:|:-------:|
| Header styling | Y | Y | Y | Y | Y | Y | Y |
| Row selection | - | - | Y | Y | Y | Y | Y |
| Column widths | Auto | Auto | Manual | Manual | Manual | Auto | Manual |
| Borders | Y | - | Y | Y | Y | Y | Y |
| Scrolling | Y | - | Y | Y | Y | Y | Y |
| Sorting | - | - | - | - | - | Y | - |
| Cell editing | - | - | - | - | Y | - | - |
| Clickable cells | Y | - | Y | - | Y | Y | - |
| Markdown source | Y | - | - | - | - | - | - |
| HTML-like syntax | Y | - | - | - | - | - | - |
| Scrollable body | Y | - | - | - | - | Y | - |
| Alignment | Y | Y | Y | Y | Y | Y | Y |

## Unique Strengths

| Library | Killer Feature |
|---------|---------------|
| **Melker** | Run `.melker` from URL, AI assistant, permission sandbox, literate UI |
| **Ink** | Full React ecosystem, DevTools, Suspense |
| **Textual** | Terminal + browser, CSS styling, command palette |
| **Ratatui** | Rust safety, no_std support, 60 FPS performance |
| **Bubble Tea** | Elm architecture, 38k stars, SSH/network serving |
| **tview** | Battle-tested (gh CLI), rich widgets |
| **FTXUI** | Zero deps, WebAssembly, pixel canvas |

## Corporate Adoption

| Library | Used By |
|---------|---------|
| Ink | Gatsby, Yarn, Prisma, Parcel, Shopify |
| Bubble Tea | GitHub, NVIDIA, GitLab, Sourcegraph |
| tview | GitHub CLI (gh), podman-tui |
| Textual | Posting, Toolong, various data tools |
| Ratatui | gitui, bottom, spotify-tui, jnv |

## Choosing a Library

| If you want... | Choose |
|----------------|--------|
| React knowledge reuse | **Ink** |
| Python + modern async | **Textual** |
| Rust performance | **Ratatui** |
| Go + Elm architecture | **Bubble Tea** |
| Go + quick widgets | **tview** |
| C++ + no deps | **FTXUI** |
| Accessible TUI apps | **Melker** |
| Sandboxed distribution | **Melker** |
| Browser + terminal | **Textual**, **Ratatui**, **FTXUI** |
| Auto theme detection | All (except ncurses) |
| Pixel graphics (retained) | **Melker** |
| Pixel graphics (immediate) | **FTXUI** |
| Literate programming | **Melker** |
| Embedded/no_std | **Ratatui** |
| SSH/network serving | **Bubble Tea**, **Textual** |

## Links

- [Awesome TUIs](https://github.com/rothgar/awesome-tuis) - Curated list
- [Ink](https://github.com/vadimdemedes/ink) - React for CLI
- [Blessed](https://github.com/chjj/blessed) - Node.js widgets (dormant)
- [neo-blessed](https://github.com/neo-blessed/neo-blessed) - Blessed fork (maintained)
- [Bubble Tea](https://github.com/charmbracelet/bubbletea) - Go Elm architecture
- [Lip Gloss](https://github.com/charmbracelet/lipgloss) - Go styling
- [tview](https://github.com/rivo/tview) - Go widgets
- [Textual](https://github.com/Textualize/textual) - Python async TUI
- [Ratatui](https://github.com/ratatui/ratatui) - Rust immediate mode
- [Ratzilla](https://github.com/ratatui/ratzilla) - Ratatui web backend
- [FTXUI](https://github.com/ArthurSonzogni/FTXUI) - C++ functional
