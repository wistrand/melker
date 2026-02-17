# Toast System Architecture

## Summary

- `$melker.toast.show(message, options)` — programmatic non-modal notifications
- Stacked vertically at top or bottom of screen; auto-dismiss with configurable duration
- Supports info/success/warning/error variants with theme-appropriate colors

Programmatic non-modal notification system for Melker.

**Status:** Implemented

## Overview

| Aspect          | Decision                                                   |
|-----------------|------------------------------------------------------------|
| API             | `$melker.toast.show(message, options)` - programmatic      |
| Position        | `bottom` (default) or `top` - centered, runtime switchable |
| Animation       | None (instant display)                                     |
| Stacking        | Vertical, newest at bottom                                 |
| Auto-close      | Per-toast timer + global inactivity timeout (timer-driven) |
| Max toasts      | 5 default, configurable, dismiss oldest on overflow        |
| Bell            | Optional `\x07` for error toasts                           |
| Rendering       | Direct buffer rendering (z-index 300)                      |
| Duplicates      | Same message+type resets timer, shows count (2), (3)       |
| Width           | Auto-sizes to content, config.width is minimum             |
| Width stability | Only expands during session, never shrinks                 |
| Text overflow   | Clips on word boundary with ellipsis                       |

---

## Configuration Schema

Add to `src/config/schema.json`:

```json
{
  "toast": {
    "type": "object",
    "properties": {
      "maxVisible": {
        "type": "number",
        "default": 5,
        "description": "Maximum visible toasts before dismissing oldest"
      },
      "position": {
        "type": "string",
        "enum": ["bottom", "top"],
        "default": "bottom",
        "description": "Toast container position"
      },
      "defaultDuration": {
        "type": "number",
        "default": 5000,
        "description": "Default toast duration in ms"
      },
      "inactivityTimeout": {
        "type": "number",
        "default": 8000,
        "description": "Dismiss all toasts after inactivity (ms)"
      },
      "bell": {
        "type": "boolean",
        "default": false,
        "description": "Play terminal bell on error toasts"
      },
      "width": {
        "type": "number",
        "default": 40,
        "description": "Toast container width in characters"
      }
    }
  }
}
```

**Environment variable overrides:**
- `MELKER_TOAST_MAX_VISIBLE`
- `MELKER_TOAST_POSITION`
- `MELKER_TOAST_DURATION`
- `MELKER_TOAST_BELL`

---

## Types (`src/toast/types.ts`)

```typescript
type ToastType = 'info' | 'success' | 'warning' | 'error';
type ToastPosition = 'bottom' | 'top';

interface ToastOptions {
  type?: ToastType;
  duration?: number;        // Per-toast timeout (default from config)
  closable?: boolean;       // Show X button (default: true)
  bell?: boolean;           // Override config bell setting
  action?: { label: string; onClick: () => void };
}

interface ToastEntry {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
  duration: number;
  closable: boolean;
  bell: boolean;
  action?: ToastAction;
  count: number;           // Duplicate count (displayed when > 1)
}

interface ToastConfig {
  maxVisible: number;
  position: ToastPosition;
  defaultDuration: number;
  inactivityTimeout: number;
  bell: boolean;
  width: number;
}
```

---

## ToastManager (`src/toast/toast-manager.ts`)

Singleton service managing toast state and lifecycle:

```typescript
class ToastManager {
  private _toasts: ToastEntry[] = [];
  private _lastActivity: number = 0;
  private _config: ToastConfig;
  private _requestRender?: () => void;
  private _expiryTimer?: number;

  // Public API
  show(message: string, options?: ToastOptions): string;
  dismiss(id: string): void;
  dismissAll(): void;
  hasVisibleToasts(): boolean;
  getActiveToasts(): ToastEntry[];
  resetInactivity(): void;
  isInactive(): boolean;
  setConfig(config: Partial<ToastConfig>): void;
  getConfig(): ToastConfig;
  setRequestRender(fn: () => void): void;
  handleClick(x: number, y: number, bounds: Bounds): boolean;
}
```

**Timer-driven expiry:** The manager uses `setTimeout` to schedule renders when toasts should expire, ensuring auto-dismiss works without user interaction. The timer considers both individual toast durations and the global inactivity timeout.

---

## Visual Layout

**Bottom position (default):** "Close All" on bottom border
```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  Main app content                                                    │
│                                                                      │
│           ╭────────────────────────────────────────╮                 │
│           │ ℹ First message                     ✕  │                 │
│           │ ✓ Success toast                     ✕  │                 │
│           │ ⚠ Warning here                      ✕  │                 │
│           │ ✕ Error occurred                    ✕  │                 │
│           ╰─────────── Close All ─────────────────╯                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Top position:** "Close All" on top border
```
┌──────────────────────────────────────────────────────────────────────┐
│           ╭─────────── Close All ─────────────────╮                 │
│           │ ℹ First message                     ✕  │                 │
│           │ ✓ Success toast                     ✕  │                 │
│           ╰────────────────────────────────────────╯                 │
│                                                                      │
│  Main app content                                                    │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

