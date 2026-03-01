// FileBrowser component - File system browser using composition
// Uses melker template literals to compose Container, Text, Input, List, Li, Button components

import {
  Element,
  BaseProps,
  Focusable,
  Interactive,
  Renderable,
  Clickable,
  ClickEvent,
  Bounds,
  ComponentRenderContext,
  IntrinsicSizeContext,
  isClickable,
} from '../../types.ts';
import type { DualBuffer, Cell } from '../../buffer.ts';
import { COLORS } from '../color-utils.ts';
import type { Document } from '../../document.ts';
import type { KeyPressEvent, ChangeEvent } from '../../events.ts';
import { registerComponent, createElement } from '../../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../../lint.ts';
// Import table components to ensure they're registered before we use createElement
import '../table.ts';
import '../table-section.ts';
import '../table-row.ts';
import '../table-cell.ts';
import type { SelectEvent, ActivateEvent } from '../table-section.ts';
import { getLogger } from '../../logging.ts';
import type {
  FileEntry,
  FileSelectEvent,
  FileErrorEvent,
} from './file-entry.ts';
import {
  loadDirectory,
  getParentPath,
  isRootPath,
  formatSize,
} from './file-utils.ts';
import { type FilterMode, applyFilter } from '../filterable-list/filter.ts';
import { getGlobalRequestRender } from '../../global-accessors.ts';
import { cwd } from '../../runtime/mod.ts';

const logger = getLogger('file-browser');

/**
 * Props for the FileBrowser component
 */
export interface FileBrowserProps extends Omit<BaseProps, 'onChange'> {
  /** Initial directory path (default: current working directory) */
  path?: string;

  /** Selection mode: single or multiple */
  selectionMode?: 'single' | 'multiple';

  /** What can be selected: file, directory, or both */
  selectType?: 'file' | 'directory' | 'both';

  /** Show hidden files (dotfiles) */
  showHidden?: boolean;

  /** Filter by file extensions (e.g., ['.ts', '.js']) */
  extensions?: string[];

  /** Show filter input */
  showFilter?: boolean;

  /** Show breadcrumb path bar */
  showBreadcrumb?: boolean;

  /** Show action buttons */
  showButtons?: boolean;

  /** Show file sizes */
  showSize?: boolean;

  /** Maximum visible rows in list */
  maxVisible?: number;

  /** Filter algorithm */
  filter?: FilterMode;

  /** Label for select/open button */
  selectLabel?: string;

  /** Label for cancel button */
  cancelLabel?: string;

  // Events
  /** Called when file/directory is selected (preferred) */
  onChange?: (event: FileSelectEvent) => void;

  /** Called when file/directory is selected (deprecated: use onChange) */
  onSelect?: (event: FileSelectEvent) => void;

  /** Called when cancel is pressed */
  onCancel?: () => void;

  /** Called when navigating to a new path */
  onNavigate?: (path: string) => void;

  /** Called when an error occurs */
  onError?: (event: FileErrorEvent) => void;
}

/**
 * Filtered entry with match info
 */
interface FilteredEntry {
  entry: FileEntry;
  matchIndices: number[];
}

/**
 * FileBrowserElement - File system browser component using composition
 *
 * Uses existing components (Container, Text, Input, List, Li, Button) instead of
 * manual rendering. The UI is built via melker template literals.
 *
 * Usage:
 * ```xml
 * <file-browser
 *   path="/home/user"
 *   onSelect="$app.handleFileSelect(event)"
 * />
 * ```
 */
export class FileBrowserElement extends Element implements Focusable, Interactive, Renderable, Clickable {
  declare type: 'file-browser';

  /** Get props with correct typing */
  protected get fbProps(): FileBrowserProps {
    return this.props as unknown as FileBrowserProps;
  }

  /** Current directory path */
  private _currentPath: string = '';

  /** Loaded file entries */
  private _entries: FileEntry[] = [];

  /** Filtered entries based on current filter */
  private _filteredEntries: FilteredEntry[] = [];

  /** Current error state */
  private _error: FileErrorEvent | null = null;

  /** Loading state */
  private _loading: boolean = false;

  /** Filter input value */
  private _filterValue: string = '';

  /** Currently focused index in the list */
  private _focusedIndex: number = 0;

  /** Selected items for multiple selection */
  private _selectedPaths: Set<string> = new Set();

