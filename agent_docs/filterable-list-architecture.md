# Filterable List Architecture

Technical architecture for the filterable list component family.

## Component Hierarchy

```
FilterableListCore (abstract base)
├── ComboboxElement     - Inline dropdown with text filter
├── SelectElement       - Dropdown picker (no filter)
├── AutocompleteElement - Combobox + async loading
└── CommandPaletteElement - Modal command picker

Child elements (non-renderable):
├── OptionElement - Selectable item
└── GroupElement  - Option grouping
```

## File Structure

```
src/components/filterable-list/
  mod.ts              - Module exports
  core.ts             - FilterableListCore base class
  filter.ts           - Fuzzy/prefix/contains algorithms
  option.ts           - OptionElement
  group.ts            - GroupElement
  combobox.ts         - ComboboxElement
  select.ts           - SelectElement
  autocomplete.ts     - AutocompleteElement
  command-palette.ts  - CommandPaletteElement
```

## Core Architecture

### FilterableListCore (`core.ts`)

Abstract base class providing shared functionality:

```typescript
abstract class FilterableListCore extends Element implements Focusable {
  // Option management
  protected _childOptions: OptionData[]      // From child elements
  protected _filteredOptions: FilteredOptionData[]
  protected _filterCacheValid: boolean

  // Navigation state
  protected _focusedIndex: number
  protected _scrollTop: number

  // Key methods
  getAllOptions(): OptionData[]              // Merge children + props.options
  getFilteredOptions(): FilteredOptionData[] // Apply filter, cache result
  handleKeyPress(event): boolean             // Navigation keys
  selectFocused(): void                      // Select current option
  selectOption(option): void                 // Fire onSelect event

  // Marker for engine keyboard routing
  handlesOwnKeyboard(): boolean { return true }
}
```

### Data Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  Child Elements │────▶│  getAllOptions() │────▶│ getFiltered-    │
│  <option>       │     │                  │     │ Options()       │
│  <group>        │     │  + props.options │     │                 │
└─────────────────┘     └──────────────────┘     └────────┬────────┘
                                                          │
                              ┌────────────────────────────┘
                              ▼
                        ┌───────────┐     ┌──────────────┐
                        │  filter() │────▶│ _filtered-   │
                        │           │     │ Options      │
                        └───────────┘     └──────────────┘
```

### Filter System (`filter.ts`)

Four matching algorithms:

| Mode | Function | Behavior |
|------|----------|----------|
| `fuzzy` | `fuzzyMatch()` | Characters in order, scores consecutive matches |
| `prefix` | `prefixMatch()` | Text starts with pattern |
| `contains` | `containsMatch()` | Text includes pattern |
| `exact` | `exactMatch()` | Text equals pattern |

```typescript
interface FuzzyMatchResult {
  matched: boolean
  score: number           // Higher = better match
  matchIndices: number[]  // For highlighting
}

function filterOptions(
  options: OptionData[],
  pattern: string,
  mode: FilterMode
): FilteredOption[]
```

## Component Specifics

### ComboboxElement

Combines text input with dropdown navigation:

```typescript
class ComboboxElement extends FilterableListCore {
  private _inputValue: string
  private _cursorPosition: number

  // Overrides
  onKeyPress(event): boolean {
    // Try navigation first (arrows, enter, escape)
    if (this.handleKeyPress(event)) return true
    // Then text input (typing, backspace)
    return this.handleKeyInput(key, ctrlKey, altKey)
  }

  selectFocused(): void {
    // Select option OR freeform text entry
    if (option) this.selectOption(option)
    else if (this._inputValue) this.selectFreeformValue(this._inputValue)
  }
}
```

### SelectElement

Simplified picker without text input:

```typescript
class SelectElement extends FilterableListCore {
  // No text input - displays selected label only
  // Click/Enter/Space opens dropdown
  // Arrow keys navigate, Enter selects
}
```

### AutocompleteElement

Extends ComboboxElement with async search:

```typescript
class AutocompleteElement extends ComboboxElement {
  private _debounceTimer: number | null
  private _dynamicOptions: OptionData[]
  private _requestRender: (() => void) | null

  handleKeyInput(key, ctrlKey, altKey): boolean {
    const handled = super.handleKeyInput(key, ctrlKey, altKey)
    if (handled) this._triggerSearch()  // Debounced
    return handled
  }

