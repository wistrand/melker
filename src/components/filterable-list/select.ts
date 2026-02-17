// Select component - Dropdown picker without text filtering
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
import { FilterableListCore, FilterableListCoreProps, OptionData, FilteredOptionData } from './core.ts';
import { getLogger } from '../../logging.ts';
import { parseDimension } from '../../utils/dimensions.ts';

const logger = getLogger('select');

export interface SelectProps extends FilterableListCoreProps {
  /** Override dropdown width (default: same as trigger) */
  dropdownWidth?: number;
  /** Width of the select trigger (number, "50%", or "fill") */
  width?: number | string;
}

/**
 * SelectElement - Dropdown picker without text filtering.
 *
 * Features:
 * - Simple trigger button showing selected value
 * - Keyboard navigation (arrows, Enter, Escape, Space)
 * - Mouse click selection
 * - Scrollable dropdown for long lists
 *
 * Usage:
 * ```xml
 * <select placeholder="Choose..." onChange="$app.setValue(event.value)">
 *   <option value="a">Option A</option>
 *   <option value="b">Option B</option>
 *   <group label="More Options">
 *     <option value="c">Option C</option>
 *     <option value="d">Option D</option>
 *   </group>
 * </select>
 * ```
 */
export class SelectElement extends FilterableListCore implements Renderable, Focusable, Interactive, Clickable {
  declare type: 'select';
  declare props: SelectProps;

  /** Last rendered bounds for trigger */
  private _triggerBounds: Bounds | null = null;
  /** Last rendered bounds for dropdown */
  private _dropdownBounds: Bounds | null = null;
  /** Map of dropdown row Y position to option index (null = group header) */
  private _rowToOptionIndex: Map<number, number | null> = new Map();

  private static _autoIdCounter = 0;

  constructor(props: SelectProps = {}, children: Element[] = []) {
    const defaultProps: SelectProps = {
      filter: 'none', // No filtering for select
      maxVisible: 8,
      ...props,
    };

    // Auto-generate ID if not provided (needed for hit testing)
    if (!defaultProps.id) {
      defaultProps.id = `select-auto-${SelectElement._autoIdCounter++}`;
    }

    super('select', defaultProps, children);
  }

  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Trigger is always 1 row high
    // Respect explicit width from style or props (style takes precedence, props are fallback)
    const explicitWidth = (this.props.style as any)?.width ?? this.props.width;
    if (explicitWidth !== undefined) {
      // Use parseDimension to support "50%", "fill", etc.
      const width = parseDimension(explicitWidth, context.availableSpace.width, 10);
      return { width, height: 1 };
    }

    // Width based on placeholder, selected value, or options
    const placeholder = this.props.placeholder || '';
    const selectedOption = this.getSelectedOption();
    const selectedLabel = selectedOption?.label || '';

    // Find longest option label for width calculation
    let maxOptionWidth = 0;
    for (const option of this.getAllOptions()) {
      maxOptionWidth = Math.max(maxOptionWidth, option.label.length);
    }

    const minWidth = Math.max(placeholder.length, selectedLabel.length, maxOptionWidth, 10);

