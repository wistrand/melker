// Combobox component - Inline dropdown with text filtering
import {
  Element,
  BaseProps,
  Renderable,
  Focusable,
  Interactive,
  Clickable,
  Bounds,
  ComponentRenderContext,
  IntrinsicSizeContext,
  type Overlay,
  BORDER_CHARS,
  getBorderChars,
} from '../../types.ts';
import { type DualBuffer, type Cell, EMPTY_CHAR } from '../../buffer.ts';
import type { KeyPressEvent } from '../../events.ts';
import type { ClickEvent } from '../../types.ts';
import { getThemeColor } from '../../theme.ts';
import { registerComponent } from '../../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../../lint.ts';
import { FilterableListCore, FilterableListCoreProps, OptionData, FilteredOptionData, OptionSelectEvent } from './core.ts';
import { getLogger } from '../../logging.ts';
import { parseDimension } from '../../utils/dimensions.ts';

const logger = getLogger('combobox');

export interface ComboboxProps extends FilterableListCoreProps {
  /** Override dropdown width (default: same as input) */
  dropdownWidth?: number;
  /** Show clear button when value is present */
  showClearButton?: boolean;
  /** Width of the combobox input (number, "50%", or "fill") */
  width?: number | string;
}

/**
 * ComboboxElement - Inline dropdown with text filtering.
 *
 * Features:
 * - Text input for filtering options
 * - Fuzzy/prefix/contains matching
 * - Keyboard navigation (arrows, Enter, Escape)
 * - Mouse click selection
 * - Scrollable dropdown for long lists
 *
 * Usage:
 * ```xml
 * <combobox placeholder="Select country..." onChange="$app.setCountry(event.value)">
 *   <option value="us">United States</option>
 *   <option value="uk">United Kingdom</option>
 *   <group label="Europe">
 *     <option value="de">Germany</option>
 *     <option value="fr">France</option>
 *   </group>
 * </combobox>
 * ```
 */
export class ComboboxElement extends FilterableListCore implements Renderable, Focusable, Interactive, Clickable {
  declare type: 'combobox';
  declare props: ComboboxProps;

  /** Internal input value (for cursor tracking) */
  private _inputValue: string = '';
  /** Cursor position in input */
  private _cursorPosition: number = 0;
  /** Last rendered bounds for input */
  private _inputBounds: Bounds | null = null;
  /** Last rendered bounds for dropdown */
  private _dropdownBounds: Bounds | null = null;
  /** Map of dropdown row Y position to option index (null = group header) */
  private _rowToOptionIndex: Map<number, number | null> = new Map();

  private static _autoIdCounter = 0;

  constructor(props: ComboboxProps = {}, children: Element[] = []) {
    const defaultProps: ComboboxProps = {
      showClearButton: true,
      filter: 'fuzzy',
      maxVisible: 8,
      ...props,
    };

    // Auto-generate ID if not provided (needed for hit testing)
    if (!defaultProps.id) {
      defaultProps.id = `combobox-auto-${ComboboxElement._autoIdCounter++}`;
    }

    super('combobox', defaultProps, children);
    this._inputValue = props.value || '';
    this._cursorPosition = this._inputValue.length;
  }

  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Input field is always 1 row high
    // Respect explicit width from style or props (style takes precedence, props are fallback)
    const explicitWidth = (this.props.style as any)?.width ?? this.props.width;
    if (explicitWidth !== undefined) {
      // Use parseDimension to support "50%", "fill", etc.
      const width = parseDimension(explicitWidth, context.availableSpace.width, 10);
      return { width, height: 1 };
    }

    // Width based on placeholder, value, or options - NOT available space
    const placeholder = this.props.placeholder || '';
    const value = this.props.value || '';

    // Find longest option label
    let maxOptionWidth = 0;
    for (const option of this.getAllOptions()) {
      const label = option.label || '';
      maxOptionWidth = Math.max(maxOptionWidth, label.length);
    }

    const contentWidth = Math.max(placeholder.length, value.length, maxOptionWidth, 10);

