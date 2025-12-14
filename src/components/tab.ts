// Tab component implementation - child of tabs container

import { Element, BaseProps, IntrinsicSizeContext } from '../types.ts';

export interface TabProps extends BaseProps {
  title: string;
  disabled?: boolean;
}

export class TabElement extends Element {
  declare type: 'tab';
  declare props: TabProps;

  constructor(props: TabProps, children: Element[] = []) {
    const defaultProps: TabProps = {
      disabled: false,
      ...props,
      style: {
        border: 'thin',
        ...props.style,
      },
    };

    super('tab', defaultProps, children);
  }

  /**
   * Calculate intrinsic size for the tab content
   * This is used when the tab is active to size the content area
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    if (!this.children || this.children.length === 0) {
      return { width: 0, height: 0 };
    }

    // Calculate size based on children (column layout)
    let maxWidth = 0;
    let totalHeight = 0;

    for (const child of this.children) {
      if ((child as any).intrinsicSize) {
        const childSize = (child as any).intrinsicSize(context);
        maxWidth = Math.max(maxWidth, childSize.width);
        totalHeight += childSize.height;
      }
    }

    // Add own border and padding to the returned size
    // Tab has default border: 'thin'
    const style = this.props?.style || {};
    let paddingH = 0;
    let paddingV = 0;
    let borderH = 0;
    let borderV = 0;

    // Parse padding
    const padding = style.padding;
    if (typeof padding === 'number') {
      paddingH = padding * 2;
      paddingV = padding * 2;
    } else if (typeof style.paddingLeft === 'number' || typeof style.paddingRight === 'number' ||
               typeof style.paddingTop === 'number' || typeof style.paddingBottom === 'number') {
      paddingH = (style.paddingLeft || 0) + (style.paddingRight || 0);
      paddingV = (style.paddingTop || 0) + (style.paddingBottom || 0);
    }

    // Parse border (default is 'thin' for tab)
    const border = style.border ?? 'thin';  // Use default if not specified
    if (['thin', 'thick', 'double', 'rounded'].includes(border as string)) {
      borderH = 2;
      borderV = 2;
    }

    return {
      width: maxWidth + paddingH + borderH,
      height: totalHeight + paddingV + borderV,
    };
  }

  /**
   * Get the tab header width (for tab bar rendering)
   */
  getHeaderWidth(): number {
    // " title " - space on each side of title
    return this.props.title.length + 2;
  }

  static validate(props: TabProps): boolean {
    if (typeof props.title !== 'string' || props.title.length === 0) {
      return false;
    }
    return true;
  }
}

// Register component for createElement
import { registerComponent } from '../element.ts';

registerComponent({
  type: 'tab',
  componentClass: TabElement,
  defaultProps: {},
});

// Lint schema for tab component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const tabSchema: ComponentSchema = {
  description: 'Tab panel within tabs container',
  props: {
    title: { type: 'string', required: true, description: 'Tab header text' },
    disabled: { type: 'boolean', description: 'Disable tab selection' },
  },
};

registerComponentSchema('tab', tabSchema);
