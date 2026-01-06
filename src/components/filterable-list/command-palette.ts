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
} from '../../types.ts';
import type { DualBuffer, Cell } from '../../buffer.ts';
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

  constructor(props: CommandPaletteProps = {}, children: Element[] = []) {
    const defaultProps: CommandPaletteProps = {
      title: 'Command Palette',
      filter: 'fuzzy',
      maxVisible: 10,
      ...props,
    };

    super('command-palette', defaultProps, children);
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
      const paletteWidth = this.props.width || Math.min(60, Math.floor(viewport.width * 0.8));
      const filtered = this.getFilteredOptions();
      const maxVisible = this.props.maxVisible || 10;
      const visibleCount = Math.min(filtered.length, maxVisible);

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

      // Center the palette in the viewport
      const paletteX = viewport.x + Math.floor((viewport.width - paletteWidth) / 2);
      const paletteY = viewport.y + Math.max(2, Math.floor((viewport.height - paletteHeight) / 3)); // Slightly above center

      const paletteBounds: Bounds = {
        x: paletteX,
        y: paletteY,
        width: paletteWidth,
        height: paletteHeight,
      };

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
    const chars = BORDER_CHARS.thin;
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
    const chars = BORDER_CHARS.thin;
    const borderColor = getThemeColor('border');
    const borderStyle: Partial<Cell> = {
      foreground: borderColor,
      background: style.background,
    };

    // Fill background
    for (let y = 0; y < bounds.height; y++) {
      for (let x = 0; x < bounds.width; x++) {
        buffer.currentBuffer.setCell(bounds.x + x, bounds.y + y, {
          char: ' ',
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
    for (let i = 0; i < width; i++) {
      buffer.currentBuffer.setCell(x + i, y, { char: ' ', background: inputStyle.background });
    }

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

      // Render option with shortcut
      const isFocused = i === this.getFocusedIndex();
      this._renderOption(bounds.x + 1, y, contentWidth, option, isFocused, style, buffer);
      this._rowToOptionIndex.set(y, i);
      y++;
    }

    // Render scrollbar
    if (this.hasScroll()) {
      const scrollbarX = bounds.x + bounds.width - 2;
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
    for (let i = 0; i < width; i++) {
      buffer.currentBuffer.setCell(x + i, y, { char: ' ', background: style.background });
    }

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
    for (let i = 0; i < width; i++) {
      buffer.currentBuffer.setCell(x + i, y, { ...optionStyle, char: ' ' });
    }

    // Calculate space for shortcut
    const shortcut = option.shortcut || '';
    const shortcutWidth = shortcut.length;
    const labelWidth = width - shortcutWidth - (shortcut ? 2 : 0); // 2 for spacing

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

    // Render shortcut (right-aligned, dimmed unless focused)
    if (shortcut) {
      const shortcutX = x + width - shortcutWidth;
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

  // Override to clear input on close
  override close(): void {
    super.close();
    this._inputValue = '';
    this._cursorPosition = 0;
    this.invalidateFilterCache();
  }

  // Override to reset filter on open
  override open(): void {
    super.open();
    this._inputValue = '';
    this._cursorPosition = 0;
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
    onSelect: { type: 'function', description: 'Callback when command is selected' },
  },
};

registerComponentSchema('command-palette', commandPaletteSchema);
