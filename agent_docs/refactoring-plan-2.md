# Refactoring Plan 2: Remaining Code Duplication

Follows [refactoring-plan.md](refactoring-plan.md) (CSS parsers, dialogs, dithering — all completed).

---

## Phase 1: Cross-Cutting Utilities

Small, isolated extractions with zero risk. Each is self-contained.

### Step 1a: SHA-256 utility

4 identical implementations of `TextEncoder → crypto.subtle.digest → hex string`.

**Files with duplication:**
- `src/bundler/cache.ts:30-36` (`hashContent`)
- `src/policy/approval.ts:43-51` (`hashString`)
- `src/state-persistence.ts` (similar)
- `src/oauth.ts` (similar)

**Action:** Create `src/utils/crypto.ts`:
```typescript
export async function sha256(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}
```
Replace all 4 callers.

### Step 1b: Tree traversal adoption

`src/utils/tree-traversal.ts` already exports `findElement`, `collectElements`, `isDescendant`, `findElementById`, `findParentOf`. But 6 files reimplement the same recursive pattern.

**Files with redundant implementations:**
- `src/element.ts` — `findElementById()` reimplemented
- `src/document.ts` — `_findElementInSubtrees()`, `_searchElementTree()`
- `src/focus.ts` — `_findElementById()` with identical logic
- `src/rendering.ts` — `_findBoundsInTree()`, `_accumulateScrollOffset()`
- `src/scroll-handler.ts:80-94` — `_findOpenDialogs()` (generic tree collect)
- `src/engine-dialog-utils.ts` — element search in dialog trees

**Action:** Replace local implementations with calls to `tree-traversal.ts`. Read each file to determine which utility fits. Some may need a new generic `collectByPredicate()` variant.

### Step 1c: Dither dispatch function

Same `if/else if` chain selecting between 8 dither algorithms appears in 3 locations.

**Files:**
- `src/components/canvas.ts:862-880`
- `src/components/video.ts:1187-1197`
- `src/components/canvas-dither.ts:198-220`

**Action:** Create `src/video/dither/apply.ts`:
```typescript
export function applyDither(
  frameData: Uint8Array, width: number, height: number,
  bits: number, mode: DitherMode
): void { /* single dispatch switch */ }
```
Replace all 3 call sites.

### Step 1d: Value clamping utility

`Math.max(min, Math.min(max, value))` appears 95+ times across 10+ files.

**Action:** Add to `src/utils/` or `src/geometry.ts`:
```typescript
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
```
Adopt incrementally in files with 3+ instances (scroll-handler, viewport, rendering, canvas-render, textarea, progress, slider).

**Est. lines removed:** ~80-100 net
**Risk:** Low — all pure utility extractions
**Performance:** No impact. SHA-256 is startup-only. Tree traversal has O(1) registry fast-path (tree walk is rare fallback). Dither dispatch runs once per frame outside the pixel loop (O(1) with ~8 comparisons). Clamp is cold-to-warm; avoid adopting inside the tight sextant quantization loop in `canvas-render.ts:225-295` — everywhere else is fine (V8 JIT would likely inline it anyway).

---

## Phase 2: Graphics Protocol Detection

The three detection files share ~50% identical code: cached capabilities, state machine, terminal environment checks, timeout handling, getter functions.

### Step 2a: Create detection base module

**New file:** `src/graphics/detection-base.ts`

Extract shared infrastructure:
```typescript
interface DetectionState<T> {
  capabilities: T;
  timeout: number;
  resolve?: (caps: T) => void;
  timer?: number;
}

abstract class BaseProtocolDetection<T extends BaseCapabilities> {
  protected cachedCapabilities: T | null = null;
  protected detectionState: DetectionState<T> | null = null;

  getCached(): T | null { ... }
  setCached(caps: T): void { ... }
  clearCache(): void { ... }
  isAvailable(): boolean { ... }
  getTimeout(): number { ... }
  protected completeDetection(): void { ... }
  protected handleDetectionTimeout(): void { ... }
  protected checkIfInProgress(): T | null { ... }
  protected abstract checkTerminalEnv(caps: T): T;
  protected abstract parseResponse(input: string): Partial<T> | null;
}
```