  /** Request render callback (set by engine) */
  private _requestRender: (() => void) | null = null;

  /** Whether filter input is focused (vs list) */
  private _filterFocused: boolean = false;

  /** Scroll position for the table */
  private _scrollY: number = 0;

  /** Whether file browser has been initialized */
  private _initialized: boolean = false;

  /** Double-click detection (tracked here since table is recreated on rebuild) */
  private _lastClickTime: number = 0;
  private _lastClickRowId: string | null = null;
  private _lastClickX: number = -1;
  private _lastClickY: number = -1;
  private static readonly DOUBLE_CLICK_THRESHOLD_MS = 400;

  constructor(props: FileBrowserProps = {}, children: Element[] = []) {
    const defaultProps: FileBrowserProps = {
      selectionMode: 'single',
      selectType: 'file',
      showHidden: false,
      showFilter: true,
      showBreadcrumb: true,
      showButtons: true,
      showSize: true,
      maxVisible: 10,
      selectLabel: 'Open',
      cancelLabel: 'Cancel',
      filter: 'fuzzy',
      style: {
        display: 'flex',
        flexDirection: 'column',
        border: 'thin',
        width: 'fill',
        height: 'fill',
      },
      ...props,
    };

    super('file-browser', defaultProps, children);

    // Initialize path
    this._currentPath = props.path || cwd();

    // Build initial UI (will be rebuilt when initialize() loads directory contents)
    this._rebuildUI();
  }

  /**
   * Initialize and load the initial directory
   */
  async initialize(): Promise<void> {
    if (this._initialized) return;
    this._initialized = true;
    await this._navigateToPath(this._currentPath);
  }

  /**
   * Set the request render callback (called by engine)
   */
  setRequestRender(callback: () => void): void {
    this._requestRender = callback;
  }

  /**
   * Navigate to a new directory path
   */
  private async _navigateToPath(newPath: string): Promise<void> {
    this._loading = true;
    this._error = null;

    // Rebuild UI immediately to show loading state before async operation
    // The engine will render this after onKeyPress returns true
    this._rebuildUI();

    const result = await loadDirectory(newPath, {
      showHidden: this.fbProps.showHidden ?? false,
      extensions: this.fbProps.extensions,
    });

    this._loading = false;

    if (result.error) {
      this._currentPath = newPath;
      this._error = { ...result.error, targetId: this.id };
      this._entries = [];
      this._filteredEntries = [];

      if (this.fbProps.onError) {
        this.fbProps.onError(this._error);
      }

      logger.error(`FileBrowser: ${result.error.message}`);
    } else {
      this._currentPath = newPath;
      this._entries = result.entries;
      this._applyFilter();
      this._focusedIndex = 0;
      this._scrollY = 0;  // Reset scroll position

      // Clear filter and selections when navigating
      this._filterValue = '';
      this._clearSelections();

      if (this.fbProps.onNavigate) {
        this.fbProps.onNavigate(newPath);
      }

      logger.debug(`FileBrowser: Loaded ${result.entries.length} entries from ${newPath}`);
    }

    this._rebuildUI();
    this._triggerRender();
  }

  /**
   * Trigger a re-render, with fallback to global requestRender if local is not set
   */
  private _triggerRender(): void {
    // Try local _requestRender first
    if (this._requestRender) {
      this._requestRender();
      return;
    }

    // Fallback to global requestRender (set by renderer)
    const globalRender = getGlobalRequestRender();
    if (globalRender) {
      globalRender();
      return;
    }

    // Neither available - schedule a retry
    setTimeout(() => {
      const globalRenderRetry = getGlobalRequestRender();
      if (this._requestRender) {
        this._requestRender();
      } else if (globalRenderRetry) {
        globalRenderRetry();
      }
    }, 50);
  }

  /**
   * Apply the current filter to entries
   */
  private _applyFilter(): void {
    const filterMode: FilterMode = this.fbProps.filter || 'fuzzy';
    const filterValue = this._filterValue;

    if (!filterValue) {
      this._filteredEntries = this._entries.map(entry => ({
        entry,
        matchIndices: [],
      }));
      return;
    }

    this._filteredEntries = [];
    for (const entry of this._entries) {
      const result = applyFilter(filterValue, entry.name, filterMode);
      if (result.matched) {
        this._filteredEntries.push({
          entry,
          matchIndices: result.matchIndices,
        });
      }
    }
  }

