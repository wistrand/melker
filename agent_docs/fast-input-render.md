# Fast Path for Input Rendering

## Problem

Input latency included a debounce delay. The debounce exists to batch rapid inputs (paste) and avoid excessive layouts, but it made typing feel sluggish.

## Solution: Dual Render Path

```
Key → Input updates state → fast render (cached bounds) → terminal (~2ms)
                          ↓
                          debounce 16ms → full layout → buffer swap → terminal
```

Fast render provides immediate visual feedback while the debounced full render ensures layout correctness.

---

## Architecture

### Buffer Management

The key insight: fast render must NOT swap buffers, or the full render will diff against the wrong baseline causing flicker.

```typescript
// Fast render path (no buffer swap)
buffer.prepareForFastRender();  // Copy previous → current
input.fastRender(buffer, bounds, isFocused);
differences = buffer.getDiffOnly();  // Diff without swap
output(differences);

// Full render path (normal swap)
buffer.clear();
layout();
render();
differences = buffer.swapAndGetDiff();  // Swap + clear
output(differences);
```

### Bounds Lookup

Uses cached layout tree from `rendering.ts`:

```typescript
findElementBounds(elementId: string): Bounds | null {
  if (!this._cachedLayoutTree) return null;
  return this._findBoundsInTree(elementId, this._cachedLayoutTree);
}
```

### Dialog Handling

Fast render is skipped when:
- System dialogs are open (alert, confirm, prompt, accessibility)
- A document dialog exists that doesn't contain the focused input (overlay)

Inputs inside an open dialog still use fast render.

---

## Components with Fast Render

| Component | Benefit                              |
|-----------|--------------------------------------|
| Input     | High - immediate keystroke feedback  |
| Textarea  | High - immediate keystroke feedback  |
| Canvas    | Potential - already has pixel buffer |
| Progress  | Potential - simple bar redraw        |

---

## Files Modified

| File                          | Changes                                    |
|-------------------------------|--------------------------------------------|
| `src/buffer.ts`               | `getDiffOnly()`, `prepareForFastRender()`  |
| `src/rendering.ts`            | `findElementBounds()`                      |
| `src/components/input.ts`     | `fastRender()`, `canFastRender()`          |
| `src/components/textarea.ts`  | `fastRender()`, `canFastRender()`          |
| `src/engine.ts`               | `_renderFastPath()`, dialog detection      |

---

## Performance

| Metric               | Before  | After   |
|----------------------|---------|---------|
| Typing latency       | ~50ms+  | ~2-5ms  |
| Debounce delay       | 50ms    | 16ms    |
| Full render frequency | Same    | Same    |

---

## Status

**Implemented** - Production ready

## See Also

- [dirty-row-tracking.md](dirty-row-tracking.md) — Buffer diff optimization
- [architecture.md](architecture.md) — Render pipeline overview
