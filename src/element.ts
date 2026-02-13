// Element creation and manipulation functions

import {
  Element,
  ComponentRegistry,
  ComponentDefinition,
  PropsForComponent,
  ComponentPropsMap,
} from './types.ts';
import { Document } from './document.ts';
import { PersistedState, PersistenceMapping } from './state-persistence.ts';
import { normalizeStyle } from './components/color-utils.ts';

// Re-export for public API (implementation in tree-traversal.ts)
export { findElementById } from './utils/tree-traversal.ts';

/**
 * Persistence context for createElement to merge saved state
 */
export interface PersistenceContext {
  state: PersistedState | null;      // Loaded from file
  document: Document | null;          // Current live document
  mappings: PersistenceMapping[];
}

let _persistenceContext: PersistenceContext = {
  state: null,
  document: null,
  mappings: [],
};

/**
 * Set the persistence context for createElement to use
 */
export function setPersistenceContext(ctx: Partial<PersistenceContext>): void {
  _persistenceContext = { ..._persistenceContext, ...ctx };
}

/**
 * Get the current persistence context
 */
export function getPersistenceContext(): PersistenceContext {
  return _persistenceContext;
}

/**
 * Merge persisted props into provided props
 * Priority: 1. Current document value, 2. Persisted state, 3. Provided props
 */
function mergePersistedProps(
  type: string,
  props: Record<string, unknown>,
  context: PersistenceContext
): Record<string, unknown> {
  // No persistence context or no ID = no merge
  if (!props.id || props.persist === false) {
    return props;
  }

  // No mappings = no merge
  if (!context.mappings || context.mappings.length === 0) {
    return props;
  }

  const id = props.id as string;
  const merged = { ...props };

  for (const mapping of context.mappings) {
    if (mapping.type !== type) continue;

    // Priority 1: Current document value (runtime changes)
    if (context.document) {
      const existingElement = context.document.getElementById(id);
      if (existingElement && existingElement.type === type) {
        // Check condition if present
        if (!mapping.condition || mapping.condition(existingElement)) {
          const currentValue = existingElement.props[mapping.prop];
          if (currentValue !== undefined) {
            merged[mapping.prop] = currentValue;
            continue; // Skip lower priorities
          }
        }
      }
    }

    // Priority 2: Persisted state (from file)
    if (context.state) {
      const savedValue = context.state[type]?.[id];
      if (savedValue !== undefined) {
        merged[mapping.prop] = savedValue;
        continue;
      }
    }

    // Priority 3: Provided props (already in merged)
  }

  return merged;
}

// Basic concrete Element implementation for built-in types
class BasicElement extends Element {
  constructor(type: string, props: Record<string, any> = {}, children?: Element[]) {
    super(type, props, children);
  }
}

const componentRegistry: ComponentRegistry = {};

/**
 * Parse class string into classList array and normalize props
 */
export function normalizeClassProps(props: Record<string, any>): void {
  // Parse 'class' string into classList array
  if (props.class && typeof props.class === 'string') {
    const classNames = props.class.trim().split(/\s+/).filter(Boolean);
    // Merge with existing classList if present
    if (props.classList && Array.isArray(props.classList)) {
      props.classList = [...new Set([...props.classList, ...classNames])];
    } else {
      props.classList = classNames;
    }
    // Remove the string 'class' prop since we've converted it
    delete props.class;
  }
}

/**
 * Check if an element has a specific class
 */
export function hasClass(element: Element, className: string): boolean {
  return element.props.classList?.includes(className) ?? false;
}

/**
 * Add a class to an element's classList
 */
export function addClass(element: Element, className: string): void {
  if (!element.props.classList) {
    element.props.classList = [];
  }
  if (!element.props.classList.includes(className)) {
    element.props.classList.push(className);
  }
}

/**
 * Remove a class from an element's classList
 */
export function removeClass(element: Element, className: string): void {
  if (element.props.classList) {
    element.props.classList = element.props.classList.filter((c: string) => c !== className);
  }
}

/**
 * Toggle a class on an element's classList
 */
export function toggleClass(element: Element, className: string, force?: boolean): boolean {
  const has = hasClass(element, className);
  if (force !== undefined) {
    if (force && !has) {
      addClass(element, className);
      return true;
    } else if (!force && has) {
      removeClass(element, className);
      return false;
    }
    return force;
  }
  if (has) {
    removeClass(element, className);
    return false;
  } else {
    addClass(element, className);
    return true;
  }
}

// Improved createElement with type-safe props for known components
export function createElement<TType extends keyof ComponentPropsMap | string>(
  type: TType,
  props: PropsForComponent<TType> = {} as PropsForComponent<TType>,
  ...children: Element[]
): Element {
  // Check if there's a registered component for this type
  const componentDef = componentRegistry[type];

  if (componentDef) {
    // Create instance using the registered component class
    // Deep merge style property so default styles aren't completely overwritten
    let mergedProps = { ...componentDef.defaultProps, ...props };
    if (componentDef.defaultProps?.style && (props as any)?.style) {
      mergedProps.style = { ...componentDef.defaultProps.style, ...(props as any).style };
    }
    // Normalize style colors (convert strings to packed RGBA numbers)
    if (mergedProps.style) {
      mergedProps.style = normalizeStyle(mergedProps.style);
    }
    // Parse class string into classList array
    normalizeClassProps(mergedProps);

    // Merge persisted props (if element has ID and persistence is enabled)
    mergedProps = mergePersistedProps(type, mergedProps, _persistenceContext) as typeof mergedProps;

    const componentInstance = new componentDef.componentClass(mergedProps, children);
    return componentInstance;
  }

  // Fallback: create basic element (for built-in types or unregistered components)
  let mergedProps: Record<string, any> = { ...props };

  // Normalize style colors (convert strings to packed RGBA numbers)
  if (mergedProps.style) {
    mergedProps.style = normalizeStyle(mergedProps.style);
  }

  // Parse class string into classList array
  normalizeClassProps(mergedProps);

  // Merge persisted props (if element has ID and persistence is enabled)
  mergedProps = mergePersistedProps(type, mergedProps, _persistenceContext);

  const element = new BasicElement(type, mergedProps, children);

  return element;
}

export function registerComponent(definition: ComponentDefinition): void {
  componentRegistry[definition.type] = definition;
}

export function isValidElementType(type: string): boolean {
  // Check if component is registered in the component registry
  return componentRegistry[type] !== undefined;
}

export function getRegisteredComponentTypes(): string[] {
  return Object.keys(componentRegistry);
}

export function cloneElement(element: Element, newProps?: Record<string, any>): Element {
  return createElement(
    element.type,
    { ...element.props, ...newProps },
    ...(element.children?.map(child => cloneElement(child)) || [])
  );
}

export function traverseElements(
  element: Element,
  callback: (element: Element) => void,
  visitChildren = true
): void {
  callback(element);

  if (visitChildren && element.children) {
    element.children.forEach(child => traverseElements(child, callback, true));
  }
}

export function appendChild(parent: Element, child: Element): void {
  if (!parent.children) {
    parent.children = [];
  }
  parent.children.push(child);
}