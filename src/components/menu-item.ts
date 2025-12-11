// MenuItem component implementation

import { Element, BaseProps, Renderable, Focusable, Bounds, ComponentRenderContext, IntrinsicSizeContext, ClickEvent } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { getThemeColor } from '../theme.ts';

export interface MenuItemProps extends BaseProps {
  title: string;
  shortcut?: string;          // "Ctrl+S", "F1", etc.
  icon?: string;              // Unicode icon character
  disabled?: boolean;
  checked?: boolean;          // For checkbox/radio items
  separator?: boolean;        // If true, renders as separator
  submenu?: Element;          // Reference to submenu element
  onClick?: (event: ClickEvent) => void;
}

export class MenuItemElement extends Element implements Renderable, Focusable {
  declare type: 'menu-item';
  declare props: MenuItemProps;

  constructor(props: MenuItemProps, children: Element[] = []) {
    const defaultProps: MenuItemProps = {
      disabled: false,
      checked: false,
      separator: false,
      tabIndex: 0,
      ...props,
      title: props.title || '',
      style: {
        // Default menu item styles
        ...props.style
      },
    };

    super('menu-item', defaultProps, children);
  }

  /**
   * Render the menu item
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    const { title, shortcut, icon, disabled, checked, separator } = this.props;

    // Check if this item is focused or hovered
    const isFocused = context.focusedElementId === this.id;
    const isHovered = context.hoveredElementId === this.id;

    // Render separator
    if (separator) {
      this._renderSeparator(bounds, style, buffer);
      return;
    }

    // Render regular menu item
    this._renderMenuItem(bounds, style, buffer, context, isFocused || isHovered);
  }

  /**
   * Render a menu separator
   */
  private _renderSeparator(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const separatorChar = '─';
    const separatorStyle = {
      ...style,
      foreground: getThemeColor('border') || 'gray'
    };

    // Fill the entire width with separator characters
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      buffer.currentBuffer.setText(x, bounds.y, separatorChar, separatorStyle);
    }
  }

  /**
   * Render a regular menu item
   */
  private _renderMenuItem(
    bounds: Bounds,
    style: Partial<Cell>,
    buffer: DualBuffer,
    context: ComponentRenderContext,
    isHighlighted: boolean
  ): void {
    const { title, shortcut, icon, disabled, checked } = this.props;

    // Determine colors based on state
    let itemStyle = { ...style };
    let textColor = disabled ? getThemeColor('secondary') : getThemeColor('foreground');
    let backgroundColor = style.background;

    if (isHighlighted && !disabled) {
      backgroundColor = getThemeColor('primary');
      textColor = getThemeColor('foreground') || 'white';
    }

    itemStyle = {
      ...itemStyle,
      foreground: textColor,
      background: backgroundColor,
      underline: isHighlighted && !disabled // Add underline for highlighted menu items
    };

    // Clear the entire item area
    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, 1, {
      char: ' ',
      ...itemStyle
    });

    // Calculate layout positions
    let currentX = bounds.x;
    const maxWidth = bounds.width;

    // Render check mark or icon (left side)
    if (checked) {
      buffer.currentBuffer.setText(currentX, bounds.y, '✓', itemStyle);
      currentX += 2;
    } else if (icon) {
      buffer.currentBuffer.setText(currentX, bounds.y, icon, itemStyle);
      currentX += 2;
    } else {
      // Space for alignment
      currentX += 2;
    }

    // Render title
    const titleMaxWidth = maxWidth - (currentX - bounds.x) - (shortcut ? shortcut.length + 2 : 0) - (this.props.submenu ? 2 : 0);
    const displayTitle = title.length > titleMaxWidth ? title.substring(0, titleMaxWidth) : title;

    if (displayTitle) {
      buffer.currentBuffer.setText(currentX, bounds.y, displayTitle, itemStyle);
      currentX += displayTitle.length;
    }

    // Render shortcut (right side, before submenu indicator)
    if (shortcut) {
      const shortcutX = bounds.x + bounds.width - shortcut.length - (this.props.submenu ? 2 : 0);
      if (shortcutX > currentX) {
        const shortcutStyle = {
          ...itemStyle,
          foreground: disabled ? getThemeColor('textMuted') : getThemeColor('textSecondary')
        };
        buffer.currentBuffer.setText(shortcutX, bounds.y, shortcut, shortcutStyle);
      }
    }

    // Render submenu indicator (rightmost)
    if (this.props.submenu) {
      const arrowX = bounds.x + bounds.width - 1;
      buffer.currentBuffer.setText(arrowX, bounds.y, '►', itemStyle);
    }
  }

  /**
   * Handle click events
   */
  handleClick(): void {
    if (this.props.disabled || this.props.separator) {
      return;
    }

    // Trigger onClick callback
    if (typeof this.props.onClick === 'function') {
      const clickEvent: ClickEvent = {
        type: 'click',
        position: { x: 0, y: 0 },
        target: this,
        timestamp: Date.now()
      };
      this.props.onClick(clickEvent);
    }
  }

  /**
   * Calculate intrinsic size for the menu item
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    const { title, shortcut, icon, checked, separator, submenu } = this.props;

    // Separators are always 1 line high
    if (separator) {
      return { width: 20, height: 1 }; // Minimum reasonable width
    }

    // Calculate required width for regular menu item
    let width = 0;

    // Space for check/icon
    width += 2;

    // Title width
    width += title.length;

    // Shortcut width
    if (shortcut) {
      width += shortcut.length + 2; // +2 for spacing
    }

    // Submenu indicator
    if (submenu) {
      width += 2; // Space + arrow
    }

    // Minimum padding
    width = Math.max(width, 12);

    return { width, height: 1 };
  }

  /**
   * Check if this menu item can receive focus
   */
  canReceiveFocus(): boolean {
    return !this.props.disabled && !this.props.separator;
  }

  /**
   * Check if this menu item has a submenu
   */
  hasSubmenu(): boolean {
    return !!this.props.submenu;
  }

  /**
   * Get the submenu element
   */
  getSubmenu(): Element | undefined {
    return this.props.submenu;
  }

  static validate(props: MenuItemProps): boolean {
    // Title is required for non-separator items
    if (!props.separator && (!props.title || typeof props.title !== 'string')) {
      return false;
    }

    if (props.shortcut !== undefined && typeof props.shortcut !== 'string') {
      return false;
    }

    if (props.icon !== undefined && typeof props.icon !== 'string') {
      return false;
    }

    return true;
  }
}

// Lint schema for menu-item component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const menuItemSchema: ComponentSchema = {
  description: 'Individual item within a menu',
  props: {
    title: { type: 'string', required: true, description: 'Item label text' },
    shortcut: { type: 'string', description: 'Keyboard shortcut hint' },
    icon: { type: 'string', description: 'Icon character/emoji' },
    checked: { type: 'boolean', description: 'Show checkmark' },
    separator: { type: 'boolean', description: 'Render as separator line' },
    submenu: { type: 'object', description: 'Nested submenu configuration' },
  },
};

registerComponentSchema('menu-item', menuItemSchema);