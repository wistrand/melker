// List component - scrollable list with selection capabilities
// Children must be 'li' elements which can contain any other components
import { Element, BaseProps, Renderable, Focusable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import type { KeyPressEvent, SelectionChangeEvent } from '../events.ts';
import { createKeyPressEvent, createSelectionChangeEvent } from '../events.ts';
import { getThemeColor } from '../theme.ts';
import { ContainerElement, ContainerProps } from './container.ts';

export type SelectionMode = 'none' | 'single' | 'multiple';

export interface ListProps extends BaseProps {
  selectionMode?: SelectionMode;
  selectedItems?: number[]; // Array of selected item indices
  focusedItem?: number; // Currently focused item index
  scrollTop?: number; // Scroll position
  onSelectionChange?: (event: SelectionChangeEvent) => void;
  onKeyPress?: (event: KeyPressEvent) => void;
  showSelectionMarkers?: boolean; // Show checkboxes/radio buttons
}

export class ListElement extends Element implements Renderable, Focusable {
  declare type: 'list';
  declare props: ListProps;

  constructor(props: ListProps = {}, children: Element[] = []) {
    // Validate that all children are 'li' elements
    const invalidChildren = children.filter(child => child.type !== 'li');
    if (invalidChildren.length > 0) {
      throw new Error(`List component only accepts 'li' elements as children. Found: ${invalidChildren.map(c => c.type).join(', ')}`);
    }

    const defaultProps: ListProps = {
      style: {
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
        ...props.style
      },
      selectionMode: 'single',
      selectedItems: [],
      focusedItem: 0,
      scrollTop: 0,
      showSelectionMarkers: true,
      disabled: false,
      tabIndex: 0,
      ...props,
    };

    super('list', defaultProps, children);
  }

  canFocus(): boolean {
    return true;
  }

  canReceiveFocus(): boolean {
    return !this.props.disabled && (this.children?.length || 0) > 0;
  }

  getIntrinsicSize(_context: IntrinsicSizeContext) {
    // Minimum size to show at least one item
    return {
      minWidth: 10,
      minHeight: 3,
      maxWidth: Infinity,
      maxHeight: Infinity
    };
  }

  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    // Calculate natural size based on children
    const itemCount = this.children?.length || 0;

    // Minimum width to show selection markers and some content
    const minWidth = 10;

    // Height based on number of items, but capped at available space
    const naturalHeight = Math.min(itemCount || 1, context.availableSpace.height || 20);

    return {
      width: context.availableSpace.width || minWidth,
      height: naturalHeight
    };
  }

  onKeyPress(event: KeyPressEvent): boolean {
    const { selectionMode = 'single', selectedItems = [], focusedItem = 0 } = this.props;
    const itemCount = this.children?.length || 0;

    if (itemCount === 0) return false;

    let newFocusedItem = focusedItem;
    let newSelectedItems = [...selectedItems];
    let handled = false;

    switch (event.key) {
      case 'ArrowUp':
        newFocusedItem = Math.max(0, focusedItem - 1);
        handled = true;
        break;

      case 'ArrowDown':
        newFocusedItem = Math.min(itemCount - 1, focusedItem + 1);
        handled = true;
        break;

      case 'Home':
        newFocusedItem = 0;
        handled = true;
        break;

      case 'End':
        newFocusedItem = itemCount - 1;
        handled = true;
        break;

      case 'PageUp':
        newFocusedItem = Math.max(0, focusedItem - 5);
        handled = true;
        break;

      case 'PageDown':
        newFocusedItem = Math.min(itemCount - 1, focusedItem + 5);
        handled = true;
        break;

      case ' ':
      case 'Enter':
        if (selectionMode !== 'none') {
          const isCurrentlySelected = selectedItems.includes(focusedItem);

          if (selectionMode === 'single') {
            newSelectedItems = isCurrentlySelected ? [] : [focusedItem];
          } else if (selectionMode === 'multiple') {
            if (isCurrentlySelected) {
              newSelectedItems = selectedItems.filter(index => index !== focusedItem);
            } else {
              newSelectedItems = [...selectedItems, focusedItem];
            }
          }
          handled = true;
        }
        break;
    }

    if (handled) {
      // Update focused item if it changed
      if (newFocusedItem !== focusedItem) {
        this.props.focusedItem = newFocusedItem;

        // Auto-scroll to keep focused item visible
        this._updateScrollForFocus(newFocusedItem);
      }

      // Update selection if it changed
      if (newSelectedItems.length !== selectedItems.length ||
          !newSelectedItems.every(item => selectedItems.includes(item))) {
        this.props.selectedItems = newSelectedItems;

        // Fire selection change event
        if (this.props.onSelectionChange) {
          const selectionEvent = createSelectionChangeEvent({
            selectedItems: newSelectedItems,
            focusedItem: newFocusedItem,
            lastSelectedItem: selectionMode !== 'none' ? newFocusedItem : undefined
          });
          this.props.onSelectionChange(selectionEvent);
        }
      }


      // Fire key press event for custom handling
      if (this.props.onKeyPress) {
        this.props.onKeyPress(event);
      }

      return true;
    }

    return false;
  }

  private _updateScrollForFocus(focusedItem: number): void {
    // This will be used by the render method to auto-scroll
    // The actual scrolling logic is implemented in the render method
  }


  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // Let the layout system render the children first, then overlay markers
    const {
      selectionMode = 'single',
      selectedItems = [],
      focusedItem = 0,
      showSelectionMarkers = true
    } = this.props;

    const itemCount = this.children?.length || 0;
    if (itemCount === 0) return;

    // Render markers as overlay on top of the li elements
    // Each li element has paddingLeft: 2, so we render markers in that space
    const containerPadding = (typeof this.props.style?.padding === 'number' ? this.props.style.padding : 1);

    for (let i = 0; i < itemCount; i++) {
      const childElement = this.children?.[i];
      if (childElement?.type !== 'li') continue;

      const isSelected = selectedItems.includes(i);
      const isFocused = i === focusedItem;

      // Calculate Y position: account for container padding + item index
      // Add 1 to align with where the layout system actually places the li elements
      const itemY = bounds.y + containerPadding + i + 1;

      // Calculate X position: account for container padding
      const markerX = bounds.x + containerPadding;

      // Check if the item is within visible bounds
      if (itemY >= bounds.y + bounds.height) break;

      // Position 0: Combined focus and selection marker
      let marker: string;
      let foregroundColor: string;
      let backgroundColor: string;

      if (isFocused && isSelected) {
        // Focused and selected: use * with focus colors
        marker = '*';
        foregroundColor = getThemeColor('focusPrimary');
        backgroundColor = getThemeColor('focusBackground');
      } else if (isFocused && !isSelected) {
        // Focused but not selected: use > with focus colors
        marker = '>';
        foregroundColor = getThemeColor('focusPrimary');
        backgroundColor = getThemeColor('focusBackground');
      } else if (!isFocused && isSelected) {
        // Selected but not focused: use * with selection colors
        marker = '*';
        foregroundColor = getThemeColor('primary');
        backgroundColor = getThemeColor('background');
      } else {
        // Neither focused nor selected: use - with normal colors
        marker = '-';
        foregroundColor = getThemeColor('textSecondary');
        backgroundColor = getThemeColor('background');
      }

      buffer.currentBuffer.setCell(markerX, itemY, {
        char: marker,
        foreground: foregroundColor,
        background: backgroundColor
      });

      // Since text starts immediately after the focus/li marker,
      // we integrate the selection state into the main marker
      // Future improvement: adjust li paddingLeft to make room for separate markers
    }
  }


  private _renderScrollbar(
    buffer: DualBuffer,
    bounds: Bounds,
    scrollTop: number,
    totalItems: number,
    visibleItems: number
  ): void {
    const scrollbarX = bounds.x + bounds.width - 1;
    const scrollbarHeight = bounds.height;

    // Clear scrollbar area
    for (let i = 0; i < scrollbarHeight; i++) {
      buffer.currentBuffer.setCell(scrollbarX, bounds.y + i, {
        char: '│',
        foreground: getThemeColor('border'),
        background: getThemeColor('surface')
      });
    }

    // Calculate thumb position and size
    const thumbSize = Math.max(1, Math.floor((visibleItems / totalItems) * scrollbarHeight));
    const thumbPosition = Math.floor((scrollTop / (totalItems - visibleItems)) * (scrollbarHeight - thumbSize));

    // Render thumb
    for (let i = 0; i < thumbSize; i++) {
      const thumbY = bounds.y + thumbPosition + i;
      if (thumbY >= bounds.y && thumbY < bounds.y + scrollbarHeight) {
        buffer.currentBuffer.setCell(scrollbarX, thumbY, {
          char: '█',
          foreground: getThemeColor('primary'),
          background: getThemeColor('surface')
        });
      }
    }
  }

  // Utility methods for external control
  selectItem(index: number): void {
    const { selectionMode = 'single', selectedItems = [] } = this.props;

    if (selectionMode === 'none' || index < 0 || index >= (this.children?.length || 0)) {
      return;
    }

    let newSelection: number[];
    if (selectionMode === 'single') {
      newSelection = [index];
    } else {
      newSelection = selectedItems.includes(index)
        ? selectedItems.filter(i => i !== index)
        : [...selectedItems, index];
    }

    this.props.selectedItems = newSelection;
    this.props.focusedItem = index;

    if (this.props.onSelectionChange) {
      const event = createSelectionChangeEvent({
        selectedItems: newSelection,
        focusedItem: index,
        lastSelectedItem: index
      });
      this.props.onSelectionChange(event);
    }
  }

  getSelectedItems(): number[] {
    return [...(this.props.selectedItems || [])];
  }

  getFocusedItem(): number {
    return this.props.focusedItem || 0;
  }

  scrollTo(index: number): void {
    if (index >= 0 && index < (this.children?.length || 0)) {
      this.props.scrollTop = index;
    }
  }
}

// Lint schema for list component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const listSchema: ComponentSchema = {
  description: 'Scrollable list container with optional selection',
  props: {
    selectionMode: { type: 'string', enum: ['none', 'single', 'multiple'], description: 'Item selection behavior' },
    selectedItems: { type: 'array', description: 'Array of selected item indices' },
    focusedItem: { type: 'number', description: 'Currently focused item index' },
    scrollTop: { type: 'number', description: 'Vertical scroll position' },
    onSelectionChange: { type: 'function', description: 'Selection change callback' },
    showSelectionMarkers: { type: 'boolean', description: 'Show checkmarks for selected items' },
  },
};

registerComponentSchema('list', listSchema);