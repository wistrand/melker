// Style and layout props computation for the layout engine.
// Pure functions extracted from LayoutEngine — no mutable state.

import { Element, Style, BoxSpacing } from './types.ts';
import type { TransitionSpec } from './types.ts';
import { findKeyframePair, interpolateStyles, interpolateValue, getTransitionStyle } from './css-animation.ts';
import { getThemeColor } from './theme.ts';
import { getTimingFunction } from './easing.ts';
import { getUIAnimationManager } from './ui-animation-manager.ts';
import type { AdvancedLayoutProps, LayoutContext } from './layout.ts';
import type { PseudoClassState } from './stylesheet.ts';

/** Shallow object equality check — avoids JSON.stringify in hot path. */
function _shallowEqual(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  for (const k in a) {
    if (a[k] !== b[k]) return false;
  }
  for (const k in b) {
    if (!(k in a)) return false;
  }
  return true;
}

/** Shared empty style object — avoids allocating {} on every fast-path return. */
const EMPTY_STYLE: Partial<Style> = Object.freeze({});

/** Default layout properties for every element. */
export const DEFAULT_LAYOUT_PROPS: AdvancedLayoutProps = {
  display: 'flex',
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

/**
 * Compute interpolated style from a CSS animation.
 * Returns {} if no animation is active.
 * Ephemeral — computed fresh each frame from AnimationState + performance.now().
 * Mirrors the canvas _terminalWidth pattern: resolved values never written to props.style.
 */
export function getAnimatedStyle(element: Element): Partial<Style> {
  const anim = element._animationState;
  if (!anim || anim.keyframes.length === 0) return EMPTY_STYLE;

  const now = performance.now();
  const elapsed = now - anim.startTime - anim.delay;

  // Still in delay period
  if (elapsed < 0) {
    if (anim.fillMode === 'backwards' || anim.fillMode === 'both') {
      // Show first keyframe during delay
      const dir = anim.direction;
      const first = (dir === 'reverse' || dir === 'alternate-reverse')
        ? anim.keyframes[anim.keyframes.length - 1]
        : anim.keyframes[0];
      return { ...first.style };
    }
    return {};
  }

  // Calculate current iteration and progress within it
  const iterationDuration = anim.duration;
  if (iterationDuration <= 0) {
    // Zero duration: jump to end
    if (anim.fillMode === 'forwards' || anim.fillMode === 'both') {
      return { ...anim.keyframes[anim.keyframes.length - 1].style };
    }
    return {};
  }

  const rawIteration = elapsed / iterationDuration;
  const isFinite = anim.iterations !== Infinity;
  const totalIterations = anim.iterations;

  // Check if animation has finished
  if (isFinite && rawIteration >= totalIterations) {
    anim.finished = true;
    if (anim.fillMode === 'forwards' || anim.fillMode === 'both') {
      // Determine which end to show based on direction and iteration count
      const lastIter = Math.ceil(totalIterations) - 1;
      const reversed = anim.direction === 'reverse' ||
        (anim.direction === 'alternate' && lastIter % 2 === 1) ||
        (anim.direction === 'alternate-reverse' && lastIter % 2 === 0);
      const endKf = reversed ? anim.keyframes[0] : anim.keyframes[anim.keyframes.length - 1];
      return { ...endKf.style };
    }
    return {};
  }

  // Current iteration (0-based) and progress within it
  const currentIteration = Math.floor(rawIteration);
  let progress = rawIteration - currentIteration;

  // Apply direction
  const dir = anim.direction;
  let reversed = false;
  if (dir === 'reverse') {
    reversed = true;
  } else if (dir === 'alternate') {
    reversed = currentIteration % 2 === 1;
  } else if (dir === 'alternate-reverse') {
    reversed = currentIteration % 2 === 0;
  }

  if (reversed) progress = 1 - progress;

  // Apply timing function
  progress = anim.timingFn(progress);

  // Find keyframe pair and interpolate
  const { from, to, localT } = findKeyframePair(anim.keyframes, progress);
  return interpolateStyles(from.style, to.style, localT);
}

/** Merge container query matching styles from all stylesheets for element. */
export function getContainerQueryStyles(element: Element, context?: LayoutContext): Partial<Style> {
  if (!context?.stylesheets || !context.containerBounds) return EMPTY_STYLE;
  const ancestors = context.ancestors || [];
  const containerSize = context.containerBounds;
  let merged: Partial<Style> | undefined;
  for (const ss of context.stylesheets) {
    if (!ss.hasContainerRules) continue;
    const styles = ss.getContainerMatchingStyles(element, ancestors, containerSize, context.styleContext);
    if (Object.keys(styles).length > 0) {
      merged = merged ? { ...merged, ...styles } : styles;
    }
  }
  return merged ?? EMPTY_STYLE;
}

/** Merge pseudo-class (:focus, :hover) matching styles from all stylesheets for element. */
function getPseudoClassStyles(element: Element, context?: LayoutContext): Partial<Style> {
  if (!context?.stylesheets || (!context.focusedElementId && !context.hoveredElementId)) return EMPTY_STYLE;
  const pseudoState: PseudoClassState = {
    focusedElementId: context.focusedElementId,
    hoveredElementId: context.hoveredElementId,
  };
  const ancestors = context.ancestors || [];
  let merged: Partial<Style> | undefined;
  for (const ss of context.stylesheets) {
    if (!ss.hasPseudoClassRules) continue;
    const styles = ss.getPseudoMatchingStyles(element, ancestors, context.styleContext, pseudoState);
    if (Object.keys(styles).length > 0) {
      merged = merged ? { ...merged, ...styles } : styles;
    }
  }
  return merged ?? EMPTY_STYLE;
}

/**
 * Map individual padding/margin property names to their BoxSpacing container + side.
 * parseStyleProperties() normalizes paddingLeft/etc. into padding:{top,right,bottom,left},
 * so transition specs referencing 'paddingLeft' need to look inside the BoxSpacing object.
 */
const BOX_SPACING_MAP: Record<string, [string, string]> = {
  paddingTop: ['padding', 'top'],
  paddingRight: ['padding', 'right'],
  paddingBottom: ['padding', 'bottom'],
  paddingLeft: ['padding', 'left'],
  marginTop: ['margin', 'top'],
  marginRight: ['margin', 'right'],
  marginBottom: ['margin', 'bottom'],
  marginLeft: ['margin', 'left'],
};

/** Read a style value, decomposing BoxSpacing when the direct property is absent. */
function getStyleValue(style: Style, prop: string): any {
  const direct = (style as any)[prop];
  if (direct !== undefined) return direct;
  const mapping = BOX_SPACING_MAP[prop];
  if (mapping) {
    const [boxProp, side] = mapping;
    const boxValue = (style as any)[boxProp];
    if (boxValue && typeof boxValue === 'object' && side in boxValue) {
      return boxValue[side] ?? 0;
    }
    if (typeof boxValue === 'number') return boxValue;
  }
  return undefined;
}

/**
 * Detect property changes and start/interrupt CSS transitions.
 * Called from computeStyle() after the full merged style is computed.
 */
function processTransitions(element: Element, resolvedStyle: Style): void {
  const specs: TransitionSpec[] | undefined = resolvedStyle._transitionSpecs;
  if (!specs || specs.length === 0) {
    // No transition specs — clear any state
    if (element._transitionState) {
      element._transitionState = undefined;
      if (element._transitionRegistration) {
        element._transitionRegistration();
        element._transitionRegistration = undefined;
      }
    }
    return;
  }

  // Initialize state if needed
  if (!element._transitionState) {
    element._transitionState = {
      active: new Map(),
      previousValues: new Map(),
    };
  }
  const state = element._transitionState;

  // Check each spec'd property for changes
  for (const spec of specs) {
    if (spec.duration <= 0) continue;  // Skip zero-duration transitions

    const props = spec.property === 'all'
      ? Object.keys(resolvedStyle).filter(k =>
          !k.startsWith('_') && !k.startsWith('transition') && !k.startsWith('animation'))
      : [spec.property];

    for (const prop of props) {
      const newValue = getStyleValue(resolvedStyle, prop);
      const prevValue = state.previousValues.get(prop);

      // Store current value for next frame comparison
      state.previousValues.set(prop, newValue);

      // Skip if no previous value (first frame) or same value
      if (prevValue === undefined || prevValue === newValue) continue;
      // Skip if both are equal objects (BoxSpacing)
      if (typeof prevValue === 'object' && typeof newValue === 'object' &&
          _shallowEqual(prevValue as Record<string, unknown>, newValue as Record<string, unknown>)) continue;

      // Value changed — start or interrupt transition
      const now = performance.now();
      if (state.active.has(prop)) {
        // Interrupt: use current interpolated value as new from
        const currentTransition = state.active.get(prop)!;
        const elapsed = now - currentTransition.startTime - currentTransition.delay;
        const progress = elapsed < 0 ? 0 : Math.min(elapsed / currentTransition.duration, 1);
        const currentValue = interpolateValue(
          prop, currentTransition.from, currentTransition.to, currentTransition.timingFn(progress));
        state.active.set(prop, {
          from: currentValue,
          to: newValue,
          startTime: now,
          duration: spec.duration,
          delay: spec.delay,
          timingFn: getTimingFunction(spec.timingFn),
        });
      } else {
        // New transition
        state.active.set(prop, {
          from: prevValue,
          to: newValue,
          startTime: now,
          duration: spec.duration,
          delay: spec.delay,
          timingFn: getTimingFunction(spec.timingFn),
        });
      }
    }
  }

  // Register with UIAnimationManager if we have active transitions and no registration
  if (state.active.size > 0 && !element._transitionRegistration) {
    const manager = getUIAnimationManager();
    const transId = `css-trans-${element.id}-${Date.now()}`;
    element._transitionRegistration = manager.register(transId, () => {
      if (!element._transitionState?.active.size) {
        if (element._transitionRegistration) {
          element._transitionRegistration();
          element._transitionRegistration = undefined;
        }
        return;
      }
      manager.requestRender();
    }, 16);  // ~60fps
  }
}

/**
 * Consolidate individual padding/margin properties (paddingLeft, marginTop, etc.)
 * into BoxSpacing objects for consistent handling.
 */
export function normalizeBoxSpacing(style: Style): Style {
  const result = { ...style };

  // Normalize padding
  const paddingTop = style.paddingTop;
  const paddingRight = style.paddingRight;
  const paddingBottom = style.paddingBottom;
  const paddingLeft = style.paddingLeft;

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
    delete result.paddingTop;
    delete result.paddingRight;
    delete result.paddingBottom;
    delete result.paddingLeft;
  }

  // Normalize margin
  const marginTop = style.marginTop;
  const marginRight = style.marginRight;
  const marginBottom = style.marginBottom;
  const marginLeft = style.marginLeft;

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
    delete result.marginTop;
    delete result.marginRight;
    delete result.marginBottom;
    delete result.marginLeft;
  }

  return result;
}

