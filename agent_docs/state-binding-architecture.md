# State Binding Architecture

**Optional.** Most `.melker` apps don't need this. The standard approach — `getElementById().setValue()` and a `sync()` function — works well for typical apps (5-15 interactive elements). State bindings are a convenience for apps where multiple handlers update the same set of elements, reducing repetitive `setValue()` calls.

`$melker.createState()` registers a plain object on the engine. The `bind` attribute on elements declares which state key drives their primary prop. Binding is **two-way by default**: element values flow back into state, and state values push to elements, both before each render. Use `bind-mode="one-way"` to opt out of the reverse sync.

If `createState()` is never called, the binding system has zero cost — `_resolveBindings()` returns immediately on the `if (!state) return` guard.

## Usage

```xml
<melker>
  <style>
    #empty { display: none; }
    .isEmpty #empty { display: flex; }
    .isFull #add-btn { background-color: red; }
  </style>

  <container style="gap: 1;">
    <text id="count" bind="count" bind-mode="one-way" />
    <text id="footer" bind="summary" bind-mode="one-way" />
    <container id="empty">
      <text>No items yet</text>
    </container>
    <button id="add-btn" onClick="$app.addItem('New')">Add</button>
  </container>

  <script>
    let items = [];

    const state = $melker.createState({
      count: 0,
      summary: '0/0',
      isEmpty: true,
      isFull: false,
    });

    export function addItem(name) {
      items.push({ name, done: false });
      state.count = items.length;
      state.summary = `${items.filter(i => i.done).length}/${items.length}`;
      state.isEmpty = items.length === 0;
      state.isFull = items.length >= 100;
      // Text elements use bind-mode="one-way" because the handler
      // controls their state values (reverse sync would overwrite them).
      // Auto-render fires after handler:
      //   0. reverse sync (two-way elements only, skipped for one-way)
      //   1. boolean state → CSS classes on root
      //   2. state values → bound elements (coerced to prop type)
      //   3. CSS rules re-applied if classes changed
      //   4. layout + paint
    }
  </script>
</melker>
```

## How It Works

`$melker.createState(initial)` registers a plain object on the engine. No Proxy, no dependency graph. Assignments are normal property mutations — the existing auto-render-after-handler mechanism triggers the sync.

Before each `render()` and `forceRender()`, `_resolveBindings()` runs three steps:

0. **Reverse sync (two-way)** — for elements without `bind-mode="one-way"`, the element's current prop value is pulled into state, coerced to the state key's original type (captured at `createState()` time). This captures user input (typing, checkbox toggles, combobox selections) without manual handler code, and preserves type consistency — e.g., a number state key bound to a `<text>` element gets `Number("42")` → `42` back, not the string `"42"`.

1. **Boolean class sync** — boolean state values toggle CSS classes on the root element via `toggleClass()`. If any classes changed, all stylesheets are re-applied to the root tree so class-dependent CSS rules take effect.

2. **Bind resolution** — elements with `bind="key"` receive the state value on their primary prop (e.g. `text` for `<text>`, `value` for `<input>`), coerced to the correct type via the component schema.

```
user interaction → element.props updated → render → _resolveBindings():
  step 0: element.props → state (reverse sync, two-way only, coerced to initial state type)
  step 1: boolean state → CSS classes
  step 2: state → element.props (forward push, coerced to prop schema type)
→ layout (CSS applies) → paint
```

Both directions coerce types symmetrically: forward push uses the component schema (prop type), reverse sync uses the state's original type map (captured once at `createState()` time via `_stateTypeMap`).

## Design: Data vs Styling

| Concern              | Mechanism                          | Example                                    |
|----------------------|------------------------------------|--------------------------------------------|
| Text/value content   | `bind` attribute                   | `<text bind="count" />`                    |
| Conditional display  | CSS classes from boolean state     | `.isEmpty #empty { display: flex; }`       |
| Conditional styling  | CSS classes from boolean state     | `.isFull #add-btn { opacity: 0.5; }`       |
| Behavioral props     | Explicit script (1-2 lines)        | `el.props.disabled = state.isFull`         |

CSS handles presentation, script handles data and behavior. Boolean state becomes CSS classes; the existing stylesheet system (class selectors, specificity, cascade) handles the rest.

## Binding Syntax

### `bind="key"` — targets the element's primary prop

```xml
<text id="count" bind="count" />
<input id="query" bind="searchTerm" />
<checkbox id="opt" bind="optEnabled" />
```

No `bind:prop` variant. The primary prop is determined by `PersistenceMapping` in `src/state-persistence.ts`.