### Step 2b: Refactor sixel/detect.ts

Keep protocol-specific logic: response parsing, DA1/DA2 sequences, sixel-specific terminal checks. Delegate state management and caching to base class.

**Current:** 732 lines → **Target:** ~400 lines

### Step 2c: Refactor kitty/detect.ts

Keep: kitty-specific APC response parsing, image placement testing. Delegate rest to base.

**Current:** 436 lines → **Target:** ~250 lines

### Step 2d: Refactor iterm2/detect.ts

Keep: iTerm2-specific environment detection (simpler than others). Delegate rest to base.

**Current:** 237 lines → **Target:** ~120 lines

**Est. lines removed:** ~350-400 net (new base ~150, removed ~500-550 from 3 files)
**Risk:** Medium — functional testing required for each protocol.
**Performance:** No impact. All detection code runs once at startup. State machine, caching, and terminal environment checks are cold paths.

---

## Phase 3: Graphics Output Pipeline

Three near-identical output collection, compositing, and generation pipelines.

### Step 3a: Unify output collection in graphics-overlay-manager.ts

**File:** `src/graphics-overlay-manager.ts`

`_collectSixelOutputs()`, `_collectKittyOutputs()`, `_collectITermOutputs()` are structurally identical. Only the method name called on each element differs (`getSixelOutput` vs `getKittyOutput` vs `getITermOutput`).

**Action:** Create generic collector:
```typescript
private _collectOutputs(
  capabilities: { supported: boolean } | undefined,
  getOutput: string,    // method name on canvas/img/video
  getOutputs: string,   // method name on markdown
  label: string,
): GraphicsOutputEntry[] { ... }
```
Replace 3 functions (~100 lines each) with 3 one-line calls.

### Step 3b: Extract compositing from canvas-render.ts

The compositing loop (draw buffer → image buffer → background fallback) is identical in `generateSixelOutput()`, `generateKittyOutput()`, `generateITerm2Output()`.

**Action:** Extract:
```typescript
function compositeBuffers(
  data: CanvasRenderData, bgColor: number
): { pixels: Uint32Array; hasContent: boolean } { ... }
```

### Step 3c: Unify placeholder rendering in canvas-render.ts

`renderSixelPlaceholder()`, `renderKittyPlaceholder()`, `renderITermPlaceholder()` are 100% identical code with different names.

**Action:** Replace with single `renderGraphicsPlaceholder()`.

### Step 3d: Unify graphics cache in canvas-render.ts

Kitty and iTerm2 caching patterns (`getKittyCompositedBuffer` / `getITermCompositedBuffer`, `getCachedOutput` / `setCachedOutput`) are identical.

**Action:** Create `GraphicsOutputCache` class used by both.

### Step 3e: Template method for canvas.ts output generation

`_generateSixelOutput()`, `_generateKittyOutput()`, `_generateITermOutput()` in canvas.ts follow the same pattern: get capabilities → create render data → call encoder → store.

**Action:** Create config-driven `_generateGraphicsOutput(protocol)` dispatching to protocol-specific encoder.

**Est. lines removed:** ~400-500 net
**Risk:** Medium — must verify visual output for all graphics modes.
**Performance:** No impact. The compositing loop is simple array read/write (not the bottleneck — encoding is). Output collection does a per-frame tree walk but this is O(elements) vs O(pixels) for encoding; the abstraction layer adds negligible overhead. Placeholder rendering is one-time. Cache lookup is Map.get() regardless of abstraction.

---

## Phase 4: Singleton & Config Patterns

### Step 4a: Global singleton factory

11 files have identical `let global; getGlobal(); setGlobal()` boilerplate (~15 lines each).

