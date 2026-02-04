# File Browser Component Architecture

A reusable file browser component for navigating the filesystem, designed to work inside any container including dialogs.

## Features

- Works standalone or embedded in dialogs
- Composition with Table, Container, Input, Button components
- Keyboard navigation: Tab, arrow keys, Enter, Escape, Backspace
- Filtering: fuzzy/prefix/contains/exact via `applyFilter()`
- Single/multiple selection, file/folder modes
- Auto-initializes on first render

## Architecture Overview

The file browser uses **composition** (not inheritance) to build its UI dynamically using `createElement()`. The UI is rebuilt on state changes via `_rebuildUI()`.

```
FileBrowserElement (composition-based)
├── Props: path, selectionMode, selectType, showHidden, etc.
├── State: _entries, _filteredEntries, _focusedIndex, _scrollY, etc.
├── Builds UI dynamically via _rebuildUI():
│   ├── Container (breadcrumb) - path display + [^] button
│   ├── Container (filter) - "Filter:" label + Input
│   ├── Table (file list) - scrollable tbody with rows
│   └── Container (buttons) - [Cancel] [Open]
└── Implements: Focusable, Interactive, Renderable, Clickable
```

## Component Structure

### Visual Layout

```
┌────────────────────────────────────────────────────────┐
│ Path: /home/user/documents                        [ ^ ]│  <- Breadcrumb
│ Filter: [type to filter...                           ] │  <- Filter input
├────────────────────────────────────────────────────────┤
│ [^] ..                                                 │  <- Parent dir
│ [D] agent_docs/                                        │  <- Directory
│ [D] examples/                                          │
│ [F] README.md                                  4.2 KB █│  <- File + scrollbar
│ [F] mod.ts                                     1.1 KB ░│
│ [F] melker.ts                                   892 B ░│
├────────────────────────────────────────────────────────┤
│                                   [ Cancel ] [ Open ]  │  <- Buttons
└────────────────────────────────────────────────────────┘
```

**Error State:**
```
┌────────────────────────────────────────────────────────┐
│ Path: /root/protected                             [ ^ ]│
├────────────────────────────────────────────────────────┤
│                                                        │
│   [!] Permission denied: /root/protected               │
│   Access denied. Check permissions.                    │
│   Press Backspace to go back, Ctrl+R to retry          │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                             [ Cancel ] │
└────────────────────────────────────────────────────────┘
```

### Props Interface

```typescript
interface FileBrowserProps extends BaseProps {
  // Path
  path?: string              // Initial directory (default: Deno.cwd())

  // Selection
  selectionMode?: 'single' | 'multiple'  // Default: single
  selectType?: 'file' | 'directory' | 'both'  // Default: file

  // Filtering
  filter?: 'fuzzy' | 'prefix' | 'contains' | 'exact' | 'none'  // Default: fuzzy
  showHidden?: boolean       // Show dotfiles (default: false)
  extensions?: string[]      // Filter by extension e.g. ['.ts', '.js']

  // Display
  showFilter?: boolean       // Show filter input (default: true)
  showBreadcrumb?: boolean   // Show path bar (default: true)
  showButtons?: boolean      // Show action buttons (default: true)
  showSize?: boolean         // Show file sizes (default: true)
  maxVisible?: number        // Visible rows (default: 10)

  // Events
  onSelect?: (event: FileSelectEvent) => void
  onCancel?: () => void
  onNavigate?: (path: string) => void
  onError?: (event: FileErrorEvent) => void

  // Labels
  selectLabel?: string       // Default: "Open"
  cancelLabel?: string       // Default: "Cancel"
}
```

### Event Types

```typescript
interface FileSelectEvent {
  type: 'select'
  path: string               // Full path to selected file/directory
  paths: string[]            // For multiple selection
  name: string               // Just filename
  isDirectory: boolean
  targetId: string
}

interface FileErrorEvent {
  type: 'error'
  path: string               // Path that caused the error
  code: FileErrorCode        // 'PERMISSION_DENIED' | 'NOT_FOUND' | 'NOT_DIRECTORY' | 'UNKNOWN'
  message: string            // Human-readable error message
  targetId: string
}
```

## File Structure

```
src/components/file-browser/
  mod.ts                     - Module exports (35 lines)
  file-browser.ts            - Main FileBrowserElement (1246 lines)
  file-entry.ts              - Type definitions (83 lines)
  file-utils.ts              - Directory loading, formatting utilities (204 lines)
```

**Total: ~1568 lines**

## Implementation Details

### Auto-Initialization