/** Compute merged style for an element (defaults → type → parent → inline → container query → animation). */
export function computeStyle(element: Element, parentStyle?: Style, context?: LayoutContext): Style {
  // Merge parent style with element style
  const defaultStyle: Style = {
    color: getThemeColor('textPrimary'),
    backgroundColor: getThemeColor('background'),
    fontWeight: 'normal',
    fontStyle: 'normal',
    textDecoration: 'none',
    border: 'none',
    borderColor: getThemeColor('border'),
    padding: 0,
    margin: 0,
    boxSizing: 'border-box',
  };

  // Apply element-type-specific defaults (lowest priority)
  // These can be overridden by stylesheet and inline styles
  let typeDefaults: Partial<Style> = {};
  if (element.type === 'container' || element.type === 'dialog' || element.type === 'tab' || element.type === 'split-pane') {
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
    fontStyle: parentStyle.fontStyle,
    textDecoration: parentStyle.textDecoration,
    dim: parentStyle.dim,
    reverse: parentStyle.reverse,
    borderColor: parentStyle.borderColor, // Border color can inherit for consistency
  } : {};

  // Fast path: only call pseudo/container/anim when features might be active
  const needsOverlay = context?.stylesheets || element._animationState;
  let pseudoStyles: Partial<Style> | undefined;
  let containerStyles: Partial<Style> | undefined;
  let animStyle: Partial<Style> | undefined;

  if (needsOverlay) {
    pseudoStyles = getPseudoClassStyles(element, context);
    containerStyles = getContainerQueryStyles(element, context);
    animStyle = getAnimatedStyle(element);
  }

  const mergedStyle = (pseudoStyles !== undefined && pseudoStyles !== EMPTY_STYLE) ||
    (containerStyles !== undefined && containerStyles !== EMPTY_STYLE) ||
    (animStyle !== undefined && animStyle !== EMPTY_STYLE)
    ? {
        ...defaultStyle,
        ...typeDefaults,
        ...inheritableParentStyle,
        ...(element.props && element.props.style),
        ...(pseudoStyles !== EMPTY_STYLE ? pseudoStyles : undefined),
        ...(containerStyles !== EMPTY_STYLE ? containerStyles : undefined),
        ...(animStyle !== EMPTY_STYLE ? animStyle : undefined),
      }
    : {
        ...defaultStyle,
        ...typeDefaults,
        ...inheritableParentStyle,
        ...(element.props && element.props.style),
      };

  // Only process transitions for elements that have transition specs or active state.
  if (mergedStyle._transitionSpecs || element._transitionState) {
    processTransitions(element, mergedStyle);
    if (element._transitionState?.active.size) {
      const transStyle = getTransitionStyle(element);
      Object.assign(mergedStyle, transStyle);
    }
  }

  // Derive flexDirection from direction style property (used by split-pane)
  if (mergedStyle.direction) {
    mergedStyle.flexDirection = mergedStyle.direction === 'horizontal' ? 'row' : 'column';
  }

  // Normalize padding and margin: consolidate individual properties into BoxSpacing
  return normalizeBoxSpacing(mergedStyle);
}

