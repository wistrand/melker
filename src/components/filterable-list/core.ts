// FilterableListCore - Shared logic for combobox, select, autocomplete, command-palette
import { Element, BaseProps, Bounds, ComponentRenderContext, IntrinsicSizeContext, Focusable } from '../../types.ts';
import type { DualBuffer, Cell } from '../../buffer.ts';
import type { KeyPressEvent } from '../../events.ts';
import { OptionElement } from './option.ts';
import { GroupElement } from './group.ts';
import { filterOptions, FilteredOption, FilterMode, FuzzyMatchResult } from './filter.ts';
import { getLogger } from '../../logging.ts';
import { getThemeColor } from '../../theme.ts';

const logger = getLogger('filterable-list');

/**
 * Normalized option data extracted from children or options prop
 */
export interface OptionData {
  /** Unique value/identifier */
  id: string;
  /** Display label */
  label: string;
  /** Parent group label (if any) */
  group?: string;
  /** Whether option is disabled */
  disabled: boolean;
  /** Keyboard shortcut display */
  shortcut?: string;
  /** Original element reference (if from children) */
  element?: OptionElement;
}

/**
 * Filtered option with match data
 */
export interface FilteredOptionData extends OptionData {
  /** Match result from filter */
  match: FuzzyMatchResult;
}

/**
 * Row in the dropdown - either a group header or an option
 */
export interface DropdownRow {
  type: 'group' | 'option';
  /** Group label (for group rows) */
  groupLabel?: string;
  /** Option data (for option rows) */
  option?: FilteredOptionData;
  /** Index in filtered options (for option rows, used for selection) */
  optionIndex?: number;
}

/**
 * Common props for all filterable list components
 */
export interface FilterableListCoreProps extends BaseProps {
  /** Current filter/input text */
  value?: string;
  /** Currently selected option value */
  selectedValue?: string;
  /** Whether dropdown is open */
  open?: boolean;
  /** Filter mode */
  filter?: FilterMode;
  /** Allow submitting values not in the list */
  allowFreeText?: boolean;
  /** Maximum visible options in dropdown */
  maxVisible?: number;
  /** Placeholder text */
  placeholder?: string;
  /** Data-driven options (alternative/supplement to children) */
  options?: OptionData[] | (() => OptionData[]);

  // Events
  /** Called when an option is selected */
  onSelect?: (event: OptionSelectEvent) => void;
  /** Called when filter input value changes */
  onFilterChange?: (event: FilterChangeEvent) => void;
  /** Called when dropdown opens/closes */
  onOpenChange?: (open: boolean) => void;
}

/**
 * Event fired when an option is selected
 */
export interface OptionSelectEvent {
  type: 'select';
  /** Selected option value */
  value: string;
  /** Selected option label */
  label: string;
  /** Full option data (undefined for freeform entries) */
  option?: OptionData;
  /** Target element ID */
  targetId: string;
  /** True if this is a freeform entry (not from options list) */
  freeform?: boolean;
}

/**
 * Event fired when filter input value changes
 */
export interface FilterChangeEvent {
  type: 'filterChange';
  /** New input value */
  value: string;
  /** Target element ID */
  targetId: string;
}

/**
 * FilterableListCore - Base class with shared logic for filterable list components.
 *
 * Subclasses:
 * - ComboboxElement: Inline dropdown with text filter
 * - SelectElement: Dropdown without filter
 * - AutocompleteElement: Combobox with async loading
 * - CommandPaletteElement: Modal command picker
 */
export abstract class FilterableListCore extends Element implements Focusable {
  declare props: FilterableListCoreProps;

  /** Options extracted from children */
  protected _childOptions: OptionData[] = [];

  /** Current focused option index (in filtered list) */
  protected _focusedIndex: number = 0;

  /** Scroll offset (first visible option index) */
  protected _scrollTop: number = 0;

  /** Cached filtered options */
  protected _filteredOptions: FilteredOptionData[] = [];

  /** Cached dropdown rows (groups + options) */
  protected _dropdownRows: DropdownRow[] = [];

  /** Whether filter cache is valid */
  protected _filterCacheValid: boolean = false;

  /** Last filter value used */
  protected _lastFilterValue: string = '';