### Primary prop mapping

Resolution uses two existing registries — no hardcoded type switch:

1. **`PersistenceMapping`** (`src/state-persistence.ts`) — maps element type → primary prop name (e.g. `text` → `text`, `input` → `value`, `checkbox` → `checked`)
2. **`ComponentSchema`** (`src/lint.ts`) — maps prop name → prop type for coercion (`String`, `Number`, `Boolean`)

New components automatically work if they register both a `ComponentSchema` and a `PersistenceMapping`.

### Two-way binding (default)

State pushes to elements, and element values flow back into state automatically. No manual sync needed for simple cases:

```xml
<input id="query" bind="searchTerm" />
<script>
  const state = $melker.createState({ searchTerm: '' });
  // state.searchTerm automatically reflects what the user types
</script>
```

### One-way binding (`bind-mode="one-way"`)

Use `bind-mode="one-way"` when a handler needs to transform the value before writing to state. With one-way binding, state pushes to elements but user input does not auto-flow back:

```xml
<input id="query" bind="searchTerm" bind-mode="one-way" onInput="$app.normalize()" />
<script>
  const state = $melker.createState({ searchTerm: '' });
  export function normalize() {
    state.searchTerm = $melker.getElementById('query').getValue().trim().toLowerCase();
  }
</script>
```

Without `bind-mode="one-way"`, the reverse sync would overwrite the handler's normalized value with the raw input value.

### Coexistence with setValue()

Bindings win. If an element has `bind="count"`, calling `setValue()` on it is overwritten at next render. Mixed usage is fine — some elements bound, some updated imperatively.

## Implementation

### Files

| File                            | What                                                                           |
|---------------------------------|--------------------------------------------------------------------------------|
| `src/engine.ts`                 | `_stateObject`, `_stateTypeMap`, `_bindMappingsByType`, `_boundElements` cache, `setStateObject()`, `_collectBoundElements()`, `_resolveBindings()`, `_coerceToType()` |
| `src/melker-runner.ts`          | `createState()` on `$melker` context, persistence merge, initialization order  |
| `src/globals.d.ts`              | `createState<T>()` on `MelkerContext` type                                     |
| `src/state-persistence.ts`      | `DEFAULT_PERSISTENCE_MAPPINGS` entries, `_bound` category in `readState()`, `mergePersistedBound()` |
| `src/state-persistence-manager.ts` | `setStateObject()` setter, state object passed to `readState()`             |
| `src/dev-tools.ts`              | "State" tab in F12 DevTools (data table with Role: `class`, `bind 2w`, `bind 1w`)          |

### `_resolveBindings()` — `src/engine.ts`

