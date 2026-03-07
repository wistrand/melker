# Command Element Architecture

## Overview

The `<command>` element is a non-visual, declarative replacement for `onKeyPress` switch blocks. Each command binds a keyboard shortcut to an action with structured metadata (key, label, callback), making shortcuts discoverable by the command palette and AI accessibility dialog.

## Design

### Focus-Scoped Commands

By default, commands fire when their parent container (or any descendant) has focus. `findMatchingCommand()` in `engine-keyboard-handler.ts` walks from the focused element's deepest ancestor to the root, checking children for matching `<command>` elements. Innermost match wins, so overlapping keys in nested containers resolve naturally.

### Global Commands

Commands with the `global` prop are registered in the palette shortcut map via `buildShortcutMap()` and fire at priority 4 in the keyboard dispatch chain. They are suppressed by `shouldSuppressGlobalShortcut()` when:

- **Any overlay is open**: command palette, alert/confirm/prompt dialog, modal document dialogs, AI dialog, dev tools
- **Focused element consumes keys** (unmodified only): input/textarea, slider, split-pane-divider, KeyboardElement with `handlesOwnKeyboard()`

Modifier combos (Ctrl+S, Alt+X) pass through focused-element suppression but not overlay suppression.

### Implicit Container Focusability

Containers with non-global, non-disabled `<command>` children automatically become focusable. `findFocusableElements()` checks for command children when `canReceiveFocus()` returns false (e.g., non-scrollable containers). These containers appear in tab order with `tabIndex: 0`.

Both keyboard (Tab/arrow) and mouse click focus are supported. `HitTester.isCommandContainer()` checks for command children during hit testing so that clicking a container's background area focuses it. When a focusable child (e.g., a button) is clicked directly, the child receives focus instead — hit testing is depth-first, so the innermost interactive element always wins.

### Focus Indicator

Focused command containers show:
- **Border color**: Theme `focusBorder` color applied to existing borders
- **`*` marker**: Always drawn in the upper-right corner (after children render, to avoid being overwritten)

### Key Parsing

The `key` prop supports comma-separated values (e.g., `"Delete,Backspace"`). Special values and aliases:

| Value     | Meaning              |
|-----------|----------------------|
| `","`     | Literal comma key    |
| `"comma"` | Alias for comma      |
| `" "`     | Space key            |
| `"Space"` | Alias for space      |
| `"+"`     | Plus key             |
| `"plus"`  | Alias for plus       |

Numeric values like `key="1"` work naturally because the template parser uses schema-driven coercion — it checks the component schema before converting numeric strings, and since the command schema declares `key` as `type: 'string'`, the value stays a string.

### Case Sensitivity

Shortcut matching is **case-insensitive** for letter keys. `key="p"`, `key="P"`, and `key="Shift+P"` all normalize to `"p"` and match identically. Both `normalizeShortcut()` and `eventToShortcut()` strip the `shift` modifier for single printable letters (a-z) and lowercase the key, because the character's case already carries the shift information.

This is a terminal constraint, not a design choice. Simple terminals send uppercase `'P'` as a raw byte without a shift flag — there's no way to distinguish `p` from `Shift+P`. Kitty protocol terminals do report an explicit shift flag, but supporting case-sensitive matching only on some terminals would be worse than not supporting it at all.

Shift **is** preserved for non-printable keys: `Shift+ArrowUp`, `Shift+Tab`, `Shift+F1` are distinct from their unshifted counterparts.

To bind two different actions to the same letter, use a modifier: `key="p"` vs `key="Ctrl+p"` or `key="Alt+p"`. This matches VS Code's behavior where `"shift+p"` is not a valid keybinding.

### Palette Integration

All commands appear in the command palette as a single entry regardless of how many keys they bind. The original `key` prop string is shown as a display-only `hint` (e.g., `ArrowLeft, a`). For global commands, each individual key is registered separately in the shortcut map via `_globalKeys` for keyboard dispatch.

## Implementation Files

| File                                | Purpose                                              |
|-------------------------------------|------------------------------------------------------|
| `src/components/command.ts`         | CommandElement class, registration, lint schema      |
| `src/command-palette-components.ts` | Discovery (`_walkTree`), key parsing, shortcut map   |
| `src/engine-keyboard-handler.ts`    | Focus-scoped matching, global suppression            |
| `src/focus-navigation-handler.ts`   | Implicit focusability for command containers         |
| `src/hit-test.ts`                   | `isCommandContainer()` for mouse-click focus         |
| `src/element-click-handler.ts`      | Focuses command containers on click                  |
| `src/rendering.ts`                  | Focus indicator (`*` marker, border color)           |
| `src/engine-system-palette.ts`      | Injection of discovered commands into palette        |

## Keyboard Dispatch Integration

| Priority    | Handler                | `<command>` role                                       |
|-------------|------------------------|--------------------------------------------------------|
| 4           | Palette shortcut map   | Global `<command>` elements (via `buildShortcutMap`)   |
| 8 (step 7)  | `findMatchingCommand` | Focus-scoped `<command>` (before `hasKeyPressHandler`) |
| 8 (step 8)  | `hasKeyPressHandler`  | Existing `onKeyPress` prop fallback                    |

## Comparison with Other Mechanisms

| Mechanism              | Scope        | Purpose                                              |
|------------------------|--------------|------------------------------------------------------|
| `palette-shortcut`     | Global       | Shortcut that clicks/focuses an interactive element  |
| `<command>`            | Focus-scoped | Declarative shortcut with custom action              |
| `<command global>`     | Global       | Like `palette-shortcut` but with custom `onExecute`  |
| `onKeyPress`           | Focus-scoped | Opaque callback (not discoverable by palette or AI)  |

