# Sandbox Terminal Detection

Analysis of how Melker's terminal capability detection behaves in the Claude Code web sandbox, and how sandbox environment variables could be used to select correct color mode, theme, and graphics mode.

## Claude Code Sandbox Environment

Key environment variables observed in the sandbox:

| Variable                               | Value            |
|----------------------------------------|------------------|
| `TERM`                                 | `linux`          |
| `SHELL`                                | `/bin/bash`      |
| `IS_SANDBOX`                           | `yes`            |
| `CLAUDECODE`                           | `1`              |
| `CLAUDE_CODE_REMOTE`                   | `true`           |
| `CLAUDE_CODE_ENTRYPOINT`               | `remote`         |
| `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE`  | `cloud_default`  |

Notable absences: no `COLORTERM`, no `COLORFGBG`, no `COLUMNS`/`LINES`, no `DISPLAY`.

Observed behaviour: output is grayscale (not monochrome — intensity/brightness differences are visible, but no colour hues). Background-color terminal cell coloring does not work.

---

## Current Detection vs Sandbox Reality

### Color mode (`detectColorSupport()` in `src/theme.ts`)

With `TERM=linux` and no `COLORTERM`, Melker hits this branch:

```typescript
if (term === 'linux') {
  return 'color16';
}
```

This selects the `color16-dark` theme and generates 16-color ANSI escapes (`\x1b[41m` for red bg, etc.). But the sandbox terminal emulator doesn't render them — output is monochrome. Melker emits color codes into a void.

**The mismatch:** `TERM=linux` promises 16 ANSI colors. The sandbox doesn't deliver. There's no standard env var that says "I lied about my TERM capabilities."

### Unicode tier (`getUnicodeTier()` in `src/utils/terminal-detection.ts`)

`TERM=linux` → `'basic'` tier. Probably correct for the sandbox — sextant characters (U+1FB00+) likely won't render. Halfblock/block fallback is appropriate.

### Graphics detection (sixel/kitty/iterm2)

No `KITTY_WINDOW_ID`, `WEZTERM_PANE`, `GHOSTTY_RESOURCES_DIR`, `ITERM_SESSION_ID`. Plus `TERM=linux` is in the sixel blocklist. All three protocols correctly detect as unsupported. Graphics fall back to text-based rendering (halfblock given basic unicode tier).

### Terminal size

No `COLUMNS`/`LINES`, so `Deno.consoleSize()` (ioctl) is used. Works if the sandbox provides a real PTY. If not, falls back to 80x24.

### Dark mode (`detectDarkMode()` in `src/theme.ts`)

No `COLORFGBG` → defaults to dark. Probably correct for the sandbox.

---

## What the Sandbox Actually Renders

The sandbox renders **grayscale** — brightness/intensity differences are visible but no colour hues appear. This means the terminal emulator IS interpreting ANSI SGR codes, but maps them by luminance rather than hue.

### Foreground colors

Melker's `rgbTo16Color()` in `src/ansi-output.ts:66-107` generates standard 16-color codes:

- Grayscale inputs (saturation < 0.2) → `30` (black), `90` (dark gray), `37` (light gray), `97` (white)
- Saturated inputs → hue codes like `31` (red), `34` (blue), etc.

The sandbox appears to render ALL of these purely by brightness — `31` (red) and `34` (blue) both appear as the same gray level. This means `color16-dark` works, but hue information is wasted.

### Background colors

Background codes (`\x1b[40-47m`, `\x1b[100-107m`) are not rendered. The sandbox terminal emulator likely ignores background SGR codes entirely, or its DOM-based renderer doesn't implement cell background colouring.

Both `gray` and `color16` themes use `colorSupport: '16'`, so both emit background codes that the sandbox discards.

### Block-mode canvas rendering

Tested with `--gfx-mode=block` on the color-selector example. Block characters (░▒▓█) render correctly with visible brightness gradients — confirming:

1. **Unicode `basic` tier is correct** — shade block characters are available
2. **Foreground colour codes produce brightness variation** — the terminal maps ANSI colour intensity to grayscale
3. **Background colour is absent** — areas that rely on `\x1b[4Xm` background fills show as default/empty background
4. **The canvas uses foreground-coloured block characters**, not background fills, which is why the gradient is visible at all

Tested with `--gfx-mode=quadrant` as well. Half-block characters (▀, ▄) and box-drawing characters (┌─┐│└┘) all render correctly, confirming the `basic` unicode tier covers the sandbox's font capabilities.

### Theme comparison for sandbox

| Theme         | colorSupport | Foreground in sandbox              | Background in sandbox |
|---------------|--------------|------------------------------------|-----------------------|
| `bw-dark`     | `'none'`     | No colour codes, only bold/dim/etc | None (no codes sent)  |
| `gray-dark`   | `'16'`       | Grayscale — looks intentional      | Codes sent, ignored   |
| `color16-dark` | `'16'`      | Grayscale — hue info wasted        | Codes sent, ignored   |

