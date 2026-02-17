// Command Palette component - Modal command picker with keyboard shortcuts
import {
  Element,
  BaseProps,
  Renderable,
  Focusable,
  Interactive,
  Bounds,
  ComponentRenderContext,
  IntrinsicSizeContext,
  type Overlay,
  BORDER_CHARS,
  getBorderChars,
} from '../../types.ts';
import { type DualBuffer, type Cell, EMPTY_CHAR } from '../../buffer.ts';
import type { KeyPressEvent } from '../../events.ts';
import { getThemeColor } from '../../theme.ts';
import { registerComponent } from '../../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../../lint.ts';
import { FilterableListCore, FilterableListCoreProps, FilteredOptionData } from './core.ts';
import { getLogger } from '../../logging.ts';

const logger = getLogger('command-palette');

export interface CommandPaletteProps extends FilterableListCoreProps {
  /** Title shown in the palette header */
  title?: string;
  /** Width of the palette (default: 60 or 80% of viewport) */
  width?: number;
  /** Maximum height of the palette */
  maxHeight?: number;
  /** Keyboard shortcut to open (default: Ctrl+Shift+P) */
  shortcut?: string;
}

/**
 * CommandPaletteElement - Modal command picker with keyboard shortcuts.
 *
 * Features:
 * - Modal overlay with search input
 * - Fuzzy filtering of commands
 * - Displays keyboard shortcuts for options
 * - Opens with configurable keyboard shortcut
 * - Keyboard navigation (arrows, Enter, Escape)
 *
 * Usage:
 * ```xml
 * <command-palette title="Command Palette" onSelect="$app.runCommand(event.value)">
 *   <group label="File">
 *     <option value="file.new" shortcut="Ctrl+N">New File</option>
 *     <option value="file.open" shortcut="Ctrl+O">Open File</option>
 *     <option value="file.save" shortcut="Ctrl+S">Save</option>
 *   </group>
 *   <group label="Edit">
 *     <option value="edit.undo" shortcut="Ctrl+Z">Undo</option>
 *     <option value="edit.redo" shortcut="Ctrl+Y">Redo</option>
 *   </group>
 * </command-palette>
 * ```
 */
export class CommandPaletteElement extends FilterableListCore implements Renderable, Focusable, Interactive {
  declare type: 'command-palette';
  declare props: CommandPaletteProps;

  /** Internal input value for filtering */
  private _inputValue: string = '';
  /** Cursor position in input */
  private _cursorPosition: number = 0;
  /** Stored viewport for rendering */
  private _viewport: Bounds | null = null;
  /** Map of row Y position to option index */
  private _rowToOptionIndex: Map<number, number | null> = new Map();

  // Drag state
  private _isDragging = false;
  private _dragStartX = 0;
  private _dragStartY = 0;
  private _dragStartOffsetX = 0;
  private _dragStartOffsetY = 0;
  private _dragOffsetX = 0;
  private _dragOffsetY = 0;
  /** Anchored top-left position set on first render after open (prevents re-centering) */
  private _anchoredX: number | null = null;
  private _anchoredY: number | null = null;
  private _anchoredWidth: number | null = null;
  /** Last calculated palette bounds (for title bar hit testing) */
  private _lastPaletteBounds: Bounds | null = null;

  constructor(props: CommandPaletteProps = {}, children: Element[] = []) {
    const defaultProps: CommandPaletteProps = {
      title: 'Command Palette',
      filter: 'fuzzy',
      maxVisible: 10,
      ...props,
    };

    super('command-palette', defaultProps, children);
  }

  // ── Drag support ──────────────────────────────────────────────────────

  /**
   * Check if a point is on the title bar (top border row where title is rendered).
   */
  isOnTitleBar(x: number, y: number): boolean {
    if (!this._lastPaletteBounds || !this.props.open) return false;
    const b = this._lastPaletteBounds;
    // Title is on the top border row (y === b.y), spanning between side borders
    return y === b.y && x > b.x && x < b.x + b.width - 1;
  }