    return {
      width: contentWidth + 3, // +3 for dropdown indicator
      height: 1, // Just the input row (dropdown renders as overlay)
    };
  }

  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Store input bounds
    this._inputBounds = { ...bounds, height: 1 };

    // Sync external value changes
    if (this.props.value !== undefined && this.props.value !== this._inputValue) {
      this._inputValue = this.props.value;
      this._cursorPosition = Math.min(this._cursorPosition, this._inputValue.length);
      this.invalidateFilterCache();
    }

    const isFocused = context.focusedElementId === this.id;

    // Render input field
    this._renderInput(bounds, style, buffer, isFocused);

    // Register dropdown as overlay if open
    if (this.props.open && context.registerOverlay) {
      // Calculate dropdown bounds
      const filtered = this.getFilteredOptions();
      if (filtered.length > 0) {
        // Calculate total rows needed (options + group headers)
        const { start, end } = this.getVisibleRange();
        let totalRows = 0;
        let currentGroup: string | undefined = undefined;

        for (let i = start; i < end && i < filtered.length; i++) {
          const option = filtered[i];
          if (option.group !== currentGroup) {
            currentGroup = option.group;
            if (currentGroup) {
              totalRows++; // Group header row
            }
          }
          totalRows++; // Option row
        }

        const maxVisible = this.props.maxVisible || 8;
        const dropdownHeight = Math.min(totalRows, maxVisible) + 2; // +2 for border
        // Dropdown can be wider than input to fit content
        const minDropdownWidth = bounds.width;
        const contentWidth = this._getMaxOptionWidth() + 4; // +4 for borders and padding
        const dropdownWidth = this.props.dropdownWidth || Math.max(minDropdownWidth, contentWidth);

        const dropdownBounds: Bounds = {
          x: bounds.x,
          y: bounds.y + 1, // Position below input
          width: dropdownWidth,
          height: dropdownHeight,
        };

        // Store dropdown bounds for click handling
        this._dropdownBounds = dropdownBounds;

        // Register the dropdown overlay
        const overlay: Overlay = {
          id: `${this.id}-dropdown`,
          zIndex: 100, // Dropdowns should be above normal content
          bounds: dropdownBounds,
          render: (buf: DualBuffer, overlayBounds: Bounds, overlayStyle: Partial<Cell>) => {
            this._renderDropdownContent(overlayBounds, style, buf, context, isFocused);
          },
          hitTestBounds: dropdownBounds,
          onClick: (x: number, y: number) => {
            return this._handleDropdownClick(x, y);
          },
          // Close dropdown when clicking outside
          onClickOutside: () => {
            this.close();
          },
          // Don't close when clicking on the input field itself
          excludeBounds: [this._inputBounds!],
        };

        context.registerOverlay(overlay);
      } else {
        // Show "no results" as overlay
        const dropdownBounds: Bounds = {
          x: bounds.x,
          y: bounds.y + 1,
          width: bounds.width,
          height: 3, // Border + 1 line + border
        };

        this._dropdownBounds = dropdownBounds;

        const overlay: Overlay = {
          id: `${this.id}-dropdown`,
          zIndex: 100,
          bounds: dropdownBounds,
          render: (buf: DualBuffer, overlayBounds: Bounds, overlayStyle: Partial<Cell>) => {
            this._renderNoResults(bounds, style, buf);
          },
          // Close dropdown when clicking outside
          onClickOutside: () => {
            this.close();
          },
          // Don't close when clicking on the input field itself
          excludeBounds: [this._inputBounds!],
        };

        context.registerOverlay(overlay);
      }
    } else if (this.props.open) {
      // Fallback: render directly if no overlay system available
      this._renderDropdown(bounds, style, buffer, context, isFocused);
    }
  }

  private _renderInput(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, isFocused: boolean): void {
    const value = this._inputValue;
    const placeholder = this.props.placeholder || '';
    const displayText = value || placeholder;

    // Input styling
    const inputStyle: Partial<Cell> = {
      ...style,
      background: this.props.disabled
        ? getThemeColor('surface')
        : getThemeColor('inputBackground'),
      foreground: value
        ? getThemeColor('inputForeground')
        : getThemeColor('textMuted'),
    };

    // Clear input area
    for (let x = 0; x < bounds.width; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, bounds.y, {
        char: EMPTY_CHAR,
        background: inputStyle.background,
        foreground: inputStyle.foreground,
      });
    }

    // Render text (leave space for dropdown indicator)
    const textWidth = bounds.width - 2; // -2 for " v" indicator
    const visibleText = displayText.length > textWidth
      ? displayText.substring(displayText.length - textWidth)
      : displayText;

    if (visibleText) {
      buffer.currentBuffer.setText(bounds.x, bounds.y, visibleText, inputStyle);
    }

    // Render dropdown indicator
    const indicatorChar = this.props.open ? '^' : 'v';
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y, {
      char: indicatorChar,
      background: inputStyle.background,
      foreground: getThemeColor('textMuted'),
    });

    // Render cursor if focused
    if (isFocused && !this.props.disabled) {
      const cursorX = bounds.x + Math.min(this._cursorPosition, textWidth);
      const charAtCursor = this._cursorPosition < value.length ? value[this._cursorPosition] : ' ';

      buffer.currentBuffer.setCell(cursorX, bounds.y, {
        char: charAtCursor,
        foreground: inputStyle.foreground,
        background: inputStyle.background,
        reverse: true,
      });
    }
  }

  private _renderDropdown(
    inputBounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext,
    isFocused: boolean
  ): void {
    const filtered = this.getFilteredOptions();
    if (filtered.length === 0) {
      // Show "no results" message
      this._renderNoResults(inputBounds, style, buffer);
      return;
    }

    // Clear row mapping
    this._rowToOptionIndex.clear();

    // Calculate total rows needed (options + group headers)
    const { start, end } = this.getVisibleRange();
    let totalRows = 0;
    let currentGroup: string | undefined = undefined;

    for (let i = start; i < end && i < filtered.length; i++) {
      const option = filtered[i];
      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup) {
          totalRows++; // Group header row
        }
      }
      totalRows++; // Option row
    }

    const maxVisible = this.props.maxVisible || 8;
    const dropdownHeight = Math.min(totalRows, maxVisible) + 2; // +2 for border
    // Dropdown can be wider than input to fit content
    const minDropdownWidth = inputBounds.width;
    const contentWidth = this._getMaxOptionWidth() + 4; // +4 for borders and padding
    const dropdownWidth = this.props.dropdownWidth || Math.max(minDropdownWidth, contentWidth);

    // Position dropdown below input
    const dropdownBounds: Bounds = {
      x: inputBounds.x,
      y: inputBounds.y + 1,
      width: dropdownWidth,
      height: dropdownHeight,
    };

    this._dropdownBounds = dropdownBounds;

    // Dropdown styling
    const dropdownStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textPrimary'),
    };

    // Draw border
    this._drawDropdownBorder(dropdownBounds, dropdownStyle, buffer);

    // Render visible options with group headers
    let y = dropdownBounds.y + 1; // +1 for top border
    currentGroup = undefined;
    const maxY = dropdownBounds.y + dropdownBounds.height - 1; // -1 for bottom border

    for (let i = start; i < end && i < filtered.length && y < maxY; i++) {
      const option = filtered[i];

      // Render group header if group changed
      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup && y < maxY) {
          this._renderGroupHeader(dropdownBounds.x + 1, y, dropdownBounds.width - 2, currentGroup, dropdownStyle, buffer);
          this._rowToOptionIndex.set(y, null); // null = group header, not selectable
          y++;
          if (y >= maxY) break;
        }
      }

      // Render option
      const isFocusedOption = i === this.getFocusedIndex();
      this._renderOption(
        dropdownBounds.x + 1,
        y,
        dropdownBounds.width - 2,
        option,
        isFocusedOption,
        dropdownStyle,
        buffer
      );
      this._rowToOptionIndex.set(y, i); // Map row Y to option index
      y++;
    }

    // Render scrollbar
    if (this.hasScroll()) {
      const scrollbarX = dropdownBounds.x + dropdownBounds.width - 2;
      const scrollbarY = dropdownBounds.y + 1;
      const scrollbarHeight = dropdownBounds.height - 2;
      this._renderScrollbar(buffer, scrollbarX, scrollbarY, scrollbarHeight, dropdownStyle);
    }
  }

  /**
   * Render dropdown content (used by overlay system)
   * This method assumes bounds are already calculated and provided.
   */
  protected _renderDropdownContent(
    dropdownBounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext,
    isFocused: boolean
  ): void {
    const filtered = this.getFilteredOptions();
    if (filtered.length === 0) {
      return; // No results handled separately
    }

    // Clear row mapping
    this._rowToOptionIndex.clear();

    // Dropdown styling
    const dropdownStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textPrimary'),
    };

    // Draw border
    this._drawDropdownBorder(dropdownBounds, dropdownStyle, buffer);

    // Render visible options with group headers
    const { start, end } = this.getVisibleRange();
    let y = dropdownBounds.y + 1; // +1 for top border
    let currentGroup: string | undefined = undefined;
    const maxY = dropdownBounds.y + dropdownBounds.height - 1; // -1 for bottom border

    for (let i = start; i < end && i < filtered.length && y < maxY; i++) {
      const option = filtered[i];

      // Render group header if group changed
      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup && y < maxY) {
          this._renderGroupHeader(dropdownBounds.x + 1, y, dropdownBounds.width - 2, currentGroup, dropdownStyle, buffer);
          this._rowToOptionIndex.set(y, null); // null = group header, not selectable
          y++;
          if (y >= maxY) break;
        }
      }

      // Render option
      const isFocusedOption = i === this.getFocusedIndex();
      this._renderOption(
        dropdownBounds.x + 1,
        y,
        dropdownBounds.width - 2,
        option,
        isFocusedOption,
        dropdownStyle,
        buffer
      );
      this._rowToOptionIndex.set(y, i); // Map row Y to option index
      y++;
    }

    // Render scrollbar
    if (this.hasScroll()) {
      const scrollbarX = dropdownBounds.x + dropdownBounds.width - 2;
      const scrollbarY = dropdownBounds.y + 1;
      const scrollbarHeight = dropdownBounds.height - 2;
      this._renderScrollbar(buffer, scrollbarX, scrollbarY, scrollbarHeight, dropdownStyle);
    }
  }

  /**
   * Get the maximum option label width (for dropdown sizing)
   */
  protected _getMaxOptionWidth(): number {
    let maxWidth = 0;
    for (const option of this.getAllOptions()) {
      const label = option.label || '';
      maxWidth = Math.max(maxWidth, label.length);
    }
    return maxWidth;
  }

  /**
   * Handle click on dropdown (used by overlay system)
   */
  private _handleDropdownClick(x: number, y: number): boolean {
    if (!this._dropdownBounds) return false;

    // Check if click is on the scrollbar
    if (this.hasScroll()) {
      const scrollbarX = this._dropdownBounds.x + this._dropdownBounds.width - 2;
      if (x === scrollbarX) {
        // Handle scrollbar click - scroll to position based on y
        const scrollbarY = this._dropdownBounds.y + 1;
        const scrollbarHeight = this._dropdownBounds.height - 2;
        const clickOffset = y - scrollbarY;

        if (clickOffset >= 0 && clickOffset < scrollbarHeight) {
          const totalItems = this.getFilteredCount();
          const visibleCount = this._getVisibleCount();
          const maxScroll = Math.max(0, totalItems - visibleCount);

          // Map click position to scroll position
          const scrollPosition = Math.round((clickOffset / Math.max(1, scrollbarHeight - 1)) * maxScroll);
          this._scrollTop = Math.max(0, Math.min(scrollPosition, maxScroll));
          return true;
        }
      }
    }

    // Use the row mapping to find which option was clicked
    const optionIndex = this._rowToOptionIndex.get(y);

    if (optionIndex !== undefined && optionIndex !== null) {
      // It's an option row, not a group header
      const filtered = this.getFilteredOptions();
      if (optionIndex >= 0 && optionIndex < filtered.length) {
        const option = filtered[optionIndex];
        if (!option.disabled) {
          this.selectOption(option);
          return true;
        }
      }
    }
    // If optionIndex is null, it's a group header - ignore click
    return true; // Consume click even for group headers
  }

  protected _renderNoResults(inputBounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const dropdownBounds: Bounds = {
      x: inputBounds.x,
      y: inputBounds.y + 1,
      width: inputBounds.width,
      height: 3, // Border + 1 line + border
    };

    this._dropdownBounds = dropdownBounds;

    const dropdownStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textMuted'),
    };

    this._drawDropdownBorder(dropdownBounds, dropdownStyle, buffer);

    const message = 'No results';
    const x = dropdownBounds.x + 1;
    const y = dropdownBounds.y + 1;
    buffer.currentBuffer.setText(x, y, message.substring(0, dropdownBounds.width - 2), dropdownStyle);
  }

  protected _drawDropdownBorder(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const chars = getBorderChars('thin');
    const borderStyle: Partial<Cell> = {
      ...style,
      foreground: getThemeColor('border'),
    };

    // Top border
    buffer.currentBuffer.setCell(bounds.x, bounds.y, { ...borderStyle, char: chars.tl });
    for (let x = 1; x < bounds.width - 1; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, bounds.y, { ...borderStyle, char: chars.h });
    }
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y, { ...borderStyle, char: chars.tr });

    // Side borders and fill
    for (let y = 1; y < bounds.height - 1; y++) {
      buffer.currentBuffer.setCell(bounds.x, bounds.y + y, { ...borderStyle, char: chars.v });
      // Fill interior
      for (let x = 1; x < bounds.width - 1; x++) {
        buffer.currentBuffer.setCell(bounds.x + x, bounds.y + y, { ...style, char: EMPTY_CHAR });
      }
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + y, { ...borderStyle, char: chars.v });
    }

    // Bottom border
    buffer.currentBuffer.setCell(bounds.x, bounds.y + bounds.height - 1, { ...borderStyle, char: chars.bl });
    for (let x = 1; x < bounds.width - 1; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, bounds.y + bounds.height - 1, { ...borderStyle, char: chars.h });
    }
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, { ...borderStyle, char: chars.br });
  }

  private _renderGroupHeader(
    x: number,
    y: number,
    width: number,
    label: string,
    style: Partial<Cell>,
    buffer: DualBuffer
  ): void {
    const headerStyle: Partial<Cell> = {
      ...style,
      foreground: getThemeColor('textSecondary'),
      bold: true,
    };

    // Clear line
    buffer.currentBuffer.fillLine(x, y, width, style);

    // Render label
    const displayLabel = label.substring(0, width);
    buffer.currentBuffer.setText(x, y, displayLabel, headerStyle);
  }

  private _renderOption(
    x: number,
    y: number,
    width: number,
    option: FilteredOptionData,
    isFocused: boolean,
    style: Partial<Cell>,
    buffer: DualBuffer
  ): void {
    // Option styling - use reverse attribute for focused option (works in all color modes)
    let optionStyle: Partial<Cell>;

    if (option.disabled) {
      optionStyle = {
        ...style,
        foreground: getThemeColor('textMuted'),
      };
    } else if (isFocused) {
      // Use reverse attribute to invert colors (reliable in all modes)
      optionStyle = {
        ...style,
        reverse: true,
      };
    } else {
      optionStyle = { ...style };
    }

    // Clear line with background
    buffer.currentBuffer.fillLine(x, y, width, optionStyle);

    // Render label with match highlighting (bold for matched chars when focused)
    const label = option.label || '';
    const matchIndices = new Set(option.match?.matchIndices || []);
    const maxLabelWidth = width - (option.shortcut ? option.shortcut.length + 2 : 0);

    for (let i = 0; i < Math.min(label.length, maxLabelWidth); i++) {
      const isMatch = matchIndices.has(i);
      const charStyle: Partial<Cell> = isMatch && !option.disabled
        ? {
            ...optionStyle,
            bold: true,
          }
        : optionStyle;

      buffer.currentBuffer.setCell(x + i, y, { ...charStyle, char: label[i] });
    }

    // Render shortcut (right-aligned, dimmed unless focused)
    if (option.shortcut) {
      const shortcutStyle: Partial<Cell> = isFocused
        ? optionStyle
        : { ...optionStyle, foreground: getThemeColor('textMuted') };
      const shortcutX = x + width - option.shortcut.length;
      buffer.currentBuffer.setText(shortcutX, y, option.shortcut, shortcutStyle);
    }
  }

  // Handle text input
  handleKeyInput(key: string, ctrlKey: boolean = false, altKey: boolean = false): boolean {
    if (this.props.disabled) return false;

    let changed = false;
    let value = this._inputValue;
    let cursor = this._cursorPosition;

    // Handle backspace
    const isBackspace = key === 'Backspace' ||
      (key.length === 1 && key.charCodeAt(0) === 8) ||
      (key.length === 1 && key.charCodeAt(0) === 127) ||
      (ctrlKey && key.toLowerCase() === 'h');

    if (isBackspace) {
      if (cursor > 0) {
        value = value.slice(0, cursor - 1) + value.slice(cursor);
        cursor = cursor - 1;
        changed = true;
      }
    } else if (key === 'Delete') {
      if (cursor < value.length) {
        value = value.slice(0, cursor) + value.slice(cursor + 1);
        changed = true;
      }
    } else if (key === 'ArrowLeft') {
      if (cursor > 0) {
        cursor = cursor - 1;
        changed = true;
      }
    } else if (key === 'ArrowRight') {
      if (cursor < value.length) {
        cursor = cursor + 1;
        changed = true;
      }
    } else if (key === 'Home' && !this.props.open) {
      cursor = 0;
      changed = true;
    } else if (key === 'End' && !this.props.open) {
      cursor = value.length;
      changed = true;
    } else if (key === 'a' && ctrlKey) {
      cursor = 0;
      changed = true;
    } else if (key === 'e' && ctrlKey) {
      cursor = value.length;
      changed = true;
    } else if (key === 'u' && ctrlKey) {
      // Clear to start
      if (cursor > 0) {
        value = value.slice(cursor);
        cursor = 0;
        changed = true;
      }
    } else if (key.length >= 1 && !ctrlKey && !altKey) {
      // Regular character input
      const charCode = key.charCodeAt(0);
      if (charCode >= 32) {
        value = value.slice(0, cursor) + key + value.slice(cursor);
        cursor = cursor + key.length;
        changed = true;

        // Open dropdown when typing
        if (!this.props.open) {
          this.open();
        }
      }
    }

    if (changed) {
      this._inputValue = value;
      this._cursorPosition = cursor;
      this.setFilterValue(value);

      // Trigger onFilterChange for the input text change
      if (this.props.onFilterChange) {
        this.props.onFilterChange({
          type: 'filterChange',
          value: value,
          targetId: this.id,
        });
      }
    }

    return changed;
  }

  // Override keyboard handling to combine input + list navigation
  onKeyPress(event: KeyPressEvent): boolean {
    const { key, ctrlKey, altKey } = event;

    // First, try list navigation keys
    if (this.handleKeyPress(event)) {
      return true;
    }

    // Then, try text input
    return this.handleKeyInput(key, ctrlKey, altKey);
  }

  // Handle clicks - toggle/open dropdown (hit testing already confirmed click is on this element)
  // Dropdown option clicks are handled by the overlay system
  handleClick(_event: ClickEvent): boolean {
    if (this.props.disabled) return false;

    // Toggle dropdown
    this.toggle();
    return true;
  }

  private _isInBounds(x: number, y: number, bounds: Bounds): boolean {
    return x >= bounds.x && x < bounds.x + bounds.width &&
           y >= bounds.y && y < bounds.y + bounds.height;
  }

  // Override selectFocused to allow freeform text entry
  override selectFocused(): void {
    const option = this.getFocusedOption();
    if (option && !option.disabled) {
      // Select the focused option
      this.selectOption(option);
    } else if (this._inputValue.trim()) {
      // No matching option - use the typed text as freeform value
      this.selectFreeformValue(this._inputValue.trim());
    } else {
      // No option and no input - just close
      this.close();
    }
  }

  // Select a freeform value (not from options list)
  selectFreeformValue(value: string): void {
    this._inputValue = value;
    this._cursorPosition = value.length;
    this.props.value = value;
    this.props.selectedValue = value;

    // Fire onChange/onSelect with the freeform value
    const event: OptionSelectEvent = {
      type: 'select',
      value: value,
      label: value,
      freeform: true,
      targetId: this.id,
    };
    if (this.props.onChange) {
      this.props.onChange(event);
    }
    if (this.props.onSelect) {
      this.props.onSelect(event);
    }

    this.close();
  }

  // Override selectOption to also set input value to selected label
  override selectOption(option: OptionData): void {
    // Set input value to selected option's label
    const label = option.label || '';
    this._inputValue = label;
    this._cursorPosition = label.length;
    this.props.value = label;

    // Call parent to fire event and close
    super.selectOption(option);
  }

  // Override setValue to also update the input display
  override setValue(value: string | undefined): void {
    if (value === undefined) {
      this.props.selectedValue = undefined;
      this._inputValue = '';
      this._cursorPosition = 0;
      this.props.value = '';
      return;
    }

    const option = this.findOptionByValue(value);
    if (option) {
      // Update input to show selected option's label
      const label = option.label || '';
      this._inputValue = label;
      this._cursorPosition = label.length;
      this.props.value = label;
    }
    // Call parent to set selectedValue and scroll
    super.setValue(value);
  }

  // Focus behavior: when open, stay on input for typing
  protected override _onOpen(): void {
    super._onOpen();
    // Keep focus on input, but also reset filter if needed
  }

  // Interactive interface
  isInteractive(): boolean {
    return !this.props.disabled;
  }

  // Capture all clicks - don't let children (options) receive clicks
  capturesFocusForChildren(): boolean {
    return true;
  }
}

