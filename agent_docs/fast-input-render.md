# Fast Path for Input Rendering

## Summary

- Typing in input/textarea gets ~1ms visual feedback by rendering directly to the buffer with cached bounds
- A debounced full layout (16ms) follows to ensure correctness
- This dual path gives instant keystroke response without sacrificing layout accuracy

## Problem

Input latency included a debounce delay. The debounce exists to batch rapid inputs (paste) and avoid excessive layouts, but it made typing feel sluggish.

## Solution: Dual Render Path

```
Key → Input updates state → fast render (DiffCollector) → terminal (~1ms)
                          ↓
                          debounce 16ms → full layout → buffer swap → terminal
```

Fast render provides immediate visual feedback while the debounced full render ensures layout correctness.

---

## Architecture

### DiffCollector

The fast render path bypasses the buffer entirely. Instead of copying the full buffer (O(w×h)) and diffing dirty rows, components write to a lightweight `DiffCollector` that collects `BufferDiff[]` directly.

```typescript
// Fast render path (no buffer involvement)
const collector = new DiffCollector();
input.fastRender(collector, bounds, isFocused);
output(collector.getDiffs());

// Full render path (normal swap)
buffer.clear();
layout();
render();
differences = buffer.swapAndGetDiff();  // Swap + clear
output(differences);
```

`DiffCollector` provides `setCell()`, `setText()`, `fillRect()` matching `TerminalBuffer`'s API. It handles wide characters via `analyzeString()` and gray theme conversion.

### Why This Is Safe

1. **previousBuffer is never modified** — DiffCollector doesn't touch any buffer
2. **currentBuffer state doesn't matter** — full render calls `clear()` first, wiping it
3. **No code reads currentBuffer between fast and full render** — verified by audit
4. **Single-threaded** — render() and fastRender never interleave (both synchronous)

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

| Component | Benefit                               |
|-----------|---------------------------------------|
| Input     | High - immediate keystroke feedback   |
| Textarea  | High - immediate keystroke feedback   |
| Canvas    | Potential - already has pixel buffer  |
| Progress  | Potential - simple bar redraw         |

---

## Files

| File                              | Purpose                                      |
|-----------------------------------|----------------------------------------------|
| `src/buffer.ts`                   | `DiffCollector` class                        |
| `src/rendering.ts`                | `findElementBounds()`                        |
| `src/components/input.ts`         | `fastRender(collector, bounds, isFocused)`   |
| `src/components/textarea.ts`      | `fastRender(collector, bounds, isFocused)`   |
| `src/engine.ts`                   | `_renderFastPath(diffs)`                     |
| `src/engine-keyboard-handler.ts`  | Creates DiffCollector, orchestrates fast path |

---

## Performance

| Metric                | Before (buffer copy) | After (DiffCollector) |
|-----------------------|----------------------|-----------------------|
| Typing latency        | ~2-5ms               | ~1ms                  |
| Buffer copy per key   | O(w×h) cells         | 0                     |
| Diff scan per key     | O(dirty rows × w)    | 0                     |
| Diffs generated       | ~30-80 cells         | ~30-80 cells          |

---

## Status

**Implemented** - Production ready

## See Also

- [dirty-row-tracking.md](dirty-row-tracking.md) — Buffer diff optimization
- [architecture.md](architecture.md) — Render pipeline overview