  /**
   * Start dragging the palette.
   */
  startDrag(mouseX: number, mouseY: number): void {
    this._isDragging = true;
    this._dragStartX = mouseX;
    this._dragStartY = mouseY;
    this._dragStartOffsetX = this._dragOffsetX;
    this._dragStartOffsetY = this._dragOffsetY;
  }

  /**
   * Update drag position. Returns true if position changed.
   */
  updateDrag(mouseX: number, mouseY: number): boolean {
    if (!this._isDragging || !this._viewport) return false;

    const deltaX = mouseX - this._dragStartX;
    const deltaY = mouseY - this._dragStartY;

    let newOffsetX = this._dragStartOffsetX + deltaX;
    let newOffsetY = this._dragStartOffsetY + deltaY;

    // Constrain to viewport (keep title bar visible)
    if (this._anchoredX !== null && this._anchoredY !== null && this._viewport) {
      const vp = this._viewport;
      const pw = this._lastPaletteBounds?.width || 60;

      // Anchored position is the base; offset moves from there
      // Keep at least 4 chars visible horizontally, title bar visible vertically
      const minX = vp.x - this._anchoredX + 2;
      const maxX = vp.x + vp.width - this._anchoredX - 4;
      const minY = vp.y - this._anchoredY;
      const maxY = vp.y + vp.height - this._anchoredY - 1;

      newOffsetX = Math.max(minX, Math.min(maxX, newOffsetX));
      newOffsetY = Math.max(minY, Math.min(maxY, newOffsetY));
    }

    this._dragOffsetX = newOffsetX;
    this._dragOffsetY = newOffsetY;
    return true;
  }

  /**
   * End dragging.
   */
  endDrag(): void {
    this._isDragging = false;
  }

  /**
   * Check if currently dragging.
   */
  isDragging(): boolean {
    return this._isDragging;
  }

