// Advanced Layout Engine with comprehensive layout algorithms
// Supports block, flex, and absolute positioning

import { Element, Style, Bounds, Size, LayoutProps, BoxSpacing, IntrinsicSizeContext, isRenderable, isScrollableType, isScrollingEnabled } from './types.ts';
import { SizingModel, globalSizingModel, BoxModel, ChromeCollapseState } from './sizing.ts';
import { ContentMeasurer, globalContentMeasurer } from './content-measurer.ts';
import { ViewportManager, globalViewportManager, ScrollbarLayout } from './viewport.ts';
import { getLogger } from './logging.ts';
import type { Stylesheet, StyleContext } from './stylesheet.ts';
import { computeStyle, computeLayoutProps, DEFAULT_LAYOUT_PROPS } from './layout-style.ts';

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
  // For scrollable containers - enables virtual layout optimization
  scrollOffset?: { x: number; y: number };
  isScrollableParent?: boolean;
  // Container query and pseudo-class support
  stylesheets?: readonly Stylesheet[];
  styleContext?: StyleContext;
  ancestors?: Element[];
  containerBounds?: { width: number; height: number };
  // Pseudo-class state (:focus, :hover)
  focusedElementId?: string;
  hoveredElementId?: string;
}

/** A flex item with computed sizing, margins, and constraints. */
interface FlexItem {
  element: Element;
  flexGrow: number;
  flexShrink: number;
  flexBasis: number;
  hypotheticalMain: number;
  finalMain: number;
  outerMain: number;
  baseCross: number;
  outerCross: number;
  intrinsicSize: Size;
  style: Style;
  props: AdvancedLayoutProps;
  marginMain: number;
  marginCross: number;
  marginStart: number;
  marginEnd: number;
  marginCrossStart: number;
  marginCrossEnd: number;
  paddingMain: number;
  paddingCross: number;
  shouldStretch: boolean;
  minMain: number;
  maxMain: number;
  minCross: number;
  maxCross: number;
}

/** A row or column of flex items after line-breaking. */
interface FlexLine {
  items: FlexItem[];
  mainSize: number;
  crossSize: number;
}

export class LayoutEngine {
  private _sizingModel: SizingModel;
  private _contentMeasurer: ContentMeasurer;
  private _viewportManager: ViewportManager;
  // Per-frame caches cleared at the start of each layout pass
  private _layoutPropsCache = new Map<Element, AdvancedLayoutProps>();
  private _styleCache = new Map<Element, Style>();
  private _intrinsicSizeCache = new Map<Element, { aw: number; ah: number; result: Size }>();

  constructor(
    sizingModel?: SizingModel,
    contentMeasurer?: ContentMeasurer,
    viewportManager?: ViewportManager
  ) {
    this._sizingModel = sizingModel || globalSizingModel;
    this._contentMeasurer = contentMeasurer || globalContentMeasurer;
    this._viewportManager = viewportManager || globalViewportManager;
  }

  // Cached computeLayoutProps (without parentProps) — used by _layoutFlex and _layoutBlock
  // to avoid recomputing for the same child multiple times within a single frame.
  private _getCachedLayoutProps(element: Element, context?: LayoutContext): AdvancedLayoutProps {
    let props = this._layoutPropsCache.get(element);
    if (!props) {
      props = computeLayoutProps(element, undefined, context);
      this._layoutPropsCache.set(element, props);
    }
    return props;
  }

  // Cached computeStyle — avoids recomputing for the same element within a single frame.
  // Safe because within a layout pass, the same element always has the same parentStyle.
  private _getCachedStyle(element: Element, parentStyle?: Style, context?: LayoutContext): Style {
    let style = this._styleCache.get(element);
    if (!style) {
      style = computeStyle(element, parentStyle, context);
      this._styleCache.set(element, style);
    }
    return style;
  }

  // Cached intrinsicSize — avoids calling element.intrinsicSize() multiple times
  // with the same availableSpace within a single frame. Uses "last result" pattern:
  // if availableSpace matches the cached entry, returns cached result; otherwise
  // recomputes and updates the cache.
  private _cachedIntrinsicSize(element: Element & { intrinsicSize(ctx: IntrinsicSizeContext): Size }, context: IntrinsicSizeContext): Size {
    const cache = this._intrinsicSizeCache;
    const cached = cache.get(element);
    const aw = context.availableSpace.width;
    const ah = context.availableSpace.height;
    if (cached && cached.aw === aw && cached.ah === ah) {
      return cached.result;
    }
    const result = element.intrinsicSize(context);
    cache.set(element, { aw, ah, result });
    return result;
  }

  // Build an IntrinsicSizeContext with the shared per-frame cache
  private _makeIntrinsicSizeContext(availableSpace: { width: number; height: number }, parentStyle?: Style): IntrinsicSizeContext {
    return {
      availableSpace,
      parentStyle,
      _sizeCache: this._intrinsicSizeCache,
    };
  }