The file browser auto-initializes on first render:

```typescript
private _initialized: boolean = false;

async initialize(): Promise<void> {
  if (this._initialized) return;
  this._initialized = true;
  await this._navigateToPath(this._currentPath);
}

render(bounds, style, buffer, context): void {
  // Auto-initialize on first render
  if (!this._initialized) {
    this.initialize();
  }
}
```

### UI Rebuilding with createElement

The UI is built dynamically using `createElement()` and replaced on each state change:

```typescript
private _rebuildUI(): void {
  const uiElements: Element[] = [];

  // Breadcrumb bar
  if (showBreadcrumb) {
    uiElements.push(createElement('container', { ... },
      createElement('text', { text: 'Path: ' + this._currentPath }),
      createElement('button', { label: '^', onClick: () => this._navigateUp() })
    ));
  }

  // Filter input
  if (showFilter && !this._error) {
    uiElements.push(createElement('container', { ... },
      createElement('text', { text: 'Filter: ' }),
      createElement('input', { value: this._filterValue, ... })
    ));
  }

  // File list table
  const tableRows = displayEntries.map((entry, i) => {
    const icon = entry.isDirectory ? '[D]' : '[F]';
    return createElement('tr', { 'data-id': entry.path, selected: i === this._focusedIndex },
      createElement('td', {}, createElement('text', { text: `${icon} ${entry.name}` })),
      createElement('td', { align: 'right' }, createElement('text', { text: formatSize(entry.size) }))
    );
  });

  uiElements.push(createElement('table', { border: 'thin', columnBorders: false },
    createElement('tbody', { selectable: 'single', style: { overflow: 'scroll' }, maxHeight: maxVisible },
      ...tableRows)
  ));

  // Action buttons
  if (showButtons) {
    uiElements.push(createElement('container', { ... },
      createElement('button', { label: 'Cancel', onClick: () => this._handleCancel() }),
      createElement('button', { label: 'Open', onClick: () => this._handleEnterFromButton() })
    ));
  }

  this.children = uiElements;
}
```

### Double-Click Detection

Double-click is detected at the `handleClick()` level using screen position, before delegating to the table. This avoids rebuilding the UI on single clicks (which would reset scroll position):

```typescript
private _lastClickTime: number = 0;
private _lastClickRowId: string | null = null;
private _lastClickX: number = -1;
private _lastClickY: number = -1;
private static readonly DOUBLE_CLICK_THRESHOLD_MS = 400;

handleClick(event: ClickEvent, document: Document): boolean {
  const { x, y } = event.position;
  const currentTime = Date.now();

  // Detect double-click by position (within 1 pixel threshold)
  const isDoubleClick = (
    currentTime - this._lastClickTime < DOUBLE_CLICK_THRESHOLD_MS &&
    Math.abs(x - this._lastClickX) <= 1 &&
    Math.abs(y - this._lastClickY) <= 1
  );

  this._lastClickTime = currentTime;
  this._lastClickX = x;
  this._lastClickY = y;

  if (isDoubleClick && this._lastClickRowId) {
    // Activate the focused row
    this._handleTableActivate({ type: 'activate', rowId });
    return true;
  }

  // Delegate to table for single-click selection
  // ...
}
```

Single clicks in single-selection mode do NOT rebuild the UI, preserving scroll position. The table handles selection display internally.

### Focus Handling

FileBrowserElement captures focus for all children and handles keyboard events:

```typescript
// Focusable interface
canReceiveFocus(): boolean {
  return !this.fbProps.disabled;
}

// Tells hit-testing to return this component instead of children
capturesFocusForChildren(): boolean {
  return true;
}

// Handles all keyboard for children (table, input, buttons)
handlesOwnKeyboard(): boolean {
  return true;
}
```

### Keyboard Navigation

| Key                    | Action                                              |
|------------------------|-----------------------------------------------------|
| Arrow Up/Down          | Move focus in list                                  |
| Arrow Right            | Navigate into directory                             |
| Arrow Left / Backspace | Navigate to parent directory                        |
| Enter                  | Open directory / Select file                        |
| Escape                 | Cancel / Close                                      |
| Tab                    | Move to filter input (Shift+Tab) / to buttons (Tab) |
| Home/End               | First/last item                                     |
| PageUp/Down            | Scroll by 5 items                                   |
| Space                  | Toggle selection (multiple mode)                    |
| Ctrl+H                 | Toggle hidden files                                 |
| Ctrl+R                 | Retry failed directory load                         |
| Any character          | Start filtering (auto-focuses filter input)         |