  /**
   * Override to account for group headers taking up rows
   */
  override getVisibleRange(): { start: number; end: number } {
    const maxRows = this.props.maxVisible || 10;
    const filtered = this.getFilteredOptions();
    const start = this._scrollTop;

    // Count how many options fit in maxRows, accounting for group headers
    let rowsUsed = 0;
    let currentGroup: string | undefined = undefined;
    let end = start;

    for (let i = start; i < filtered.length && rowsUsed < maxRows; i++) {
      const option = filtered[i];
      // Group header takes a row
      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup) {
          rowsUsed++;
          if (rowsUsed >= maxRows) break;
        }
      }
      // Option takes a row
      rowsUsed++;
      end = i + 1;
    }

    return { start, end };
  }

  /**
   * Override to properly calculate scroll limits with group headers
   */
  protected override _ensureFocusedVisible(): void {
    const filtered = this.getFilteredOptions();
    const maxRows = this.props.maxVisible || 10;

    // Calculate how many options fit from current scroll position
    const { end } = this.getVisibleRange();
    const visibleCount = end - this._scrollTop;

    if (this._focusedIndex < this._scrollTop) {
      this._scrollTop = this._focusedIndex;
    } else if (this._focusedIndex >= end) {
      // Need to scroll down - find scroll position that shows focused item
      // Work backwards from focused item to find proper scroll top
      let rowsNeeded = 1; // The focused item itself
      let currentGroup = filtered[this._focusedIndex]?.group;

      for (let i = this._focusedIndex - 1; i >= 0 && rowsNeeded < maxRows; i--) {
        const option = filtered[i];
        if (option.group !== currentGroup) {
          currentGroup = option.group;
          if (filtered[i + 1]?.group) rowsNeeded++; // Group header for next group
        }
        rowsNeeded++;
        if (rowsNeeded >= maxRows) {
          this._scrollTop = i + 1;
          break;
        }
      }
      if (rowsNeeded < maxRows) {
        this._scrollTop = 0;
      }
    }

    // Clamp scroll
    this._scrollTop = Math.max(0, this._scrollTop);
  }

  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Return minimal size to ensure render is called (needed to register overlay)
    // The actual modal content is rendered as an overlay and doesn't affect layout
    return { width: 1, height: 1 };
  }

  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Use viewport from context for modal positioning (element bounds may be 0x0)
    const viewport = context.viewport || bounds;
    this._viewport = viewport;

    // Sync value prop to input
    if (this.props.value !== undefined && this.props.value !== this._inputValue) {
      this._inputValue = this.props.value;
      this._cursorPosition = this._inputValue.length;
      this.invalidateFilterCache();
    }

    // Only render if open
    if (!this.props.open) return;

    // Register modal overlay
    if (context.registerOverlay) {
      const paletteWidth = this._anchoredWidth ?? (this.props.width || Math.min(60, Math.floor(viewport.width * 0.8)));
      const filtered = this.getFilteredOptions();
      const maxVisible = this.props.maxVisible || 10;

      // Calculate height: title(1) + border(1) + input(1) + separator(1) + options + border(1)
      let optionRows = 0;
      let currentGroup: string | undefined = undefined;
      const { start, end } = this.getVisibleRange();

      for (let i = start; i < end && i < filtered.length; i++) {
        const option = filtered[i];
        if (option.group !== currentGroup) {
          currentGroup = option.group;
          if (currentGroup) optionRows++;
        }
        optionRows++;
      }

      const contentHeight = Math.min(optionRows, maxVisible);
      const paletteHeight = 4 + contentHeight + 1; // title+border + input + separator + options + border

      // Anchor position on first render — subsequent renders reuse it so filtering
      // and drag don't fight with auto-centering
      if (this._anchoredX === null) {
        this._anchoredX = viewport.x + Math.floor((viewport.width - paletteWidth) / 2);
        this._anchoredY = viewport.y + Math.max(2, Math.floor((viewport.height - paletteHeight) / 3));
        this._anchoredWidth = paletteWidth;
      }

      const paletteX = this._anchoredX + this._dragOffsetX;
      const paletteY = this._anchoredY! + this._dragOffsetY;

      const paletteBounds: Bounds = {
        x: paletteX,
        y: paletteY,
        width: paletteWidth,
        height: paletteHeight,
      };

      // Store for title bar hit testing
      this._lastPaletteBounds = paletteBounds;

      const overlay: Overlay = {
        id: `${this.id}-modal`,
        zIndex: 200, // Higher than dropdowns
        bounds: paletteBounds,
        render: (buf: DualBuffer, overlayBounds: Bounds, overlayStyle: Partial<Cell>) => {
          this._renderPalette(overlayBounds, style, buf, context);
        },
        hitTestBounds: paletteBounds,
        onClick: (x: number, y: number) => {
          return this._handlePaletteClick(x, y, paletteBounds);
        },
        onClickOutside: () => {
          this.close();
        },
      };

      context.registerOverlay(overlay);
    }
  }

  private _renderPalette(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext
  ): void {
    const paletteStyle: Partial<Cell> = {
      background: getThemeColor('surface'),
      foreground: getThemeColor('textPrimary'),
    };

    // Draw backdrop (dim effect)
    this._renderBackdrop(buffer, this._viewport || bounds);

    // Draw palette frame
    this._drawFrame(bounds, paletteStyle, buffer);

    // Draw title
    const title = this.props.title || 'Command Palette';
    const titleX = bounds.x + Math.floor((bounds.width - title.length) / 2);
    buffer.currentBuffer.setText(titleX, bounds.y, title, {
      ...paletteStyle,
      bold: true,
    });

    // Draw input field
    const inputY = bounds.y + 1;
    this._renderInput(bounds.x + 1, inputY, bounds.width - 2, paletteStyle, buffer);

    // Draw separator with T-junctions
    const chars = getBorderChars('thin');
    const separatorY = bounds.y + 2;
    buffer.currentBuffer.setCell(bounds.x, separatorY, {
      char: chars.lm,
      foreground: getThemeColor('border'),
      background: paletteStyle.background,
    });
    for (let x = 1; x < bounds.width - 1; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, separatorY, {
        char: chars.h,
        foreground: getThemeColor('border'),
        background: paletteStyle.background,
      });
    }
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, separatorY, {
      char: chars.rm,
      foreground: getThemeColor('border'),
      background: paletteStyle.background,
    });

    // Draw options
    this._renderOptions(bounds, paletteStyle, buffer);
  }

  private _renderBackdrop(buffer: DualBuffer, viewport: Bounds): void {
    // Dim the background by setting a dark overlay color
    const backdropBg = getThemeColor('surface');

    for (let y = viewport.y; y < viewport.y + viewport.height; y++) {
      for (let x = viewport.x; x < viewport.x + viewport.width; x++) {
        const cell = buffer.currentBuffer.getCell(x, y);
        if (cell) {
          buffer.currentBuffer.setCell(x, y, {
            ...cell,
            background: backdropBg,
            foreground: getThemeColor('textMuted'),
          });
        }
      }
    }
  }

  private _drawFrame(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const chars = getBorderChars('thin');
    const borderColor = getThemeColor('border');
    const borderStyle: Partial<Cell> = {
      foreground: borderColor,
      background: style.background,
    };

    // Fill background
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        buffer.currentBuffer.setCell(bounds.x + x, bounds.y + y, {
          char: EMPTY_CHAR,
          background: style.background,
        });
      }
    }

    // Top border with title space
    buffer.currentBuffer.setCell(bounds.x, bounds.y, { char: chars.tl, ...borderStyle });
    for (let x = 1; x < bounds.width - 1; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, bounds.y, { char: chars.h, ...borderStyle });
    }
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y, { char: chars.tr, ...borderStyle });

    // Side borders
    for (let y = 1; y < bounds.height - 1; y++) {
      buffer.currentBuffer.setCell(bounds.x, bounds.y + y, { char: chars.v, ...borderStyle });
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + y, { char: chars.v, ...borderStyle });
    }

    // Bottom border
    buffer.currentBuffer.setCell(bounds.x, bounds.y + bounds.height - 1, { char: chars.bl, ...borderStyle });
    for (let x = 1; x < bounds.width - 1; x++) {
      buffer.currentBuffer.setCell(bounds.x + x, bounds.y + bounds.height - 1, { char: chars.h, ...borderStyle });
    }
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, { char: chars.br, ...borderStyle });
  }

  private _renderInput(x: number, y: number, width: number, style: Partial<Cell>, buffer: DualBuffer): void {
    const value = this._inputValue;
    const placeholder = this.props.placeholder || 'Type to search...';

    const inputStyle: Partial<Cell> = {
      ...style,
      background: getThemeColor('inputBackground'),
      foreground: value ? getThemeColor('textPrimary') : getThemeColor('textMuted'),
    };

    // Clear input area
    buffer.currentBuffer.fillLine(x, y, width, { background: inputStyle.background });

    // Render text or placeholder
    const displayText = value || placeholder;
    const maxTextWidth = width - 1;
    const truncatedText = displayText.length > maxTextWidth
      ? displayText.substring(0, maxTextWidth - 1) + '~'
      : displayText;

    buffer.currentBuffer.setText(x, y, truncatedText, inputStyle);

    // Render cursor
    const cursorX = Math.min(this._cursorPosition, width - 1);
    const cursorChar = value[this._cursorPosition] || (value ? ' ' : placeholder[0] || ' ');
    buffer.currentBuffer.setCell(x + cursorX, y, {
      char: cursorChar,
      foreground: inputStyle.foreground,
      background: inputStyle.background,
      reverse: true,
    });
  }

  private _renderOptions(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const filtered = this.getFilteredOptions();
    this._rowToOptionIndex.clear();

    if (filtered.length === 0) {
      // No results message
      const message = 'No matching commands';
      const msgX = bounds.x + Math.floor((bounds.width - message.length) / 2);
      buffer.currentBuffer.setText(msgX, bounds.y + 3, message, {
        ...style,
        foreground: getThemeColor('textMuted'),
      });
      return;
    }

    const { start, end } = this.getVisibleRange();
    let y = bounds.y + 3; // After title, input, separator
    let currentGroup: string | undefined = undefined;
    const maxY = bounds.y + bounds.height - 1; // Before bottom border
    const contentWidth = bounds.width - 2;

    for (let i = start; i < end && i < filtered.length && y < maxY; i++) {
      const option = filtered[i];

      // Render group header if changed
      if (option.group !== currentGroup) {
        currentGroup = option.group;
        if (currentGroup && y < maxY) {
          this._renderGroupHeader(bounds.x + 1, y, contentWidth, currentGroup, style, buffer);
          this._rowToOptionIndex.set(y, null);
          y++;
          if (y >= maxY) break;
        }
      }

      // Render option with shortcut (indent if in a group)
      const isFocused = i === this.getFocusedIndex();
      const indent = option.group ? 1 : 0;
      this._renderOption(bounds.x + 1 + indent, y, contentWidth - indent, option, isFocused, style, buffer);
      this._rowToOptionIndex.set(y, i);
      y++;
    }

    // Render scrollbar (overwrites right border)
    if (this.hasScroll()) {
      const scrollbarX = bounds.x + bounds.width - 1;
      const scrollbarY = bounds.y + 3; // After title, input, separator
      const scrollbarHeight = bounds.height - 4; // Minus borders and header
      this._renderScrollbar(buffer, scrollbarX, scrollbarY, scrollbarHeight, style);
    }
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

    // Clear line with full style (including reverse for focused)
    buffer.currentBuffer.fillLine(x, y, width, optionStyle);

    // Calculate space for shortcut (1 char right padding)
    const shortcut = option.shortcut || '';
    const shortcutWidth = shortcut.length;
    const labelWidth = width - shortcutWidth - (shortcut ? 3 : 0); // 2 for spacing + 1 for right padding

    // Render label (with match highlighting via bold)
    let label = option.label;
    if (label.length > labelWidth) {
      label = label.substring(0, labelWidth - 1) + '~';
    }

    // Render label with match highlighting (bold for matches)
    for (let i = 0; i < label.length; i++) {
      const isMatchChar = option.match.matchIndices.includes(i);
      buffer.currentBuffer.setCell(x + i, y, {
        ...optionStyle,
        char: label[i],
        bold: isMatchChar,
      });
    }

    // Render shortcut (right-aligned with 1 char padding, dimmed unless focused)
    if (shortcut) {
      const shortcutX = x + width - shortcutWidth - 1;
      const shortcutStyle: Partial<Cell> = isFocused
        ? optionStyle
        : { ...style, foreground: getThemeColor('textMuted') };
      buffer.currentBuffer.setText(shortcutX, y, shortcut, shortcutStyle);
    }
  }

  private _handlePaletteClick(x: number, y: number, bounds: Bounds): boolean {
    // Check if click is on an option
    const optionIndex = this._rowToOptionIndex.get(y);

    if (optionIndex !== undefined && optionIndex !== null) {
      const filtered = this.getFilteredOptions();
      if (optionIndex >= 0 && optionIndex < filtered.length) {
        const option = filtered[optionIndex];
        if (!option.disabled) {
          this.selectOption(option);
          return true;
        }
      }
    }

    return true; // Consume click
  }

  // Override to clear input on close and reset position state
  override close(): void {
    super.close();
    this._inputValue = '';
    this._cursorPosition = 0;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._isDragging = false;
    this._anchoredX = null;
    this._anchoredY = null;
    this._anchoredWidth = null;
    this._lastPaletteBounds = null;
    this.invalidateFilterCache();
  }

  // Override to reset filter on open and reset position state
  override open(): void {
    super.open();
    this._inputValue = '';
    this._cursorPosition = 0;
    this._dragOffsetX = 0;
    this._dragOffsetY = 0;
    this._anchoredX = null;
    this._anchoredY = null;
    this._anchoredWidth = null;
    this._lastPaletteBounds = null;
    this.invalidateFilterCache();
  }

  // Sync internal input value to props.value for filtering
  private _syncFilterValue(): void {
    this.props.value = this._inputValue;
  }

  // Keyboard handling
  onKeyPress(event: KeyPressEvent): boolean {
    const { key, ctrlKey, altKey } = event;

    // Handle text input when open
    if (this.props.open) {
      // First try navigation keys
      if (this.handleKeyPress(event)) {
        return true;
      }

      // Then handle text input
      return this.handleKeyInput(key, ctrlKey, altKey);
    }

    return false;
  }

  // Text input handling
  handleKeyInput(key: string, ctrlKey: boolean, altKey: boolean): boolean {
    if (!this.props.open) return false;

    // Backspace
    if (key === 'Backspace') {
      if (this._cursorPosition > 0) {
        this._inputValue = this._inputValue.slice(0, this._cursorPosition - 1) + this._inputValue.slice(this._cursorPosition);
        this._cursorPosition--;
        this._syncFilterValue();
        this.invalidateFilterCache();
        return true;
      }
      return false;
    }

    // Delete
    if (key === 'Delete') {
      if (this._cursorPosition < this._inputValue.length) {
        this._inputValue = this._inputValue.slice(0, this._cursorPosition) + this._inputValue.slice(this._cursorPosition + 1);
        this._syncFilterValue();
        this.invalidateFilterCache();
        return true;
      }
      return false;
    }

    // Cursor movement
    if (key === 'ArrowLeft' && !ctrlKey) {
      if (this._cursorPosition > 0) {
        this._cursorPosition--;
        return true;
      }
      return false;
    }

    if (key === 'ArrowRight' && !ctrlKey) {
      if (this._cursorPosition < this._inputValue.length) {
        this._cursorPosition++;
        return true;
      }
      return false;
    }

    // Home/End
    if (key === 'Home') {
      this._cursorPosition = 0;
      return true;
    }

    if (key === 'End') {
      this._cursorPosition = this._inputValue.length;
      return true;
    }

    // Ctrl+A - select all (just move to end for now)
    if (ctrlKey && key === 'a') {
      this._cursorPosition = this._inputValue.length;
      return true;
    }

    // Regular character input
    if (key.length === 1 && !ctrlKey && !altKey) {
      this._inputValue = this._inputValue.slice(0, this._cursorPosition) + key + this._inputValue.slice(this._cursorPosition);
      this._cursorPosition++;
      this._syncFilterValue();
      this.invalidateFilterCache();
      return true;
    }

    return false;
  }

  // Focusable interface
  override canReceiveFocus(): boolean {
    // Focusable when open to receive keyboard events
    return this.props.open === true;
  }

  // Interactive interface
  isInteractive(): boolean {
    return true;
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

  // Toggle the palette
  override toggle(): void {
    if (this.props.open) {
      this.close();
    } else {
      this.open();
    }
  }
}

// Register the command-palette component
registerComponent({
  type: 'command-palette',
  componentClass: CommandPaletteElement,
  defaultProps: {
    filter: 'fuzzy',
    maxVisible: 10,
    open: false,
    title: 'Command Palette',
  },
});

// Lint schema for command-palette component
export const commandPaletteSchema: ComponentSchema = {
  description: 'Modal command picker with search and keyboard shortcuts',
  props: {
    title: { type: 'string', description: 'Title shown in palette header' },
    placeholder: { type: 'string', description: 'Placeholder text in search input' },
    open: { type: 'boolean', description: 'Whether palette is open' },
    maxVisible: { type: 'number', description: 'Maximum visible options' },
    width: { type: 'number', description: 'Width of the palette' },
    maxHeight: { type: 'number', description: 'Maximum height of the palette' },
    shortcut: { type: 'string', description: 'Keyboard shortcut to open (e.g., "Ctrl+Shift+P")' },
    onChange: { type: 'handler', description: 'Called when command is selected (preferred). Event: { value, label, option?, targetId }' },
    onSelect: { type: 'handler', description: 'Called when command is selected (deprecated: use onChange)' },
  },
};

registerComponentSchema('command-palette', commandPaletteSchema);
