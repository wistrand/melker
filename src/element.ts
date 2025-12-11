// Element creation and manipulation functions

import {
  Element,
  ComponentRegistry,
  ComponentDefinition,
  PropsForComponent,
  ComponentPropsMap,
} from './types.ts';

// Basic concrete Element implementation for built-in types
class BasicElement extends Element {
  constructor(type: string, props: Record<string, any> = {}, children?: Element[]) {
    super(type, props, children);
  }
}

let elementIdCounter = 0;
const componentRegistry: ComponentRegistry = {};

function generateElementId(): string {
  return `mel-${++elementIdCounter}`;
}

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
    const mergedProps = { ...componentDef.defaultProps, ...props };
    if (componentDef.defaultProps?.style && (props as any)?.style) {
      mergedProps.style = { ...componentDef.defaultProps.style, ...(props as any).style };
    }
    // Parse class string into classList array
    normalizeClassProps(mergedProps);
    const componentInstance = new componentDef.componentClass(mergedProps, children);

    // Generate ID if not provided
    if (!componentInstance.id && !mergedProps.id) {
      componentInstance.id = generateElementId();
    } else if (mergedProps.id && !componentInstance.id) {
      componentInstance.id = mergedProps.id;
    }

    return componentInstance;
  }

  // Fallback: create basic element (for built-in types or unregistered components)
  const mergedProps = { ...props };

  // Parse class string into classList array
  normalizeClassProps(mergedProps);

  // Generate ID if not provided
  if (!mergedProps.id) {
    mergedProps.id = generateElementId();
  }

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

export function cloneElement(element: Element, newProps?: Record<string, any>): Element {
  return createElement(
    element.type,
    { ...element.props, ...newProps },
    ...(element.children?.map(child => cloneElement(child)) || [])
  );
}

export function findElementById(root: Element, id: string): Element | null {
  if (root.id === id) {
    return root;
  }

  if (root.children) {
    for (const child of root.children) {
      const found = findElementById(child, id);
      if (found) {
        return found;
      }
    }
  }

  return null;
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