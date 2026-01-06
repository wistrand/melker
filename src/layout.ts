// Advanced Layout Engine with comprehensive layout algorithms
// Supports block, flex, and absolute positioning

import { Element, Style, Bounds, Size, LayoutProps, BoxSpacing, IntrinsicSizeContext, Renderable, isRenderable, isScrollableType } from './types.ts';
import { SizingModel, globalSizingModel, BoxModel, ChromeCollapseState } from './sizing.ts';
import { getThemeColor } from './theme.ts';
import { ContentMeasurer, globalContentMeasurer } from './content-measurer.ts';
import { ViewportManager, globalViewportManager, ScrollbarLayout } from './viewport.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('LayoutEngine');

// Enhanced layout properties
export interface AdvancedLayoutProps extends LayoutProps {
  // Positioning
  position?: 'static' | 'relative' | 'absolute' | 'fixed';
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
  zIndex?: number;

  // Flexbox properties
  flexDirection?: 'row' | 'column' | 'row-reverse' | 'column-reverse';
  flexWrap?: 'nowrap' | 'wrap' | 'wrap-reverse';
  justifyContent?: 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
  alignItems?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  alignContent?: 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'space-between' | 'space-around';

  // Flex item properties
  flexGrow?: number;
  flexShrink?: number;
  flexBasis?: number | 'auto';
  alignSelf?: 'auto' | 'flex-start' | 'flex-end' | 'center' | 'stretch' | 'baseline';
  gap?: number;  // Space between flex items

  // Alignment
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'baseline';
  textAlign?: 'left' | 'center' | 'right' | 'justify';
}

export interface LayoutNode {
  element: Element;
  bounds: Bounds;
  contentBounds: Bounds;
  visible: boolean;
  children: LayoutNode[];
  computedStyle: Style;
  layoutProps: AdvancedLayoutProps;
  boxModel: BoxModel;
  zIndex: number;
  // New Phase 2 properties
  actualContentSize?: Size;
  scrollbars?: {
    vertical?: ScrollbarLayout;
    horizontal?: ScrollbarLayout;
  };
  // Chrome collapse state (padding/border reduced due to insufficient space)
  chromeCollapse?: ChromeCollapseState;
}

export interface LayoutContext {
  viewport: Bounds;
  parentBounds: Bounds;
  availableSpace: Size;
  parentStyle?: Style;
  parentLayoutProps?: AdvancedLayoutProps;
}

export class LayoutEngine {
  private _sizingModel: SizingModel;
  private _contentMeasurer: ContentMeasurer;
  private _viewportManager: ViewportManager;
  private _defaultLayoutProps: AdvancedLayoutProps = {
    display: 'block',
    position: 'static',
    flexDirection: 'column',  // Default to column for terminal UIs
    flexWrap: 'nowrap',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    alignContent: 'stretch',
    flexGrow: 0,
    flexShrink: 1,
    flexBasis: 'auto',
    alignSelf: 'auto',
    verticalAlign: 'top',
    textAlign: 'left',
    zIndex: 0,
  };

  constructor(
    sizingModel?: SizingModel,
    contentMeasurer?: ContentMeasurer,
    viewportManager?: ViewportManager
  ) {
    this._sizingModel = sizingModel || globalSizingModel;
    this._contentMeasurer = contentMeasurer || globalContentMeasurer;
    this._viewportManager = viewportManager || globalViewportManager;
  }

  // Main layout calculation method
  calculateLayout(
    element: Element,
    context: LayoutContext,
    parentNode?: LayoutNode
  ): LayoutNode {
    const startTime = performance.now();
    logger.trace(`Starting layout calculation for element: ${element.type}`, {
      elementId: element.id,
      elementType: element.type,
      availableSpace: context.availableSpace,
      parentBounds: context.parentBounds,
    });
    const computedStyle = this._computeStyle(element, context.parentStyle);
    const layoutProps = this._computeLayoutProps(element, context.parentLayoutProps);

    logger.trace(`Layout props computed for ${element.type}`, {
      display: layoutProps.display,
      flexDirection: layoutProps.flexDirection,
      position: layoutProps.position,
      width: layoutProps.width,
      height: layoutProps.height,
    });

    // Calculate element bounds based on layout type
    const boundsStartTime = performance.now();
    const bounds = this._calculateElementBounds(element, computedStyle, layoutProps, context);
    logger.trace(`Bounds calculated for ${element.type} in ${(performance.now() - boundsStartTime).toFixed(2)}ms`, {
      bounds,
      elementId: element.id,
    });
    const boxModel = this._sizingModel.calculateBoxModel(
      { width: bounds.width, height: bounds.height },
      computedStyle
    );

    const isScrollable = isScrollableType(element.type) && element.props.scrollable;
    const contentBoundsResult = this._sizingModel.calculateContentBounds(bounds, computedStyle, isScrollable);
    let contentBounds = contentBoundsResult.bounds;

    const node: LayoutNode = {
      element,
      bounds,
      contentBounds,
      visible: this._isVisible(element, bounds),
      children: [],
      computedStyle,
      layoutProps,
      boxModel,
      zIndex: layoutProps.zIndex || 0,
      chromeCollapse: contentBoundsResult.chromeCollapse,
    };

    // Calculate children layout
    // Check both element.children and props.children for compatibility
    const children = element.children && element.children.length > 0
      ? element.children
      : ((element.props as any)?.children || []);

    if (children && children.length > 0) {
      logger.trace(`Processing ${children.length} children for ${element.type}`, {
        elementId: element.id,
        childCount: children.length,
      });
      let childContext: LayoutContext;

      if (isScrollable) {
        // For scrollable containers, calculate actual content dimensions first
        // then use those dimensions for proper layout
        const actualContentSize = this._contentMeasurer.measureContainer(element, contentBounds.width);

        // Store actual content size in layout node
        node.actualContentSize = actualContentSize;

        // Calculate scrollbars during layout phase
        const scrollOffset = {
          x: (element.props.scrollX as number) || 0,
          y: (element.props.scrollY as number) || 0
        };

        // Use ViewportManager to calculate scrollbars
        const viewport = this._viewportManager.createViewport({
          element,
          contentSize: actualContentSize,
          scrollable: true
        });

        // Override viewport bounds to match layout bounds
        viewport.bounds = { ...contentBounds };
        viewport.clipRect = { ...contentBounds };
        viewport.scrollOffset = scrollOffset;

        // Calculate scrollbars based on actual content vs viewport size
        if (actualContentSize.height > contentBounds.height || actualContentSize.width > contentBounds.width) {
          // Need scrollbars - calculate layout
          const needsVertical = actualContentSize.height > contentBounds.height;
          const needsHorizontal = actualContentSize.width > contentBounds.width;

          if (needsVertical) {
            viewport.scrollbars.vertical = {
              bounds: {
                x: contentBounds.x + contentBounds.width - 1,
                y: contentBounds.y,
                width: 1,
                height: contentBounds.height
              },
              trackLength: contentBounds.height,
              thumbPosition: 0, // Will be calculated by viewport manager
              thumbSize: Math.max(1, Math.floor(contentBounds.height * contentBounds.height / actualContentSize.height)),
              visible: true
            };
          }

          if (needsHorizontal) {
            viewport.scrollbars.horizontal = {
              bounds: {
                x: contentBounds.x,
                y: contentBounds.y + contentBounds.height - 1,
                width: needsVertical ? contentBounds.width - 1 : contentBounds.width,
                height: 1
              },
              trackLength: needsVertical ? contentBounds.width - 1 : contentBounds.width,
              thumbPosition: 0, // Will be calculated by viewport manager
              thumbSize: Math.max(1, Math.floor(contentBounds.width * contentBounds.width / actualContentSize.width)),
              visible: true
            };
          }

          node.scrollbars = viewport.scrollbars;
        }

        // Use real content dimensions instead of artificial virtual space
        const actualContentHeight = Math.max(actualContentSize.height, contentBounds.height);

        childContext = {
          ...context,
          parentBounds: {
            x: contentBounds.x,
            y: contentBounds.y,
            width: contentBounds.width, // Use actual width for proper layout
            height: actualContentHeight, // Real content height, not 10000
          },
          availableSpace: {
            width: contentBounds.width,
            height: actualContentHeight // Real content height for proper layout
          },
          parentStyle: computedStyle,
          parentLayoutProps: layoutProps,
        };
      } else {
        // Normal layout - constrain children to actual content bounds
        childContext = {
          ...context,
          parentBounds: contentBounds,
          availableSpace: { width: contentBounds.width, height: contentBounds.height },
          parentStyle: computedStyle,
          parentLayoutProps: layoutProps,
        };
      }

      const childrenStartTime = performance.now();
      node.children = this._layoutChildren(children, childContext, node);
      logger.trace(`Children layout completed in ${(performance.now() - childrenStartTime).toFixed(2)}ms`, {
        elementId: element.id,
        childCount: children.length,
      });
    }

    const totalTime = performance.now() - startTime;
    if (totalTime > 20) { // Log slow layouts
      logger.warn(`Slow layout detected for ${element.type}: ${totalTime.toFixed(2)}ms`, {
        elementId: element.id,
        elementType: element.type,
        bounds,
      });
    }

    return node;
  }

