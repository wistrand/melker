// MenuSeparator component implementation

import { Element, BaseProps, Renderable, Bounds, ComponentRenderContext, IntrinsicSizeContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { getThemeColor } from '../theme.ts';

export interface MenuSeparatorProps extends BaseProps {
  // Separators are simple, no additional props needed
}

export class MenuSeparatorElement extends Element implements Renderable {
  declare type: 'menu-separator';
  declare props: MenuSeparatorProps;

  constructor(props: MenuSeparatorProps = {}, children: Element[] = []) {
    const defaultProps: MenuSeparatorProps = {
      disabled: true, // Separators can't be focused or clicked
      ...props,
      style: {
        ...props.style
      },
    };

    super('menu-separator', defaultProps, children);
  }

  /**
   * Render the menu separator as a horizontal line
   */
  render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    const separatorChar = '─';
    const separatorStyle = {
      ...style,
      foreground: getThemeColor('border') || 'gray'
    };

    // Render horizontal line across the full width
    for (let x = bounds.x; x < bounds.x + bounds.width; x++) {
      buffer.currentBuffer.setText(x, bounds.y, separatorChar, separatorStyle);
    }
  }

  /**
   * Calculate intrinsic size - separators are 1 line high
   */
  intrinsicSize(context: IntrinsicSizeContext): { width: number; height: number } {
    return {
      width: 1,  // Will expand to container width
      height: 1  // Always 1 line
    };
  }

  static validate(props: MenuSeparatorProps): boolean {
    return true; // Separators have no validation requirements
  }
}

// Lint schema for menu-separator component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const menuSeparatorSchema: ComponentSchema = {
  description: 'Horizontal divider line between menu items',
  props: {},
};

registerComponentSchema('menu-separator', menuSeparatorSchema);