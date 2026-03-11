# Inline (Partial-Screen) Mode Plan

**Status: On hold.** Technically feasible but not worth building until there is concrete demand. See [Recommendation](#recommendation) below.

## Summary

Melker currently runs in full-screen mode (even when alt-screen is disabled). This plan covers adding an inline/partial-screen mode where the app occupies only part of the terminal, similar to Ink or Bubble Tea's inline mode.

**Verdict: Feasible but the tradeoffs are significant. The core rendering pipeline (layout, dual buffer, input) is parameterizable, but inline mode would create a parallel behavioral regime where many of Melker's product surfaces (overlays, dropdowns, graphics, mouse interaction) stop working or degrade substantially.**

## Current Full-Screen Assumptions

| Area                   | File                      | Lines     | Difficulty | Notes                                                                          |
|------------------------|---------------------------|-----------|------------|--------------------------------------------------------------------------------|
| Cursor positioning     | `renderer.ts`             | 219-220   | **Hard**   | Absolute `\x1b[row;colH` per diff. Needs relative movement + stale content clearing + cursor recovery |
| Screen clear           | `renderer.ts`             | 151, 161  | Medium     | `\x1b[2J` clears full screen. Needs regional `\x1b[K` clears + line width shrinkage handling |
| Terminal setup         | `terminal-lifecycle.ts`   | 62-99     | Medium     | Alt-screen, cursor hide, screen clear. Alt-screen flag exists                  |
| Root layout sizing     | `engine.ts`               | 421-427   | Easy       | Already falls back to `stdoutWidth`/`stdoutHeight` config                      |
| Mouse coordinates      | `input.ts`                | 220-222   | **Soft**   | Offset subtraction is trivial. Coordinate model becomes unreliable after scroll |
| Resize handling        | `resize.ts`               | 60-160    | Easy       | `consoleSize()` returns full terminal, buffer handles any size                 |
| Dual buffer diffing    | `buffer.ts`               | 750-783   | **None**   | Purely relative cell comparison. No changes needed                             |
| Boundary enforcement   | multiple                  | multiple  | **Hard**   | Dialogs, dropdowns, toasts, command palette, graphics protocols all assume full screen. Not cleanup work. |

## Scroll Problem

In inline mode, if the terminal scrolls (user scrollback, other program output, etc.), an absolute Y offset becomes stale and rendering goes to the wrong rows. The terminal has no event or signal for "your content scrolled" (unlike resize which has SIGWINCH).

**Solution: Relative cursor movement.** Instead of absolute `\x1b[row;colH`, use relative movement (`\x1b[NA` cursor up, `\x1b[NB` cursor down) from a tracked anchor point. This is what Ink and Bubble Tea do. It is inherently scroll-tolerant because it doesn't depend on absolute Y coordinates.

### How it works

1. The renderer tracks an internal cursor position (row, col) within the inline region (0-based, relative to the region's top).
2. Before each render, move to the anchor (bottom of inline region) using the tracked position, then move up N rows to reach row 0.
3. For each diff cell, emit relative vertical moves (`\x1b[NA`/`\x1b[NB`) from the tracked position. Horizontal positioning with `\x1b[colG` is only valid once the cursor is on the correct row; it depends on the vertical anchor logic being correct.
4. After render, restore cursor to the anchor (bottom of inline region).

**Anchor fragility:** The "move to row 0" step only works if the cursor is actually at the tracked anchor position. If external output writes to the terminal while Melker is running, the anchor assumption breaks. Ink and Bubble Tea get away with this because they effectively own the live region contract: nothing else writes to the terminal while they're running. Melker would need the same contract, which limits the "embed alongside other output" use case.

### Dual-buffer compatibility

The dual-buffer diff still works. The diff produces a list of changed cells with (x, y) coordinates relative to the inline region. The renderer sorts diffs top-to-bottom, left-to-right and emits relative vertical moves between rows.

### Additional renderer concerns

Switching to relative Y movement is necessary but not sufficient. The inline renderer also needs:

- **Stale content clearing.** When content shrinks (fewer characters on a line than the previous render), leftover characters must be erased. Full-screen mode handles this implicitly via the dual buffer overwriting every cell. Inline mode needs explicit `\x1b[K` (clear to end of line) or padding, since the terminal may have content from previous output in those cells.
- **Line width shrinkage.** If a line was 40 chars last frame and 30 this frame, the 10 trailing chars must be cleared. The diff may not produce changes for cells that went from "content" to "nothing."
- **Cursor recovery.** If a render is interrupted (signal, error), the cursor must be returned to a known position. In full-screen mode this is trivial (home cursor). In inline mode, a lost cursor position means corrupted output above or below the region.
- **Graphics protocol output.** Sixel, kitty, and iterm2 protocols use their own positioning. These would need separate clipping or be disabled in inline mode.

## Existing Infrastructure That Helps

- **stdout mode** already does non-fullscreen rendering with custom dimensions, no alt-screen, no cursor positioning. Closest thing to inline mode today.
- **Alt-screen disable** config flag exists but currently falls back to clear-screen + home-cursor (still assumes full screen).
- **Viewport clipping** already works for scroll containers. Same mechanism could clip to an inline region.
- **`DetectionModule`** in `src/graphics/detection-base.ts` provides async query/response infrastructure (state machine, timeout, input feed guards, Ctrl+C passthrough) used by sixel and kitty detection. The cursor position query (`\x1b[6n` DSR) follows the same query/response pattern, so the `DetectionModule` approach could be reused. However, the existing infrastructure is specifically built for graphics protocol detection; adapting it for DSR would require new code, not just configuration.

## Approach

Extend stdout mode into an "inline interactive" mode.

### Phase 1: Relative cursor renderer (3-5 days)

- Add `inlineMode` config flag and `inlineHeight` parameter (defaults to e.g. 15 rows).
- At startup, reserve N rows by printing newlines, then move cursor up N lines to position at the top of the inline region. The anchor (bottom of region) is tracked internally.
- Query initial cursor position via `\x1b[6n` DSR for mouse coordinate translation (not needed for rendering). Build a new detection module following the `DetectionModule` pattern from `src/graphics/detection-base.ts`.
- Add an inline rendering mode to `renderer.ts` that:
  - Tracks internal cursor position (row, col) within the inline region.
  - Uses relative vertical movement (`\x1b[NA`/`\x1b[NB`) from the tracked position.
  - Uses `\x1b[colG` for horizontal positioning only after confirming the cursor is on the correct row.
  - Handles stale content clearing: emit `\x1b[K` at end of each line that shrank since last render.
  - Handles cursor recovery on error/signal: always restore to anchor before returning.
  - Sorts diffs top-to-bottom, left-to-right for sequential traversal.
- Replace `\x1b[2J` (full clear) with line-by-line `\x1b[K` within the inline region on first render.
- Skip alt-screen and full-screen clear in `terminal-lifecycle.ts`.

### Phase 2: Input and cleanup (1-2 days)

- Disable mouse reporting by default in inline mode. Skip mouse enable sequences in `terminal-lifecycle.ts`. Scrollable containers, dropdowns, and other mouse-interactive components fall back to keyboard navigation.
- When `inlineMouse` is enabled: subtract the initial offset (from DSR query) from mouse Y in `input.ts`. The coordinate model becomes unreliable after any terminal scroll. This is inherent to all inline TUI modes.
- Restore terminal on exit: move cursor below the inline region (anchor point), print newline, show cursor. Previous terminal content above the inline region is preserved.

### Phase 3: Boundary enforcement (3-5 days)

This is not cleanup work. Dialogs, dropdowns, command palette, toasts, and graphics protocols are important product surfaces in Melker. Inline mode creates a parallel behavioral regime where many existing assumptions stop holding.

- Clip or disable dialogs and modals. Full-screen dialogs cannot work in a 15-row region.
- Clip dropdown menus (select, combobox, command-palette) to inline bounds. Dropdowns that would extend beyond the region need to flip direction or truncate.
- Clip toast notifications to the inline region.
- Disable or clip graphics protocol output (sixel, kitty, iterm2). These protocols use their own positioning and cannot be trivially confined to a region.
- The command palette (Ctrl+K) may need to be disabled or replaced with a simpler version in inline mode.

### Phase 4: Edge cases and testing (open-ended)

- Resize: on SIGWINCH, adjust inline region width (height stays fixed).
- Test across terminals (Ghostty, Kitty, iTerm2, WezTerm, Alacritty, VS Code).
- Test with tmux/screen.
- Test with content above/below the inline region (ensure no bleed).
- Test rapid re-renders to verify relative cursor tracking stays in sync.
- Test cursor recovery after signals (SIGTSTP/SIGCONT, Ctrl+Z).
- Test with external output interference (other processes writing to the same terminal).

## Estimated Total

A prototype that works in the happy path: 2-3 weeks. Production-ready across terminals, tmux/screen, mouse/no-mouse, overlays, graphics protocols, and external output interference: open-ended until the first real app tries it.

## Config

```typescript
// New config keys
inlineMode: boolean    // Enable inline (partial-screen) mode
inlineHeight: number   // Height in rows (default: 15)
inlineMouse: boolean   // Enable mouse capture in inline mode (default: false)
```

Environment variables: `MELKER_INLINE=true`, `MELKER_INLINE_HEIGHT=20`, `MELKER_INLINE_MOUSE=true`.

## Mouse and Terminal Scrolling

Raw mode is required for keyboard input in inline mode. However, mouse reporting is a separate concern. When mouse reporting is enabled, the terminal sends scroll wheel events as escape sequences instead of actually scrolling the viewport. This means the user cannot scroll the terminal normally while mouse capture is active. Mouse reporting is all-or-nothing at the protocol level: there is no way to capture mouse events only within the inline region.

**Default: mouse off.** Inline mode disables mouse reporting by default. The terminal scrolls normally. Scrollable containers within the app use keyboard navigation (arrow keys, Page Up/Down, Home/End). This matches Bubble Tea's inline mode behavior.

**Opt-in: `inlineMouse: true`.** Enables mouse capture for apps that need click/scroll interaction and don't care about terminal scrollback. When enabled, all scroll wheel events go to Melker, not the terminal. The mouse coordinate model becomes unreliable after any terminal scroll event.

Dropdowns (select, combobox) in inline mode default to keyboard-only interaction when mouse is off: arrow keys to navigate, Enter to select, Escape to close.

## Known Limitations

- **No mouse by default:** Inline mode disables mouse to preserve terminal scrolling. Opt in with `inlineMouse: true`, which captures all mouse events including scroll wheel. Coordinates become unreliable after scroll.
- **Anchor fragility:** The relative cursor model assumes Melker owns the live region. External output to the same terminal breaks the anchor tracking. This limits the "embed alongside other output" use case.
- **Overlays and modals:** Dialogs, command palette, toasts, and dropdown menus are clipped to the inline region or disabled. These are important product surfaces, not edge cases.
- **Graphics protocols:** Sixel/kitty/iterm2 image output uses its own positioning. Must be disabled or separately clipped in inline mode.
- **Stale content:** Lines that shrink between renders need explicit clearing. The dual buffer diff alone does not handle this in inline mode.

## Prior Art

- **Ink** renders bottom-up: tracks how many lines were last rendered, moves cursor up that many lines, clears and rewrites. No absolute coordinates. Scroll-tolerant. Owns the live region contract.
- **Bubble Tea** uses the same approach: relative cursor movement from a tracked anchor point. Their "inline mode" reserves N rows and renders within them. Also owns the live region.
- Both frameworks give up on accurate mouse coordinates after scroll, same as this plan.

## Use Cases

- Embedding Melker UI in a larger CLI tool's output
- Running a dashboard widget alongside other terminal output
- Interactive prompts that don't take over the screen
- Library usage where the caller controls the terminal

## Recommendation

**Don't build this until there is demand.** The tradeoffs outweigh the benefits for current use cases:

- **No mouse by default** means scrollable containers, dropdowns, data tables, and click-to-select all degrade to keyboard-only. Much of Melker's component library assumes mouse interaction.
- **Clipped or disabled overlays** means dialogs, command palette, toasts, and dropdowns lose functionality or disappear entirely. These are important product surfaces, not edge cases.
- **Boundary enforcement is substantial work** that creates a parallel behavioral regime across multiple component systems.
- **Open-ended timeline** for production readiness across terminals, multiplexers, and interference scenarios.

The apps that benefit from inline mode (small prompts, status widgets, progress bars) are also the apps that don't need Melker. A simple readline or spinner library handles those. Melker's value is in full-screen apps: dashboards, data explorers, forms with tables and charts. Those need the full terminal.

**What would change this:**
- A concrete use case where someone needs Melker components but cannot take the full screen (e.g., library mode where another tool embeds a Melker widget).
- Terminal protocol evolution that solves the mouse/scroll conflict (unlikely near-term).

The plan and analysis are preserved here for when the need arises. The rendering pipeline constraints are well understood and the approach is directionally clear, even if the details would need to be worked out against a real app.