  // Layout children based on parent display type
  private _layoutChildren(
    children: Element[],
    context: LayoutContext,
    parentNode: LayoutNode
  ): LayoutNode[] {
    const { layoutProps } = parentNode;


    switch (layoutProps.display) {
      case 'flex':
        return this._layoutFlex(children, context, parentNode);
      case 'block':
      default:
        return this._layoutBlock(children, context, parentNode);
    }
  }

  // Block layout (vertical stacking)
  private _layoutBlock(
    children: Element[],
    context: LayoutContext,
    parentNode: LayoutNode
  ): LayoutNode[] {
    const nodes: LayoutNode[] = [];
    let currentY = context.parentBounds.y;


    // First pass: handle normal flow elements
    for (const child of children) {
      // Skip invisible elements - they don't participate in layout
      if (child.props?.visible === false) continue;
      // Skip elements with display: none
      if (this._isDisplayNone(child)) continue;

      const childLayoutProps = this._computeLayoutProps(child);
      const childText = (child.props as any)?.text;


      if (childLayoutProps.position === 'absolute' || childLayoutProps.position === 'fixed') {
        // Skip absolute positioned elements in first pass
        continue;
      }

      const childContext: LayoutContext = {
        ...context,
        parentBounds: {
          x: context.parentBounds.x,
          y: currentY,
          width: context.parentBounds.width,
          height: context.parentBounds.height - (currentY - context.parentBounds.y),
        },
        availableSpace: {
          width: context.availableSpace.width,
          height: context.parentBounds.height - (currentY - context.parentBounds.y),
        },
        parentLayoutProps: parentNode.layoutProps, // Use the current element's layout props, not inherited from grandparent
      };

      const childNode = this.calculateLayout(child, childContext, parentNode);
      nodes.push(childNode);

      // Advance Y position for next child
      const margin = childNode.computedStyle.margin || 0;
      const marginBottom = typeof margin === 'number' ? margin : (margin as BoxSpacing).bottom || 0;
      currentY += childNode.bounds.height + marginBottom;

      if (currentY >= context.parentBounds.y + context.parentBounds.height) {
        break;
      }
    }

    // Second pass: handle absolute positioned elements
    for (const child of children) {
      // Skip invisible elements
      if (child.props?.visible === false) continue;
      // Skip elements with display: none
      if (this._isDisplayNone(child)) continue;

      const childLayoutProps = this._computeLayoutProps(child);
      const childText = (child.props as any)?.text;

      if (childLayoutProps.position === 'absolute' || childLayoutProps.position === 'fixed') {
        const absoluteNode = this._layoutAbsolute(child, context, parentNode);
        nodes.push(absoluteNode);
      }
    }

    return nodes;
  }

