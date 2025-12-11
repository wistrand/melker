// MenuBar component implementation

import { Element, BaseProps, Renderable, Focusable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { KeyPressEvent, MouseEvent } from '../events.ts';
import { getThemeColor } from '../theme.ts';
import { MenuElement } from './menu.ts';

export interface MenuBarProps extends BaseProps {
  menus: MenuElement[];              // Top-level menus
  activated?: boolean;               // Whether menu bar is in "active" mode (Alt pressed)
}

export class MenuBarElement extends Element implements Renderable, Focusable {
  declare type: 'menu-bar';
  declare props: MenuBarProps;
  private _selectedMenuIndex: number = -1;
  private _openMenu: MenuElement | null = null;
  private _isActivated: boolean = false;

  constructor(props: MenuBarProps, children: Element[] = []) {
    const defaultProps: MenuBarProps = {
      activated: false,
      tabIndex: 0,
      ...props,
      menus: props.menus || [],
      style: {
        background: getThemeColor('menuBarBackground') || getThemeColor('background') || 'black',
        color: getThemeColor('menuBarText') || getThemeColor('foreground') || 'white',
        ...props.style
      },
    };

    super('menu-bar', defaultProps, children);

    // Handle menus from either props.menus or children
    if (props.menus && props.menus.length > 0) {
      this.children = [...props.menus];
      // Also update the props to maintain consistency
      this.props.menus = [...props.menus];
    } else if (children && children.length > 0) {
      // Use children as menus (for template system)
      this.children = [...children];
      this.props.menus = children.filter(child => child.type === 'menu') as MenuElement[];
    }

    this._isActivated = !!props.activated;
  }

  /**
   * Render the menu bar
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    const isFocused = context.focusedElementId === this.id;

    const menuBarStyle = {
      ...style,
      background: this.props.style?.background || getThemeColor('menuBarBackground') || 'black',
      foreground: this.props.style?.color || getThemeColor('menuBarText') || 'white'
    };

    // Clear the menu bar area
    buffer.currentBuffer.fillRect(bounds.x, bounds.y, bounds.width, bounds.height, {
      char: ' ',
      ...menuBarStyle
    });

    // Render menu titles horizontally (pass focus state for underline indicator)
    this._renderMenuTitles(bounds, menuBarStyle, buffer, context, isFocused);

    // Store menu bounds for overlay rendering but don't render here
    // The menu will be rendered as an overlay after all normal rendering
    if (this._openMenu && this._openMenu.props.visible) {
      const menuBounds = this._calculateMenuBounds(bounds);
      // Store menu rendering info in context for deferred overlay rendering
      if (!context.overlays) {
        (context as any).overlays = [];
      }
      (context as any).overlays.push({
        element: this._openMenu,
        bounds: menuBounds,
        style: menuBarStyle
      });
    }
  }

  /**
   * Render menu titles in the menu bar
   */
  private _renderMenuTitles(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext, isFocused: boolean = false): void {
    let currentX = bounds.x + 1; // Start with 1 space padding

    for (let i = 0; i < this.props.menus.length; i++) {
      const menu = this.props.menus[i];
      const title = menu.props.title || `Menu ${i + 1}`;

      if (currentX + title.length + 2 > bounds.x + bounds.width) {
        break; // No more space for this menu
      }

      // Determine if this menu should be highlighted
      const isSelected = i === this._selectedMenuIndex;
      const isOpen = this._openMenu === menu;

      let titleStyle = { ...style };

      if ((isSelected && this._isActivated) || isOpen) {
        titleStyle.background = getThemeColor('menuBarItemSelected') || getThemeColor('primary') || 'blue';
        titleStyle.foreground = getThemeColor('menuBarItemSelectedText') || getThemeColor('foreground') || 'white';
        titleStyle.underline = true; // Add underline for selected/open menu titles
      } else if (this._isActivated) {
        // Show that menu bar is activated but this item isn't selected
        titleStyle.background = style.background;
        titleStyle.foreground = style.foreground;
      }

      // Add underline when menu bar is focused (but not activated)
      if (isFocused && !this._isActivated) {
        titleStyle.underline = true;
      }

      // Render menu title with padding
      buffer.currentBuffer.setText(currentX, bounds.y, ` ${title} `, titleStyle);

      currentX += title.length + 2; // +2 for spaces around title
    }
  }

  /**
   * Calculate bounds for dropdown menu positioning
   */
  private _calculateMenuBounds(menuBarBounds: Bounds): Bounds {
    if (this._selectedMenuIndex < 0 || this._selectedMenuIndex >= this.props.menus.length) {
      return { x: 0, y: 0, width: 0, height: 0 };
    }

    const selectedMenu = this.props.menus[this._selectedMenuIndex];

    // Calculate X position based on selected menu position
    let menuX = menuBarBounds.x + 1; // Start position

    for (let i = 0; i < this._selectedMenuIndex; i++) {
      const menu = this.props.menus[i];
      const title = menu.props.title || `Menu ${i + 1}`;
      menuX += title.length + 2; // +2 for spacing
    }

    // Use menu's intrinsic size for proper dimensions
    let menuSize = { width: 20, height: 3 }; // Default size

    if (selectedMenu && selectedMenu.intrinsicSize) {
      try {
        menuSize = selectedMenu.intrinsicSize({ availableSpace: { width: 50, height: 15 } });
      } catch {
        // Use default size if intrinsic size calculation fails
      }
    }

    return {
      x: menuX,
      y: menuBarBounds.y + 1, // Position below menu bar
      width: Math.min(menuSize.width, 50), // Cap at reasonable width
      height: Math.min(menuSize.height, 15) // Cap at reasonable height
    };
  }

  /**
   * Handle keyboard input for menu bar navigation
   */
  handleKeyInput(key: string, ctrlKey: boolean = false, altKey: boolean = false): boolean {
    // Handle F10 or Ctrl+M to activate/deactivate menu bar
    if (key === 'F10' || (ctrlKey && key === 'm') || key === 'Alt' || (altKey && !ctrlKey)) {
      return this._toggleActivation();
    }

    // Handle Enter/Space when menu bar is focused (via Tab navigation)
    if (!this._isActivated && (key === 'Enter' || key === ' ')) {
      return this._toggleActivation();
    }

    // Only handle other keys when activated
    if (!this._isActivated) {
      return false;
    }

    // If a menu is open, delegate navigation keys to it
    if (this._openMenu && this._openMenu.props.visible) {
      // Let the open menu handle up/down/enter/space/escape
      if (key === 'ArrowDown' || key === 'ArrowUp' || key === 'Enter' || key === ' ' || key === 'Escape') {
        const handled = this._openMenu.handleKeyInput(key, ctrlKey, altKey);
        // If escape was handled and menu is now closed, we handled it
        if (key === 'Escape' && !this._openMenu.props.visible) {
          this._openMenu = null;
          return true;
        }
        if (handled) {
          return true;
        }
      }
    }

    switch (key) {
      case 'ArrowLeft':
        return this._navigateLeft();

      case 'ArrowRight':
        return this._navigateRight();

      case 'ArrowDown':
        return this._openSelectedMenu();

      case 'Enter':
      case ' ':
        return this._openSelectedMenu();

      case 'Escape':
        this._deactivate();
        return true;

      case 'Tab':
        // Tab should exit menu bar and continue normal focus navigation
        this._deactivate();
        return false; // Allow Tab to be handled by focus manager

      default:
        // Handle mnemonic keys (F for File, etc.)
        return this._handleMenuMnemonic(key);
    }
  }

  /**
   * Toggle menu bar activation state
   */
  private _toggleActivation(): boolean {
    if (this._isActivated) {
      this._deactivate();
    } else {
      this._activate();
    }
    return true;
  }

  /**
   * Activate the menu bar
   */
  private _activate(): void {
    this._isActivated = true;
    this.props.activated = true;

    // Select first menu if none selected
    if (this._selectedMenuIndex < 0 && this.props.menus.length > 0) {
      this._selectedMenuIndex = 0;
    }
  }

  /**
   * Deactivate the menu bar and close any open menus
   */
  private _deactivate(): void {
    this._isActivated = false;
    this.props.activated = false;
    this._selectedMenuIndex = -1;

    if (this._openMenu) {
      this._openMenu.close();
      this._openMenu = null;
    }
  }

  /**
   * Navigate to previous menu
   */
  private _navigateLeft(): boolean {
    if (this.props.menus.length === 0) {
      return false;
    }

    // Close current open menu
    if (this._openMenu) {
      this._openMenu.close();
      this._openMenu = null;
    }

    // Navigate to previous menu
    this._selectedMenuIndex = this._selectedMenuIndex <= 0 ?
      this.props.menus.length - 1 : this._selectedMenuIndex - 1;

    return true;
  }

  /**
   * Navigate to next menu
   */
  private _navigateRight(): boolean {
    if (this.props.menus.length === 0) {
      return false;
    }

    // Close current open menu
    if (this._openMenu) {
      this._openMenu.close();
      this._openMenu = null;
    }

    // Navigate to next menu
    this._selectedMenuIndex = (this._selectedMenuIndex + 1) % this.props.menus.length;

    return true;
  }

  /**
   * Open the currently selected menu
   */
  private _openSelectedMenu(): boolean {
    if (this._selectedMenuIndex < 0 || this._selectedMenuIndex >= this.props.menus.length) {
      return false;
    }

    const selectedMenu = this.props.menus[this._selectedMenuIndex];

    // Close any currently open menu
    if (this._openMenu && this._openMenu !== selectedMenu) {
      this._openMenu.close();
    }

    // Open the selected menu
    this._openMenu = selectedMenu;
    this._openMenu.open();

    return true;
  }

  /**
   * Handle mnemonic key for quick menu access
   */
  private _handleMenuMnemonic(key: string): boolean {
    const lowerKey = key.toLowerCase();

    for (let i = 0; i < this.props.menus.length; i++) {
      const menu = this.props.menus[i];
      const title = menu.props.title || '';

      // Check if first character matches (simple mnemonic)
      if (title.toLowerCase().startsWith(lowerKey)) {
        this._selectedMenuIndex = i;
        this._openSelectedMenu();
        return true;
      }
    }

    return false;
  }

  /**
   * Handle click on menu bar
   */
  handleClick(x: number, y: number): void {
    // Calculate which menu was clicked based on x position
    let currentX = 1; // Starting position

    for (let i = 0; i < this.props.menus.length; i++) {
      const menu = this.props.menus[i];
      const title = menu.props.title || `Menu ${i + 1}`;
      const titleWidth = title.length + 2; // +2 for spaces

      if (x >= currentX && x < currentX + titleWidth) {
        // This menu was clicked
        if (this._openMenu === menu) {
          // Close if already open
          this._deactivate();
        } else {
          // Open this menu
          this._activate();
          this._selectedMenuIndex = i;
          this._openSelectedMenu();
        }
        return;
      }

      currentX += titleWidth;
    }
  }

  /**
   * Check if menu bar is currently activated
   */
  isActivated(): boolean {
    return this._isActivated;
  }

  /**
   * Get the currently open menu
   */
  getOpenMenu(): MenuElement | null {
    return this._openMenu;
  }

  /**
   * Calculate intrinsic size - menu bar is always 1 line high
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    let totalWidth = 2; // Start with padding

    for (const menu of this.props.menus) {
      const title = menu.props.title || 'Menu';
      totalWidth += title.length + 2; // +2 for spaces around title
    }

    return {
      width: Math.max(totalWidth, 20), // Minimum reasonable width
      height: 1 // Menu bar is always 1 line
    };
  }

  /**
   * Check if this menu bar can receive focus
   */
  canReceiveFocus(): boolean {
    return !this.props.disabled;
  }

  static validate(props: MenuBarProps): boolean {
    if (props.menus && !Array.isArray(props.menus)) {
      return false;
    }

    return true;
  }
}

// Lint schema for menu-bar component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const menuBarSchema: ComponentSchema = {
  description: 'Horizontal menu bar containing dropdown menus',
  props: {
    menus: { type: 'array', description: 'Array of menu definitions' },
    activated: { type: 'boolean', description: 'Menu bar is active/focused' },
  },
};

registerComponentSchema('menu-bar', menuBarSchema);