  constructor(type: string, props: FilterableListCoreProps = {}, children: Element[] = []) {
    const defaultProps: FilterableListCoreProps = {
      open: false,
      filter: 'fuzzy',
      allowFreeText: false,
      maxVisible: 8,
      placeholder: '',
      disabled: false,
      ...props,
    };

    // Pass children to super so wireBundlerHandlers can process their event handlers
    super(type, defaultProps, children);

    // Extract option data from children
    this._childOptions = this._extractOptionsFromChildren(children);
  }

  /**
   * Extract option data from child elements (option and group)
   */
  protected _extractOptionsFromChildren(children: Element[]): OptionData[] {
    const options: OptionData[] = [];

    for (const child of children) {
      if (child.type === 'option') {
        const optionEl = child as OptionElement;
        options.push({
          id: optionEl.getValue(),
          label: optionEl.getLabel(),
          disabled: optionEl.isDisabled(),
          shortcut: optionEl.getShortcut(),
          element: optionEl,
        });
      } else if (child.type === 'group') {
        const groupEl = child as GroupElement;
        const groupLabel = groupEl.getLabel();

        for (const optionEl of groupEl.getOptions()) {
          options.push({
            id: optionEl.getValue(),
            label: optionEl.getLabel(),
            group: groupLabel,
            disabled: optionEl.isDisabled(),
            shortcut: optionEl.getShortcut(),
            element: optionEl,
          });
        }
      } else {
        logger.warn(`FilterableList only accepts option/group children, ignoring ${child.type}`);
      }
    }

    return options;
  }

  /**
   * Get all options (from children + options prop)
   */
  getAllOptions(): OptionData[] {
    const propOptions = typeof this.props.options === 'function'
      ? this.props.options()
      : (this.props.options || []);

    // Children first, then prop options
    return [...this._childOptions, ...propOptions];
  }

  /**
   * Get filtered and sorted options based on current filter value
   */
  getFilteredOptions(): FilteredOptionData[] {
    const filterValue = this.props.value || '';

    // Check cache
    if (this._filterCacheValid && this._lastFilterValue === filterValue) {
      return this._filteredOptions;
    }

    const allOptions = this.getAllOptions();
    const mode = this.props.filter || 'fuzzy';

    const filtered = filterOptions(allOptions, filterValue, mode);

    // Convert to FilteredOptionData
    this._filteredOptions = filtered.map(f => ({
      ...f.option,
      match: f.match,
    }));

    this._lastFilterValue = filterValue;
    this._filterCacheValid = true;

    // Rebuild dropdown rows
    this._rebuildDropdownRows();

    return this._filteredOptions;
  }

  /**
   * Rebuild dropdown rows from filtered options (with group headers)
   */
  protected _rebuildDropdownRows(): void {
    this._dropdownRows = [];
    let currentGroup: string | undefined = undefined;
    let optionIndex = 0;

    for (const option of this._filteredOptions) {
      // Insert group header if group changed
      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup) {
          this._dropdownRows.push({
            type: 'group',
            groupLabel: currentGroup,
          });
        }
      }