  // Improved Flexbox layout based on correct algorithm
  private _layoutFlex(
    children: Element[],
    context: LayoutContext,
    parentNode: LayoutNode
  ): LayoutNode[] {
    const flexStartTime = performance.now();
    logger.trace(`Starting flexbox layout with ${children.length} children`, {
      parentId: parentNode.element.id,
      childCount: children.length,
      flexDirection: parentNode.layoutProps.flexDirection,
      flexWrap: parentNode.layoutProps.flexWrap,
      justifyContent: parentNode.layoutProps.justifyContent,
      alignItems: parentNode.layoutProps.alignItems,
    });

    const flexProps = parentNode.layoutProps;
    const isRow = flexProps.flexDirection === 'row' || flexProps.flexDirection === 'row-reverse';
    const isReverse = flexProps.flexDirection === 'row-reverse' || flexProps.flexDirection === 'column-reverse';
    const isWrap = flexProps.flexWrap !== 'nowrap';
    const isWrapReverse = flexProps.flexWrap === 'wrap-reverse';
    const gap = flexProps.gap || 0;  // Gap between flex items (from style)

    // Calculate available space early (needed for stretch calculations)
    const mainAxisSize = isRow ? context.availableSpace.width : context.availableSpace.height;
    const crossAxisSize = isRow ? context.availableSpace.height : context.availableSpace.width;


    // Filter out absolutely positioned children and invisible children
    const flexChildren = children.filter(child => {
      // Skip invisible elements - they don't participate in layout
      if (child.props?.visible === false) return false;
      // Skip elements with display: none
      if (this._isDisplayNone(child)) return false;
      const childProps = this._computeLayoutProps(child);
      return childProps.position !== 'absolute' && childProps.position !== 'fixed';
    });

    const absoluteChildren = children.filter(child => {
      // Skip invisible elements
      if (child.props?.visible === false) return false;
      // Skip elements with display: none
      if (this._isDisplayNone(child)) return false;
      const childProps = this._computeLayoutProps(child);
      return childProps.position === 'absolute' || childProps.position === 'fixed';
    });

    logger.trace(`Filtered to ${flexChildren.length} flex children (${absoluteChildren.length} absolute)`);

    if (flexChildren.length === 0) {
      // Only absolutely positioned children
      return absoluteChildren.map(child =>
        this._layoutAbsolute(child, context, parentNode)
      );
    }

    // Step 1: Calculate hypothetical sizes for flex children
    const intrinsicStartTime = performance.now();
    const flexItems = flexChildren.map(child => {
      const childProps = this._computeLayoutProps(child);
      const childStyle = this._computeStyle(child, context.parentStyle);

      // Calculate intrinsic size (content only, WITHOUT padding/borders for flex)
      // Flex algorithm handles padding separately
      let contentSize = { width: 10, height: 1 }; // Default fallback
      if (isRenderable(child)) {
        const intrinsicSizeContext: IntrinsicSizeContext = {
          availableSpace: context.availableSpace
        };
        try {
          contentSize = child.intrinsicSize(intrinsicSizeContext);
        } catch (error) {
          console.error(`Error calculating intrinsic size for element ${child.type}:`, error);
        }
      } else {
        // For non-renderable elements (containers), calculate intrinsic size
        contentSize = this._calculateIntrinsicSize(child, childStyle, context);
      }
      const intrinsicSize = contentSize; // Use content size directly, don't add padding yet

      // Calculate margins
      const margin = childStyle.margin || 0;
      let marginMain = 0;
      let marginCross = 0;
      let marginStart = 0;  // For main axis positioning
      let marginEnd = 0;
      let marginCrossStart = 0;  // For cross axis positioning
      let marginCrossEnd = 0;

      if (typeof margin === 'number') {
        marginMain = margin * 2;
        marginCross = margin * 2;
        marginStart = margin;
        marginEnd = margin;
        marginCrossStart = margin;
        marginCrossEnd = margin;
      } else if (typeof margin === 'object') {
        const m = margin as BoxSpacing;
        if (isRow) {
          marginMain = (m.left || 0) + (m.right || 0);
          marginCross = (m.top || 0) + (m.bottom || 0);
          marginStart = m.left || 0;
          marginEnd = m.right || 0;
          marginCrossStart = m.top || 0;
          marginCrossEnd = m.bottom || 0;
        } else {
          marginMain = (m.top || 0) + (m.bottom || 0);
          marginCross = (m.left || 0) + (m.right || 0);
          marginStart = m.top || 0;
          marginEnd = m.bottom || 0;
          marginCrossStart = m.left || 0;
          marginCrossEnd = m.right || 0;
        }
      }

      // Calculate padding
      const padding = childStyle.padding || 0;
      let paddingMain = 0;
      let paddingCross = 0;

      if (typeof padding === 'number') {
        paddingMain = padding * 2;
        paddingCross = padding * 2;
      } else if (typeof padding === 'object') {
        const p = padding as BoxSpacing;
        if (isRow) {
          paddingMain = (p.left || 0) + (p.right || 0);
          paddingCross = (p.top || 0) + (p.bottom || 0);
        } else {
          paddingMain = (p.top || 0) + (p.bottom || 0);
          paddingCross = (p.left || 0) + (p.right || 0);
        }
      }

      // Calculate border dimensions
      const borderTop = childStyle.borderTop || (childStyle.border && childStyle.border !== 'none' ? childStyle.border : undefined);
      const borderRight = childStyle.borderRight || (childStyle.border && childStyle.border !== 'none' ? childStyle.border : undefined);
      const borderBottom = childStyle.borderBottom || (childStyle.border && childStyle.border !== 'none' ? childStyle.border : undefined);
      const borderLeft = childStyle.borderLeft || (childStyle.border && childStyle.border !== 'none' ? childStyle.border : undefined);

      const borderTopWidth = borderTop && borderTop !== 'none' ? 1 : 0;
      const borderRightWidth = borderRight && borderRight !== 'none' ? 1 : 0;
      const borderBottomWidth = borderBottom && borderBottom !== 'none' ? 1 : 0;
      const borderLeftWidth = borderLeft && borderLeft !== 'none' ? 1 : 0;

      let borderMain = 0;
      let borderCross = 0;

      if (isRow) {
        borderMain = borderLeftWidth + borderRightWidth;
        borderCross = borderTopWidth + borderBottomWidth;
      } else {
        borderMain = borderTopWidth + borderBottomWidth;
        borderCross = borderLeftWidth + borderRightWidth;
      }

      // Calculate flex basis (base size on main axis)
      // flexBasis should be content size + padding + borders (element's full outer size)
      //
      // Use intrinsicSize for renderable elements (handles responsive sizing like percentage-based images)
      // Each element's intrinsicSize() is responsible for returning the correct size:
      // - Containers with explicit style.width/height return those values
      // - Images with percentage dimensions calculate from available space
      // - Canvas returns props.width/height
      const useIntrinsicSize = isRenderable(child);

      let flexBasisValue: number;
      if (childProps.flexBasis === 'auto') {
        if (isRow) {
          if (!useIntrinsicSize && typeof childProps.width === 'number') {
            flexBasisValue = childProps.width;
          } else if (childProps.width === 'fill') {
            // For "fill" width in flex context, treat as flexible
            flexBasisValue = 0;
          } else {
            // Use intrinsic size + padding + borders
            flexBasisValue = intrinsicSize.width + paddingMain + borderMain;
          }
        } else {
          if (!useIntrinsicSize && typeof childProps.height === 'number') {
            flexBasisValue = childProps.height;
          } else if (childProps.height === 'fill') {
            // For "fill" height in flex context, treat as flexible
            flexBasisValue = 0;
          } else {
            // Use intrinsic size + padding + borders
            flexBasisValue = intrinsicSize.height + paddingMain + borderMain;
          }
        }
      } else {
        flexBasisValue = typeof childProps.flexBasis === 'number' ? childProps.flexBasis : 0;
      }


      // Auto-set flexGrow for "fill" elements if not explicitly set
      let flexGrow = childProps.flexGrow || 0;
      if (flexGrow === 0) {
        if ((isRow && childProps.width === 'fill') ||
            (!isRow && childProps.height === 'fill')) {
          flexGrow = 1; // Auto-grow for fill elements
        }
      }

      // Calculate base cross size (also needs padding and borders added)
      let baseCross: number;

      // Check if item will be stretched (default align-items is 'stretch')
      // When wrapping is enabled, don't stretch items to full container size during base size calculation
      // as this would make each wrapped line too large. Items will be stretched to their line's size later.
      const willStretch = (childProps.alignSelf === 'auto' || childProps.alignSelf === undefined || childProps.alignSelf === 'stretch') &&
                         (flexProps.alignItems === undefined || flexProps.alignItems === 'stretch') &&
                         !isWrap; // Don't stretch during base size calc when wrapping


      if (isRow) {
        if (!useIntrinsicSize && typeof childProps.height === 'number') {
          baseCross = childProps.height;
        } else if (willStretch) {
          // For stretch alignment, use available space but ensure minimum intrinsic size
          const intrinsicOuter = intrinsicSize.height + paddingCross + borderCross;
          baseCross = Math.max(crossAxisSize, intrinsicOuter);
        } else {
          // Use intrinsic size + padding + borders for cross axis (outer size)
          baseCross = intrinsicSize.height + paddingCross + borderCross;
        }
      } else {
        if (!useIntrinsicSize && typeof childProps.width === 'number') {
          baseCross = childProps.width;
        } else if (willStretch) {
          // For stretch alignment, use available space but ensure minimum intrinsic size
          const intrinsicOuter = intrinsicSize.width + paddingCross + borderCross;
          baseCross = Math.max(crossAxisSize, intrinsicOuter);
        } else {
          // Use intrinsic size + padding + borders for cross axis (outer size)
          baseCross = intrinsicSize.width + paddingCross + borderCross;
        }
      }

      return {
        element: child,
        flexGrow: flexGrow,
        flexShrink: childProps.flexShrink || 1,
        flexBasis: flexBasisValue,
        hypotheticalMain: flexBasisValue,  // Base size including padding
        outerMain: flexBasisValue + marginMain,  // Outer size with padding + margin
        baseCross: baseCross,
        outerCross: baseCross + marginCross,  // Outer cross with padding + margin
        intrinsicSize,
        style: childStyle,
        props: childProps,
        marginMain,
        marginCross,
        marginStart,
        marginEnd,
        marginCrossStart,
        marginCrossEnd,
        paddingMain,
        paddingCross,
      };
    });

    logger.trace(`Intrinsic sizes calculated in ${(performance.now() - intrinsicStartTime).toFixed(2)}ms`, {
      itemCount: flexItems.length,
    });

    logger.trace(`Flex axis sizes - main: ${mainAxisSize}, cross: ${crossAxisSize}`);

    // Safeguard: If mainAxisSize is NaN, fallback to block layout
    if (isNaN(mainAxisSize) || isNaN(crossAxisSize)) {
      return this._layoutBlock(children, context, parentNode);
    }

    // Step 2: Collect items into flex lines
    interface FlexLine {
      items: typeof flexItems;
      mainSize: number;
      crossSize: number;
    }

    const flexLines: FlexLine[] = [];
    const lineStartTime = performance.now();

    if (!isWrap) {
      // No wrap - all items on one line
      flexLines.push({
        items: [...flexItems],
        mainSize: 0,
        crossSize: 0,
      });
    } else {
      // Wrap - break into lines based on available space
      let currentLine: FlexLine = { items: [], mainSize: 0, crossSize: 0 };
      let currentMainPos = 0;

      flexItems.forEach((item) => {
        const gapBefore = currentLine.items.length > 0 ? gap : 0;
        const newMainPos = currentMainPos + gapBefore + item.outerMain;

        if (currentLine.items.length > 0 && newMainPos > mainAxisSize) {
          // Start new line
          flexLines.push(currentLine);
          currentLine = { items: [item], mainSize: item.outerMain, crossSize: item.outerCross };
          currentMainPos = item.outerMain;
        } else {
          currentLine.items.push(item);
          currentLine.mainSize = newMainPos;
          currentLine.crossSize = Math.max(currentLine.crossSize, item.outerCross);
          currentMainPos = newMainPos;
        }
      });

      if (currentLine.items.length > 0) {
        flexLines.push(currentLine);
      }
    }

    logger.trace(`Flex lines collected in ${(performance.now() - lineStartTime).toFixed(2)}ms`, {
      lineCount: flexLines.length,
    });

    // Step 3: Resolve flexible lengths per line
    const resolveLengthsStartTime = performance.now();
    flexLines.forEach(line => {
      const lineItems = line.items;
      const totalGaps = gap * Math.max(0, lineItems.length - 1);
      const totalOuter = lineItems.reduce((sum, item) => sum + item.outerMain, 0);
      const freeSpace = mainAxisSize - totalOuter - totalGaps;

      if (freeSpace >= 0) {
        // Grow items
        const totalGrow = lineItems.reduce((sum, item) => sum + item.flexGrow, 0);

        lineItems.forEach(item => {
          if (totalGrow > 0) {
            const growShare = (item.flexGrow / totalGrow) * freeSpace;
            (item as any).finalMain = item.hypotheticalMain + growShare;
          } else {
            (item as any).finalMain = item.hypotheticalMain;
          }
        });
      } else {
        // Shrink items
        const totalShrinkScaled = lineItems.reduce((sum, item) =>
          sum + (item.flexShrink * item.hypotheticalMain), 0
        );

        lineItems.forEach(item => {
          if (totalShrinkScaled > 0) {
            const scaledShrink = item.flexShrink * item.hypotheticalMain;
            const shrinkRatio = scaledShrink / totalShrinkScaled;
            const shrinkAmount = shrinkRatio * Math.abs(freeSpace);
            (item as any).finalMain = Math.max(0, item.hypotheticalMain - shrinkAmount);
          } else {
            (item as any).finalMain = item.hypotheticalMain;
          }
        });
      }
    });

    // Step 4: Calculate line cross sizes
    flexLines.forEach(line => {
      line.crossSize = Math.max(...line.items.map(item => item.outerCross));
    });

    const totalLineCross = flexLines.reduce((sum, line) => sum + line.crossSize, 0);
    const crossGaps = gap * Math.max(0, flexLines.length - 1);
    const freeCrossSpace = crossAxisSize - totalLineCross - crossGaps;

    // Step 5: Align lines (align-content)
    let linePositions: number[] = [];

    if (flexLines.length === 1 && !isWrap) {
      // Single line nowrap - align-content has no effect
      linePositions = [0];
      // Only use container's cross size if it's explicitly set, otherwise use calculated size
      // 'fill' counts as explicit because the container is constrained to available space
      const hasExplicitCrossSize = isRow
        ? (typeof parentNode.layoutProps.height === 'number' || parentNode.layoutProps.height === 'fill')
        : (typeof parentNode.layoutProps.width === 'number' || parentNode.layoutProps.width === 'fill');
      if (hasExplicitCrossSize) {
        flexLines[0].crossSize = crossAxisSize;
      }
      // else: keep the calculated crossSize from line 661
    } else {
      let pos = 0;

      switch (flexProps.alignContent || 'stretch') {
        case 'flex-start':
          pos = 0;
          flexLines.forEach(line => {
            linePositions.push(pos);
            pos += line.crossSize + gap;
          });
          break;

        case 'flex-end':
          pos = freeCrossSpace;
          flexLines.forEach(line => {
            linePositions.push(pos);
            pos += line.crossSize + gap;
          });
          break;

        case 'center':
          pos = freeCrossSpace / 2;
          flexLines.forEach(line => {
            linePositions.push(pos);
            pos += line.crossSize + gap;
          });
          break;

        case 'space-between': {
          const spaceBetween = flexLines.length > 1 ? freeCrossSpace / (flexLines.length - 1) : 0;
          pos = 0;
          flexLines.forEach(line => {
            linePositions.push(pos);
            pos += line.crossSize + spaceBetween + gap;
          });
          break;
        }

        case 'space-around': {
          const spaceAround = freeCrossSpace / (flexLines.length * 2);
          pos = spaceAround;
          flexLines.forEach(line => {
            linePositions.push(pos);
            pos += line.crossSize + spaceAround * 2 + gap;
          });
          break;
        }

        case 'stretch':
        default: {
          const extraPerLine = Math.max(0, freeCrossSpace / flexLines.length);
          pos = 0;
          flexLines.forEach(line => {
            linePositions.push(pos);
            line.crossSize += extraPerLine;
            pos += line.crossSize + gap;
          });
          break;
        }
      }
    }

    // Apply wrap-reverse if needed
    if (isWrapReverse) {
      linePositions = linePositions.map((pos, i) =>
        crossAxisSize - pos - flexLines[i].crossSize
      );
    }

    logger.trace(`Flexible lengths resolved in ${(performance.now() - resolveLengthsStartTime).toFixed(2)}ms`);

    // Step 6: Position items on main axis (justify-content) and cross axis (align-items)
    const positioningStartTime = performance.now();
    const nodes: LayoutNode[] = [];

    flexLines.forEach((line, lineIndex) => {
      const lineItems = line.items;
      const totalGaps = gap * Math.max(0, lineItems.length - 1);
      const totalMainUsed = lineItems.reduce((sum, item) => sum + (item as any).finalMain + item.marginMain, 0);
      const remainingSpace = mainAxisSize - totalMainUsed - totalGaps;

      let mainPositions: number[] = [];
      let pos = 0;

      switch (flexProps.justifyContent || 'flex-start') {
        case 'flex-start':
          pos = 0;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += (item as any).finalMain + item.marginMain + (i < lineItems.length - 1 ? gap : 0);
          });
          break;

        case 'flex-end':
          pos = remainingSpace;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += (item as any).finalMain + item.marginMain + (i < lineItems.length - 1 ? gap : 0);
          });
          break;

