# Implementation Details

Critical implementation notes for Melker development.

## Mouse Tracking Initialization Order

**CRITICAL**: Raw mode MUST be enabled BEFORE terminal setup.

**Correct order** (see `src/engine.ts` ~line 797):
1. Enable raw mode FIRST - `_inputProcessor.startListening()`
2. Setup event handlers - `_setupEventHandlers()`
3. Terminal setup LAST - `_setupTerminal()`

Wrong order causes `ENOTTY` errors because alternate screen mode interferes with raw mode.

## Menu Overlay Rendering

Dropdown menus are rendered as overlays after normal content to prevent sibling elements from overwriting them.

**Pipeline** (see `src/rendering.ts` ~line 109):
1. Normal rendering - all elements in tree order
2. Menu collection - dropdowns stored in `context.overlays`
3. Overlay pass - menus rendered on top
4. Modal pass - dialogs render last

**Component registration** (`src/melker-main.ts`): The `melker.ts` module MUST be imported BEFORE `parseMelkerFile` to ensure component registrations happen first.

## Error Handling

The engine MUST:
- Exit with full stack traces on fatal errors
- Restore terminal before error output (disable mouse tracking, exit alternate screen, show cursor, reset attributes)
- Never suppress errors

See terminal restoration sequences in `src/engine.ts` cleanup methods.

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `MELKER_THEME` | Visual theme (`{type}-{mode}`) | `fullcolor-dark`, `bw-std` |
| `MELKER_LOG_FILE` | Log file path | `/tmp/debug.log` |
| `MELKER_LOG_LEVEL` | Log level | `DEBUG`, `INFO`, `WARN`, `ERROR` |
| `MELKER_HEADLESS` | Headless mode for CI | `true` |
| `MELKER_DEBUG_PORT` | Debug server port | `8080` |
| `MELKER_NO_ALTERNATE_SCREEN` | Disable alternate screen | `1` |

## Gray Theme

Gray themes (`gray-std`, `gray-dark`) enforce grayscale conversion at render time:
- All colors converted using luminance-based algorithm
- Maps to 4 levels: black, brightBlack, gray, white
- See `src/theme.ts` for implementation

## Dialog/Menu Hit Testing

Overlays (dialogs, menus) require special hit testing since their children's bounds are stored separately from the main layout tree. See `_hitTestOpenDialogs()` and `_hitTestOpenMenus()` in `src/engine.ts`.