  /**
   * Get display entries including parent dir
   */
  private _getDisplayEntries(): Array<{ entry: FileEntry | null; label: string; isParent: boolean }> {
    const entries: Array<{ entry: FileEntry | null; label: string; isParent: boolean }> = [];

    // Add ".." parent directory entry if not at root
    if (!isRootPath(this._currentPath)) {
      entries.push({
        entry: null,
        label: '..',
        isParent: true,
      });
    }

    // Add filtered entries
    for (const filtered of this._filteredEntries) {
      entries.push({
        entry: filtered.entry,
        label: filtered.entry.name,
        isParent: false,
      });
    }

    return entries;
  }

  /**
   * Navigate to parent directory
   */
  private _navigateUp(): void {
    if (isRootPath(this._currentPath)) return;
    const parentPath = getParentPath(this._currentPath);
    this._navigateToPath(parentPath);
  }

  /**
   * Handle Enter key - navigate into directory or select file
   */
  private _handleEnter(): void {
    const displayEntries = this._getDisplayEntries();
    if (this._focusedIndex >= displayEntries.length) return;

    const focused = displayEntries[this._focusedIndex];

    if (focused.isParent) {
      this._navigateUp();
      return;
    }

    const entry = focused.entry;
    if (!entry) return;

    const selectionMode = this.fbProps.selectionMode || 'single';
    const selectType = this.fbProps.selectType || 'file';

    // In multiple mode with existing selections, confirm the selection
    if (selectionMode === 'multiple' && this._selectedPaths.size > 0) {
      this._selectEntry(entry);
      return;
    }

    if (entry.isDirectory) {
      if (selectType === 'directory' || selectType === 'both') {
        // Directory can be selected - select it
        this._selectEntry(entry);
      } else {
        // Navigate into directory
        this._navigateToPath(entry.path);
      }
    } else {
      this._selectEntry(entry);
    }
  }

  /**
   * Check if an entry can be selected based on selectType
   */
  private _canSelectEntry(entry: FileEntry): boolean {
    const selectType = this.fbProps.selectType || 'file';
    if (selectType === 'both') return true;
    if (selectType === 'file' && entry.isDirectory) return false;
    if (selectType === 'directory' && !entry.isDirectory) return false;
    return true;
  }

  /**
   * Toggle selection of an entry (for multiple selection mode)
   */
  private _toggleSelection(entry: FileEntry): void {
    if (!this._canSelectEntry(entry)) return;

    if (this._selectedPaths.has(entry.path)) {
      this._selectedPaths.delete(entry.path);
    } else {
      this._selectedPaths.add(entry.path);
    }

    this._rebuildUI();
  }

  /**
   * Select an entry (file or directory based on selectType)
   */
  private _selectEntry(entry: FileEntry): void {
    if (!this._canSelectEntry(entry)) return;

    const selectionMode = this.fbProps.selectionMode || 'single';

    if (selectionMode === 'multiple') {
      const selectedPaths = Array.from(this._selectedPaths);
      if (selectedPaths.length === 0) {
        selectedPaths.push(entry.path);
      }

      const event: FileSelectEvent = {
        type: 'select',
        path: selectedPaths[0],
        paths: selectedPaths,
        name: entry.name,
        isDirectory: entry.isDirectory,
        targetId: this.id,
      };

      this.fbProps.onChange?.(event);
      this.fbProps.onSelect?.(event);
    } else {
      const event: FileSelectEvent = {
        type: 'select',
        path: entry.path,
        paths: [entry.path],
        name: entry.name,
        isDirectory: entry.isDirectory,
        targetId: this.id,
      };

      this.fbProps.onChange?.(event);
      this.fbProps.onSelect?.(event);
    }
  }

  /**
   * Clear all selections
   */
  private _clearSelections(): void {
    this._selectedPaths.clear();
  }

  /**
   * Handle cancel button
   */
  private _handleCancel(): void {
    if (this.fbProps.onCancel) {
      this.fbProps.onCancel();
    }
  }

  /**
   * Handle filter input change
   */
  private _handleFilterChange(value: string): void {
    this._filterValue = value;
    this._applyFilter();
    this._focusedIndex = 0;
    this._scrollY = 0;  // Reset scroll position when filter changes
    this._rebuildUI();
    this._requestRender?.();
  }