**Best fit:** `gray-dark`. Its palette is designed for grayscale (uses only black, white, gray values), so the output looks intentional rather than broken. Background codes are still emitted and ignored, but foreground rendering matches the theme's design intent.

---

## Sandbox Environment Variables for Detection

### Detection points, by priority

| Env var                                | Specificity                     | Notes                                                              |
|----------------------------------------|---------------------------------|--------------------------------------------------------------------|
| `IS_SANDBOX=yes`                       | Generic sandbox signal          | Safest — not tied to Claude branding                               |
| `CLAUDECODE=1`                         | Claude Code is running          | Too broad — also true in local sessions that DO have color         |
| `CLAUDE_CODE_REMOTE=true`              | Remote/cloud session            | Narrows to the web sandbox specifically                            |
| `CLAUDE_CODE_REMOTE_ENVIRONMENT_TYPE`  | Exact sandbox type              | Most specific but most brittle                                     |

`IS_SANDBOX=yes` combined with `CLAUDE_CODE_REMOTE=true` is the reliable pair. `CLAUDECODE=1` alone is too broad — local Claude Code sessions in a real terminal have full color.

### What each detection could control

**Color mode / theme:**
Sandbox should force `gray-dark` instead of `color16-dark`. The `gray` theme uses only grayscale palette values, so the output looks intentional on a brightness-only terminal. Currently `detectColorSupport()` returns `color16` for `TERM=linux`, but should return `gray` when in a sandbox. The check should go *before* the TERM parsing — similar to how `NO_COLOR` is checked first in `initThemes()`.

**Graphics mode:**
Sandbox should default to `block`. The higher-resolution text modes all rely on background colour:

| Mode         | Resolution | Technique                                       | Needs bg color |
|--------------|------------|-------------------------------------------------|----------------|
| `sextant`    | 2x3        | U+1FB00+ characters — excluded by `basic` tier  | Yes            |
| `quadrant`   | 2x2        | ▀▄▌▐ — characters render but half is bg colour  | **Yes**        |
| `halfblock`  | 1x2        | ▀▄ — top half is fg, bottom half is bg colour    | **Yes**        |
| `block`      | 1x1        | ░▒▓█ — entire cell is foreground-only            | **No**         |

Only `block` mode is fully foreground-based. Quadrant and halfblock characters render in the sandbox, but each cell is only half-visible because the background half is missing. Block mode uses shade characters (░▒▓█) where the entire glyph is foreground-coloured, producing correct gradients at 1x1 resolution.

**Unicode tier:**
Already returns `basic` for `TERM=linux`. Possibly should be `ascii` if the web terminal can't render box-drawing characters, but `basic` is likely fine since most web fonts include those glyphs.

**Terminal size:**
If `Deno.consoleSize()` fails in the sandbox (no real PTY), it falls back to 80x24. The sandbox might benefit from `COLUMNS`/`LINES` being set, or Melker could read a `MELKER_STDOUT_WIDTH`/`MELKER_STDOUT_HEIGHT` override.

---

## The General Problem

The real issue isn't Claude-specific. It's that `TERM=linux` overpromises. Any web-based or emulated terminal that sets `TERM=linux` but can't render ANSI colors hits this. A more robust approach:

1. Check `NO_COLOR` (already done, but the sandbox doesn't set it)
2. Check sandbox/CI indicators (`IS_SANDBOX`, `CI`, `GITHUB_ACTIONS`, etc.) as a colour-downgrade signal
3. Optionally probe actual colour support at runtime (write a colour escape, query cursor position — fragile)

---

## Implementation Plan

If `IS_SANDBOX=yes` or (`CLAUDECODE=1` && `CLAUDE_CODE_REMOTE=true`):

1. Force theme to `gray-dark` — the sandbox renders foreground ANSI codes as grayscale, and the `gray` theme's palette is designed for exactly that
2. Force gfx mode to `block` — the only text-graphics mode that is purely foreground-based and doesn't rely on background colour

Both should be overridable by explicit `--theme` / `--gfx-mode` flags.

### Files to modify

| File                        | Change                                                                           |
|-----------------------------|----------------------------------------------------------------------------------|
| `src/theme.ts`              | Add sandbox check before TERM parsing in `detectColorSupport()`, return `'gray'` |
| `src/components/canvas-render.ts` | Add sandbox check in `getEffectiveGfxMode()`, default to `'block'`         |
| `src/policy/flags.ts`       | Add `IS_SANDBOX`, `CLAUDECODE`, `CLAUDE_CODE_REMOTE` to `ALWAYS_ALLOWED_ENV`     |