    return {
      width: minWidth + 4, // +4 for padding and dropdown indicator
      height: 1, // Just the trigger row (dropdown renders as overlay)
    };
  }

  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Store trigger bounds
    this._triggerBounds = { ...bounds, height: 1 };

    const isFocused = context.focusedElementId === this.id;

    // Render trigger button
    this._renderTrigger(bounds, style, buffer, isFocused);

    // Register dropdown as overlay if open
    if (this.props.open && context.registerOverlay) {
      const options = this.getAllOptions();
      if (options.length > 0) {
        // Calculate total rows needed (options + group headers)
        const { start, end } = this.getVisibleRange();
        let totalRows = 0;
        let currentGroup: string | undefined = undefined;

        for (let i = start; i < end && i < options.length; i++) {
          const option = options[i];
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
        // Dropdown can be wider than trigger to fit content
        const minDropdownWidth = bounds.width;
        const contentWidth = this._getMaxOptionWidth() + 4; // +4 for borders and padding
        const dropdownWidth = this.props.dropdownWidth || Math.max(minDropdownWidth, contentWidth);

        const dropdownBounds: Bounds = {
          x: bounds.x,
          y: bounds.y + 1, // Position below trigger
          width: dropdownWidth,
          height: dropdownHeight,
        };

        // Store dropdown bounds for click handling
        this._dropdownBounds = dropdownBounds;

        // Register the dropdown overlay
        const overlay: Overlay = {
          id: `${this.id}-dropdown`,
          zIndex: 100,
          bounds: dropdownBounds,
          render: (buf: DualBuffer, overlayBounds: Bounds, overlayStyle: Partial<Cell>) => {
            this._renderDropdownContent(overlayBounds, style, buf, context, isFocused);
          },
          hitTestBounds: dropdownBounds,
          onClick: (x: number, y: number) => {
            return this._handleDropdownClick(x, y);
          },
          onClickOutside: () => {
            this.close();
          },
          excludeBounds: [this._triggerBounds!],
        };

        context.registerOverlay(overlay);
      } else {
        // Show "no options" as overlay
        const dropdownBounds: Bounds = {
          x: bounds.x,
          y: bounds.y + 1,
          width: bounds.width,
          height: 3,
        };

        this._dropdownBounds = dropdownBounds;

        const overlay: Overlay = {
          id: `${this.id}-dropdown`,
          zIndex: 100,
          bounds: dropdownBounds,
          render: (buf: DualBuffer, overlayBounds: Bounds, overlayStyle: Partial<Cell>) => {
            this._renderNoOptions(bounds, style, buf);
          },
          onClickOutside: () => {
            this.close();
          },
          excludeBounds: [this._triggerBounds!],
        };

        context.registerOverlay(overlay);
      }
    } else if (this.props.open) {
      // Fallback: render directly if no overlay system available
      this._renderDropdown(bounds, style, buffer, context, isFocused);
    }
  }

  private _renderTrigger(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, isFocused: boolean): void {
    const selectedOption = this.getSelectedOption();
    const displayText = selectedOption?.label || this.props.placeholder || '';
    const isPlaceholder = !selectedOption;

    // Trigger styling
    const triggerStyle: Partial<Cell> = {
      ...style,
      background: isFocused ? getThemeColor('focusBackground') || getThemeColor('inputBackground') : getThemeColor('inputBackground'),
      foreground: isPlaceholder ? getThemeColor('textMuted') : getThemeColor('textPrimary'),
    };

    // Clear trigger area
    const triggerWidth = bounds.width;
    for (let x = 0; x < triggerWidth; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, bounds.y, {
        char: EMPTY_CHAR,
        background: triggerStyle.background,
        foreground: triggerStyle.foreground,
      });
    }

    // Render display text (truncate if needed)
    const maxTextWidth = triggerWidth - 3; // Reserve space for indicator
    const truncatedText = displayText.length > maxTextWidth
      ? displayText.substring(0, maxTextWidth - 1) + '~'
      : displayText;

    buffer.currentBuffer.setText(bounds.x + 1, bounds.y, truncatedText, triggerStyle);

    // Render dropdown indicator
    const indicator = this.props.open ? '^' : 'v';
    buffer.currentBuffer.setCell(bounds.x + triggerWidth - 2, bounds.y, {
      char: indicator,
      background: triggerStyle.background,
      foreground: getThemeColor('textMuted'),
    });

    // Show focus cursor at start of text
    if (isFocused && !this.props.open) {
      buffer.currentBuffer.setCell(bounds.x + 1, bounds.y, {
        char: truncatedText[0] || ' ',
        foreground: triggerStyle.foreground,
        background: triggerStyle.background,
        reverse: true,
      });
    }
  }

  private _renderDropdown(
    triggerBounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext,
    isFocused: boolean
  ): void {
    const options = this.getAllOptions();
    if (options.length === 0) {
      this._renderNoOptions(triggerBounds, style, buffer);
      return;
    }

    // Clear row mapping
    this._rowToOptionIndex.clear();

    // Calculate total rows needed
    const { start, end } = this.getVisibleRange();
    let totalRows = 0;
    let currentGroup: string | undefined = undefined;

    for (let i = start; i < end && i < options.length; i++) {
      const option = options[i];
      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup) {
          totalRows++;
        }
      }
      totalRows++;
    }

    const maxVisible = this.props.maxVisible || 8;
    const dropdownHeight = Math.min(totalRows, maxVisible) + 2;
    // Dropdown can be wider than trigger to fit content
    const minDropdownWidth = triggerBounds.width;
    const contentWidth = this._getMaxOptionWidth() + 4; // +4 for borders and padding
    const dropdownWidth = this.props.dropdownWidth || Math.max(minDropdownWidth, contentWidth);

    const dropdownBounds: Bounds = {
      x: triggerBounds.x,
      y: triggerBounds.y + 1,
      width: dropdownWidth,
      height: dropdownHeight,
    };

    this._dropdownBounds = dropdownBounds;

    const dropdownStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textPrimary'),
    };

    this._drawDropdownBorder(dropdownBounds, dropdownStyle, buffer);

    let y = dropdownBounds.y + 1;
    currentGroup = undefined;
    const maxY = dropdownBounds.y + dropdownBounds.height - 1;

    for (let i = start; i < end && i < options.length && y < maxY; i++) {
      const option = options[i];

      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup && y < maxY) {
          this._renderGroupHeader(dropdownBounds.x + 1, y, dropdownBounds.width - 2, currentGroup, dropdownStyle, buffer);
          this._rowToOptionIndex.set(y, null);
          y++;
          if (y >= maxY) break;
        }
      }

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
      this._rowToOptionIndex.set(y, i);
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

  private _renderDropdownContent(
    dropdownBounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext,
    isFocused: boolean
  ): void {
    const options = this.getAllOptions();
    if (options.length === 0) return;

    this._rowToOptionIndex.clear();

    const dropdownStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textPrimary'),
    };

    this._drawDropdownBorder(dropdownBounds, dropdownStyle, buffer);

    const { start, end } = this.getVisibleRange();
    let y = dropdownBounds.y + 1;
    let currentGroup: string | undefined = undefined;
    const maxY = dropdownBounds.y + dropdownBounds.height - 1;

    for (let i = start; i < end && i < options.length && y < maxY; i++) {
      const option = options[i];

      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup && y < maxY) {
          this._renderGroupHeader(dropdownBounds.x + 1, y, dropdownBounds.width - 2, currentGroup, dropdownStyle, buffer);
          this._rowToOptionIndex.set(y, null);
          y++;
          if (y >= maxY) break;
        }
      }

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
      this._rowToOptionIndex.set(y, i);
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
  private _getMaxOptionWidth(): number {
    let maxWidth = 0;
    for (const option of this.getAllOptions()) {
      const label = option.label || '';
      maxWidth = Math.max(maxWidth, label.length);
    }
    return maxWidth;
  }

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

    const optionIndex = this._rowToOptionIndex.get(y);

    if (optionIndex !== undefined && optionIndex !== null) {
      const options = this.getAllOptions();
      if (optionIndex >= 0 && optionIndex < options.length) {
        const option = options[optionIndex];
        if (!option.disabled) {
          this.selectOptionByIndex(optionIndex);
          return true;
        }
      }
    }
    return true; // Consume click even for group headers
  }

  private _renderNoOptions(triggerBounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const dropdownBounds: Bounds = {
      x: triggerBounds.x,
      y: triggerBounds.y + 1,
      width: triggerBounds.width,
      height: 3,
    };

    this._dropdownBounds = dropdownBounds;

    const dropdownStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('surface'),
      foreground: getThemeColor('textMuted'),
    };

    this._drawDropdownBorder(dropdownBounds, dropdownStyle, buffer);

    const message = 'No options';
    const x = dropdownBounds.x + Math.floor((dropdownBounds.width - message.length) / 2);
    buffer.currentBuffer.setText(x, dropdownBounds.y + 1, message, dropdownStyle);
  }

  private _drawDropdownBorder(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const chars = getBorderChars('thin');
    const borderColor = getThemeColor('border');
    const borderStyle: Partial<Cell> = {
      foreground: borderColor,
      background: style.background,
    };

    // Top border
    buffer.currentBuffer.setCell(bounds.x, bounds.y, { char: chars.tl, ...borderStyle });
    for (let x = 1; x < bounds.width - 1; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, bounds.y, { char: chars.h, ...borderStyle });
    }
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y, { char: chars.tr, ...borderStyle });

    // Side borders and fill
    for (let y = 1; y < bounds.height - 1; y++) {
      buffer.currentBuffer.setCell(bounds.x, bounds.y + y, { char: chars.v, ...borderStyle });
      for (let x = 1; x < bounds.width - 1; x++) {
        buffer.currentBuffer.setCell(bounds.x + x, bounds.y + y, { char: EMPTY_CHAR, background: style.background });
      }
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + y, { char: chars.v, ...borderStyle });
    }

    // Bottom border
    buffer.currentBuffer.setCell(bounds.x, bounds.y + bounds.height - 1, { char: chars.bl, ...borderStyle });
    for (let x = 1; x < bounds.width - 1; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, bounds.y + bounds.height - 1, { char: chars.h, ...borderStyle });
    }
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, { char: chars.br, ...borderStyle });
  }

  private _renderGroupHeader(x: number, y: number, width: number, label: string, style: Partial<Cell>, buffer: DualBuffer): void {
    const headerStyle: Partial<Cell> = {
      ...style,
      foreground: getThemeColor('textSecondary') || getThemeColor('textMuted'),
      bold: true,
    };

    // Clear line
    buffer.currentBuffer.fillLine(x, y, width, { background: style.background });

    // Render label
    const truncatedLabel = label.length > width ? label.substring(0, width - 1) + '~' : label;
    buffer.currentBuffer.setText(x, y, truncatedLabel, headerStyle);
  }

  private _renderOption(
    x: number,
    y: number,
    width: number,
    option: OptionData,
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

    // Clear line with full style (including reverse for focused)
    buffer.currentBuffer.fillLine(x, y, width, optionStyle);

    // Render label
    const truncatedLabel = option.label.length > width ? option.label.substring(0, width - 1) + '~' : option.label;
    buffer.currentBuffer.setText(x, y, truncatedLabel, optionStyle);
  }

  // Get currently selected option
  override getSelectedOption(): OptionData | null {
    const selectedValue = this.props.selectedValue;
    if (!selectedValue) return null;

    const options = this.getAllOptions();
    return options.find(o => o.id === selectedValue) || null;
  }

  // Select option by index (for select, we use getAllOptions not filtered)
  selectOptionByIndex(index: number): void {
    const options = this.getAllOptions();
    if (index >= 0 && index < options.length) {
      const option = options[index];
      if (!option.disabled) {
        // Update selected value
        this.props.selectedValue = option.id;

        // Fire onChange/onSelect callback
        const event = {
          type: 'select' as const,
          value: option.id,
          label: option.label,
          option: option,
          targetId: this.id,
        };
        if (this.props.onChange) {
          this.props.onChange(event);
        }
        if (this.props.onSelect) {
          this.props.onSelect(event);
        }

        // Close dropdown
        this.close();
      }
    }
  }

  // Override getFilteredOptions to return all options (no filtering for select)
  override getFilteredOptions(): FilteredOptionData[] {
    // For select, return all options without filtering
    return this.getAllOptions().map(opt => ({
      ...opt,
      match: { matched: true, score: 1, matchIndices: [] },
    }));
  }

  // Override getFilteredCount
  override getFilteredCount(): number {
    return this.getAllOptions().length;
  }

  // Keyboard handling
  onKeyPress(event: KeyPressEvent): boolean {
    const { key } = event;

    // Handle Space to toggle dropdown (in addition to Enter)
    if (key === ' ' && !this.props.open) {
      this.open();
      return true;
    }

    // Use parent's handleKeyPress for standard navigation
    return this.handleKeyPress(event);
  }

  // Click handling - toggle dropdown on any click (hit testing already confirmed click is on this element)
  handleClick(_event: ClickEvent): boolean {
    if (this.props.disabled) return false;

    // Toggle dropdown
    if (this.props.open) {
      this.close();
    } else {
      this.open();
    }
    return true;
  }

  // Focusable interface
  override canReceiveFocus(): boolean {
    return this.props.disabled !== true;
  }

  // Capture all clicks - don't let children (options) receive clicks
  capturesFocusForChildren(): boolean {
    return true;
  }

  // Interactive interface
  isInteractive(): boolean {
    return this.props.disabled !== true;
  }
}

// Register the select component
registerComponent({
  type: 'select',
  componentClass: SelectElement,
  defaultProps: {
    filter: 'none',
    maxVisible: 8,
    open: false,
  },
});

// Lint schema for select component
export const selectSchema: ComponentSchema = {
  description: 'Dropdown picker for selecting from a list of options',
  props: {
    placeholder: { type: 'string', description: 'Placeholder text when no option is selected' },
    selectedValue: { type: 'string', description: 'Currently selected option value' },
    open: { type: 'boolean', description: 'Whether dropdown is open' },
    disabled: { type: 'boolean', description: 'Whether select is disabled' },
    maxVisible: { type: 'number', description: 'Maximum visible options in dropdown' },
    dropdownWidth: { type: 'number', description: 'Override dropdown width' },
    width: { type: ['number', 'string'], description: 'Width of the select trigger (number, "50%", or "fill")' },
    onChange: { type: 'handler', description: 'Called when option is selected (preferred). Event: { value, label, option, targetId }' },
    onSelect: { type: 'handler', description: 'Called when option is selected (deprecated: use onChange)' },
  },
};

registerComponentSchema('select', selectSchema);