  /**
   * Rebuild the UI tree using createElement for reliable construction
   * @param skipScrollAdjust - If true, don't adjust scroll position (used for click events)
   */
  private _rebuildUI(skipScrollAdjust = false): void {
    const showBreadcrumb = this.fbProps.showBreadcrumb ?? true;
    const showFilter = this.fbProps.showFilter ?? true;
    const showButtons = this.fbProps.showButtons ?? true;
    const showSize = this.fbProps.showSize ?? true;
    const selectionMode = this.fbProps.selectionMode || 'single';

    // Build table rows
    const displayEntries = this._getDisplayEntries();
    const tableRows: Element[] = [];

    for (let i = 0; i < displayEntries.length; i++) {
      const { entry, label, isParent } = displayEntries[i];
      const isFocused = i === this._focusedIndex;
      const isMultiSelected = entry && this._selectedPaths.has(entry.path);

      // Build entry icon
      let icon: string;
      if (isParent) {
        icon = '[^]';
      } else if (isMultiSelected) {
        icon = '[*]';
      } else if (entry?.isDirectory) {
        icon = '[D]';
      } else {
        icon = '[F]';
      }

      // Build name with directory suffix
      let name = label;
      if (entry?.isDirectory) {
        name += '/';
      }

      // Create table row with two cells: name and size
      const sizeStr = showSize && entry && !entry.isDirectory && entry.size >= 0
        ? formatSize(entry.size)
        : '';

      const cells: Element[] = [
        createElement('td', {}, createElement('text', { text: `${icon} ${name}` })),
      ];

      if (showSize) {
        cells.push(createElement('td', { align: 'right' },
          createElement('text', { text: sizeStr })));
      }

      // Use entry path or 'parent' as data-id for selection
      const rowId = isParent ? 'parent' : (entry?.path || `item-${i}`);

      const rowElement = createElement('tr', {
        'data-id': rowId,
        selected: isFocused,  // Single selection: focused row is selected
      }, ...cells);

      tableRows.push(rowElement);
    }

    // Build the complete UI
    const uiElements: Element[] = [];

    // Breadcrumb
    if (showBreadcrumb) {
      const breadcrumbChildren: Element[] = [
        createElement('text', {
          style: { flex: 1 },
          text: 'Path: ' + this._currentPath
        }),
      ];

      if (!isRootPath(this._currentPath)) {
        breadcrumbChildren.push(createElement('button', {
          id: 'fb-up-btn',
          title: '^',
          onClick: () => this._navigateUp(),
        }));
      }

      const breadcrumb = createElement('container', {
        id: 'fb-breadcrumb',
        style: {
          display: 'flex',
          flexDirection: 'row',
          padding: 0,
          paddingLeft: 1,
          width: 'fill',
        },
      }, ...breadcrumbChildren);
      uiElements.push(breadcrumb);
    }

    // Filter input
    if (showFilter && !this._error) {
      const filterInput = createElement('container', {
        id: 'fb-filter-container',
        style: {
          display: 'flex',
          flexDirection: 'row',
          padding: 0,
          paddingLeft: 1,
          width: 'fill',
        },
      },
        createElement('text', { text: 'Filter: ' }),
        createElement('input', {
          id: 'fb-filter',
          value: this._filterValue,
          placeholder: 'type to filter...',
          style: { flex: 1 },
          focused: this._filterFocused,
          cursorPosition: this._filterValue.length,
        }),
      );
      uiElements.push(filterInput);
    }

    // List or error content
    if (this._error) {
      const errorContent = createElement('container', {
        id: 'fb-error',
        style: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          padding: 1,
          width: 'fill',
        },
      },
        createElement('text', {
          style: { color: COLORS.red, fontWeight: 'bold' },
          text: '[!] ' + this._error.message
        }),
        createElement('text', {
          style: { color: COLORS.gray },
          text: this._getErrorHint(this._error.code)
        }),
        createElement('text', {
          style: { color: COLORS.gray },
          text: 'Press Backspace to go back, Ctrl+R to retry'
        }),
      );
      uiElements.push(errorContent);
    } else if (displayEntries.length === 0) {
      const emptyContent = createElement('container', {
        id: 'fb-empty',
        style: {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          width: 'fill',
        },
      },
        createElement('text', {
          style: { color: COLORS.gray },
          text: this._filterValue ? 'No matches' : '(empty directory)'
        }),
      );
      uiElements.push(emptyContent);
    } else {
      const maxVisible = this.fbProps.maxVisible || 10;

      // Auto-scroll to keep focused row visible (skip on click - row is already visible)
      if (!skipScrollAdjust) {
        this._ensureFocusedVisible(displayEntries.length, maxVisible);
      }

      const table = createElement('table', {
        id: 'fb-table',
        border: 'thin',
        columnBorders: false,
        cellPadding: 1,
        style: { flex: 1, width: 'fill' },
      },
        createElement('tbody', {
          id: 'fb-tbody',
          selectable: 'single',
          scrollable: true,
          maxHeight: maxVisible,
          scrollY: this._scrollY,
          onSelect: (event: SelectEvent) => this._handleTableSelect(event),
          // Note: Double-click detection is handled in _handleTableSelect because the
          // table element is recreated on each rebuild, losing its internal click state.
        }, ...tableRows),
      );

      uiElements.push(table);
    }