**Files:**
- `events.ts`, `focus.ts`, `headless.ts`, `input.ts`, `logging.ts`
- `performance-dialog.ts`, `stdout.ts`, `theme.ts`, `ui-animation-manager.ts`
- `tooltip/tooltip-manager.ts`, `toast/toast-manager.ts`

**Action:** Create `src/utils/singleton.ts`:
```typescript
export function createSingleton<T>(factory?: () => T) {
  let instance: T | undefined;
  return {
    get(): T { if (!instance) instance = factory!(); return instance; },
    set(v: T) { instance = v; },
    clear() { instance = undefined; },
  };
}
```
Each file replaces 15 lines with ~3 lines.

### Step 4b: Config value parsing

3 near-identical `string → boolean/integer/number` converters.

**Files:**
- `src/config/config.ts:220-250` (`parseEnvValue`)
- `src/config/config.ts:152-163` (`parseEnvValueForType`)
- `src/config/cli.ts:104-137` (`parseValue`)

**Action:** Extract single `parseValueByType(value, schemaType)` in `src/config/utils.ts`.

### Step 4c: Policy permission formatting

Same `if (p.read?.length) { header; for items; }` pattern repeated for 7 permission types in 3 functions. Plus duplicated `cwd` expansion and `samesite` host expansion.

**Files:**
- `src/policy/approval.ts:177-283` (`formatPolicyPermissions`)
- `src/policy/approval.ts:288-363` (`formatOverrides`)
- `src/policy/loader.ts:439-568` (`formatPolicy`)

**Action:** Create `formatPermissionGroup(lines, permissions, key, title, formatter?)` helper. Extract `expandCwdDisplay()` and `expandSamesite()` shared helpers.

### Step 4d: Handler context interfaces

Overlapping dependency interfaces in `engine-keyboard-handler.ts:42-74`, `engine-mouse-handler.ts:19-32`, `scroll-handler.ts:32-39`.

**Action:** Create base `HandlerContext` interface, extend for each handler's specific needs.

**Est. lines removed:** ~250-300 net
**Risk:** Low — isolated patterns, no hot paths
**Performance:** No impact. Singleton getters are called once at module load (`const logger = getLogger('X')`) and cached — not in loops. Config parsing and policy formatting are startup/approval-prompt-only. Handler context interfaces are type-only (erased at runtime).

---

## Performance Notes

All four phases have **zero measurable performance impact**. The refactored code is either on cold paths (startup, approval prompts, module initialization) or on warm paths where the abstraction overhead is negligible compared to the actual bottleneck (graphics encoding at O(pixels)).

**Actual rendering bottlenecks** (not touched by this plan):
- Sixel/Kitty/iTerm2 encoding (palette quantization, RLE, base64)
- Terminal I/O (writing escape sequences)
- Sextant quantization loop (`canvas-render.ts:225-295`)
- Error-diffusion dithering inner loops (already optimized in Phase 3 of plan 1)

**One caution:** Step 1d (clamp utility) — do not adopt inside the sextant quantization loop in `canvas-render.ts:225-295`. This is the tightest per-cell loop in the renderer. Everywhere else is safe.

---

## Summary

| Phase | What                          | Est. Lines Removed | Files Touched | Risk   | Perf Impact |
|-------|-------------------------------|--------------------:|---------------|--------|-------------|
| 1     | Cross-cutting utilities       |           80-100    | ~15           | Low    | None        |
| 2     | Graphics protocol detection   |          350-400    | 3 + 1 new     | Medium | None (cold) |
| 3     | Graphics output pipeline      |          400-500    | 3             | Medium | None        |
| 4     | Singleton & config patterns   |          250-300    | ~18           | Low    | None (cold) |
| **Total** |                           |    **1080-1300**    |               |        |             |

Phases are independent. Phase 1 is lowest risk, highest value-per-effort. Phases 2 and 3 can be done in either order but share the graphics subsystem so doing them together may be cleaner. Phase 4 is pure cleanup.

All phases are performance-safe. No refactored code is on a rendering hot path. See Performance Notes above.
