// Menu component implementation

import { Element, BaseProps, Renderable, Focusable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { KeyPressEvent, MouseEvent } from '../events.ts';
import { createKeyPressEvent, createMouseEvent } from '../events.ts';
import { getThemeColor } from '../theme.ts';
import { MenuItemElement } from './menu-item.ts';
import { MenuSeparatorElement } from './menu-separator.ts';

export interface MenuProps extends BaseProps {
  title?: string;                    // Menu title (for menu bar)
  items: Element[];                  // MenuItems and MenuSeparators
  visible?: boolean;                 // Whether the menu popup is visible
  submenuPosition?: 'bottom' | 'right';  // Where submenu appears relative to parent
  autoClose?: boolean;               // Close menu when item is clicked
  anchorElement?: Element;           // Element that triggered this menu
}

export class MenuElement extends Element implements Renderable, Focusable {
  declare type: 'menu';
  declare props: MenuProps;
  private _selectedIndex: number = -1;
  private _openSubmenu: MenuElement | null = null;

  constructor(props: MenuProps, children: Element[] = []) {
    const defaultProps: MenuProps = {
      visible: false,
      submenuPosition: 'bottom',
      autoClose: true,
      tabIndex: 0,
      ...props,
      items: props.items || [],
      style: {
        border: 'thin',
        background: getThemeColor('surface') || getThemeColor('background') || 'black',
        ...props.style
      },
    };

    super('menu', defaultProps, children);

    // Handle items from either props.items or children
    if (props.items && props.items.length > 0) {
      this.children = [...props.items];
      // Also update the props to maintain consistency
      this.props.items = [...props.items];
    } else if (children && children.length > 0) {
      // Use children as items (for template system)
      this.children = [...children];
      this.props.items = children.filter(child =>
        child.type === 'menu-item' || child.type === 'menu-separator'
      );
    }
  }

  /**
   * Render the menu - only renders when visible
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    if (!this.props.visible) {
      return; // Don't render hidden menus
    }

    const menuStyle = {
      ...style,
      background: this.props.style?.background || getThemeColor('surface') || 'black',
      foreground: this.props.style?.color || getThemeColor('foreground') || 'white'
    };

    // Draw menu border and background
    this._drawMenuBorder(bounds, menuStyle, buffer);

    // Render menu items within the border
    const contentBounds = {
      x: bounds.x + 1,
      y: bounds.y + 1,
      width: bounds.width - 2,
      height: bounds.height - 2
    };
    this._renderMenuItems(contentBounds, menuStyle, buffer, context);

    // Render open submenu if any
    if (this._openSubmenu && this._openSubmenu.props.visible) {
      const submenuBounds = this._calculateSubmenuBounds(bounds);
      this._openSubmenu.render(submenuBounds, menuStyle, buffer, context);
    }
  }

  /**
   * Draw menu border and background
   */
  private _drawMenuBorder(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer): void {
    const borderStyle = {
      ...style,
      foreground: getThemeColor('border') || 'gray'
    };

    // Fill entire menu area with background
    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, bounds.height, {
      char: ' ',
      ...style
    });

    // Draw border
    // Top and bottom borders
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      buffer.currentBuffer.setCell(x, bounds.y, { char: '─', ...borderStyle });
      buffer.currentBuffer.setCell(x, bounds.y + bounds.height - 1, { char: '─', ...borderStyle });
    }

    // Left and right borders
    for (let y = bounds.y; y < bounds.y + bounds.height; y++) {
      buffer.currentBuffer.setCell(bounds.x, y, { char: '│', ...borderStyle });
      buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, y, { char: '│', ...borderStyle });
    }

    // Corners
    buffer.currentBuffer.setCell(bounds.x, bounds.y, { char: '┌', ...borderStyle });
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y, { char: '┐', ...borderStyle });
    buffer.currentBuffer.setCell(bounds.x, bounds.y + bounds.height - 1, { char: '└', ...borderStyle });
    buffer.currentBuffer.setCell(bounds.x + bounds.width - 1, bounds.y + bounds.height - 1, { char: '┘', ...borderStyle });
  }

  /**
   * Render menu items within the menu bounds
   */
  private _renderMenuItems(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    if (!this.children) return;

    let currentY = bounds.y;
    const itemWidth = bounds.width;

    for (let i = 0; i < this.children.length; i++) {
      const item = this.children[i];

      if (currentY >= bounds.y + bounds.height) {
        break; // No more space
      }

      // Calculate item bounds
      const itemBounds: Bounds = {
        x: bounds.x,
        y: currentY,
        width: itemWidth,
        height: 1
      };

      // Highlight selected or hovered item
      const isSelected = i === this._selectedIndex;
      const isHovered = context.hoveredElementId === item.id;
      let itemStyle = { ...style };

      if ((isSelected || isHovered) && this._isItemFocusable(item)) {
        itemStyle.background = getThemeColor('primary') || 'blue';
        itemStyle.foreground = getThemeColor('foreground') || 'white';
      }

      // Render the menu item
      const renderable = item as unknown as Renderable;
      if (renderable.render) {
        renderable.render(itemBounds, itemStyle, buffer, context);
      }
      currentY += 1;
    }
  }

  /**
   * Calculate bounds for submenu positioning
   */
  private _calculateSubmenuBounds(parentBounds: Bounds): Bounds {
    const position = this.props.submenuPosition || 'right';

    if (position === 'right') {
      // Position submenu to the right of current menu
      return {
        x: parentBounds.x + parentBounds.width,
        y: parentBounds.y + this._selectedIndex,
        width: 25, // Default submenu width
        height: 10 // Will be adjusted by submenu content
      };
    } else {
      // Position submenu below current menu
      return {
        x: parentBounds.x,
        y: parentBounds.y + parentBounds.height,
        width: parentBounds.width,
        height: 10 // Will be adjusted by submenu content
      };
    }
  }

  /**
   * Handle keyboard input for menu navigation
   */
  handleKeyInput(key: string, ctrlKey: boolean = false, altKey: boolean = false): boolean {
    if (!this.props.visible) {
      return false;
    }

    switch (key) {
      case 'ArrowDown':
        return this._navigateDown();

      case 'ArrowUp':
        return this._navigateUp();

      case 'ArrowRight':
        return this._handleRightArrow();

      case 'ArrowLeft':
        return this._handleLeftArrow();

      case 'Enter':
      case ' ':
        return this._activateSelectedItem();

      case 'Escape':
        return this._handleEscape();

      default:
        // Handle mnemonic key navigation
        return this._handleMnemonic(key);
    }
  }

  /**
   * Handle mouse click on menu
   */
  handleClick(x: number, y: number): void {
    if (!this.props.visible || !this.children) {
      return;
    }

    // Calculate which menu item was clicked based on y position
    // y is relative to the menu's bounds
    const itemIndex = y - 1; // -1 for border

    if (itemIndex >= 0 && itemIndex < this.children.length) {
      const clickedItem = this.children[itemIndex];

      // Check if item is focusable
      if (this._isItemFocusable(clickedItem)) {
        this._selectedIndex = itemIndex;
        this._activateSelectedItem();
      }
    }
  }

  /**
   * Navigate to next menu item
   */
  private _navigateDown(): boolean {
    if (!this.children) return false;
    const focusableItems = this._getFocusableItems();

    if (focusableItems.length === 0) {
      return false;
    }

    do {
      this._selectedIndex = (this._selectedIndex + 1) % this.children.length;
    } while (!this._isCurrentItemFocusable());

    return true;
  }

  /**
   * Navigate to previous menu item
   */
  private _navigateUp(): boolean {
    if (!this.children) return false;
    const focusableItems = this._getFocusableItems();

    if (focusableItems.length === 0) {
      return false;
    }

    do {
      this._selectedIndex = this._selectedIndex <= 0 ? this.children.length - 1 : this._selectedIndex - 1;
    } while (!this._isCurrentItemFocusable());

    return true;
  }

  /**
   * Handle right arrow key (open submenu or navigate to parent menu)
   */
  private _handleRightArrow(): boolean {
    if (!this.children) return false;
    const currentItem = this.children[this._selectedIndex];

    if (currentItem instanceof MenuItemElement && currentItem.hasSubmenu()) {
      // Open submenu
      this._openSubmenu = currentItem.getSubmenu() as MenuElement;
      if (this._openSubmenu) {
        this._openSubmenu.props.visible = true;
        this._openSubmenu._selectedIndex = 0;
        this._openSubmenu._selectFirstFocusableItem();
      }
      return true;
    }

    return false;
  }

  /**
   * Handle left arrow key (close submenu or navigate to parent)
   */
  private _handleLeftArrow(): boolean {
    if (this._openSubmenu) {
      // Close open submenu
      this._openSubmenu.props.visible = false;
      this._openSubmenu = null;
      return true;
    }

    // TODO: Navigate to parent menu if this is a submenu
    return false;
  }

  /**
   * Activate the currently selected menu item
   */
  private _activateSelectedItem(): boolean {
    if (!this.children || this._selectedIndex < 0 || this._selectedIndex >= this.children.length) {
      return false;
    }

    const selectedItem = this.children[this._selectedIndex];

    // Check if it's a menu-item (either MenuItemElement instance or element with type 'menu-item')
    const isMenuItem = selectedItem instanceof MenuItemElement || selectedItem.type === 'menu-item';

    if (isMenuItem) {
      // Check for submenu
      const hasSubmenu = selectedItem instanceof MenuItemElement ?
        selectedItem.hasSubmenu() :
        !!selectedItem.props.submenu;

      if (hasSubmenu) {
        // Open submenu instead of activating
        return this._handleRightArrow();
      } else {
        // Activate the menu item
        if (selectedItem instanceof MenuItemElement) {
          selectedItem.handleClick();
        } else {
          // Call onClick handler directly for non-class menu items
          if (typeof selectedItem.props.onClick === 'function') {
            const clickEvent = createMouseEvent('click', 0, 0, 0, 1, selectedItem.id);
            selectedItem.props.onClick(clickEvent);
          }
        }

        // Auto-close menu if enabled
        if (this.props.autoClose) {
          this.close();
        }
        return true;
      }
    }

    return false;
  }

  /**
   * Handle escape key (close menu/submenu)
   */
  private _handleEscape(): boolean {
    if (this._openSubmenu) {
      // Close submenu first
      this._openSubmenu.props.visible = false;
      this._openSubmenu = null;
      return true;
    } else {
      // Close this menu
      this.close();
      return true;
    }
  }

  /**
   * Handle mnemonic key navigation (Alt+F for File menu, etc.)
   */
  private _handleMnemonic(key: string): boolean {
    // TODO: Implement mnemonic navigation
    return false;
  }

  /**
   * Check if an item is focusable
   */
  private _isItemFocusable(item: Element): boolean {
    // Check if item has canReceiveFocus method and use it
    const focusable = item as unknown as Focusable;
    if (focusable.canReceiveFocus && typeof focusable.canReceiveFocus === 'function') {
      return focusable.canReceiveFocus();
    }

    // Fallback: separators and disabled items are not focusable
    if (item.type === 'menu-separator') {
      return false;
    }

    // Other items are focusable by default unless disabled
    return !(item.props as Record<string, unknown>).disabled;
  }

  /**
   * Get all focusable items in the menu
   */
  private _getFocusableItems(): Element[] {
    if (!this.children) return [];
    return this.children.filter(item => this._isItemFocusable(item));
  }

  /**
   * Check if the currently selected item is focusable
   */
  private _isCurrentItemFocusable(): boolean {
    if (!this.children || this._selectedIndex < 0 || this._selectedIndex >= this.children.length) {
      return false;
    }

    const item = this.children[this._selectedIndex];
    return this._isItemFocusable(item);
  }

  /**
   * Select the first focusable item
   */
  private _selectFirstFocusableItem(): void {
    this._selectedIndex = -1;
    this._navigateDown(); // This will find the first focusable item
  }

  /**
   * Open the menu
   */
  open(): void {
    this.props.visible = true;
    this._selectFirstFocusableItem();
  }

  /**
   * Close the menu and any open submenus
   */
  close(): void {
    this.props.visible = false;
    this._selectedIndex = -1;

    if (this._openSubmenu) {
      this._openSubmenu.close();
      this._openSubmenu = null;
    }
  }

  /**
   * Check if the menu is currently visible
   */
  isVisible(): boolean {
    return !!this.props.visible;
  }

  /**
   * Get the currently selected item index
   */
  getSelectedIndex(): number {
    return this._selectedIndex;
  }

  /**
   * Calculate intrinsic size based on menu items
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Always calculate size regardless of visibility for proper bounds calculation
    let maxWidth = 0;
    let totalHeight = 0;

    if (this.children) {
      for (const item of this.children) {
        const sizable = item as unknown as { intrinsicSize?: (ctx: IntrinsicSizeContext) => { width: number; height: number } };
        if (sizable.intrinsicSize) {
          const itemSize = sizable.intrinsicSize(context);
          maxWidth = Math.max(maxWidth, itemSize.width);
          totalHeight += itemSize.height;
        } else {
          totalHeight += 1; // Default item height
        }
      }
    }

    // Minimum menu size
    maxWidth = Math.max(maxWidth, 12);
    totalHeight = Math.max(totalHeight, 1);

    // Add space for border
    return { width: maxWidth + 2, height: totalHeight + 2 };
  }

  /**
   * Check if this menu can receive focus
   */
  canReceiveFocus(): boolean {
    return this.props.visible === true && !this.props.disabled;
  }

  static validate(props: MenuProps): boolean {
    if (props.items && !Array.isArray(props.items)) {
      return false;
    }

    if (props.position && !['bottom', 'right'].includes(props.position)) {
      return false;
    }

    return true;
  }
}

// Lint schema for menu component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const menuSchema: ComponentSchema = {
  description: 'Dropdown menu with items and optional submenus',
  props: {
    title: { type: 'string', description: 'Menu title (for menu bar)' },
    items: { type: 'array', description: 'Array of menu items' },
    visible: { type: 'boolean', description: 'Whether menu is shown' },
    submenuPosition: { type: 'string', enum: ['bottom', 'right'], description: 'Where submenus appear' },
    autoClose: { type: 'boolean', description: 'Close on item selection' },
    anchorElement: { type: 'object', description: 'Element to position menu relative to' },
  },
};

registerComponentSchema('menu', menuSchema);