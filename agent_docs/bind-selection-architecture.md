# bind:selection Architecture

Cross-component selection sync via `bind:selection` on `createState`. Extends the [state binding system](state-binding-architecture.md) with method-based bindings for `IdSelectable` components.

## Overview

`bind:selection="key"` binds an element's selection state (via `getSelectedIds()` / `setSelectedIds()`) to a `createState` key. Multiple components bound to the same key stay in sync automatically — clicking one component updates all others.

```xml
<data-boxplot bind:selection="selectedAreas" onGetId="event.label" selectable="true" />
<data-table   bind:selection="selectedAreas" onGetId="event[0]"    selectable="single" />
<data-bars    bind:selection="selectedAreas" onGetId="event.label"  selectable="true" />
```

```typescript
const state = $melker.createState({ selectedAreas: [] as string[] });
```

Requires `onGetId` on each bound component — see [selection-id-architecture.md](selection-id-architecture.md).

## How it differs from `bind`

| Aspect            | `bind="key"`                         | `bind:selection="key"`                        |
|-------------------|--------------------------------------|-----------------------------------------------|
| What it binds     | Primary prop (value, text, checked)  | Selection state (set of selected IDs)         |
| Read mechanism    | `element.props[prop]`                | `element.getSelectedIds()` (method call)      |
| Write mechanism   | `element.props[prop] = value`        | `element.setSelectedIds(new Set(ids))` (method call) |
| State type        | Varies (string, number, boolean)     | Always `string[]`                             |
| Typical use       | One element per key                  | Multiple elements per key                     |
| Dirty detection   | None (always syncs)                  | `_lastPushed` tracking (see below)            |

## State type

Always `string[]`. Single-selection is `["SE3"]`, multi is `["SE3", "SE4"]`, empty is `[]`. No scalar special-casing.

`typeof [] === 'object'` in the `_stateTypeMap`. The `default` case in `_coerceToType` passes arrays through unchanged — no coercion issues.

## Binding resolution

`_resolveBindings()` handles both `bind` and `bind:selection` in the same loop, branching on `bindProp`:

```
user clicks component → internal selection updates → onSelect fires → auto-render →
  _resolveBindings():
    reverse sync:  getSelectedIds() vs _lastPushed → write state if changed
    forward push:  setSelectedIds(new Set(state[key])) → update _lastPushed
  → layout → paint
```

### The _lastPushed problem and solution

When multiple components share a key, naive reverse sync has a **last-writer-wins race**: the clicked component writes its new selection to state, then the next (unchanged) component overwrites state with its stale empty selection.

Comparing against the current state value doesn't work either — the state was just updated by the first component's reverse sync, so the second component's empty selection looks "different" and overwrites it.

**Solution:** Each binding entry tracks `_lastPushed: string[]` — what was last forward-pushed to that element. Reverse sync compares `getSelectedIds()` against `_lastPushed`, not the current state. Only elements whose selection changed from what was pushed write back.

```
Click boxplot (selects "SE3"):

  Reverse sync:
    boxplot: getSelectedIds() = {"SE3"}, _lastPushed = [] → different → state = ["SE3"]
    table:   getSelectedIds() = {},      _lastPushed = [] → same     → skip
    bars:    getSelectedIds() = {},      _lastPushed = [] → same     → skip

  Forward push:
    boxplot: setSelectedIds({"SE3"}), _lastPushed = ["SE3"]
    table:   setSelectedIds({"SE3"}), _lastPushed = ["SE3"]
    bars:    setSelectedIds({"SE3"}), _lastPushed = ["SE3"]

Next render (no user action):
    All: getSelectedIds() = {"SE3"}, _lastPushed = ["SE3"] → same → skip
```

### bind-mode="one-way"

Supported. Skips reverse sync, only forward-pushes. Useful for display-only components that reflect selection but don't originate it.

### Precedence

`bind:selection` wins over `selectedIds` prop. The binding layer calls `setSelectedIds()` before render, overwriting any `selectedIds` prop value. Consistent with how `bind` overwrites value props.

## Implementation

### Bound elements type

```typescript
private _boundElements: Array<{
  element: Element;
  stateKey: string;
  twoWay: boolean;
  bindProp?: 'selection';    // undefined = primary value (existing)
  _lastPushed?: string[];    // last forward-pushed selection IDs
}> | null = null;
```

### `_collectBoundElements()` — `src/engine.ts`

Scans for both `bind` and `bind:selection` on each element:

```typescript
const selectionKey = element.props['bind:selection'];
if (typeof selectionKey === 'string') {
  const twoWay = element.props['bind-mode'] !== 'one-way';
  this._boundElements.push({ element, stateKey: selectionKey, twoWay, bindProp: 'selection' });
}
```