### Directory Loading

```typescript
async function loadDirectory(path: string, options: LoadOptions): Promise<LoadResult> {
  const entries: FileEntry[] = [];

  try {
    for await (const entry of Deno.readDir(path)) {
      if (!options.showHidden && entry.name.startsWith('.')) continue;

      const fullPath = join(path, entry.name);

      try {
        const stat = await Deno.stat(fullPath);
        // Apply extension filter for files
        if (!entry.isDirectory && options.extensions?.length) {
          const ext = getExtension(entry.name);
          if (!options.extensions.includes(ext)) continue;
        }
        entries.push({ name, path: fullPath, isDirectory, isSymlink, size, modified, icon });
      } catch (statError) {
        // Log but continue - don't fail for one bad entry
        entries.push({ ...entry, size: -1, modified: null, icon: '[?]' });
      }
    }
  } catch (error) {
    return { entries: [], error: { code: classifyError(error), message, ... } };
  }

  // Sort: directories first, then alphabetically
  entries.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  return { entries, error: null };
}
```

### Filtering with applyFilter

Uses the filterable-list filter module:

```typescript
import { applyFilter } from '../filterable-list/filter.ts';

private _applyFilter(): void {
  const filterMode: FilterMode = this.fbProps.filter || 'fuzzy';

  if (!this._filterValue) {
    this._filteredEntries = this._entries.map(entry => ({ entry, matchIndices: [] }));
    return;
  }

  this._filteredEntries = [];
  for (const entry of this._entries) {
    const result = applyFilter(this._filterValue, entry.name, filterMode);
    if (result.matched) {
      this._filteredEntries.push({ entry, matchIndices: result.matchIndices });
    }
  }
}
```

## Usage Examples

### Inside a Dialog (Recommended)

```xml
<dialog id="file-dialog" title="Open File" open="false" modal="true" width="70" height="20">
  <file-browser
    id="file-browser"
    selectionMode="single"
    selectType="file"
    onSelect="$app.handleFileSelect(event)"
    onCancel="$app.closeDialog()"
    maxVisible="12"
  />
</dialog>
```

```typescript
export function openDialog() {
  const dialog = $melker.getElementById('file-dialog');
  dialog.props.open = true;
  $melker.render();
}

export function handleFileSelect(event) {
  console.log('Selected:', event.path);
  closeDialog();
}

export function closeDialog() {
  const dialog = $melker.getElementById('file-dialog');
  dialog.props.open = false;
  $melker.render();
}
```

### Standalone File Browser

```xml
<file-browser
  id="browser"
  path="/home/user/documents"
  showButtons="false"
  onSelect="$app.openFile(event.path)"
/>
```

### Directory Picker

```xml
<file-browser
  selectType="directory"
  selectLabel="Choose Folder"
  onSelect="$app.setWorkspace(event.path)"
/>
```

### Multiple Selection

```xml
<file-browser
  selectionMode="multiple"
  selectType="file"
  onSelect="$app.handleFiles(event.paths)"
/>
```

### Filter by Extension

```xml
<file-browser
  extensions="['.ts', '.js', '.tsx']"
  onSelect="$app.openSourceFile(event.path)"
/>
```

## Permission Requirements

Apps using file-browser need read permission in their policy:

```json
{
  "permissions": {
    "read": ["."]  // or ["*"] for all paths
  }
}
```

## Dialog Integration

How file browser works in dialogs:

1. **Auto-initialization**: Initializes on first render (deferred async)
2. **Deferred focus trap**: Dialog's `trapFocus()` uses `setTimeout(0)` to allow render cycle to complete
3. **canReceiveFocus()**: Engine checks this method directly instead of relying on registration
4. **capturesFocusForChildren()**: File browser captures focus for all child components

## Related Files

| File                                         | Purpose                                            |
|----------------------------------------------|----------------------------------------------------|
| `src/components/table.ts`                    | Table component used for file list                 |
| `src/components/filterable-list/filter.ts`  | Filtering algorithms (fuzzy, prefix, etc.)         |
| `src/components/dialog.ts`                   | Dialog wrapper                                     |
| `src/focus.ts`                               | Focus management, trapFocus with deferred initial focus |
| `src/engine.ts`                              | findFirstFocusable checks canReceiveFocus()        |
| `agent_docs/filterable-list-architecture.md` | Filter architecture reference                      |

## See Also

- [component-reference.md](component-reference.md) — All component documentation
- [filterable-list-architecture.md](filterable-list-architecture.md) — Filter algorithms
