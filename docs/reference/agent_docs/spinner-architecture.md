# Spinner Component Architecture

## Summary

- Animated single-character spinner with optional text label
- Multiple built-in styles (dots, line, arc, etc.) selected via `variant` prop
- Runs on the shared `UIAnimationManager` timer; `spinning` prop starts/stops

The `<spinner>` component displays animated loading indicators with optional text and effects.

## Overview

| Property  | Value                                          |
|-----------|------------------------------------------------|
| Type      | `spinner`                                      |
| File      | `src/components/spinner.ts`                    |
| Animation | Shared timer with time-based frame calculation |
| Size      | Single line, 1 char spinner + optional text    |

## Props

| Prop           | Type                    | Default  | Description                                       |
|----------------|-------------------------|----------|---------------------------------------------------|
| `text`         | `string`                | -        | Static text beside spinner (ignored if verbs set) |
| `variant`      | `SpinnerVariant`        | `'line'` | Animation style                                   |
| `speed`        | `number`                | `100`    | Frame interval in milliseconds                    |
| `textPosition` | `'left'` \| `'right'`   | `'left'` | Spinner position relative to text                 |
| `spinning`     | `boolean`               | `true`   | Whether animation is active                       |
| `verbs`        | `VerbTheme` \| `string` | -        | Cycling text: theme name or comma-separated list  |
| `verbSpeed`    | `number`                | `800`    | Verb cycle interval in milliseconds               |
| `shade`        | `boolean`               | `false`  | Enable animated brightness wave across text       |
| `shadeSpeed`   | `number`                | `60`     | Shade wave speed in ms per character              |

## Variants

| Variant   | Frames       | Description                    |
|-----------|--------------|--------------------------------|
| `none`    | (empty)      | Text only, no spinner char     |
| `line`    | `\|/-\`      | Classic ASCII spinner          |
| `dots`    | `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | Braille dots rotation          |
| `braille` | `⣷⣯⣟⡿⢿⣻⣽⣾`   | Braille circle rotation        |
| `arc`     | `◜◠◝◞◡◟`     | Arc segments rotation          |
| `bounce`  | `⠁⠂⠄⠂`       | Vertical bouncing dot          |
| `flower`  | `·✻✽✶✳✢`     | Decorative flower animation    |
| `pulse`   | `·•●•`       | Pulsating dot (small to large) |

## Verb Themes

### Standard Themes

| Theme      | Words                                          |
|------------|------------------------------------------------|
| `loading`  | Loading, Loading., Loading.., Loading...       |
| `thinking` | Thinking, Pondering, Contemplating, Reasoning  |
| `working`  | Working, Processing, Computing, Calculating    |
| `waiting`  | Please wait, Hold on, One moment, Almost there |
| `fetching` | Fetching, Downloading, Retrieving, Receiving   |
| `saving`   | Saving, Writing, Storing, Committing           |

### Poetic Themes

| Theme        | Words (8 each)                                                                                      |
|--------------|-----------------------------------------------------------------------------------------------------|
| `dreaming`   | Dreaming, Drifting, Wandering, Imagining, Musing, Floating, Reverie, Daydreaming                    |
| `conjuring`  | Conjuring, Summoning, Manifesting, Invoking, Channeling, Enchanting, Spellcasting, Incanting        |
| `brewing`    | Brewing, Simmering, Steeping, Distilling, Fermenting, Infusing, Concocting, Alchemizing             |
| `weaving`    | Weaving, Spinning, Threading, Stitching, Knitting, Braiding, Intertwining, Entwining                |
| `unfolding`  | Unfolding, Blossoming, Awakening, Emerging, Blooming, Unfurling, Revealing, Flourishing             |
| `stargazing` | Stargazing, Moonwatching, Skydreaming, Cloudreading, Stardrifting, Constellation, Celestial, Cosmic |

---

## Architecture

### Shared Animation Manager

All spinners share a single timer via `SpinnerAnimationManager` (singleton):

```
┌─────────────────────────────────────────┐
│       SpinnerAnimationManager           │
│  ┌─────────────────────────────────┐    │
│  │  setInterval (40ms tick)        │    │
│  │         │                       │    │
│  │         ▼                       │    │
│  │   requestRender()               │    │
│  └─────────────────────────────────┘    │
│                                         │
│  Registered spinners: Set<Spinner>      │
└─────────────────────────────────────────┘
           │
           ▼
    ┌──────────────┐
    │   Spinner 1  │──┐
    └──────────────┘  │
    ┌──────────────┐  │  Each calculates own
    │   Spinner 2  │──┼─ frame from elapsed time
    └──────────────┘  │
    ┌──────────────┐  │
    │   Spinner N  │──┘
    └──────────────┘
```

**Benefits:**
- Single timer for all spinners (not N timers)
- Single `requestRender()` call per tick
- Auto-starts when first spinner registers
- Auto-stops when last spinner unregisters

### Time-Based Animation

Instead of incrementing frame counters, spinners calculate current frame from elapsed time:

```typescript
const elapsed = Date.now() - this._startTime;
const frameIndex = Math.floor(elapsed / speed) % frames.length;
```

This allows each spinner to have different `speed` values while sharing the same 40ms base timer.

### Wide Character Handling

Spinner characters (especially Unicode like `✶`) can have ambiguous widths. The component uses `setCell` with explicit `width: 1` to force single-cell rendering:

```typescript
buffer.currentBuffer.setCell(x, y, { char: frame, width: 1, ...style });
```

---

## Shade Effect

The shade effect creates a moving "spotlight" across text with brightness gradient:

```
Peak at position 3:
  C  h  a  r  a  c  t  e  r  s
 50% 75% 100% 75% 50% 50% 50% 50% ...
```

**Algorithm:**
1. Calculate peak position from elapsed time
2. For each character, compute distance from peak (with wrap-around)
3. Brightness = max(50%, 100% - distance * 25%)
4. Darken foreground color by brightness factor

```typescript
const brightness = Math.max(0.5, 1.0 - dist * 0.25);
const r = Math.round(baseR * brightness);
// ... apply to foreground color
```

---

## Usage Examples

### Basic

```xml
<spinner />
<spinner text="Loading..." />
<spinner variant="dots" text="Please wait" />
```

### With Verb Themes

```xml
<spinner variant="braille" verbs="thinking" />
<spinner variant="flower" verbs="conjuring" />
```

### Custom Verbs (comma-separated)

```xml
<spinner variant="dots" verbs="Step 1, Step 2, Step 3, Done!" verbSpeed="600" />
```

### Shade Effect

```xml
<spinner variant="dots" text="Processing..." shade="true" />
<spinner variant="none" verbs="dreaming" shade="true" shadeSpeed="40" />
```

### Text Only (no spinner char)

```xml
<spinner variant="none" verbs="thinking" />
<spinner variant="none" text="Status message" shade="true" />
```

### Programmatic Control

```typescript
const spinner = $melker.getElementById('my-spinner');
spinner.props.spinning = false;  // Stop
spinner.props.spinning = true;   // Start
spinner.props.variant = 'dots';  // Change variant
spinner.props.verbs = 'saving';  // Change verb theme
```

---

## Files

| File                             | Purpose                  |
|----------------------------------|--------------------------|
| `src/components/spinner.ts`      | Component implementation |
| `src/components/mod.ts`          | Export                   |
| `src/types.ts`                   | Type registration        |
| `examples/basics/spinner.melker` | Example showcase         |
