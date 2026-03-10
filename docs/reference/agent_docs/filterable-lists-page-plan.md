# Plan: Filterable List Components Doc Page

## Context

`docs/filterable-lists.html` follows the same structure as `docs/data-visualization.html`. Covers the four filterable list components: `select`, `combobox`, `autocomplete`, `command-palette`.

These components are interactive (dropdowns, typing, filtering) but render their initial/closed state in `--stdout` mode, which is enough for the doc screenshots.

## Page Structure

| # | Section | Component | Example file |
|---|---------|-----------|-------------|
| 1 | Select | `<select>` | `docs/examples/lists/select.melker` |
| 2 | Combobox | `<combobox>` | `docs/examples/lists/combobox.melker` |
| 3 | Autocomplete | `<autocomplete>` | `docs/examples/lists/autocomplete.melker` |
| 4 | Command Palette | `<command-palette>` | `docs/examples/lists/command-palette.melker` |
| 5 | Options and Groups | `<option>`, `<group>` | (code-only, no separate example) |
| 6 | Filter Modes | fuzzy, prefix, contains, exact | (code-only) |

No "pattern" or "policy" sections needed. These components use inline data, no fetch/network required.

## Files

| File | Purpose |
|------|---------|
| `docs/filterable-lists.html` | The doc page |
| `docs/examples/lists/select.melker` | Select with grouped options |
| `docs/examples/lists/combobox.melker` | Combobox with fuzzy filter |
| `docs/examples/lists/autocomplete.melker` | Autocomplete with async search |
| `docs/examples/lists/command-palette.melker` | Command palette with groups |

## Example .melker Files

Each example is self-contained (no network, no JSON files). Uses `<script async="ready">` with `$melker.render()` for stdout capture. Keep examples simple and focused. Policy: `{"permissions": {}}` (no permissions needed).

### select.melker
Select with grouped options (size + drink pickers). Shows `<group>` and `<option>` child elements, `onChange` handler, `setValue` to show result.

### combobox.melker
Country picker with fuzzy filter. Shows `placeholder`, `filter="fuzzy"`, `onSelect`, grouped options.

### autocomplete.melker
User search with simulated async. Shows `onSearch`, `debounce`, `minChars`, dynamic results via `setOptions()`.

### command-palette.melker
File/Edit/View command groups. Shows `shortcut` prop on options, `open` toggle, button to trigger.

## Generating Terminal Output

```bash
run_example() {
  ./melker.ts --trust --stdout --stdout-width=60 --stdout-height=$2 \
    --color=always --stdout-timeout=2000 "docs/examples/lists/$1" \
    2>/dev/null | ./scripts/ansi2html.ts
}

run_example select.melker 8
run_example combobox.melker 7
run_example autocomplete.melker 7
run_example command-palette.melker 8
```

## Writing Style

- No em-dashes. Use periods, colons, commas, or "and" instead.
- No bragging language ("powerful", "seamless", "beautiful", etc.).
- Keep descriptions factual and concise.
