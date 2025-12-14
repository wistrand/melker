// Tabs component implementation - container for tab children

import { Element, BaseProps, IntrinsicSizeContext } from '../types.ts';
import { TabElement } from './tab.ts';
import { createElement } from '../element.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('Tabs');

export interface TabsProps extends BaseProps {
  activeTab?: string | number;  // Tab id or index
  onTabChange?: (tabId: string, index: number) => void;
}

export class TabsElement extends Element {
  declare type: 'tabs';
  declare props: TabsProps;

  private _activeIndex: number = 0;
  private _tabElements: TabElement[] = [];  // Original tab elements
  private _tabBar: Element | null = null;   // Tab bar container
  private _tabButtons: Element[] = [];       // Tab buttons

  constructor(props: TabsProps, children: Element[] = []) {
    const defaultProps: TabsProps = {
      activeTab: 0,
      ...props,
      style: {
        display: 'flex',
        flexDirection: 'column',
        flexGrow: 1,
        ...props.style,
      },
    };

    // Filter to only tab children
    const tabElements: TabElement[] = [];
    for (const child of children) {
      if (child.type === 'tab') {
        tabElements.push(child as TabElement);
      } else {
        logger.warn(`Tabs only accepts tab children, ignoring ${child.type}`);
      }
    }

    // Don't pass tab children to super - we'll build our own children structure
    super('tabs', defaultProps, []);

    this._tabElements = tabElements;

    // Set initial active index
    this._resolveActiveTab();

    // Create tab bar with buttons
    this._createTabBar();

    // Build children array once: [tabBar, ...allTabs]
    // All tabs are always in children, visibility controls display
    this.children = [this._tabBar!, ...this._tabElements];

    // Set initial visibility on all tabs
    this._updateTabVisibility();
  }

  /**
   * Resolve activeTab prop to an index
   */
  private _resolveActiveTab(): void {
    const { activeTab } = this.props;

    if (typeof activeTab === 'number') {
      this._activeIndex = Math.max(0, Math.min(activeTab, this._tabElements.length - 1));
    } else if (typeof activeTab === 'string') {
      const index = this._tabElements.findIndex(tab => tab.id === activeTab);
      this._activeIndex = index >= 0 ? index : 0;
    }
  }

  /**
   * Create tab bar and buttons once
   */
  private _createTabBar(): void {
    const lastIndex = this._tabElements.length - 1;

    for (let i = 0; i < this._tabElements.length; i++) {
      const tab = this._tabElements[i];
      const isActive = i === this._activeIndex;
      const isLast = i === lastIndex;
      const tabIndex = i;  // Capture for closure

      const button = createElement('button', {
        id: `${this.id}-tab-${i}`,
        title: tab.props.title,
        disabled: tab.props.disabled,
        tabIndex: 0,
        onClick: () => this._handleTabClick(tabIndex),
        style: {
          fontWeight: isActive ? 'bold' : 'normal',
          borderLeft: 'thin',
          ...(isLast ? { borderRight: 'thin' } : { paddingLeft: 1 }),
        },
      });
      this._tabButtons.push(button);
    }

    this._tabBar = createElement('container', {
      id: `${this.id}-tab-bar`,
      style: {
        display: 'flex',
        flexDirection: 'row',
      },
    }, ...this._tabButtons);
  }

  /**
   * Update visibility on all tabs based on active index.
   * Active tab is visible, inactive tabs are hidden.
   * Also updates button styles to reflect active state.
   */
  private _updateTabVisibility(): void {
    const lastIndex = this._tabElements.length - 1;

    for (let i = 0; i < this._tabElements.length; i++) {
      const tab = this._tabElements[i];
      const isActive = i === this._activeIndex;

      // Set visibility - this is the key: all tabs exist, only active is visible
      tab.props.visible = isActive;

      // Ensure tabs have flex properties when visible
      if (isActive) {
        tab.props.style = {
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          ...tab.props.style,
        };
      }

      // Update button style to show active state
      const button = this._tabButtons[i];
      if (button) {
        const isLast = i === lastIndex;
        button.props.style = {
          ...button.props.style,
          fontWeight: isActive ? 'bold' : 'normal',
          borderLeft: 'thin',
          ...(isLast ? { borderRight: 'thin' } : { paddingLeft: 1 }),
        };
      }
    }
  }

  /**
   * Handle tab button click
   */
  private _handleTabClick(index: number): void {
    if (index !== this._activeIndex) {
      this._activeIndex = index;

      const activeTab = this._tabElements[index];
      if (this.props.onTabChange && activeTab) {
        this.props.onTabChange(activeTab.id, index);
      }

      // Update visibility - no children array changes needed
      this._updateTabVisibility();
    }
  }

  /**
   * Get the active tab index
   */
  getActiveIndex(): number {
    return this._activeIndex;
  }

  /**
   * Set the active tab by index
   */
  setActiveIndex(index: number): void {
    const newIndex = Math.max(0, Math.min(index, this._tabElements.length - 1));
    this._handleTabClick(newIndex);
  }

  /**
   * Set the active tab by id
   */
  setActiveTab(tabId: string): void {
    const index = this._tabElements.findIndex(tab => tab.id === tabId);
    if (index >= 0) {
      this.setActiveIndex(index);
    }
  }

  /**
   * Calculate intrinsic size for the tabs
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Tab bar width: buttons with gaps
    let tabBarWidth = 0;
    for (const tab of this._tabElements) {
      tabBarWidth += tab.props.title.length + 4; // Button padding
    }
    tabBarWidth += (this._tabElements.length - 1); // Gaps

    // Content size - max of all tabs (for proper sizing regardless of which is active)
    let maxContentWidth = 0;
    let maxContentHeight = 0;

    for (const tab of this._tabElements) {
      const tabSize = (tab as any).intrinsicSize?.(context) || { width: 0, height: 0 };
      maxContentWidth = Math.max(maxContentWidth, tabSize.width);
      maxContentHeight = Math.max(maxContentHeight, tabSize.height);
    }

    return {
      width: Math.max(tabBarWidth, maxContentWidth),
      height: maxContentHeight + 1, // +1 for tab bar
    };
  }

  static validate(props: TabsProps): boolean {
    if (props.activeTab !== undefined) {
      if (typeof props.activeTab !== 'string' && typeof props.activeTab !== 'number') {
        return false;
      }
    }
    return true;
  }
}

// Register component for createElement
import { registerComponent } from '../element.ts';

registerComponent({
  type: 'tabs',
  componentClass: TabsElement,
  defaultProps: {
    activeTab: 0,
  },
});

// Lint schema for tabs component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const tabsSchema: ComponentSchema = {
  description: 'Tabbed container with switchable panels',
  props: {
    activeTab: { type: ['string', 'number'], description: 'Active tab id or index' },
    onTabChange: { type: 'function', description: 'Tab change handler' },
  },
};

registerComponentSchema('tabs', tabsSchema);