        case 'center':
          pos = remainingSpace / 2;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += (item as any).finalMain + item.marginMain + (i < lineItems.length - 1 ? gap : 0);
          });
          break;

        case 'space-between': {
          const spaceBetween = lineItems.length > 1 ? remainingSpace / (lineItems.length - 1) : 0;
          pos = 0;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += (item as any).finalMain + item.marginMain + spaceBetween + (i < lineItems.length - 1 ? gap : 0);
          });
          break;
        }

        case 'space-around': {
          const spaceAround = remainingSpace / (lineItems.length * 2);
          pos = spaceAround;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += (item as any).finalMain + item.marginMain + spaceAround * 2 + (i < lineItems.length - 1 ? gap : 0);
          });
          break;
        }

        case 'space-evenly': {
          const spaceEvenly = remainingSpace / (lineItems.length + 1);
          pos = spaceEvenly;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += (item as any).finalMain + item.marginMain + spaceEvenly + (i < lineItems.length - 1 ? gap : 0);
          });
          break;
        }
      }

      // Apply reverse if needed
      if (isReverse) {
        mainPositions = mainPositions.map((p, i) =>
          mainAxisSize - p - (lineItems[i] as any).finalMain
        );
      }

      // Position items on cross axis (align-items)
      const lineCrossStart = linePositions[lineIndex];
      const lineCrossSize = line.crossSize;

      lineItems.forEach((item, i) => {
        const mainPos = mainPositions[i];
        let crossPos: number;
        let finalCross: number;

        // Handle align-self first, then fall back to align-items
        const alignment = item.props.alignSelf === 'auto' ? (flexProps.alignItems || 'stretch') : item.props.alignSelf;

        switch (alignment) {
          case 'flex-start':
            crossPos = lineCrossStart + item.marginCrossStart;
            // baseCross already includes padding+border (from explicit size or intrinsic+chrome)
            finalCross = item.baseCross;
            break;

          case 'flex-end':
            // baseCross already includes padding+border (from explicit size or intrinsic+chrome)
            finalCross = item.baseCross;
            crossPos = lineCrossStart + lineCrossSize - finalCross - item.marginCrossEnd;
            break;

          case 'center':
            // baseCross already includes padding+border (from explicit size or intrinsic+chrome)
            finalCross = item.baseCross;
            const totalCross = finalCross + item.marginCross;
            crossPos = lineCrossStart + (lineCrossSize - totalCross) / 2 + item.marginCrossStart;
            break;

          case 'stretch':
          default:
            crossPos = lineCrossStart + item.marginCrossStart;
            finalCross = lineCrossSize - item.marginCross;
            break;
        }

        // Ensure non-container elements get at least their minimum size
        // (containers can have 0 height, but buttons/text/etc need at least 1 line)
        // Note: baseCross already includes padding+border (from explicit size or intrinsic+chrome)
        const isContainer = item.element.type === 'container';
        if (!isContainer) {
          const minCross = item.baseCross;
          finalCross = Math.max(finalCross, minCross);
        }

        // Create bounds based on main/cross axes
        // Note: finalMain already includes padding, we want total size including padding
        let bounds: Bounds;
        if (isRow) {
          bounds = {
            x: Math.round(context.parentBounds.x + mainPos),
            y: Math.round(context.parentBounds.y + crossPos),
            width: Math.round((item as any).finalMain),
            height: Math.round(finalCross),
          };
        } else {
          bounds = {
            x: Math.round(context.parentBounds.x + crossPos),
            y: Math.round(context.parentBounds.y + mainPos),
            width: Math.round(finalCross),
            height: Math.round((item as any).finalMain),
          };
        }

        const childContext: LayoutContext = {
          ...context,
          parentBounds: bounds,
          availableSpace: { width: bounds.width, height: bounds.height },
        };

        const childNode = this.calculateLayout(item.element, childContext, parentNode);
        nodes.push(childNode);
      });
    });

    // Add absolutely positioned children
    absoluteChildren.forEach(child => {
      const absoluteNode = this._layoutAbsolute(child, context, parentNode);
      nodes.push(absoluteNode);
    });

    logger.trace(`Items positioned in ${(performance.now() - positioningStartTime).toFixed(2)}ms`);

    const flexTotalTime = performance.now() - flexStartTime;
    logger.trace(`Flexbox layout completed in ${flexTotalTime.toFixed(2)}ms`, {
      parentId: parentNode.element.id,
      nodeCount: nodes.length,
      lineCount: flexLines.length,
    });

    if (flexTotalTime > 20) {
      logger.warn(`Slow flexbox layout: ${flexTotalTime.toFixed(2)}ms for ${nodes.length} items in ${flexLines.length} lines`);
    }

    return nodes;
  }



  // Absolute positioning
  private _layoutAbsolute(
    element: Element,
    context: LayoutContext,
    parentNode: LayoutNode
  ): LayoutNode {
    const layoutProps = this._computeLayoutProps(element);
    const style = this._computeStyle(element, context.parentStyle);

    // Calculate position based on top/right/bottom/left
    const containingBlock = layoutProps.position === 'fixed' ?
      context.viewport :
      context.parentBounds;

    let x = containingBlock.x;
    let y = containingBlock.y;
    let width: number | 'auto' = 'auto';
    let height: number | 'auto' = 'auto';

    // Calculate position and size
    if (layoutProps.left !== undefined) {
      x = containingBlock.x + layoutProps.left;
    } else if (layoutProps.right !== undefined) {
      x = containingBlock.x + containingBlock.width - layoutProps.right;
    }

    if (layoutProps.top !== undefined) {
      y = containingBlock.y + layoutProps.top;
    } else if (layoutProps.bottom !== undefined) {
      y = containingBlock.y + containingBlock.height - layoutProps.bottom;
    }

    // Use explicit width/height if provided
    if (layoutProps.width !== undefined && typeof layoutProps.width === 'number') {
      width = layoutProps.width;
    }
    if (layoutProps.height !== undefined && typeof layoutProps.height === 'number') {
      height = layoutProps.height;
    }

    // Calculate intrinsic size if needed
    const intrinsicSize = this._calculateIntrinsicSize(element, style, context);
    if (width === 'auto') width = intrinsicSize.width;
    if (height === 'auto') height = intrinsicSize.height;


    const bounds: Bounds = {
      x,
      y,
      width: typeof width === 'number' ? width : intrinsicSize.width,
      height: typeof height === 'number' ? height : intrinsicSize.height,
    };

    const absoluteContext: LayoutContext = {
      ...context,
      parentBounds: bounds,
      availableSpace: { width: bounds.width, height: bounds.height },
    };

    return this.calculateLayout(element, absoluteContext, parentNode);
  }

  // Helper methods

  private _computeStyle(element: Element, parentStyle?: Style): Style {
    // Merge parent style with element style
    const defaultStyle: Style = {
      color: getThemeColor('textPrimary'),
      backgroundColor: getThemeColor('background'),
      fontWeight: 'normal',
      border: 'none',
      borderColor: getThemeColor('border'),
      padding: 0,
      margin: 0,
      boxSizing: 'border-box',
    };

    // Apply element-type-specific defaults (lowest priority)
    // These can be overridden by stylesheet and inline styles
    let typeDefaults: Partial<Style> = {};
    if (element.type === 'container') {
      typeDefaults = {
        display: 'flex',
        flexDirection: 'column',
        overflow: 'visible',
      };
    }

    // Only inherit specific properties (whitelist approach)
    const inheritableParentStyle: Partial<Style> = parentStyle ? {
      // Text and color properties that should inherit
      color: parentStyle.color,
      backgroundColor : parentStyle.backgroundColor,
      fontWeight: parentStyle.fontWeight,
      borderColor: parentStyle.borderColor, // Border color can inherit for consistency
    } : {};

    const mergedStyle = {
      ...defaultStyle,
      ...typeDefaults,  // Type-specific defaults (can be overridden by stylesheet/inline)
      ...inheritableParentStyle,
      ...(element.props && element.props.style),  // Stylesheet + inline styles
    };

    // Normalize padding and margin: consolidate individual properties into BoxSpacing
    return this._normalizeBoxSpacing(mergedStyle);
  }

  /**
   * Consolidate individual padding/margin properties (paddingLeft, marginTop, etc.)
   * into BoxSpacing objects for consistent handling
   */
  private _normalizeBoxSpacing(style: Style): Style {
    const result = { ...style };

    // Normalize padding
    const paddingTop = (style as any).paddingTop;
    const paddingRight = (style as any).paddingRight;
    const paddingBottom = (style as any).paddingBottom;
    const paddingLeft = (style as any).paddingLeft;

    if (paddingTop !== undefined || paddingRight !== undefined ||
        paddingBottom !== undefined || paddingLeft !== undefined) {
      // Get base padding value (could be number or object)
      const basePadding = style.padding;
      let baseTop = 0, baseRight = 0, baseBottom = 0, baseLeft = 0;

      if (typeof basePadding === 'number') {
        baseTop = baseRight = baseBottom = baseLeft = basePadding;
      } else if (basePadding && typeof basePadding === 'object') {
        const p = basePadding as BoxSpacing;
        baseTop = p.top || 0;
        baseRight = p.right || 0;
        baseBottom = p.bottom || 0;
        baseLeft = p.left || 0;
      }

      // Override with individual properties
      result.padding = {
        top: paddingTop !== undefined ? paddingTop : baseTop,
        right: paddingRight !== undefined ? paddingRight : baseRight,
        bottom: paddingBottom !== undefined ? paddingBottom : baseBottom,
        left: paddingLeft !== undefined ? paddingLeft : baseLeft,
      };

      // Clean up individual properties
      delete (result as any).paddingTop;
      delete (result as any).paddingRight;
      delete (result as any).paddingBottom;
      delete (result as any).paddingLeft;
    }

    // Normalize margin
    const marginTop = (style as any).marginTop;
    const marginRight = (style as any).marginRight;
    const marginBottom = (style as any).marginBottom;
    const marginLeft = (style as any).marginLeft;

    if (marginTop !== undefined || marginRight !== undefined ||
        marginBottom !== undefined || marginLeft !== undefined) {
      // Get base margin value (could be number or object)
      const baseMargin = style.margin;
      let baseTop = 0, baseRight = 0, baseBottom = 0, baseLeft = 0;

      if (typeof baseMargin === 'number') {
        baseTop = baseRight = baseBottom = baseLeft = baseMargin;
      } else if (baseMargin && typeof baseMargin === 'object') {
        const m = baseMargin as BoxSpacing;
        baseTop = m.top || 0;
        baseRight = m.right || 0;
        baseBottom = m.bottom || 0;
        baseLeft = m.left || 0;
      }

      // Override with individual properties
      result.margin = {
        top: marginTop !== undefined ? marginTop : baseTop,
        right: marginRight !== undefined ? marginRight : baseRight,
        bottom: marginBottom !== undefined ? marginBottom : baseBottom,
        left: marginLeft !== undefined ? marginLeft : baseLeft,
      };

      // Clean up individual properties
      delete (result as any).marginTop;
      delete (result as any).marginRight;
      delete (result as any).marginBottom;
      delete (result as any).marginLeft;
    }

    return result;
  }

  private _computeLayoutProps(element: Element, parentProps?: AdvancedLayoutProps): AdvancedLayoutProps {
    // Filter out properties that should not be inherited from parent:
    // - Size and position properties are element-specific
    // - flexDirection defines how a container lays out its children, not how the container itself is laid out
    // - gap is specific to each flex container
    const inheritableParentProps = parentProps ? {
      ...parentProps,
      width: undefined,
      height: undefined,
      left: undefined,
      right: undefined,
      top: undefined,
      bottom: undefined,
      flexDirection: undefined,  // Each container defines its own flex direction
      gap: undefined,
    } : undefined;

    const result = {
      ...this._defaultLayoutProps,
      ...inheritableParentProps,
      ...element.props,
    };

    // Extract flex and layout properties from style section
    const style = (element.props && element.props.style) || {};

    // Support flex shorthand in style: flex: "1" or flex: "0 0 auto" etc
    if (style.flex !== undefined) {
      const flexValue = typeof style.flex === 'string' ? style.flex : String(style.flex);
      const flexParts = flexValue.split(' ').map((part: string) => part.trim());

      if (flexParts.length === 1) {
        // flex: "1" -> flex-grow: 1, flex-shrink: 1, flex-basis: 0
        const grow = parseFloat(flexParts[0]);
        if (!isNaN(grow)) {
          result.flexGrow = grow;
          result.flexShrink = 1;
          result.flexBasis = grow > 0 ? 0 : 'auto';
        }
      } else if (flexParts.length === 3) {
        // flex: "1 1 auto" -> flex-grow: 1, flex-shrink: 1, flex-basis: auto
        const grow = parseFloat(flexParts[0]);
        const shrink = parseFloat(flexParts[1]);
        const basis = flexParts[2] === 'auto' ? 'auto' : parseFloat(flexParts[2]);

        if (!isNaN(grow)) result.flexGrow = grow;
        if (!isNaN(shrink)) result.flexShrink = shrink;
        if (basis === 'auto') {
          result.flexBasis = 'auto';
        } else if (basis !== undefined && !isNaN(basis as number)) {
          result.flexBasis = basis;
        }
      }
    }

    // Support individual flex properties in style
    if (style.flexGrow !== undefined) {
      const grow = typeof style.flexGrow === 'string' ? parseFloat(style.flexGrow) : style.flexGrow;
      if (!isNaN(grow)) result.flexGrow = grow;
    }

    if (style.flexShrink !== undefined) {
      const shrink = typeof style.flexShrink === 'string' ? parseFloat(style.flexShrink) : style.flexShrink;
      if (!isNaN(shrink)) result.flexShrink = shrink;
    }

    if (style.flexBasis !== undefined) {
      if (style.flexBasis === 'auto') {
        result.flexBasis = 'auto';
      } else {
        const basis = typeof style.flexBasis === 'string' ? parseFloat(style.flexBasis) : style.flexBasis;
        if (!isNaN(basis)) result.flexBasis = basis;
      }
    }

    // Support all layout properties in style
    if (style.display !== undefined) result.display = style.display;
    if (style.flexDirection !== undefined) result.flexDirection = style.flexDirection;
    if (style.justifyContent !== undefined) result.justifyContent = style.justifyContent;
    if (style.alignItems !== undefined) result.alignItems = style.alignItems;
    if (style.alignContent !== undefined) result.alignContent = style.alignContent;
    if (style.flexWrap !== undefined) result.flexWrap = style.flexWrap;
    if (style.alignSelf !== undefined) result.alignSelf = style.alignSelf;
    if (style.gap !== undefined) result.gap = style.gap;
    if (style.position !== undefined) result.position = style.position;
    if (style.top !== undefined) result.top = style.top;
    if (style.right !== undefined) result.right = style.right;
    if (style.bottom !== undefined) result.bottom = style.bottom;
    if (style.left !== undefined) result.left = style.left;
    if (style.zIndex !== undefined) result.zIndex = style.zIndex;
    if (style.overflow !== undefined) result.overflow = style.overflow;
    if (style.width !== undefined) result.width = style.width;
    if (style.height !== undefined) result.height = style.height;


    // No special cases - all elements inherit layout properties normally

    return result;
  }

  private _calculateElementBounds(
    element: Element,
    style: Style,
    layoutProps: AdvancedLayoutProps,
    context: LayoutContext
  ): Bounds {

    // If we're in a flex context and the parent has already calculated precise bounds,
    // use the parent bounds directly (flex parent already calculated the size)
    // We detect this by checking if:
    // 1. Element has explicit flex properties (non-default), OR
    // 2. Parent bounds exactly match available space AND parentBounds has exact positioning
    //    (this indicates flex layout has set precise bounds)
    const hasExplicitFlexProps = (layoutProps.flexGrow !== undefined && layoutProps.flexGrow !== 0) ||
                                (layoutProps.flexShrink !== undefined && layoutProps.flexShrink !== 1) ||
                                (layoutProps.flexBasis !== undefined && layoutProps.flexBasis !== 'auto');

    const isFlexCalculatedBounds = context.parentBounds &&
                                   context.parentLayoutProps?.display === 'flex' &&
                                   context.availableSpace.width === context.parentBounds.width &&
                                   context.availableSpace.height === context.parentBounds.height &&
                                   // Additional check: bounds seem specifically positioned (not just defaults)
                                   (context.parentBounds.x !== 0 || context.parentBounds.y !== 0 ||
                                    context.parentBounds.width < context.viewport?.width ||
                                    context.parentBounds.height < context.viewport?.height);

    if ((hasExplicitFlexProps || isFlexCalculatedBounds) &&
        context.parentBounds &&
        context.availableSpace.width === context.parentBounds.width &&
        context.availableSpace.height === context.parentBounds.height) {
      return context.parentBounds;
    }

    const intrinsicSize = this._calculateIntrinsicSize(element, style, context);

    let width = intrinsicSize.width;
    let height = intrinsicSize.height;

    // For flex containers with no explicit size, use available space instead of intrinsic
    // This allows flex children to grow properly
    const isFlexContainer = layoutProps.display === 'flex';
    const hasExplicitWidth = layoutProps.width !== undefined && layoutProps.width !== 'auto';
    const hasExplicitHeight = layoutProps.height !== undefined && layoutProps.height !== 'auto';

    if (layoutProps.width === 'fill') {
      width = context.availableSpace.width;
    } else if (typeof layoutProps.width === 'number') {
      width = layoutProps.width;
    } else if (typeof layoutProps.width === 'string' && layoutProps.width.endsWith('%')) {
      const percentage = parseFloat(layoutProps.width) / 100;
      width = Math.floor(context.availableSpace.width * percentage);
    } else if (isFlexContainer && !hasExplicitWidth) {
      // Flex containers with no explicit width should use available space
      width = context.availableSpace.width;
    }

    if (layoutProps.height === 'fill') {
      height = context.availableSpace.height;
    } else if (typeof layoutProps.height === 'number') {
      height = layoutProps.height;
    } else if (typeof layoutProps.height === 'string' && layoutProps.height.endsWith('%')) {
      const percentage = parseFloat(layoutProps.height) / 100;
      height = Math.floor(context.availableSpace.height * percentage);
    } else if (isFlexContainer && !hasExplicitHeight) {
      // Row-flex containers should use intrinsic height (content-based)
      // Column-flex containers can use available space for stretching
      const isRowFlex = layoutProps.flexDirection === 'row' || layoutProps.flexDirection === 'row-reverse';
      if (!isRowFlex) {
        height = context.availableSpace.height;
      }
      // else: keep intrinsic height for row-flex containers
    }

    return {
      x: context.parentBounds.x,
      y: context.parentBounds.y,
      width,
      height,
    };
  }

  private _calculateIntrinsicSize(element: Element, style: Style, context: LayoutContext): Size {
    let contentSize = { width: 10, height: 1 }; // Default fallback

    // Delegate to component's intrinsicSize method if available
    if (isRenderable(element)) {
      const intrinsicSizeContext: IntrinsicSizeContext = {
        availableSpace: context.availableSpace
      };

      try {
        contentSize = element.intrinsicSize(intrinsicSizeContext);
      } catch (error) {
        // Fallback if intrinsicSize method fails
        console.error(`Error calculating intrinsic size for element ${element.type}:`, error);
      }
    } else if (element.type === 'container' && element.children && element.children.length > 0) {
      // For containers, calculate intrinsic size based on children
      const containerStyle = style;
      const isRowFlex = containerStyle.flexDirection === 'row' || containerStyle.flexDirection === 'row-reverse';
      const gap = typeof containerStyle.gap === 'number' ? containerStyle.gap : 0;

      let totalWidth = 0;
      let totalHeight = 0;
      let maxWidth = 0;
      let maxHeight = 0;
      let childCount = 0;

      for (const child of element.children) {
        const childStyle = this._computeStyle(child, containerStyle);

        // Use explicit height/width from style if available, otherwise use intrinsic
        let childWidth: number;
        let childHeight: number;

        if (typeof childStyle.width === 'number') {
          childWidth = childStyle.width;
        } else if (isRenderable(child)) {
          childWidth = child.intrinsicSize({ availableSpace: context.availableSpace }).width;
        } else {
          childWidth = 10; // Default
        }

        if (typeof childStyle.height === 'number') {
          childHeight = childStyle.height;
        } else if (isRenderable(child)) {
          childHeight = child.intrinsicSize({ availableSpace: context.availableSpace }).height;
        } else {
          childHeight = 1; // Default
        }

        // Add margins
        const childMargin = childStyle.margin || 0;
        const marginH = typeof childMargin === 'number' ? childMargin * 2 : ((childMargin as BoxSpacing).left || 0) + ((childMargin as BoxSpacing).right || 0);
        const marginV = typeof childMargin === 'number' ? childMargin * 2 : ((childMargin as BoxSpacing).top || 0) + ((childMargin as BoxSpacing).bottom || 0);

        totalWidth += childWidth + marginH;
        totalHeight += childHeight + marginV;
        maxWidth = Math.max(maxWidth, childWidth + marginH);
        maxHeight = Math.max(maxHeight, childHeight + marginV);
        childCount++;
      }

      // Add gaps between children
      const totalGap = childCount > 1 ? gap * (childCount - 1) : 0;

      // Row flex: width is sum + gaps, height is max
      // Column flex: width is max, height is sum + gaps
      if (isRowFlex) {
        contentSize = { width: totalWidth + totalGap, height: maxHeight };
      } else {
        contentSize = { width: maxWidth, height: totalHeight + totalGap };
      }
    }

    // Apply sizing model
    const requiredSize = this._sizingModel.calculateRequiredSize(
      contentSize,
      style
    );

    return requiredSize;
  }

  private _isVisible(element: Element, bounds: Bounds): boolean {
    // Check basic visibility
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    if (element.props?.visible === false) return false;

    // Check for display: 'none'
    if (this._isDisplayNone(element)) return false;

    // Dialogs are only visible when open (they render as overlays)
    if (element.type === 'dialog' && element.props?.open !== true) return false;

    return true;
  }

  /**
   * Check if an element has display: 'none' set
   */
  private _isDisplayNone(element: Element): boolean {
    const style = element.props?.style;
    return style?.display === 'none';
  }

  private _applyFlexAlignment(
    bounds: Bounds,
    item: any,
    flexProps: AdvancedLayoutProps,
    isRow: boolean,
    context: LayoutContext
  ): Bounds {
    const alignItems = flexProps.alignItems || 'stretch';
    const crossSize = isRow ? context.availableSpace.height : context.availableSpace.width;

    if (isRow) {
      switch (alignItems) {
        case 'center':
          bounds.y = context.parentBounds.y + (crossSize - bounds.height) / 2;
          break;
        case 'flex-end':
          bounds.y = context.parentBounds.y + crossSize - bounds.height;
          break;
        case 'stretch':
          // Only stretch if no explicit height is set
          if (item.props.height === undefined) {
            bounds.height = crossSize;
          }
          break;
      }
    } else {
      switch (alignItems) {
        case 'center':
          bounds.x = context.parentBounds.x + (crossSize - bounds.width) / 2;
          break;
        case 'flex-end':
          bounds.x = context.parentBounds.x + crossSize - bounds.width;
          break;
        case 'stretch':
          // Only stretch if no explicit width is set
          if (item.props.width === undefined) {
            bounds.width = crossSize;
          }
          break;
      }
    }

    return bounds;
  }

}


// Export global layout engine instance
export const globalLayoutEngine = new LayoutEngine();