### When to Use `<command>` vs `onKeyPress`

`<command>` replaces most `onKeyPress` switch blocks, but not all. The key distinction is **dispatch priority**: input elements (input, textarea, slider, split-pane-divider, and `KeyboardElement` components like data-table) consume all keys at priority 8 steps 1-4, **before** command dispatch at step 7. A `<command>` on a parent container cannot intercept keys that a focused child input already handles.

| Pattern                | Use                | Example                                                                                  |
|------------------------|--------------------|------------------------------------------------------------------------------------------|
| Container shortcut     | `<command>`        | `<command key="Delete" label="Remove" onExecute="..." />` in a panel                     |
| Global app shortcut    | `<command global>` | `<command key="Ctrl+s" label="Save" global onExecute="..." />`                           |
| Game/canvas controls   | `<command global>` | Arrow keys, Space, etc. on a shader canvas                                               |
| Input-specific key     | `onKeyPress`       | Enter to submit: `<input onKeyPress="if (event.key === 'Enter') ..." />`                 |
| Component-internal key | `onKeyPress`       | Custom key handling inside a `KeyboardElement`                                           |

**Rule of thumb:** If the key should fire when a specific input-like component has focus, use `onKeyPress` on that component. If the key should fire when a container (or any of its non-input descendants) has focus, use `<command>`. If the key should fire regardless of focus, use `<command global>`.

## Known Limitations

**Global-before-local with heuristic suppression.** Most UI frameworks give the focused element first crack at the key (web: target then bubble; Qt: focused widget then parent chain). Melker inverts this — global shortcuts fire at priority 4, before focused element dispatch at priority 8. `shouldSuppressGlobalShortcut` predicts whether the focused element would consume the key by checking element types. This is fragile if a new component handles its own keys but doesn't implement `KeyboardElement`. The reason for the inversion is that modifier shortcuts like Ctrl+S should override focused element behavior (e.g., save should work even when a data-table has focus).

**No context guards (`when` clauses).** Commands are either always active (global) or active when the parent has focus (scoped). The only conditional mechanism is the `disabled` prop. For complex apps with modes, this forces toggling `disabled` imperatively or falling back to `onKeyPress`. See [Future: `onWhen` Handler](#future-onwhen-handler) for a designed-but-not-implemented alternative.

**No key sequences (chords).** No support for multi-key sequences like `Ctrl+K, Ctrl+C`.

**Tree walks on every keypress.** `hasElement(root, isOpenModalDialog)` and `findAncestorPath` both walk the tree on every keypress. O(n) where n is the number of elements. Negligible for typical apps but could be cached per render cycle.

## Comparison with Other Systems

| Aspect           | Melker                                            | VS Code                        | Web/DOM                  | WPF/XAML                        |
|------------------|---------------------------------------------------|--------------------------------|--------------------------|---------------------------------|
| Dispatch order   | Global first, suppress heuristic                  | Global first, `when` clauses  | Target first, bubble up  | Routed events (tunnel + bubble) |
| Shortcut binding | `<command>` element                               | JSON keybindings               | `addEventListener`       | `CommandBinding`                |
| Scoping          | Focus ancestry                                    | `when` context expressions     | DOM tree propagation     | Visual tree routing             |
| Discoverability  | Palette + AI auto-discovery                       | Command palette registry       | None built-in            | None built-in                   |
| Key sequences    | No                                                | Yes (chords)                   | No (manual)              | Yes (`InputGesture`)            |
| Context guards   | `disabled` prop (`onWhen` designed, not yet impl) | `when` expressions             | Manual                   | `CanExecute`                    |

## Future: `onWhen` Handler

If context guards are needed, the recommended approach is an `onWhen` handler attribute rather than a VS Code-style expression grammar. VS Code needs `"when"` expressions because its keybindings are static JSON. Melker doesn't have this constraint — `.melker` files already support inline code in handler attributes.

```xml
<command key="Delete" label="Delete Item" onWhen="$app.canDelete()" onExecute="$app.deleteItem()" />
```

`onWhen` would be compiled by the bundler exactly like `onExecute` (via the existing `__isStringHandler` pipeline) but as a predicate — returning truthy means the command is active.

**Evaluation points:**

| Command type    | When `onWhen` runs                                | Staleness risk                   |
|-----------------|---------------------------------------------------|----------------------------------|
| Focus-scoped    | At keypress (`findMatchingCommand`)               | None — reads current state       |
| Global          | At dispatch (inside shortcut action callback)     | None — guard checked before exec |
| Palette display | At discovery (`discoverPaletteItems`)             | Stale until palette reopened     |

Focus-scoped: `findMatchingCommand()` already reads props at keypress time, so adding `if (child.props.onWhen && !child.props.onWhen()) continue` is a one-line change.

Global: the `onWhen` guard should be checked at dispatch time rather than baked into the shortcut map, to avoid staleness:

```typescript
// In buildShortcutMap, wrap the action:
const guardedAction = command.props.onWhen
  ? () => { if (command.props.onWhen()) command.props.onExecute(); }
  : command.props.onExecute;
map.set(normalized, guardedAction);
```

**Implementation cost:**

| File                                | Change                                                                       |
|-------------------------------------|------------------------------------------------------------------------------|
| `src/components/command.ts`         | Add `onWhen?: Function` to `CommandProps` and schema                         |
| `src/engine-keyboard-handler.ts`    | One guard in `findMatchingCommand()`                                         |
| `src/command-palette-components.ts` | Wrap global shortcut actions with guard; check during discovery to dim/hide  |
| `src/bundler/generator.ts`          | Nothing — `on*` string handlers compile automatically                        |

**Status:** Not implemented. The `disabled` prop covers all current use cases.