  // Main layout calculation method
  calculateLayout(
    element: Element,
    context: LayoutContext,
    parentNode?: LayoutNode
  ): LayoutNode {
    // Clear per-frame caches at top-level entry (no parent = root call)
    if (!parentNode) {
      this._layoutPropsCache.clear();
      this._styleCache.clear();
      this._intrinsicSizeCache.clear();
    }
    const traceEnabled = logger.isTraceEnabled();
    const startTime = performance.now(); // Always track for slow layout warning
    if (traceEnabled) {
      logger.trace(`Starting layout calculation for element: ${element.type}`, {
        elementId: element.id,
        elementType: element.type,
        availableSpace: context.availableSpace,
        parentBounds: context.parentBounds,
      });
    }
    const computedStyle = this._getCachedStyle(element, context.parentStyle, context);
    const layoutProps = computeLayoutProps(element, context.parentLayoutProps, context);

    if (traceEnabled) {
      logger.trace(`Layout props computed for ${element.type}`, {
        display: layoutProps.display,
        flexDirection: layoutProps.flexDirection,
        position: layoutProps.position,
        width: layoutProps.width,
        height: layoutProps.height,
      });
    }

    // Calculate element bounds based on layout type
    const boundsStartTime = traceEnabled ? performance.now() : 0;
    const bounds = this._calculateElementBounds(element, computedStyle, layoutProps, context);
    if (traceEnabled) {
      logger.trace(`Bounds calculated for ${element.type} in ${(performance.now() - boundsStartTime).toFixed(2)}ms`, {
        bounds,
        elementId: element.id,
      });
    }
    const boxModel = this._sizingModel.calculateBoxModel(
      { width: bounds.width, height: bounds.height },
      computedStyle
    );

    const isScrollable = isScrollableType(element.type) && isScrollingEnabled(element);
    const contentBoundsResult = this._sizingModel.calculateContentBounds(bounds, computedStyle, isScrollable);
    let contentBounds = contentBoundsResult.bounds;

    const node: LayoutNode = {
      element,
      bounds,
      contentBounds,
      visible: this._isVisible(element, bounds, layoutProps),
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
      if (traceEnabled) {
        logger.trace(`Processing ${children.length} children for ${element.type}`, {
          elementId: element.id,
          childCount: children.length,
        });
      }
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
        // Reduce available width when vertical scrollbar is present
        const hasVerticalScrollbar = viewport.scrollbars.vertical?.visible ?? false;
        const childAvailableWidth = hasVerticalScrollbar ? contentBounds.width - 1 : contentBounds.width;

        childContext = {
          ...context,
          parentBounds: {
            x: contentBounds.x,
            y: contentBounds.y,
            width: childAvailableWidth, // Reduce width for scrollbar
            height: actualContentHeight, // Real content height, not 10000
          },
          availableSpace: {
            width: childAvailableWidth, // Reduce width for scrollbar
            height: actualContentHeight // Real content height for proper layout
          },
          parentStyle: computedStyle,
          parentLayoutProps: layoutProps,
          // Pass scroll info for virtual layout optimization
          scrollOffset,
          isScrollableParent: true,
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

      // Thread container query context: update ancestors and containerBounds
      if (context.stylesheets) {
        childContext.ancestors = [...(context.ancestors || []), element];
        const ct = computedStyle.containerType;
        if (ct && ct !== 'normal') {
          childContext.containerBounds = { width: bounds.width, height: bounds.height };
        }
      }

      const childrenStartTime = traceEnabled ? performance.now() : 0;
      node.children = this._layoutChildren(children, childContext, node);
      if (traceEnabled) {
        logger.trace(`Children layout completed in ${(performance.now() - childrenStartTime).toFixed(2)}ms`, {
          elementId: element.id,
          childCount: children.length,
        });
      }
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


    // Single pass: partition children into normal flow and absolute
    const normalChildren: Element[] = [];
    const absoluteBlockChildren: Element[] = [];
    for (const child of children) {
      if (child.props?.visible === false) continue;
      const childLayoutProps = this._getCachedLayoutProps(child, context);
      if (childLayoutProps.display === 'none') continue;
      if (childLayoutProps.position === 'absolute' || childLayoutProps.position === 'fixed') {
        absoluteBlockChildren.push(child);
      } else {
        normalChildren.push(child);
      }
    }

    // Layout normal flow elements
    for (const child of normalChildren) {
      const childBounds: Bounds = {
        x: context.parentBounds.x,
        y: currentY,
        width: context.parentBounds.width,
        height: context.parentBounds.height - (currentY - context.parentBounds.y),
      };
      // Apply position: relative visual offset (preserves normal-flow space)
      const offsetBounds = this._applyRelativeOffset(childBounds, this._getCachedLayoutProps(child, context));
      const childContext: LayoutContext = {
        ...context,
        parentBounds: offsetBounds,
        availableSpace: {
          width: context.availableSpace.width,
          height: context.parentBounds.height - (currentY - context.parentBounds.y),
        },
        parentLayoutProps: parentNode.layoutProps,
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

    // Layout absolute positioned elements
    for (const child of absoluteBlockChildren) {
      const absoluteNode = this._layoutAbsolute(child, context, parentNode);
      nodes.push(absoluteNode);
    }

    return nodes;
  }

  // Improved Flexbox layout based on correct algorithm
  private _layoutFlex(
    children: Element[],
    context: LayoutContext,
    parentNode: LayoutNode
  ): LayoutNode[] {
    const traceEnabled = logger.isTraceEnabled();
    const flexStartTime = performance.now(); // Always track for slow layout warning

    const flexProps = parentNode.layoutProps;
    const isRow = flexProps.flexDirection === 'row' || flexProps.flexDirection === 'row-reverse';
    const isReverse = flexProps.flexDirection === 'row-reverse' || flexProps.flexDirection === 'column-reverse';
    const isWrap = flexProps.flexWrap !== 'nowrap';
    const isWrapReverse = flexProps.flexWrap === 'wrap-reverse';
    const gap = flexProps.gap || 0;  // Gap between flex items (from style)

    // Calculate available space early (needed for stretch calculations)
    const mainAxisSize = isRow ? context.availableSpace.width : context.availableSpace.height;
    const crossAxisSize = isRow ? context.availableSpace.height : context.availableSpace.width;

    // Single-pass partition: separate flex children from absolute/fixed children
    const flexChildren: Element[] = [];
    const absoluteChildren: Element[] = [];
    for (const child of children) {
      if (child.props?.visible === false) continue;
      const childProps = this._getCachedLayoutProps(child, context);
      if (childProps.display === 'none') continue;
      if (childProps.position === 'absolute' || childProps.position === 'fixed') {
        absoluteChildren.push(child);
      } else {
        flexChildren.push(child);
      }
    }

    if (traceEnabled) {
      logger.trace(`Filtered to ${flexChildren.length} flex children (${absoluteChildren.length} absolute)`);
    }

    if (flexChildren.length === 0) {
      // Only absolutely positioned children
      return absoluteChildren.map(child =>
        this._layoutAbsolute(child, context, parentNode)
      );
    }

    // Virtual layout optimization for scrollable containers with many children
    const VIRTUAL_THRESHOLD = 50;
    if (context.isScrollableParent && !isRow && flexChildren.length > VIRTUAL_THRESHOLD) {
      return this._layoutFlexVirtual(flexChildren, absoluteChildren, context, parentNode, gap);
    }

    // Step 1: Calculate hypothetical sizes for flex children
    const intrinsicStartTime = traceEnabled ? performance.now() : 0;
    const flexItems = this._calculateFlexItems(
      flexChildren, context, flexProps, isRow, isWrap, mainAxisSize, crossAxisSize
    );

    if (traceEnabled) {
      logger.trace(`Intrinsic sizes calculated in ${(performance.now() - intrinsicStartTime).toFixed(2)}ms`, {
        itemCount: flexItems.length,
      });
      logger.trace(`Flex axis sizes - main: ${mainAxisSize}, cross: ${crossAxisSize}`);
    }

    // Safeguard: If mainAxisSize is NaN, fallback to block layout
    if (isNaN(mainAxisSize) || isNaN(crossAxisSize)) {
      return this._layoutBlock(children, context, parentNode);
    }

    // Step 2: Collect items into flex lines
    const flexLines: FlexLine[] = [];
    const lineStartTime = traceEnabled ? performance.now() : 0;

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

    if (traceEnabled) {
      logger.trace(`Flex lines collected in ${(performance.now() - lineStartTime).toFixed(2)}ms`, {
        lineCount: flexLines.length,
      });
    }

    // Step 3: Resolve flexible lengths per line with min/max constraints
    const resolveLengthsStartTime = traceEnabled ? performance.now() : 0;
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
            item.finalMain = item.hypotheticalMain + growShare;
          } else {
            item.finalMain = item.hypotheticalMain;
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
            item.finalMain = Math.max(0, item.hypotheticalMain - shrinkAmount);
          } else {
            item.finalMain = item.hypotheticalMain;
          }
        });
      }

      // Apply min/max constraints on main axis
      // Items cannot shrink below minMain or grow above maxMain
      lineItems.forEach(item => {
        item.finalMain = Math.max(item.minMain, Math.min(item.maxMain, item.finalMain));
      });
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
      // 'fill' and percentages count as explicit because the container is constrained to available space
      const isExplicitSize = (val: unknown) => typeof val === 'number' || val === 'fill' || (typeof val === 'string' && val.endsWith('%'));
      const hasExplicitCrossSize = isRow
        ? isExplicitSize(parentNode.layoutProps.height)
        : isExplicitSize(parentNode.layoutProps.width);
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

    if (traceEnabled) {
      logger.trace(`Flexible lengths resolved in ${(performance.now() - resolveLengthsStartTime).toFixed(2)}ms`);
    }

    // Step 6: Position items and create layout nodes
    const positioningStartTime = traceEnabled ? performance.now() : 0;
    const nodes = this._positionFlexItems(
      flexLines, linePositions, absoluteChildren, context, parentNode,
      flexProps, isRow, isReverse, gap, mainAxisSize
    );

    if (traceEnabled) {
      logger.trace(`Items positioned in ${(performance.now() - positioningStartTime).toFixed(2)}ms`);
    }

    const flexTotalTime = performance.now() - flexStartTime;
    if (traceEnabled) {
      logger.trace(`Flexbox layout completed in ${flexTotalTime.toFixed(2)}ms`, {
        parentId: parentNode.element.id,
        nodeCount: nodes.length,
        lineCount: flexLines.length,
      });
    }

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
    const layoutProps = this._getCachedLayoutProps(element, context);
    const style = this._getCachedStyle(element, context.parentStyle, context);

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

  // Flex sub-methods

  /** Step 1: Calculate hypothetical sizes, margins, and constraints for flex children. */
  private _calculateFlexItems(
    flexChildren: Element[],
    context: LayoutContext,
    flexProps: AdvancedLayoutProps,
    isRow: boolean,
    isWrap: boolean,
    mainAxisSize: number,
    crossAxisSize: number,
  ): FlexItem[] {
    return flexChildren.map(child => {
      const childProps = this._getCachedLayoutProps(child, context);
      const childStyle = this._getCachedStyle(child, context.parentStyle, context);

      // Calculate intrinsic size (content only, WITHOUT padding/borders for flex)
      // Flex algorithm handles padding separately
      let contentSize = { width: 10, height: 1 }; // Default fallback
      if (isRenderable(child)) {
        try {
          contentSize = this._cachedIntrinsicSize(child, this._makeIntrinsicSizeContext(context.availableSpace, context.parentStyle));
        } catch (error) {
          logger.error(`Error calculating intrinsic size for element ${child.type}`, error instanceof Error ? error : undefined);
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

      // Check if renderable element intentionally returns zero size (e.g., dialogs, overlays)
      // These elements should not participate in normal layout flow
      const intentionallyZeroSize = useIntrinsicSize &&
                                    intrinsicSize.width === 0 &&
                                    intrinsicSize.height === 0;

      let flexBasisValue: number;
      if (childProps.flexBasis === 'auto') {
        if (isRow) {
          // If element intentionally returns zero size (dialogs, overlays), respect that
          if (intentionallyZeroSize) {
            flexBasisValue = 0;
          } else if (childProps.width === 'fill') {
            // For "fill" width in flex context, treat as flexible
            flexBasisValue = 0;
          } else if (typeof childProps.width === 'number') {
            // Explicit numeric width - use the larger of explicit and intrinsic
            const intrinsicOuter = intrinsicSize.width + paddingMain + borderMain;
            flexBasisValue = Math.max(childProps.width, intrinsicOuter);
          } else if (typeof childProps.width === 'string' && childProps.width.endsWith('%')) {
            // Percentage width - resolve against available main-axis space
            const pct = parseFloat(childProps.width) / 100;
            flexBasisValue = Math.floor(mainAxisSize * pct);
          } else {
            // No explicit width - use intrinsic size + padding + borders
            flexBasisValue = intrinsicSize.width + paddingMain + borderMain;
          }
        } else {
          // If element intentionally returns zero size (dialogs, overlays), respect that
          if (intentionallyZeroSize) {
            flexBasisValue = 0;
          } else if (childProps.height === 'fill') {
            // For "fill" height in flex context, treat as flexible
            flexBasisValue = 0;
          } else if (typeof childProps.height === 'number') {
            // Explicit numeric height - use the larger of explicit and intrinsic
            const intrinsicOuter = intrinsicSize.height + paddingMain + borderMain;
            flexBasisValue = Math.max(childProps.height, intrinsicOuter);
          } else if (typeof childProps.height === 'string' && childProps.height.endsWith('%')) {
            // Percentage height - resolve against available main-axis space
            const pct = parseFloat(childProps.height) / 100;
            flexBasisValue = Math.floor(mainAxisSize * pct);
          } else {
            // No explicit height - use intrinsic size + padding + borders
            flexBasisValue = intrinsicSize.height + paddingMain + borderMain;
          }
        }
      } else {
        flexBasisValue = typeof childProps.flexBasis === 'number' ? childProps.flexBasis : 0;
      }

      // Extract min/max constraints from style
      const minMain = isRow
        ? (typeof childStyle.minWidth === 'number' ? childStyle.minWidth : 0)
        : (typeof childStyle.minHeight === 'number' ? childStyle.minHeight : 0);
      const maxMain = isRow
        ? (typeof childStyle.maxWidth === 'number' ? childStyle.maxWidth : Infinity)
        : (typeof childStyle.maxHeight === 'number' ? childStyle.maxHeight : Infinity);
      const minCross = isRow
        ? (typeof childStyle.minHeight === 'number' ? childStyle.minHeight : 0)
        : (typeof childStyle.minWidth === 'number' ? childStyle.minWidth : 0);
      const maxCross = isRow
        ? (typeof childStyle.maxHeight === 'number' ? childStyle.maxHeight : Infinity)
        : (typeof childStyle.maxWidth === 'number' ? childStyle.maxWidth : Infinity);

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

      // For single-line elements (like buttons, text, input) without border,
      // don't add vertical padding to cross-axis
      let effectivePaddingCross = paddingCross;
      if (isRow && intrinsicSize.height === 1 && borderCross === 0) {
        effectivePaddingCross = 0;
      } else if (!isRow && intrinsicSize.width === 1 && borderCross === 0) {
        effectivePaddingCross = 0;
      }

      // Determine if this item has stretch alignment
      const _isExplicitSize = (v: unknown) => typeof v === 'number' || (typeof v === 'string' && v.endsWith('%'));
      const hasExplicitCrossSize = isRow
        ? _isExplicitSize(childProps.height)
        : _isExplicitSize(childProps.width);

      const hasStretchAlignment = (childProps.alignSelf === 'auto' || childProps.alignSelf === undefined || childProps.alignSelf === 'stretch') &&
                                  (flexProps.alignItems === undefined || flexProps.alignItems === 'stretch');

      const shouldStretch = hasStretchAlignment && !hasExplicitCrossSize;

      // Pre-stretch to container size only for nowrap (wrapping defers stretch to line sizing phase)
      const willPreStretchToContainer = shouldStretch && !isWrap;

      if (isRow) {
        if (intentionallyZeroSize) {
          baseCross = 0;
        } else if (typeof childProps.height === 'number') {
          const intrinsicOuter = intrinsicSize.height + effectivePaddingCross + borderCross;
          baseCross = Math.max(childProps.height, intrinsicOuter);
        } else if (typeof childProps.height === 'string' && childProps.height.endsWith('%')) {
          const pct = parseFloat(childProps.height) / 100;
          baseCross = Math.floor(crossAxisSize * pct);
        } else if (willPreStretchToContainer) {
          baseCross = crossAxisSize;
        } else {
          baseCross = intrinsicSize.height + effectivePaddingCross + borderCross;
        }
      } else {
        if (intentionallyZeroSize) {
          baseCross = 0;
        } else if (typeof childProps.width === 'number') {
          const intrinsicOuter = intrinsicSize.width + effectivePaddingCross + borderCross;
          baseCross = Math.max(childProps.width, intrinsicOuter);
        } else if (typeof childProps.width === 'string' && childProps.width.endsWith('%')) {
          const pct = parseFloat(childProps.width) / 100;
          baseCross = Math.floor(crossAxisSize * pct);
        } else if (willPreStretchToContainer) {
          baseCross = crossAxisSize;
        } else {
          baseCross = intrinsicSize.width + effectivePaddingCross + borderCross;
        }
      }

      return {
        element: child,
        flexGrow: flexGrow,
        flexShrink: childProps.flexShrink ?? 1,
        flexBasis: flexBasisValue,
        hypotheticalMain: flexBasisValue,
        finalMain: flexBasisValue,
        outerMain: flexBasisValue + marginMain,
        baseCross: baseCross,
        outerCross: baseCross + marginCross,
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
        shouldStretch,
        minMain,
        maxMain,
        minCross,
        maxCross,
      };
    });
  }

  /** Virtual layout optimization for scrollable column containers with 50+ children. */
  private _layoutFlexVirtual(
    flexChildren: Element[],
    absoluteChildren: Element[],
    context: LayoutContext,
    parentNode: LayoutNode,
    gap: number,
  ): LayoutNode[] {
    const VIRTUAL_BUFFER = 5;
    const scrollY = context.scrollOffset?.y || 0;
    const viewportHeight = context.viewport.height;

    // Sample first few children to estimate uniform height
    const sampleSize = Math.min(5, flexChildren.length);
    let totalSampleHeight = 0;
    for (let i = 0; i < sampleSize; i++) {
      const child = flexChildren[i];
      if (isRenderable(child)) {
        const size = this._cachedIntrinsicSize(child, this._makeIntrinsicSizeContext(context.availableSpace, context.parentStyle));
        totalSampleHeight += size.height;
      } else {
        totalSampleHeight += 1;
      }
    }
    const estimatedRowHeight = Math.max(1, Math.ceil(totalSampleHeight / sampleSize));
    const rowStride = estimatedRowHeight + gap;

    // Calculate visible range
    const startIndex = Math.max(0, Math.floor(scrollY / rowStride) - VIRTUAL_BUFFER);
    const endIndex = Math.min(flexChildren.length, Math.ceil((scrollY + viewportHeight) / rowStride) + VIRTUAL_BUFFER);

    if (logger.isDebugEnabled()) {
      logger.debug(`Virtual layout: ${flexChildren.length} children, visible ${startIndex}-${endIndex}, rowHeight=${estimatedRowHeight}, gap=${gap}`);
    }

    const nodes: LayoutNode[] = [];
    let currentY = context.parentBounds.y;

    for (let i = 0; i < flexChildren.length; i++) {
      const child = flexChildren[i];

      if (i >= startIndex && i < endIndex) {
        let childBounds: Bounds = {
          x: context.parentBounds.x,
          y: currentY,
          width: context.availableSpace.width,
          height: estimatedRowHeight
        };
        childBounds = this._applyRelativeOffset(childBounds, this._getCachedLayoutProps(child, context));
        const childNode = this.calculateLayout(child, { ...context, parentBounds: childBounds }, parentNode);
        nodes.push(childNode);
        currentY += childNode.bounds.height + gap;
      } else {
        // Placeholder for non-visible children
        const placeholderBounds: Bounds = {
          x: context.parentBounds.x,
          y: currentY,
          width: context.availableSpace.width,
          height: estimatedRowHeight
        };
        const zeroDims = { top: 0, right: 0, bottom: 0, left: 0, horizontal: 0, vertical: 0 };
        nodes.push({
          element: child,
          bounds: placeholderBounds,
          contentBounds: placeholderBounds,
          visible: false,
          children: [],
          computedStyle: {},
          layoutProps: this._getCachedLayoutProps(child, context),
          boxModel: {
            content: { width: placeholderBounds.width, height: placeholderBounds.height },
            padding: zeroDims,
            border: zeroDims,
            margin: zeroDims,
            total: { width: placeholderBounds.width, height: placeholderBounds.height }
          },
          zIndex: 0,
        });
        currentY += rowStride;
      }
    }

    for (const child of absoluteChildren) {
      nodes.push(this._layoutAbsolute(child, context, parentNode));
    }

    return nodes;
  }

  /** Step 6: Position flex items on main axis (justify-content) and cross axis (align-items). */
  private _positionFlexItems(
    flexLines: FlexLine[],
    linePositions: number[],
    absoluteChildren: Element[],
    context: LayoutContext,
    parentNode: LayoutNode,
    flexProps: AdvancedLayoutProps,
    isRow: boolean,
    isReverse: boolean,
    gap: number,
    mainAxisSize: number,
  ): LayoutNode[] {
    const nodes: LayoutNode[] = [];

    flexLines.forEach((line, lineIndex) => {
      const lineItems = line.items;
      const totalGaps = gap * Math.max(0, lineItems.length - 1);
      const totalMainUsed = lineItems.reduce((sum, item) => sum + item.finalMain + item.marginMain, 0);
      const remainingSpace = mainAxisSize - totalMainUsed - totalGaps;

      let mainPositions: number[] = [];
      let pos = 0;

      switch (flexProps.justifyContent || 'flex-start') {
        case 'flex-start':
          pos = 0;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += item.finalMain + item.marginMain + (i < lineItems.length - 1 ? gap : 0);
          });
          break;

        case 'flex-end':
          pos = remainingSpace;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += item.finalMain + item.marginMain + (i < lineItems.length - 1 ? gap : 0);
          });
          break;

        case 'center':
          pos = remainingSpace / 2;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += item.finalMain + item.marginMain + (i < lineItems.length - 1 ? gap : 0);
          });
          break;

        case 'space-between': {
          const spaceBetween = lineItems.length > 1 ? remainingSpace / (lineItems.length - 1) : 0;
          pos = 0;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += item.finalMain + item.marginMain + spaceBetween + (i < lineItems.length - 1 ? gap : 0);
          });
          break;
        }

        case 'space-around': {
          const spaceAround = remainingSpace / (lineItems.length * 2);
          pos = spaceAround;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += item.finalMain + item.marginMain + spaceAround * 2 + (i < lineItems.length - 1 ? gap : 0);
          });
          break;
        }

        case 'space-evenly': {
          const spaceEvenly = remainingSpace / (lineItems.length + 1);
          pos = spaceEvenly;
          lineItems.forEach((item, i) => {
            mainPositions.push(pos + item.marginStart);
            pos += item.finalMain + item.marginMain + spaceEvenly + (i < lineItems.length - 1 ? gap : 0);
          });
          break;
        }
      }

      // Apply reverse if needed
      if (isReverse) {
        mainPositions = mainPositions.map((p, i) =>
          mainAxisSize - p - lineItems[i].finalMain
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
            finalCross = item.baseCross;
            break;

          case 'flex-end':
            finalCross = item.baseCross;
            crossPos = lineCrossStart + lineCrossSize - finalCross - item.marginCrossEnd;
            break;

          case 'center': {
            finalCross = item.baseCross;
            const totalCross = finalCross + item.marginCross;
            crossPos = lineCrossStart + (lineCrossSize - totalCross) / 2 + item.marginCrossStart;
            break;
          }

          case 'stretch':
          default:
            crossPos = lineCrossStart + item.marginCrossStart;
            if (item.shouldStretch) {
              finalCross = lineCrossSize - item.marginCross;
            } else {
              finalCross = item.baseCross;
            }
            break;
        }

        // Ensure non-container elements get at least their minimum size
        const isContainer = item.element.type === 'container';
        if (!isContainer) {
          finalCross = Math.max(finalCross, item.baseCross);
        }

        // Apply min/max constraints on cross axis
        finalCross = Math.max(item.minCross, Math.min(item.maxCross, finalCross));

        // Create bounds based on main/cross axes
        let bounds: Bounds;
        if (isRow) {
          bounds = {
            x: Math.round(context.parentBounds.x + mainPos),
            y: Math.round(context.parentBounds.y + crossPos),
            width: Math.round(item.finalMain),
            height: Math.round(finalCross),
          };
        } else {
          bounds = {
            x: Math.round(context.parentBounds.x + crossPos),
            y: Math.round(context.parentBounds.y + mainPos),
            width: Math.round(finalCross),
            height: Math.round(item.finalMain),
          };
        }

        // Apply position: relative visual offset
        const offsetBounds = this._applyRelativeOffset(bounds, this._getCachedLayoutProps(item.element, context));

        const childContext: LayoutContext = {
          ...context,
          parentBounds: offsetBounds,
          availableSpace: { width: offsetBounds.width, height: offsetBounds.height },
        };

        const childNode = this.calculateLayout(item.element, childContext, parentNode);
        nodes.push(childNode);
      });
    });

    // Add absolutely positioned children
    for (const child of absoluteChildren) {
      nodes.push(this._layoutAbsolute(child, context, parentNode));
    }

    return nodes;
  }

  // Helper methods

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
    } else if (typeof layoutProps.width === 'string') {
      if (layoutProps.width.endsWith('%')) {
        const percentage = parseFloat(layoutProps.width) / 100;
        width = Math.floor(context.availableSpace.width * percentage);
      } else {
        // Parse numeric strings like "30" from XML attributes
        const parsed = parseFloat(layoutProps.width);
        if (!isNaN(parsed)) {
          width = parsed;
        }
      }
    } else if (isFlexContainer && !hasExplicitWidth) {
      // Flex containers with no explicit width should use available space
      width = context.availableSpace.width;
    }

    if (layoutProps.height === 'fill') {
      height = context.availableSpace.height;
    } else if (typeof layoutProps.height === 'number') {
      height = layoutProps.height;
    } else if (typeof layoutProps.height === 'string') {
      if (layoutProps.height.endsWith('%')) {
        const percentage = parseFloat(layoutProps.height) / 100;
        height = Math.floor(context.availableSpace.height * percentage);
      } else {
        // Parse numeric strings like "5" from XML attributes
        const parsed = parseFloat(layoutProps.height);
        if (!isNaN(parsed)) {
          height = parsed;
        }
      }
    } else if (isFlexContainer && !hasExplicitHeight) {
      // Row-flex containers should use intrinsic height (content-based)
      // Column-flex containers can use available space for stretching
      const isRowFlex = layoutProps.flexDirection === 'row' || layoutProps.flexDirection === 'row-reverse';
      if (!isRowFlex) {
        height = context.availableSpace.height;
      }
      // else: keep intrinsic height for row-flex containers
    }

    // Apply min/max constraints
    if (typeof style.minWidth === 'number') width = Math.max(width, style.minWidth);
    if (typeof style.maxWidth === 'number') width = Math.min(width, style.maxWidth);
    if (typeof style.minHeight === 'number') height = Math.max(height, style.minHeight);
    if (typeof style.maxHeight === 'number') height = Math.min(height, style.maxHeight);

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
      try {
        contentSize = this._cachedIntrinsicSize(element, this._makeIntrinsicSizeContext(context.availableSpace, context.parentStyle));
      } catch (error) {
        // Fallback if intrinsicSize method fails
        logger.error(`Error calculating intrinsic size for element ${element.type}`, error instanceof Error ? error : undefined);
      }
    } else if (element.type === 'container' && element.children && element.children.length > 0) {
      // For containers, calculate intrinsic size based on children
      const containerStyle = style;
      const isRowFlex = containerStyle.flexDirection === 'row' || containerStyle.flexDirection === 'row-reverse';
      const isWrap = containerStyle.flexWrap === 'wrap' || containerStyle.flexWrap === 'wrap-reverse';
      const gap = typeof containerStyle.gap === 'number' ? containerStyle.gap : 0;

      let totalWidth = 0;
      let totalHeight = 0;
      let maxWidth = 0;
      let maxHeight = 0;
      let childCount = 0;
      const childSizes: Array<{ w: number; h: number }> = [];

      for (const child of element.children) {
        const childStyle = this._getCachedStyle(child, containerStyle, context);

        // Use explicit height/width from style if available, otherwise use intrinsic
        let childWidth: number;
        let childHeight: number;

        const hasExplicitW = typeof childStyle.width === 'number';
        const hasExplicitH = typeof childStyle.height === 'number';
        if (hasExplicitW && hasExplicitH) {
          childWidth = childStyle.width as number;
          childHeight = childStyle.height as number;
        } else if (isRenderable(child)) {
          const childIntrinsic = this._cachedIntrinsicSize(child, this._makeIntrinsicSizeContext(context.availableSpace, context.parentStyle));
          childWidth = hasExplicitW ? childStyle.width as number : childIntrinsic.width;
          childHeight = hasExplicitH ? childStyle.height as number : childIntrinsic.height;
        } else {
          childWidth = hasExplicitW ? childStyle.width as number : 10;
          childHeight = hasExplicitH ? childStyle.height as number : 1;
        }

        // Add border + padding to get outer size (matching _calculateFlexItems behavior)
        const hasBorder = childStyle.border && childStyle.border !== 'none';
        if (hasBorder) {
          childWidth += 2;
          childHeight += 2;
        }
        const cp = childStyle.padding || 0;
        if (typeof cp === 'number') {
          childWidth += cp * 2;
          childHeight += cp * 2;
        } else if (typeof cp === 'object') {
          childWidth += ((cp as BoxSpacing).left || 0) + ((cp as BoxSpacing).right || 0);
          childHeight += ((cp as BoxSpacing).top || 0) + ((cp as BoxSpacing).bottom || 0);
        }

        // Add margins
        const childMargin = childStyle.margin || 0;
        const marginH = typeof childMargin === 'number' ? childMargin * 2 : ((childMargin as BoxSpacing).left || 0) + ((childMargin as BoxSpacing).right || 0);
        const marginV = typeof childMargin === 'number' ? childMargin * 2 : ((childMargin as BoxSpacing).top || 0) + ((childMargin as BoxSpacing).bottom || 0);

        const outerW = childWidth + marginH;
        const outerH = childHeight + marginV;
        totalWidth += outerW;
        totalHeight += outerH;
        maxWidth = Math.max(maxWidth, outerW);
        maxHeight = Math.max(maxHeight, outerH);
        if (isRowFlex && isWrap) childSizes.push({ w: outerW, h: outerH });
        // Only count children with non-zero main-axis size for gap calculation
        const mainSize = isRowFlex ? childWidth : childHeight;
        if (mainSize > 0) childCount++;
      }

      // Add gaps between children
      const totalGap = childCount > 1 ? gap * (childCount - 1) : 0;

      if (isRowFlex && isWrap && context.availableSpace.width > 0) {
        // Simulate line-breaking to determine wrapped height
        const availW = context.availableSpace.width;
        let lineWidth = 0;
        let lineHeight = 0;
        let lineChildCount = 0;
        let rowCount = 0;
        let wrappedHeight = 0;

        for (const cs of childSizes) {
          if (cs.w <= 0) continue;
          const gapBefore = lineChildCount > 0 ? gap : 0;
          if (lineChildCount > 0 && lineWidth + gapBefore + cs.w > availW) {
            wrappedHeight += lineHeight;
            rowCount++;
            lineWidth = cs.w;
            lineHeight = cs.h;
            lineChildCount = 1;
          } else {
            lineWidth += gapBefore + cs.w;
            lineHeight = Math.max(lineHeight, cs.h);
            lineChildCount++;
          }
        }
        if (lineChildCount > 0) {
          wrappedHeight += lineHeight;
          rowCount++;
        }
        if (rowCount > 1) {
          wrappedHeight += gap * (rowCount - 1);
        }
        contentSize = { width: totalWidth + totalGap, height: wrappedHeight };
      } else if (isRowFlex) {
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

  private _isVisible(element: Element, bounds: Bounds, layoutProps?: AdvancedLayoutProps): boolean {
    // Connectors have 0x0 bounds but still need to be visible (they draw based on connected elements)
    if (element.type === 'connector') {
      return element.props?.visible !== false;
    }

    // Check basic visibility
    if (bounds.width <= 0 || bounds.height <= 0) return false;
    if (element.props?.visible === false) return false;

    // Check for display: 'none' — use layoutProps when available (includes container query styles)
    const isDisplayNone = layoutProps
      ? layoutProps.display === 'none'
      : element.props?.style?.display === 'none';
    if (isDisplayNone) return false;

    // Dialogs are only visible when open (they render as overlays)
    if (element.type === 'dialog' && element.props?.open !== true) return false;

    return true;
  }

  /**
   * Apply position: relative offset to bounds.
   * The element keeps its normal-flow space; only the visual position shifts.
   */
  private _applyRelativeOffset(bounds: Bounds, layoutProps: AdvancedLayoutProps): Bounds {
    if (layoutProps.position !== 'relative') return bounds;
    const b = { ...bounds };
    if (layoutProps.top !== undefined) b.y += layoutProps.top;
    else if (layoutProps.bottom !== undefined) b.y -= layoutProps.bottom;
    if (layoutProps.left !== undefined) b.x += layoutProps.left;
    else if (layoutProps.right !== undefined) b.x -= layoutProps.right;
    return b;
  }

}


// Export global layout engine instance
export const globalLayoutEngine = new LayoutEngine();