  private _executeSearch(query: string): void {
    const result = this.props.onSearch(event)
    // Handle sync or async result
    if (result?.then) {
      result.then(options => {
        this.setOptions(options)
        this._requestRender?.()  // Re-render after async
      })
    }
  }

  getAllOptions(): OptionData[] {
    // Static children + dynamic search results
    return [...super.getAllOptions(), ...this._dynamicOptions]
  }
}
```

### CommandPaletteElement

Modal overlay variant:

```typescript
class CommandPaletteElement extends FilterableListCore {
  // Renders as centered modal (like dialog)
  // Shortcuts display right-aligned
  // Escape closes, fires onOpenChange
}
```

## Rendering Architecture

### Overlay System

Dropdowns render as overlays to avoid clipping by parent bounds:

```typescript
// In render():
if (this.props.open && context.registerOverlay) {
  context.registerOverlay({
    id: `${this.id}-dropdown`,
    zIndex: 100,
    bounds: dropdownBounds,
    render: (buf) => this._renderDropdownContent(...),
    onClickOutside: () => this.close(),
    excludeBounds: [this._inputBounds],  // Don't close on input click
  })
}
```

**Z-Index Hierarchy:**
| Layer | Z-Index |
|-------|---------|
| Normal content | 0 |
| Dialogs | 100 |
| Dropdowns | 100 |
| Command Palette | 200 |

### Scrollable Dropdown

```typescript
getVisibleRange(): { start: number, end: number } {
  const visibleCount = Math.min(maxVisible, filteredCount)
  return {
    start: this._scrollTop,
    end: Math.min(this._scrollTop + visibleCount, filteredCount)
  }
}

_ensureFocusedVisible(): void {
  // Adjust _scrollTop to keep focused item in view
  if (this._focusedIndex < this._scrollTop)
    this._scrollTop = this._focusedIndex
  else if (this._focusedIndex >= this._scrollTop + visibleCount)
    this._scrollTop = this._focusedIndex - visibleCount + 1
}
```

## Keyboard Handling

### Engine Integration

The engine routes keyboard events based on `handlesOwnKeyboard()`:

```typescript
// engine.ts
if (typeof focusedElement.handlesOwnKeyboard === 'function' &&
    focusedElement.handlesOwnKeyboard() &&
    typeof focusedElement.onKeyPress === 'function') {
  // Route to component's onKeyPress
  focusedElement.onKeyPress(keyPressEvent)
}
```

This prevents Enter/Space from being intercepted by Clickable handling.

### Key Bindings

| Key | Closed | Open |
|-----|--------|------|
| ArrowDown | Open | Focus next |
| ArrowUp | Open | Focus prev |
| Enter | Open | Select focused |
| Space | Open | (combobox: type space) |
| Escape | - | Close |
| Tab | - | Close, move focus |
| Home | - | Focus first |
| End | - | Focus last |
| PageUp/Down | - | Scroll by page |

## Events

### OptionSelectEvent

```typescript
interface OptionSelectEvent {
  type: 'select'
  value: string       // option.id
  label: string       // option.label
  option?: OptionData // Full data (undefined for freeform)
  targetId: string
  freeform?: boolean  // True if typed, not from list
}
```

### SearchEvent (autocomplete)

```typescript
interface SearchEvent {
  type: 'search'
  query: string
  targetId: string
}
```

## Dual Data Sources

Options come from both children and props:

```xml
<!-- Static children -->
<combobox>
  <group label="Recent">
    <option value="a">Option A</option>
  </group>
</combobox>

<!-- Dynamic prop -->
<combobox options="${$app.items}" />

<!-- Both (children first, then prop) -->
<autocomplete options="${$app.searchResults}">
  <option value="default">Default</option>
</autocomplete>
```

```typescript
getAllOptions(): OptionData[] {
  const propOptions = typeof this.props.options === 'function'
    ? this.props.options()
    : (this.props.options || [])
  return [...this._childOptions, ...propOptions]
}
```

## Example Files

| File | Description |
|------|-------------|
| `examples/melker/combobox_simple.melker` | Basic combobox |
| `examples/melker/combobox_demo.melker` | Full features |
| `examples/melker/select_simple.melker` | Basic select |
| `examples/melker/select_demo.melker` | Full features |
| `examples/melker/autocomplete_demo.melker` | Async search |
| `examples/melker/command_palette_simple.melker` | Basic palette |
| `examples/melker/command_palette_demo.melker` | Full features |