**Positioning:**
- Centered horizontally: `x = (viewport.width - width) / 2`
- Bottom: `y = viewport.height - containerHeight - 1`
- Top: `y = 1`

**Toast icons by type:**
- `info`: `ℹ`
- `success`: `✓`
- `warning`: `⚠`
- `error`: `✕`

---

## $melker API Extension

```typescript
interface MelkerContext {
  // ... existing
  toast: {
    show(message: string, options?: ToastOptions): string;
    dismiss(id: string): void;
    dismissAll(): void;
    setPosition(position: 'top' | 'bottom'): void;
  };
}
```

---

## Duplicate Handling

When `toast.show()` is called with a message that matches an existing toast (same message text AND same type), instead of creating a new toast:

1. The existing toast's expiration timer is reset (`createdAt` updated to now)
2. The duplicate count is incremented
3. When count > 1, it's displayed after the message: `Message text (2)`

This prevents toast spam when the same event fires repeatedly.

---

## Auto-Sizing Width

The toast container width automatically adjusts based on content:

1. **Calculate optimal width** from longest toast (icon + message + count + action + close button)
2. **Minimum width** is `config.width` (default 40 characters)
3. **Maximum width** is `viewport.width - 4` (margin on sides)
4. **Width stability:** Container only expands during a toast session, never shrinks
5. **Session reset:** When all toasts are dismissed, width resets to minimum

**Text overflow:** Long messages are clipped on word boundary with ellipsis (`…`)

---

## Auto-Close Behavior

**Timer-driven expiry:**
- ToastManager schedules a `setTimeout` for the next expiry event
- Timer fires at the earliest of: individual toast expiry or global inactivity timeout
- When timer fires, triggers render which cleans up expired toasts
- Timer automatically reschedules if toasts remain

**Per-toast timeout:**
- Each toast has individual duration (default 5000ms from config)
- Expired toasts removed during render cycle

**Global inactivity:**
- Track last activity (new toast, user click on toast)
- After inactivityTimeout (default 8000ms), dismiss all toasts
- Any new toast resets inactivity timer

---

## Overflow Behavior

When toast count exceeds `maxVisible`, dismiss oldest:

```
Before (maxVisible=5):           After adding 6th toast:
┌─────────────────────┐          ┌─────────────────────┐
│ Toast 1 (oldest)    │ ←dismiss │ Toast 2             │
│ Toast 2             │          │ Toast 3             │
│ Toast 3             │          │ Toast 4             │
│ Toast 4             │          │ Toast 5             │
│ Toast 5             │          │ Toast 6 (new)       │
└─────────────────────┘          └─────────────────────┘
```

Oldest dismissed silently, new toast appears instantly.

---

## File Structure

```
src/toast/
├── mod.ts              # Exports
├── types.ts            # Toast interfaces
├── toast-manager.ts    # Singleton manager
└── toast-renderer.ts   # Overlay rendering logic
```

**Integration points:**
- `src/engine.ts` - Toast overlay rendering, click handling, config initialization
- `src/melker-runner.ts` - Add toast() to MelkerContext
- `src/config/schema.json` - Toast configuration
- `src/config/config.ts` - Toast config getters
- `src/globals.d.ts` - Toast API type declarations
- `mod.ts` - Toast module export

---

## Usage Examples

```typescript
// Simple toast
$melker.toast.show('File saved');

// Typed toast
$melker.toast.show('Operation completed', { type: 'success' });

// Error with bell (if config.bell=true)
$melker.toast.show('Connection failed', { type: 'error' });

// Force bell regardless of config
$melker.toast.show('Critical error!', { type: 'error', bell: true });

// Long-lived toast
$melker.toast.show('Uploading...', { duration: 30000 });

// With action button
$melker.toast.show('Update available', {
  type: 'info',
  action: { label: 'Install', onClick: () => $app.install() }
});

// Programmatic dismiss
const id = $melker.toast.show('Processing...');
// ... later
$melker.toast.dismiss(id);

// Dismiss all
$melker.toast.dismissAll();

// Change position at runtime
$melker.toast.setPosition('top');

// Duplicate handling - calling show() with same message resets timer
$melker.toast.show('Saving...', { type: 'info' });
// ... called again ...
$melker.toast.show('Saving...', { type: 'info' });  // Shows "Saving... (2)" instead of new toast
```

---

## Click Handling

Via overlay `onClick`:
- Close button (✕) on each toast → dismiss single
- Close All button → dismiss all
- Action button → execute callback, dismiss toast
- Click outside → no action (non-modal)

---

## Z-Index Layering

```
Toast overlay                       ← 300 (above everything)
Modals (dialogs with backdrop)      ← 200+
Command Palette                     ← 200
Dropdowns                           ← 100
Normal content                      ← 0
```