// Register the combobox component
registerComponent({
  type: 'combobox',
  componentClass: ComboboxElement,
  defaultProps: {
    open: false,
    filter: 'fuzzy',
    maxVisible: 8,
    showClearButton: true,
    disabled: false,
    tabIndex: 0,
  },
});

// Lint schema for combobox
export const comboboxSchema: ComponentSchema = {
  description: 'Dropdown with text filtering for selecting from a list of options',
  props: {
    value: { type: 'string', description: 'Current filter/input text' },
    selectedValue: { type: 'string', description: 'Currently selected option value' },
    placeholder: { type: 'string', description: 'Placeholder text when empty' },
    open: { type: 'boolean', description: 'Whether dropdown is open' },
    filter: { type: 'string', enum: ['fuzzy', 'prefix', 'contains', 'exact', 'none'], description: 'Filter algorithm' },
    maxVisible: { type: 'number', description: 'Maximum visible options in dropdown' },
    options: { type: 'array', description: 'Data-driven options (alternative to children)' },
    allowFreeText: { type: 'boolean', description: 'Allow submitting values not in list' },
    dropdownWidth: { type: 'number', description: 'Override dropdown width' },
    width: { type: ['number', 'string'], description: 'Width of the combobox input (number, "50%", or "fill")' },
    showClearButton: { type: 'boolean', description: 'Show clear button' },
    onChange: { type: 'handler', description: 'Called when option is selected (preferred). Event: { value, label, option?, freeform?, targetId }' },
    onSelect: { type: 'handler', description: 'Called when option is selected (deprecated: use onChange)' },
    onFilterChange: { type: 'function', description: 'Called when filter text changes' },
    onOpenChange: { type: 'function', description: 'Called when dropdown opens/closes' },
  },
};

registerComponentSchema('combobox', comboboxSchema);
