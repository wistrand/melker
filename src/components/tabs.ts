// Tabs component implementation - container for tab children

import { Element, BaseProps, IntrinsicSizeContext, isRenderable, hasIntrinsicSize } from '../types.ts';
import { TabElement } from './tab.ts';
import { createElement, registerComponent } from '../element.ts';
import { getLogger } from '../logging.ts';

const logger = getLogger('Tabs');

export interface TabChangeEvent {
  type: 'change';
  tabId: string;
  index: number;
  targetId: string;
}

export interface TabsProps extends Omit<BaseProps, 'onChange'> {
  activeTab?: string;  // Tab id (must match a tab's id attribute)
  onChange?: (event: TabChangeEvent) => void;  // Preferred
  onTabChange?: (tabId: string, index: number) => void;  // Deprecated: use onChange
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
      // activeTab defaults to first tab's id (set after we know children)
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
   * Resolve activeTab prop (string id) to an index
   */
  private _resolveActiveTab(): void {
    const { activeTab } = this.props;

    if (typeof activeTab === 'string') {
      const index = this._tabElements.findIndex(tab => tab.id === activeTab);
      this._activeIndex = index >= 0 ? index : 0;
    } else {
      // Default to first tab
      this._activeIndex = 0;
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
        label: tab.props.title,
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
   * Compute a tab button's layout width from its label and border/padding.
   */
  private _buttonWidth(index: number): number {
    const label = this._tabElements[index].props.title;
    const isLast = index === this._tabElements.length - 1;
    // borderLeft(1) + paddingLeft(1) + label + paddingRight(1) + borderRight(0|1)
    return 1 + 1 + label.length + 1 + (isLast ? 1 : 0);
  }

  /**
   * Update visibility on all tabs based on active index.
   * Active tab is visible, inactive tabs are hidden.
   * Also updates button styles to reflect active state.
   * Sets border top gap and corner overrides for active tab merging.
   */
  private _updateTabVisibility(): void {
    const lastIndex = this._tabElements.length - 1;

    // Compute gap offset = sum of button widths before active tab
    let gapStart = 0;
    for (let i = 0; i < this._activeIndex; i++) {
      gapStart += this._buttonWidth(i);
    }
    // For non-last tabs: gap covers the full button (junction └ goes at next button's borderLeft).
    // For last tab: gap excludes borderRight so └ aligns with the button's own borderRight vertical.
    const gapEnd = this._activeIndex === lastIndex
      ? gapStart + this._buttonWidth(this._activeIndex) - 2
      : gapStart + this._buttonWidth(this._activeIndex) - 1;

    for (let i = 0; i < this._tabElements.length; i++) {
      const tab = this._tabElements[i];
      const isActive = i === this._activeIndex;

      // Set visibility - this is the key: all tabs exist, only active is visible
      tab.props.visible = isActive;

      // Ensure tabs have flex properties when visible, and set border gap
      if (isActive) {
        tab.props.style = {
          display: 'flex',
          flexDirection: 'column',
          flexGrow: 1,
          ...tab.props.style,
          _borderTopGap: { start: gapStart, end: gapEnd },
        };
      }

      // Update button style to show active state
      const button = this._tabButtons[i];
      if (button) {
        const isLast = i === lastIndex;

        // Corner overrides:
        // - First inactive button to the RIGHT of active gets ╮ at TL
        // - Active button gets ╭ at TL when not first tab
        let cornerTL: string | undefined;
        if (i === this._activeIndex + 1) {
          cornerTL = '╮';
        } else if (isActive && this._activeIndex > 0) {
          cornerTL = '╭';
        }

        button.props.style = {
          ...button.props.style,
          fontWeight: isActive ? 'bold' : 'normal',
          borderLeft: 'thin',
          borderTop: 'thin',
          height: 2,
          _borderCornerTL: cornerTL,
          ...(isLast ? { borderRight: 'thin', paddingLeft: 1, paddingRight: 1 } : { paddingLeft: 1, paddingRight: 1 }),
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
      if (activeTab) {
        // Call onChange (preferred)
        if (this.props.onChange) {
          this.props.onChange({
            type: 'change',
            tabId: activeTab.id,
            index: index,
            targetId: this.id,
          });
        }
        // Call onTabChange (deprecated, backwards compat)
        if (this.props.onTabChange) {
          this.props.onTabChange(activeTab.id, index);
        }
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
      const tabSize = hasIntrinsicSize(tab) ? tab.intrinsicSize(context) : { width: 0, height: 0 };
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
      if (typeof props.activeTab !== 'string') {
        return false;
      }
    }
    return true;
  }
}

// Register component for createElement
registerComponent({
  type: 'tabs',
  componentClass: TabsElement,
  defaultProps: {
    // activeTab defaults to first tab if not specified
  },
});

// Lint schema for tabs component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const tabsSchema: ComponentSchema = {
  description: 'Tabbed container with switchable panels',
  props: {
    activeTab: { type: 'string', description: 'Active tab id (must match a tab child id)' },
    onChange: { type: 'handler', description: 'Called when tab changes (preferred). Event: { tabId, index, targetId }' },
    onTabChange: { type: 'handler', description: 'Called when tab changes (deprecated: use onChange)' },
  },
};

registerComponentSchema('tabs', tabsSchema);