Called in both `render()` and `forceRender()`, before layout. Early-exits if no state object. First, iterates cached bound elements with `twoWay` flag, pulling element prop values into state (reverse sync, coerced to the state key's original type via `_stateTypeMap`). Then iterates boolean state keys, toggling CSS classes on root via `toggleClass()`. If any classes changed, re-applies stylesheets. Finally iterates all cached bound elements, assigning coerced state values to their primary props (forward push, coerced to the component schema type).

### `createState()` — `src/melker-runner.ts`

Guards against double-call and post-render call. Merges persisted `_bound` values (if any) over the initial object, then registers it on the engine via `setStateObject()`. Returns the same object reference.

### Critical: runner initialization order

`addStylesheet()` must be called BEFORE `updateUI()` in the runner. `updateUI()` triggers `render()` → `_resolveBindings()`, and bindings need stylesheets already registered for class-dependent CSS rules to take effect. If reversed, `_resolveBindings` syncs classes but `applyStylesToElement` iterates zero stylesheets.

## Performance

The resolution runs on every render. Cost breakdown:

| Step           | Operation                                  | Cost                            |
|----------------|--------------------------------------------|---------------------------------|
| Guard          | `if (!state) return`                       | O(1) — zero cost without state  |
| Reverse sync   | Read element prop → state (two-way only)   | O(bound), skip if `!twoWay`     |
| Class sync     | `toggleClass()` per boolean key            | O(state keys), typically 3-10   |
| Stylesheet     | `applyStylesToElement()` if classes changed | Only on change, not every frame |
| Cache check    | `document.registryGeneration !== last`     | O(1) — reads generation counter |
| Bind loop      | Iterate cached bound elements              | O(bound), typically 3-8         |
| Per element    | `map.get()` + `getComponentSchema()` + assign | O(1) each                    |

### Bound element caching

`_collectBoundElements()` iterates `document.getAllElements()` — a flat `Map.values()` from the element registry. No tree recursion. The result is a cached array of `{ element, stateKey, twoWay }` triples, invalidated when `document.registryGeneration` changes. The generation counter is incremented on every `_registerElement()` and `removeElement()` call, so it catches add+remove pairs that leave `elementCount` unchanged (e.g., dialog close + dialog open in the same frame). The `twoWay` flag is computed once from the element's `bind-mode` prop during collection — no per-render overhead.

### Pre-indexed mappings

`setStateObject()` pre-builds a `Map<string, PersistenceMapping>` once, and captures a `_stateTypeMap` (`Map<string, string>`) recording the initial `typeof` for each state key. The resolution loop does `map.get(element.type)` — O(1) per element instead of `mappings.find()`. Reverse sync uses `_stateTypeMap` to coerce element values back to the state's original types.

## Persistence

When `--persist` is enabled, state values are saved and restored automatically.

### State file shape

A `_bound` category is added to the existing persistence format:

```json
{
  "version": 1,
  "state": {
    "input": { "nameInput": "John" },
    "_bound": { "count": 42, "isEmpty": false, "summary": "3/5" }
  }
}
```

### Save

`readState()` serializes the state object into the `_bound` category alongside the existing per-element state.

### Restore

Before `createState()` returns, `mergePersistedBound()` merges persisted `_bound` values over the initial values. Persisted values win over defaults. The `createState()` call defines the schema (what keys exist) — extra keys in persisted data are ignored.

## CSS Class Naming

Boolean state keys become classes on the root element directly. No prefix.

```typescript
const state = $melker.createState({
  isEmpty: true,   // → root gets class "isEmpty"
  isFull: false,   // → root does not get class "isFull"
  count: 0,        // → number, not a class (used with bind)
});
```

Only `typeof value === 'boolean'` triggers class sync. Numbers, strings, and objects are ignored.

## DevTools

When `createState()` has been called, the F12 DevTools overlay shows a "State" tab as a data table with columns: Name, Value, Bound To, and Role.

The Role column shows:
- `class` — boolean value synced as CSS class on root
- `bind 2w` — two-way bound (element ↔ state)
- `bind 1w` — one-way bound (state → element only)

The Bound To column shows the element's `#id` (or type if no id).

```
  Name      | Value   | Bound To | Role
  count     | 5       | #count   | bind 1w
  summary   | "2/5"   | #footer  | bind 1w
  query     | "hello" | #search  | bind 2w
  isEmpty   | false   |          | class
  isFull    | false   |          | class
```

The summary line at the bottom shows totals, e.g. `5 keys (2 class, 1 bind 2w, 2 bind 1w)`.

## Constraints

- One `createState()` call per app. Second call throws.
- Must be called before first render (see below). Calling after throws.
- Flat keys only (no nested objects).
- Returns the same object reference — store in a module variable.

### Script type compatibility

`createState()` must run before the first render. This means it works in `<script>` and `<script async="init">` (both execute before the first frame), but **throws** in `<script async="ready">` (which runs after the first render).

| Script type              | `createState()` | Why                          |
|--------------------------|-----------------|------------------------------|
| `<script>`               | Works           | Runs before first render     |
| `<script async="init">`  | Works           | Runs before first render     |
| `<script async="ready">` | Throws          | Runs after first render      |

## Error Handling

| Condition                        | Behavior                                        |
|----------------------------------|-------------------------------------------------|
| `bind="nonexistent"` (not in state) | Silent skip (key not in state object)         |
| Second `createState()` call      | Error: "createState() can only be called once"  |
| `createState()` after first render | Error: "createState() must be called before first render" |
| `bind` on element without mapping | Silent skip (element type not in persistence mappings) |

## Examples

- [examples/basics/two-way-binding.melker](../examples/basics/two-way-binding.melker) — two-way binding on input and checkboxes, one-way on display text, checkbox-driven CSS visibility
- [examples/basics/state-binding.melker](../examples/basics/state-binding.melker) — task list with `sync()` function, `bind-mode="one-way"` on display elements
- [examples/basics/state-binding-count.melker](../examples/basics/state-binding-count.melker) — minimal counter with boolean CSS classes

## See Also

- [script_usage.md](script_usage.md) — `$melker` context and runtime API
- [css-themes-architecture.md](css-themes-architecture.md) — CSS themes and class selectors
- [getting-started.md](getting-started.md) — Script types and critical rules
- [dx-footguns.md](dx-footguns.md) — Handler + two-way binding gotcha (#15)