### `_resolveBindings()` — `src/engine.ts`

Reverse sync (selection branch):
```typescript
if (binding.bindProp === 'selection') {
  const el = binding.element as unknown as IdSelectable;
  if (typeof el.getSelectedIds === 'function') {
    const elementIds = el.getSelectedIds();
    if (!_selectionEquals(elementIds, binding._lastPushed)) {
      state[binding.stateKey] = [...elementIds];
    }
  }
}
```

Forward push (selection branch):
```typescript
if (binding.bindProp === 'selection') {
  const el = binding.element as unknown as IdSelectable;
  const ids = state[binding.stateKey];
  if (typeof el.setSelectedIds === 'function' && Array.isArray(ids)) {
    el.setSelectedIds(new Set(ids));
    binding._lastPushed = ids as string[];
  }
}
```

### `_selectionEquals()` — `src/engine.ts`

Compares a `Set<string>` (from element) against a `string[]` (from `_lastPushed`):

```typescript
function _selectionEquals(elementIds: Set<string>, stateIds: unknown): boolean {
  if (!Array.isArray(stateIds)) return elementIds.size === 0;
  if (elementIds.size !== stateIds.length) return false;
  for (const id of stateIds) {
    if (!elementIds.has(id)) return false;
  }
  return true;
}
```

### Lint schema — `src/lint.ts`

`bind:selection` added to `BASE_PROPS_SCHEMA` as type `'string'`.

### Template parser — `src/template.ts`

No changes needed. The HTML parser passes colon-containing attributes through as-is (`bind:selection` → `props['bind:selection']`).

### Persistence — `src/state-persistence.ts`

No changes needed. `_bound` serializes the full state object. `string[]` values serialize/restore naturally via JSON.

### Data safety — `setSelectedIds()` guards

All five data components guard against undefined data arrays in `setSelectedIds()`:

```typescript
setSelectedIds(ids: Set<string>): void {
  if (!this.props.onGetId || !this.props.rows) return;  // guard
  // ...
}
```

This prevents crashes when the binding layer forward-pushes before data is loaded (e.g., async fetch on startup).

## Files

| File                        | What                                                                 |
|-----------------------------|----------------------------------------------------------------------|
| `src/engine.ts`             | `_boundElements` type, `_collectBoundElements`, `_resolveBindings`, `_selectionEquals` |
| `src/lint.ts`               | `bind:selection` in `BASE_PROPS_SCHEMA`                              |
| `src/components/data-*.ts`  | `setSelectedIds` data guards                                         |

## Extensibility

`bind:prop` is a general pattern. Adding new method-based bindings follows the same structure:

- `bind="key"` — primary value (existing, prop-based)
- `bind:selection="key"` — selection (implemented, method-based via `IdSelectable`)
- `bind:scroll="key"` — scroll position (future)

Each new `bind:*` adds a `bindProp` discriminator value and a branch in `_resolveBindings`.

## Performance

Forward push calls `setSelectedIds()` on every bound element per render — O(n) per component where n is the item count. With 3 components × 30 items = ~90 `onGetId` calls per render. Negligible for typical dashboards.

The `_lastPushed` check in reverse sync is O(k) where k is the selection size (typically 0-5).

## Usage

### Automatic sync (no handler needed for sync)

```xml
<data-boxplot bind:selection="sel" onGetId="event.label" selectable="true" />
<data-table   bind:selection="sel" onGetId="event[0]"    selectable="single" />
```

```typescript
const state = $melker.createState({ sel: [] as string[] });
// Clicking either component automatically syncs the other
```

### With side effects

```xml
<data-boxplot bind:selection="sel" onGetId="event.label" selectable="true"
              onSelect="$app.onSelect(event)" />
<data-table   bind:selection="sel" onGetId="event[0]"    selectable="single"
              onChange="$app.onSelect(event)" />
```

```typescript
const state = $melker.createState({ sel: [] as string[] });

// Handler only needed for side effects — sync is automatic
export function onSelect(event: { id?: string }): void {
  if (event.id) updateDetailView(event.id);
}
```

### Programmatic selection

```typescript
// Set selection from code — forward push syncs all bound components
state.selectedAreas = ['SE3'];
$melker.render();

// Clear selection
state.selectedAreas = [];
$melker.render();
```

## See Also

- [state-binding-architecture.md](state-binding-architecture.md) — primary value binding (`bind="key"`)
- [selection-id-architecture.md](selection-id-architecture.md) — `IdSelectable` interface and `onGetId`