/** Compute layout props for an element (defaults → parent → element → style → animation → container query). */
export function computeLayoutProps(element: Element, parentProps?: AdvancedLayoutProps, context?: LayoutContext): AdvancedLayoutProps {
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
    ...DEFAULT_LAYOUT_PROPS,
    ...inheritableParentProps,
    ...element.props,
  };

  // Extract flex and layout properties from style section
  // Fast path: skip pseudo/container/anim/transition when no features are active
  const baseStyle = (element.props && element.props.style) || {};
  const needsOverlay = context?.stylesheets || element._animationState || element._transitionState;
  let style = baseStyle;
  if (needsOverlay) {
    const pseudoStyles = getPseudoClassStyles(element, context);
    const containerStyles = getContainerQueryStyles(element, context);
    const animStyle = getAnimatedStyle(element);
    const transStyle = element._transitionState?.active?.size ? getTransitionStyle(element) : EMPTY_STYLE;
    if (pseudoStyles !== EMPTY_STYLE || containerStyles !== EMPTY_STYLE ||
        animStyle !== EMPTY_STYLE || transStyle !== EMPTY_STYLE) {
      style = { ...baseStyle,
        ...(pseudoStyles !== EMPTY_STYLE ? pseudoStyles : undefined),
        ...(containerStyles !== EMPTY_STYLE ? containerStyles : undefined),
        ...(animStyle !== EMPTY_STYLE ? animStyle : undefined),
        ...(transStyle !== EMPTY_STYLE ? transStyle : undefined) };
    }
  }

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
  // Derive flexDirection from direction style property (used by split-pane)
  if (style.direction === 'horizontal') result.flexDirection = 'row';
  else if (style.direction === 'vertical') result.flexDirection = 'column';
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
  if (style.overflowX !== undefined) result.overflowX = style.overflowX;
  if (style.overflowY !== undefined) result.overflowY = style.overflowY;
  if (style.arrowNav !== undefined) result.arrowNav = style.arrowNav;
  // Parse width/height - XML attributes come as strings, need to convert numeric strings to numbers
  if (style.width !== undefined) {
    if (typeof style.width === 'string' && !isNaN(parseFloat(style.width)) && !style.width.endsWith('%')) {
      result.width = parseFloat(style.width);
    } else {
      result.width = style.width;
    }
  }
  if (style.height !== undefined) {
    if (typeof style.height === 'string' && !isNaN(parseFloat(style.height)) && !style.height.endsWith('%')) {
      result.height = parseFloat(style.height);
    } else {
      result.height = style.height;
    }
  }
  // Parse min/max constraints - XML attributes come as strings
  if (style.minWidth !== undefined) {
    result.minWidth = typeof style.minWidth === 'string' ? parseFloat(style.minWidth) : style.minWidth;
  }
  if (style.maxWidth !== undefined) {
    result.maxWidth = typeof style.maxWidth === 'string' ? parseFloat(style.maxWidth) : style.maxWidth;
  }
  if (style.minHeight !== undefined) {
    result.minHeight = typeof style.minHeight === 'string' ? parseFloat(style.minHeight) : style.minHeight;
  }
  if (style.maxHeight !== undefined) {
    result.maxHeight = typeof style.maxHeight === 'string' ? parseFloat(style.maxHeight) : style.maxHeight;
  }

  // Auto-infer display: flex when flex container properties are present
  // This makes the framework more ergonomic - no need to explicitly set display: flex
  if (result.display !== 'flex' && result.display !== 'none') {
    const hasFlexContainerProps =
      style.flexDirection !== undefined ||
      style.justifyContent !== undefined ||
      style.alignItems !== undefined ||
      style.alignContent !== undefined ||
      style.flexWrap !== undefined ||
      style.gap !== undefined;
    if (hasFlexContainerProps) {
      result.display = 'flex';
    }
  }

  return result;
}