    // Buttons
    if (showButtons) {
      const buttons = createElement('container', {
        id: 'fb-buttons',
        style: {
          display: 'flex',
          flexDirection: 'row',
          justifyContent: 'flex-end',
          padding: 0,
          paddingRight: 1,
          gap: 1,
          width: 'fill',
        },
      },
        createElement('button', {
          id: 'fb-cancel-btn',
          label: this.fbProps.cancelLabel || 'Cancel',
          onClick: () => this._handleCancel(),
        }),
        createElement('button', {
          id: 'fb-select-btn',
          label: this.fbProps.selectLabel || 'Open',
          onClick: () => this._handleEnterFromButton(),
          disabled: !!this._error,
        }),
      );
      uiElements.push(buttons);
    }

    // Replace children with new UI
    this.children = uiElements;
  }

  /**
   * Handle Enter from button click
   */
  private _handleEnterFromButton(): void {
    const displayEntries = this._getDisplayEntries();
    if (this._focusedIndex < displayEntries.length) {
      const focused = displayEntries[this._focusedIndex];
      if (!focused.isParent && focused.entry) {
        this._selectEntry(focused.entry);
      }
    }
  }

  /**
   * Ensure the focused row is visible by adjusting scroll position
   */
  private _ensureFocusedVisible(totalRows: number, maxVisible: number): void {
    if (totalRows <= maxVisible) {
      // No scrolling needed
      this._scrollY = 0;
      return;
    }

    const maxScrollY = totalRows - maxVisible;

    // If focused row is above visible area, scroll up
    if (this._focusedIndex < this._scrollY) {
      this._scrollY = this._focusedIndex;
    }
    // If focused row is below visible area, scroll down
    else if (this._focusedIndex >= this._scrollY + maxVisible) {
      this._scrollY = this._focusedIndex - maxVisible + 1;
    }

    // Clamp scroll position
    this._scrollY = Math.max(0, Math.min(maxScrollY, this._scrollY));
  }

  /**
   * Handle table row selection (single-click)
   * Single-click only updates focus/selection, does NOT navigate or confirm.
   * Navigation/confirmation happens via Enter key, double-click, or Open button.
   *
   * Note: Double-click detection is handled at handleClick() level using click
   * position, so we don't rebuild UI here (which would reset scroll position).
   */
  private _handleTableSelect(event: SelectEvent): void {
    const rowId = event.rowId;

    // Track clicked row for double-click activation
    this._lastClickRowId = rowId;

    // Find the entry index by rowId
    const displayEntries = this._getDisplayEntries();
    let entryIndex: number;

    if (rowId === 'parent') {
      // Parent entry is always at index 0 if present
      entryIndex = 0;
    } else {
      // Find by path
      entryIndex = displayEntries.findIndex(e =>
        !e.isParent && e.entry?.path === rowId
      );
    }

    if (entryIndex >= 0) {
      // Update focus to the clicked row
      this._focusedIndex = entryIndex;

      // In multiple selection mode, toggle selection and rebuild UI
      const selectionMode = this.fbProps.selectionMode || 'single';
      if (selectionMode === 'multiple') {
        const focused = displayEntries[entryIndex];
        if (!focused.isParent && focused.entry && this._canSelectEntry(focused.entry)) {
          // Toggle selection in multi-select mode
          if (this._selectedPaths.has(focused.entry.path)) {
            this._selectedPaths.delete(focused.entry.path);
          } else {
            this._selectedPaths.add(focused.entry.path);
          }
        }
        // Only rebuild in multiple mode (icon changes to [*])
        this._rebuildUI(true);
      }
      // In single selection mode, table handles selection display - no rebuild needed
    }
  }

  /**
   * Handle table row activation (double-click or Enter)
   * This is where navigation into directories and file selection happens.
   */
  private _handleTableActivate(event: ActivateEvent): void {
    const rowId = event.rowId;

    // Handle parent directory navigation
    if (rowId === 'parent') {
      this._navigateUp();
      return;
    }

    // Find the entry by path
    const displayEntries = this._getDisplayEntries();
    const entryIndex = displayEntries.findIndex(e =>
      !e.isParent && e.entry?.path === rowId
    );

    if (entryIndex >= 0) {
      const entry = displayEntries[entryIndex].entry;
      if (!entry) return;

      const selectType = this.fbProps.selectType || 'file';

      if (entry.isDirectory) {
        if (selectType === 'directory' || selectType === 'both') {
          // Directory can be selected - select it
          this._selectEntry(entry);
        } else {
          // Navigate into directory
          this._navigateToPath(entry.path);
        }
      } else {
        // Select file
        this._selectEntry(entry);
      }
    }
  }

  /**
   * Get hint text for error code
   */
  private _getErrorHint(code: string): string {
    switch (code) {
      case 'PERMISSION_DENIED':
        return 'Access denied. Check permissions.';
      case 'NOT_FOUND':
        return 'Directory does not exist.';
      case 'NOT_DIRECTORY':
        return 'Path is not a directory.';
      default:
        return 'An unexpected error occurred.';
    }
  }

  // Intrinsic size for layout
  // Note: Returns content size WITHOUT borders (layout engine adds them separately)
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const showBreadcrumb = this.fbProps.showBreadcrumb ?? true;
    const showFilter = this.fbProps.showFilter ?? true;
    const showButtons = this.fbProps.showButtons ?? true;
    const maxVisible = this.fbProps.maxVisible || 10;

    // Calculate content height (borders are added by layout engine)
    let height = 0;
    if (showBreadcrumb) height += 1;
    if (showFilter) height += 1;
    height += maxVisible; // List area
    if (showButtons) height += 1;

    // Calculate width
    const minWidth = 40;
    const pathWidth = this._currentPath.length + 10;

    return {
      width: Math.max(minWidth, Math.min(pathWidth, context.availableSpace.width)),
      height: Math.min(height, context.availableSpace.height),
    };
  }

  // Render method - children are rendered by the layout system, so this is mostly empty
  render(
    _bounds: Bounds,
    _style: Partial<Cell>,
    _buffer: DualBuffer,
    context: ComponentRenderContext
  ): void {
    // Capture requestRender for async operations (directory loading, etc.)
    if (context.requestRender) {
      this._requestRender = context.requestRender;
    }

    // Auto-initialize on first render (loads directory contents)
    if (!this._initialized) {
      this.initialize();
    }

    // FileBrowser is a container that builds its UI via _rebuildUI()
    // Children (containers, text, list, buttons) are rendered by the layout system
  }

  // Override keyboard handling
  onKeyPress(event: KeyPressEvent): boolean {
    const { key, ctrlKey, shiftKey } = event;

    // In error state, only allow recovery actions
    if (this._error) {
      switch (key) {
        case 'Backspace':
          this._navigateUp();
          return true;
        case 'Escape':
          this._handleCancel();
          return true;
        case 'r':
          if (ctrlKey) {
            this._navigateToPath(this._currentPath);
            return true;
          }
          break;
      }
      return false;
    }

    // Handle filter input when focused
    if (this._filterFocused) {
      if (key === 'Tab' && !shiftKey) {
        this._filterFocused = false;
        this._rebuildUI();
        this._requestRender?.();
        return true;
      }
      if (key === 'Escape') {
        if (this._filterValue) {
          this._filterValue = '';
          this._applyFilter();
          this._rebuildUI();
          this._requestRender?.();
          return true;
        }
        this._filterFocused = false;
        this._rebuildUI();
        this._requestRender?.();
        return true;
      }
      if (key === 'ArrowDown') {
        this._filterFocused = false;
        this._rebuildUI();
        this._requestRender?.();
        return true;
      }
      if (key === 'Enter') {
        this._filterFocused = false;
        this._rebuildUI();
        this._requestRender?.();
        return true;
      }
      if (key === 'Backspace') {
        if (this._filterValue.length > 0) {
          this._filterValue = this._filterValue.slice(0, -1);
          this._applyFilter();
          this._focusedIndex = 0;
          this._scrollY = 0;
          this._rebuildUI();
          this._requestRender?.();
        }
        return true;
      }
      // Handle character input directly
      if (key.length === 1 && !ctrlKey) {
        this._filterValue += key;
        this._applyFilter();
        this._focusedIndex = 0;
        this._scrollY = 0;
        this._rebuildUI();
        this._requestRender?.();
        return true;
      }
      return false;
    }

    const displayEntries = this._getDisplayEntries();
    const itemCount = displayEntries.length;

    // List navigation
    switch (key) {
      case 'Tab':
        if (shiftKey && this.fbProps.showFilter) {
          this._filterFocused = true;
          this._rebuildUI();
          this._requestRender?.();
          return true;
        }
        return false;

      case 'ArrowUp':
        if (this._focusedIndex > 0) {
          this._focusedIndex--;
          this._rebuildUI();
          this._requestRender?.();
        }
        return true;

      case 'ArrowDown':
        if (this._focusedIndex < itemCount - 1) {
          this._focusedIndex++;
          this._rebuildUI();
          this._requestRender?.();
        }
        return true;

      case 'Home':
        this._focusedIndex = 0;
        this._rebuildUI();
        this._requestRender?.();
        return true;

      case 'End':
        this._focusedIndex = Math.max(0, itemCount - 1);
        this._rebuildUI();
        this._requestRender?.();
        return true;

      case 'PageUp':
        this._focusedIndex = Math.max(0, this._focusedIndex - 5);
        this._rebuildUI();
        this._requestRender?.();
        return true;

      case 'PageDown':
        this._focusedIndex = Math.min(itemCount - 1, this._focusedIndex + 5);
        this._rebuildUI();
        this._requestRender?.();
        return true;

      case 'Enter':
        this._handleEnter();
        return true;

      case 'ArrowRight': {
        const focused = displayEntries[this._focusedIndex];
        if (focused && !focused.isParent && focused.entry?.isDirectory) {
          this._navigateToPath(focused.entry.path);
          return true;
        }
        return false;
      }

      case 'ArrowLeft':
      case 'Backspace':
        this._navigateUp();
        return true;

      case 'Escape':
        this._handleCancel();
        return true;

      case ' ':
        if (this.fbProps.selectionMode === 'multiple') {
          const focused = displayEntries[this._focusedIndex];
          if (focused && !focused.isParent && focused.entry) {
            this._toggleSelection(focused.entry);
            this._requestRender?.();
            return true;
          }
        }
        return false;

      case 'h':
        if (ctrlKey) {
          this.fbProps.showHidden = !this.fbProps.showHidden;
          this._navigateToPath(this._currentPath);
          return true;
        }
        break;
    }

    // Start typing to filter
    if (key.length === 1 && !ctrlKey && this.fbProps.showFilter) {
      this._filterFocused = true;
      this._filterValue = key;
      this._applyFilter();
      this._rebuildUI();
      this._requestRender?.();
      return true;
    }

    return false;
  }

  // Focusable interface
  canReceiveFocus(): boolean {
    return !this.fbProps.disabled;
  }

  // Interactive interface
  isInteractive(): boolean {
    return !this.fbProps.disabled;
  }

  // FileBrowser handles all keyboard events for its children
  handlesOwnKeyboard(): boolean {
    return true;
  }

  // FileBrowser should capture focus for all children (table, input, etc.)
  // This tells hit-testing to return this component instead of children
  capturesFocusForChildren(): boolean {
    return true;
  }

  // Clickable interface - delegate clicks to children (table, buttons)
  handleClick(event: ClickEvent, document: Document): boolean {
    if (this.fbProps.disabled) return false;

    const clickX = event.position.x;
    const clickY = event.position.y;
    const currentTime = Date.now();
    logger.debug(`FileBrowser.handleClick at (${clickX}, ${clickY})`);

    // Check for double-click on same position (within threshold)
    const timeSinceLastClick = currentTime - this._lastClickTime;
    const isDoubleClick = (
      timeSinceLastClick < FileBrowserElement.DOUBLE_CLICK_THRESHOLD_MS &&
      Math.abs(clickX - this._lastClickX) <= 1 &&
      Math.abs(clickY - this._lastClickY) <= 1
    );

    // Track click position for double-click detection
    this._lastClickTime = currentTime;
    this._lastClickX = clickX;
    this._lastClickY = clickY;

    if (isDoubleClick && this._lastClickRowId) {
      // Double-click detected - activate the previously clicked row
      logger.debug(`FileBrowser double-click detected on row: ${this._lastClickRowId}`);
      this._lastClickTime = 0;
      this._lastClickRowId = null;
      const displayEntries = this._getDisplayEntries();
      const focused = displayEntries[this._focusedIndex];
      if (focused) {
        const rowId = focused.isParent ? 'parent' : (focused.entry?.path || '');
        this._handleTableActivate({ type: 'activate', rowId });
      }
      return true;
    }

    // Helper to recursively find all clickable elements
    const findAllClickables = (element: Element, results: Element[]): void => {
      if (element.children) {
        for (const child of element.children) {
          findAllClickables(child, results);
        }
      }
      if (isClickable(element) && element !== this) {
        results.push(element);
      }
    };

    // Get all clickable children
    const clickables: Element[] = [];
    findAllClickables(this, clickables);

    // Try each clickable - table should handle row clicks, buttons handle their clicks
    for (const clickable of clickables) {
      logger.debug(`FileBrowser trying clickable: ${clickable.type}/${clickable.id}`);
      const handled = (clickable as unknown as Clickable).handleClick(event, document);
      if (handled) {
        logger.debug(`FileBrowser click handled by ${clickable.type}/${clickable.id}`);
        return true;
      }
    }

    return false;
  }

  // Get current path
  getCurrentPath(): string {
    return this._currentPath;
  }

  // Programmatic navigation
  async navigateTo(path: string): Promise<void> {
    await this._navigateToPath(path);
  }
}

