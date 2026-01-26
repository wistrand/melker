# Dirty Row Tracking

## Overview

Dirty row tracking optimizes buffer diff operations by only scanning rows that have changed, avoiding full O(width × height) scans.

## How It Works

ALL buffer writes funnel through `TerminalBuffer.setCell()`:

```
buffer.currentBuffer.setCell()     → TerminalBuffer.setCell()
clipped.currentBuffer.setCell()    → ClippedBufferProxy → TerminalBuffer.setCell()
viewport.currentBuffer.setCell()   → ViewportBufferProxy → TerminalBuffer.setCell()
fastRender fillRect/setText        → TerminalBuffer.setCell() (internally)
```

DualBuffer injects dirty tracking into TerminalBuffer. When `setCell()` writes a cell that differs from the reference buffer (previous frame), that row is marked dirty. During diff, only dirty rows are scanned.

## Implementation

### TerminalBuffer

```typescript
// Fields injected by DualBuffer
private _dirtyRows?: Set<number>;
private _referenceBuffer?: TerminalBuffer;

// Called by DualBuffer to enable/disable tracking
setDirtyTracking(referenceBuffer: TerminalBuffer, dirtyRows: Set<number>): void
clearDirtyTracking(): void

// In setCell(), after writing:
if (this._dirtyRows && this._referenceBuffer) {
  const written = this._cells[y][x];
  const reference = this._referenceBuffer._cells[y]?.[x];
  if (!reference || !this._cellsEqualDirect(written, reference)) {
    this._dirtyRows.add(y);
  }
}
```

### DualBuffer

```typescript
private _dirtyRows = new Set<number>();

constructor() {
  // Enable tracking on current buffer
  this._currentBuffer.setDirtyTracking(this._previousBuffer, this._dirtyRows);
}

swapAndGetDiff(): BufferDiff[] {
  const differences = this._computeDirtyDiff();

  // Disable tracking, swap buffers, clear, re-enable tracking
  this._currentBuffer.clearDirtyTracking();
  [this._previousBuffer, this._currentBuffer] = [this._currentBuffer, this._previousBuffer];
  this._currentBuffer.clear();
  this._currentBuffer.setDirtyTracking(this._previousBuffer, this._dirtyRows);
  this._dirtyRows.clear();

  return differences;
}

private _computeDirtyDiff(): BufferDiff[] {
  const differences: BufferDiff[] = [];
  for (const y of this._dirtyRows) {
    // Only scan cells in dirty rows
    for (let x = 0; x < this._width; x++) {
      if (!this._cellsEqualDirect(currentRow[x], previousRow[x])) {
        differences.push({ x, y, cell: { ...currentRow[x] } });
      }
    }
  }
  return differences;
}
```

### Special Cases

**Resize**: Marks all rows dirty (full redraw needed)

**prepareForFastRender**: Temporarily disables tracking during buffer copy, preserves dirty rows

## Performance

| Operation | Before             | After               |
|-----------|--------------------|---------------------|
| setCell   | O(1)               | O(1) + 1 comparison |
| diff      | O(width × height)  | O(dirtyRows × width) |

**Real-world example** (form demo, 123×47 terminal):
- 13/47 rows contain form content
- 72% savings: scans 1599 cells instead of 5781
- Static UI rows (empty space) never scanned

## Tracking Paths

| Path               | Flow                                                                      | Tracked |
|--------------------|---------------------------------------------------------------------------|---------|
| Direct DualBuffer  | `buffer.currentBuffer.setCell()` → TerminalBuffer                          | ✓       |
| ClippedDualBuffer  | `clipped.currentBuffer.setCell()` → ClippedBufferProxy → TerminalBuffer    | ✓       |
| ViewportDualBuffer | `viewport.currentBuffer.setCell()` → ViewportBufferProxy → TerminalBuffer  | ✓       |
| Fast render        | `buffer.currentBuffer.fillRect()` → TerminalBuffer.setCell()               | ✓       |
| setText/fillRect   | Internal loops call setCell()                                              | ✓       |

## Stats

BufferStats includes dirty tracking metrics:

```typescript
interface BufferStats {
  // ... existing fields ...
  dirtyRows: number;      // Number of rows marked dirty
  totalRows: number;      // Total buffer height
  scannedCells: number;   // dirtyRows × width
}
```

Debug logging (enable with `MELKER_LOG_LEVEL=DEBUG`):
```
Diff scan: 1599/5781 cells (72% saved), 13/47 rows dirty, 2 cells changed
```

## Limitations

**Conservative marking**: Rows are marked dirty based on intermediate writes, not final state. If a container fills background before children render, rows get marked dirty even if the final content matches the reference. This is acceptable - the actual diff still finds 0 changes, we just scan more rows than strictly necessary.

**Row-level granularity**: Entire rows are marked dirty, not individual cells. A single changed cell marks its entire row for scanning. Cell-level tracking would add memory overhead.

**Modal dialog transitions**: When opening a modal dialog, rows may not be marked dirty if the app content underneath happens to match the previous frame's content at those positions. This occurs because:
1. Buffer is cleared (doesn't trigger dirty tracking)
2. App content renders first - if it matches previous frame, rows aren't marked dirty
3. Modal renders on top, but if some cells in the modal area weren't explicitly written (gaps, margins), they retain app content
4. Those cells match the previous frame, so the row isn't in the diff
5. Terminal shows stale content from the previous frame

**Automatic Solution**: The engine automatically detects when dialogs open and uses a full diff for that render cycle. This is transparent to apps - just use `render()` as normal. The engine tracks which dialogs were open in the previous frame and, if any new dialog is detected, marks the buffer for a full diff via `DualBuffer.markForceNextRender()`.

```typescript
// In engine.render():
const currentOpenDialogs = this._collectOpenDialogIds();
for (const id of currentOpenDialogs) {
  if (!this._previouslyOpenDialogIds.has(id)) {
    this._buffer.markForceNextRender();  // Automatic!
    break;
  }
}
this._previouslyOpenDialogIds = currentOpenDialogs;
```

Built-in dialogs (alert, confirm, prompt, accessibility, dev-tools) also call `forceRender()` directly for immediate feedback.

## See Also

- [fast-input-render.md](fast-input-render.md) — Fast render path for input components
- [architecture.md](architecture.md) — Render pipeline overview
