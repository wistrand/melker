# Splitting engine.ts — Analysis & Plan (Round 2)

**Current state**: 2,074 lines, ~37 fields, ~60 methods/getters.

**Already extracted** (13 modules): ScrollHandler, ElementClickHandler, FocusNavigationHandler, TextSelectionHandler, GraphicsOverlayManager, StatePersistenceManager, engine-keyboard-handler, engine-mouse-handler, engine-buffer-overlays, engine-system-palette, engine-dialog-utils, TerminalSizeManager, DialogCoordinator.

## 1. Debug/Test Injection API (~110 lines)

**The problem**: `handleKeyPress()`, `handleMouseEvent()`, `clickElementById()`, `dispatchNamedEvent()`, `getElementAt()`, `getElementBounds()` are testing/debugging helpers that inject synthetic events. All are pure delegation with no state.

**Extract to**: `engine-test-api.ts` as functions taking a context interface, with 3-line delegation wrappers staying on the engine.

**Fields that move**: None.

**Complexity**: Low. Pure delegation methods.

**Impact**: ~80 lines of method bodies extracted. Wrappers remain on engine for public API compatibility.

## 2. Render Pipeline Internals (~180 lines)

**The problem**: `_renderOptimized()` (46 lines), `_renderFastPath()` (23 lines), `_renderFullScreen()` (37 lines), and `_writeAllSync()` (25 lines) are the low-level rendering strategies. They share access to `_buffer`, `_ansiOutput`, `_terminalRenderer`, `_graphicsOverlayManager`, and `_logger`.

**Extract to**: `engine-render-pipeline.ts` with a `RenderPipelineContext` interface.

**Fields that move**: None directly — all accessed via context.

**Complexity**: Medium. Needs a context interface with buffer, ansi output, terminal renderer, graphics overlay manager, logger, and terminal size.

**Impact**: ~130 lines of method bodies removed. The calling code in `render()`/`forceRender()` stays.

## 3. Lifecycle Shutdown (~113 lines)

**The problem**: `stop()` is 113 lines of cascading cleanup — stopping input, resize handler, debug server, headless/stdout managers, restoring terminal, clearing graphics, removing global instances. Essentially the reverse of `start()`.

**Extract to**: `engine-lifecycle.ts` as a `shutdownEngine(deps)` function.

**Fields that move**: None — all accessed via context/deps.

**Complexity**: Medium. Touches many fields but in a read-only/teardown pattern. Needs a large context interface.

**Impact**: ~80 lines removed (engine keeps a thin `stop()` wrapper).

## 4. Split _initializeComponents (readability, no new file)

**The problem**: `_initializeComponents()` is 158 lines creating ~15 manager instances with dependency injection. Single largest method.

**Extract to**: No new file. Break into sub-methods within engine.ts: `_initializeInputHandlers()`, `_initializeRenderingStack()`, `_initializeDebugFeatures()`.

**Complexity**: Low. Mechanical restructuring.

**Impact**: 0 lines saved, but significantly improves readability of the initialization flow.

## 5. Performance Tracking (~50 lines)

**The problem**: Performance measurement scattered across `render()` and `forceRender()` — timing, layout node counting, `perfDialog.recordRenderTime()`, slow-render warnings.

**Extract to**: `engine-perf-tracking.ts` or fold into existing `performance-dialog.ts`.

**Complexity**: Low.

**Impact**: ~40 lines. Modest win — removes boilerplate timing code from render methods.

## Recommended Priority Order

| Priority | Extraction                    | Lines saved     | Effort | Rationale                                                    |
|----------|-------------------------------|-----------------|--------|--------------------------------------------------------------|
| 1        | **Debug/test injection API**  | ~80             | Low    | Clear boundary, pure delegation, no state                    |
| 2        | **Render pipeline internals** | ~130            | Medium | Groups the 3 render strategies + writeAllSync                |
| 3        | **Lifecycle shutdown**        | ~80             | Medium | Self-contained teardown logic                                |
| 4        | **Split _initializeComponents** | 0 (readability) | Low  | Break into sub-methods, no new file                          |
| 5        | **Performance tracking**      | ~40             | Low    | Modest win, removes scattered timing code                    |

Extractions 1-3 would bring engine.ts from ~2,074 to ~1,784 lines. After that, the remaining bulk is the core `render()`/`forceRender()` orchestration and `constructor`/`start()` lifecycle, which is inherently engine responsibility.