// Register the component
registerComponent({
  type: 'file-browser',
  componentClass: FileBrowserElement,
  defaultProps: {
    selectionMode: 'single',
    selectType: 'file',
    showHidden: false,
    showFilter: true,
    showBreadcrumb: true,
    showButtons: true,
    showSize: true,
    maxVisible: 10,
    selectLabel: 'Open',
    cancelLabel: 'Cancel',
    filter: 'fuzzy',
    disabled: false,
    tabIndex: 0,
  },
});

// Lint schema
export const fileBrowserSchema: ComponentSchema = {
  description: 'File system browser for selecting files and directories',
  props: {
    path: { type: 'string', description: 'Initial directory path' },
    selectionMode: {
      type: 'string',
      enum: ['single', 'multiple'],
      description: 'Selection mode',
    },
    selectType: {
      type: 'string',
      enum: ['file', 'directory', 'both'],
      description: 'What can be selected',
    },
    showHidden: { type: 'boolean', description: 'Show hidden files (dotfiles)' },
    extensions: { type: 'array', description: 'Filter by file extensions' },
    showFilter: { type: 'boolean', description: 'Show filter input' },
    showBreadcrumb: { type: 'boolean', description: 'Show path breadcrumb' },
    showButtons: { type: 'boolean', description: 'Show action buttons' },
    showSize: { type: 'boolean', description: 'Show file sizes' },
    maxVisible: { type: 'number', description: 'Maximum visible list rows' },
    selectLabel: { type: 'string', description: 'Label for select button' },
    cancelLabel: { type: 'string', description: 'Label for cancel button' },
    filter: {
      type: 'string',
      enum: ['fuzzy', 'prefix', 'contains', 'exact', 'none'],
      description: 'Filter algorithm',
    },
    onChange: { type: 'handler', description: 'Called when file/directory selected (preferred)' },
    onSelect: { type: 'handler', description: 'Called when file/directory selected (deprecated: use onChange)' },
    onCancel: { type: 'handler', description: 'Called when cancel pressed' },
    onNavigate: { type: 'handler', description: 'Called when navigating to new path' },
    onError: { type: 'handler', description: 'Called when error occurs' },
  },
};

registerComponentSchema('file-browser', fileBrowserSchema);