      this._dropdownRows.push({
        type: 'option',
        option,
        optionIndex,
      });
      optionIndex++;
    }
  }

  /**
   * Get dropdown rows (groups + options)
   */
  getDropdownRows(): DropdownRow[] {
    // Ensure filtered options are up to date
    this.getFilteredOptions();
    return this._dropdownRows;
  }

  /**
   * Invalidate filter cache (call when options change)
   */
  invalidateFilterCache(): void {
    this._filterCacheValid = false;
  }

  /**
   * Get number of filtered options
   */
  getFilteredCount(): number {
    return this.getFilteredOptions().length;
  }

  /**
   * Get currently focused option
   */
  getFocusedOption(): FilteredOptionData | null {
    const filtered = this.getFilteredOptions();
    if (this._focusedIndex >= 0 && this._focusedIndex < filtered.length) {
      return filtered[this._focusedIndex];
    }
    return null;
  }

  /**
   * Get focused index
   */
  getFocusedIndex(): number {
    return this._focusedIndex;
  }

  /**
   * Set focused index (clamps to valid range)
   */
  setFocusedIndex(index: number): void {
    const count = this.getFilteredCount();
    this._focusedIndex = Math.max(0, Math.min(index, count - 1));
    this._ensureFocusedVisible();
  }

  /**
   * Move focus to next option
   */
  focusNext(): void {
    this.setFocusedIndex(this._focusedIndex + 1);
  }

  /**
   * Move focus to previous option
   */
  focusPrev(): void {
    this.setFocusedIndex(this._focusedIndex - 1);
  }

  /**
   * Move focus to first option
   */
  focusFirst(): void {
    this.setFocusedIndex(0);
  }

  /**
   * Move focus to last option
   */
  focusLast(): void {
    this.setFocusedIndex(this.getFilteredCount() - 1);
  }

  /**
   * Move focus by page (for PageUp/PageDown)
   */
  focusPageDown(): void {
    const visibleCount = this._getVisibleCount();
    this.setFocusedIndex(this._focusedIndex + visibleCount);
  }

  focusPageUp(): void {
    const visibleCount = this._getVisibleCount();
    this.setFocusedIndex(this._focusedIndex - visibleCount);
  }

  /**
   * Get number of visible options (based on maxVisible and available space)
   */
  protected _getVisibleCount(): number {
    const maxVisible = this.props.maxVisible || 8;
    const count = this.getFilteredCount();
    return Math.min(maxVisible, count);
  }

  /**
   * Ensure focused option is visible (adjust scroll)
   */
  protected _ensureFocusedVisible(): void {
    const visibleCount = this._getVisibleCount();

    if (this._focusedIndex < this._scrollTop) {
      this._scrollTop = this._focusedIndex;
    } else if (this._focusedIndex >= this._scrollTop + visibleCount) {
      this._scrollTop = this._focusedIndex - visibleCount + 1;
    }

    // Clamp scroll
    const maxScroll = Math.max(0, this.getFilteredCount() - visibleCount);
    this._scrollTop = Math.max(0, Math.min(this._scrollTop, maxScroll));
  }

  /**
   * Get current scroll offset
   */
  getScrollTop(): number {
    return this._scrollTop;
  }

  /**
   * Get visible range (start, end indices)
   */
  getVisibleRange(): { start: number; end: number } {
    const visibleCount = this._getVisibleCount();
    const start = this._scrollTop;
    const end = Math.min(start + visibleCount, this.getFilteredCount());
    return { start, end };
  }

  /**
   * Check if scrolling is needed
   */
  hasScroll(): boolean {
    return this.getFilteredCount() > this._getVisibleCount();
  }

  /**
   * Open the dropdown
   */
  open(): void {
    if (this.props.open) return;

    this.props.open = true;
    this._onOpen();

    if (this.props.onOpenChange) {
      this.props.onOpenChange(true);
    }
  }

  /**
   * Close the dropdown
   */
  close(): void {
    if (!this.props.open) return;

    this.props.open = false;

    if (this.props.onOpenChange) {
      this.props.onOpenChange(false);
    }
  }

  /**
   * Toggle dropdown open/close
   */
  toggle(): void {
    if (this.props.open) {
      this.close();
    } else {
      this.open();
    }
  }

  /**
   * Called when dropdown opens - subclasses can override for focus behavior
   */
  protected _onOpen(): void {
    // Reset focus to first option or current selection
    const selectedValue = this.props.selectedValue;
    if (selectedValue) {
      const filtered = this.getFilteredOptions();
      const index = filtered.findIndex(o => o.id === selectedValue);
      if (index >= 0) {
        this._focusedIndex = index;
      } else {
        this._focusedIndex = 0;
      }
    } else {
      this._focusedIndex = 0;
    }

    this._ensureFocusedVisible();
  }

  /**
   * Select the currently focused option
   */
  selectFocused(): void {
    const option = this.getFocusedOption();
    if (option && !option.disabled) {
      this.selectOption(option);
    }
  }

  /**
   * Select a specific option
   */
  selectOption(option: OptionData): void {
    if (option.disabled) return;

    this.props.selectedValue = option.id;

    const event: OptionSelectEvent = {
      type: 'select',
      value: option.id,
      label: option.label,
      option,
      targetId: this.id,
    };

    // Call option's individual onSelect handler if defined
    if (option.element?.props.onSelect) {
      const handler = option.element.props.onSelect as any;
      if (typeof handler === 'function') {
        handler(event);
      } else if (typeof handler === 'object' && handler.__isStringHandler) {
        // String handler not yet wired - log warning
        logger.warn(`Option onSelect handler not wired: ${handler.__handlerCode}`);
      }
    }

    // Call parent's onSelect handler if defined
    if (this.props.onSelect) {
      this.props.onSelect(event);
    }

    // Close dropdown after selection (subclasses can override)
    this.close();
  }

  /**
   * Update filter value
   */
  setFilterValue(value: string): void {
    if (this.props.value === value) return;

    this.props.value = value;
    this.invalidateFilterCache();

    // Reset focus to first match
    this._focusedIndex = 0;
    this._scrollTop = 0;

    if (this.props.onFilterChange) {
      this.props.onFilterChange({
        type: 'filterChange',
        value,
        targetId: this.id,
      });
    }
  }

  /**
   * Handle keyboard input - returns true if handled
   */
  handleKeyPress(event: KeyPressEvent): boolean {
    const { key } = event;

    // When closed, certain keys open the dropdown
    if (!this.props.open) {
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ') {
        this.open();
        return true;
      }
      return false;
    }

    // When open, handle navigation
    switch (key) {
      case 'ArrowDown':
        this.focusNext();
        return true;

      case 'ArrowUp':
        this.focusPrev();
        return true;

      case 'Home':
        this.focusFirst();
        return true;

      case 'End':
        this.focusLast();
        return true;

      case 'PageDown':
        this.focusPageDown();
        return true;

      case 'PageUp':
        this.focusPageUp();
        return true;

      case 'Enter':
        this.selectFocused();
        return true;

      case 'Escape':
        this.close();
        return true;

      case 'Tab':
        // Close on Tab (let focus move naturally)
        this.close();
        return false; // Don't consume - let tab navigation happen

      default:
        return false;
    }
  }

  /**
   * Handle mouse wheel scrolling
   */
  handleWheel(deltaY: number): boolean {
    if (!this.props.open) return false;

    const delta = deltaY > 0 ? 1 : -1;
    const maxScroll = Math.max(0, this.getFilteredCount() - this._getVisibleCount());

    this._scrollTop = Math.max(0, Math.min(this._scrollTop + delta, maxScroll));
    return true;
  }

  /**
   * Find option by value
   */
  findOptionByValue(value: string): OptionData | null {
    const all = this.getAllOptions();
    return all.find(o => o.id === value) || null;
  }

  /**
   * Get selected option
   */
  getSelectedOption(): OptionData | null {
    if (!this.props.selectedValue) return null;
    return this.findOptionByValue(this.props.selectedValue);
  }

  // Focusable interface
  canReceiveFocus(): boolean {
    return !this.props.disabled;
  }

  /**
   * Marker method indicating this component handles its own keyboard events
   * (including Enter/Space) and should not have them intercepted by Clickable handling.
   */
  handlesOwnKeyboard(): boolean {
    return true;
  }

  /**
   * Render a scrollbar in the dropdown area
   * @param buffer - The buffer to render to
   * @param x - X position of scrollbar (right edge)
   * @param y - Y position (top of scrollbar area)
   * @param height - Height of scrollbar track
   * @param style - Cell style for colors
   */
  protected _renderScrollbar(
    buffer: DualBuffer,
    x: number,
    y: number,
    height: number,
    style: Partial<Cell>
  ): void {
    if (!this.hasScroll() || height < 2) return;

    const filtered = this.getFilteredOptions();
    const totalItems = filtered.length;
    const visibleItems = this._getVisibleCount();
    const scrollTop = this._scrollTop;

    // Calculate thumb size and position
    const thumbSize = Math.max(1, Math.floor((visibleItems / totalItems) * height));
    const maxScroll = totalItems - visibleItems;
    const thumbPosition = maxScroll > 0
      ? Math.floor((scrollTop / maxScroll) * (height - thumbSize))
      : 0;

    // Draw track
    for (let i = 0; i < height; i++) {
      const isThumb = i >= thumbPosition && i < thumbPosition + thumbSize;
      buffer.currentBuffer.setCell(x, y + i, {
        char: isThumb ? '█' : '░',
        foreground: isThumb ? getThemeColor('primary') : getThemeColor('border'),
        background: style.background,
      });
    }
  }

  // Abstract methods for subclasses
  abstract intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number };
  abstract render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void;
}
