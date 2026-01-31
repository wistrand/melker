// Tree traversal utilities for Element trees
// Consolidates common recursive traversal patterns

import type { Element } from '../types.ts';

/**
 * Predicate function for filtering elements
 */
export type ElementPredicate = (element: Element) => boolean;

/**
 * Find the first element matching a predicate (depth-first search)
 * @returns The first matching element, or null if not found
 */
export function findElement(root: Element, predicate: ElementPredicate): Element | null {
  if (predicate(root)) {
    return root;
  }
  if (root.children) {
    for (const child of root.children) {
      const found = findElement(child, predicate);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Check if any element matches a predicate (early return on first match)
 * @returns true if any element matches, false otherwise
 */
export function hasElement(root: Element, predicate: ElementPredicate): boolean {
  if (predicate(root)) {
    return true;
  }
  if (root.children) {
    for (const child of root.children) {
      if (hasElement(child, predicate)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Collect all elements matching a predicate
 * @param root - Root element to search from
 * @param predicate - Filter function
 * @param result - Optional array to collect into (for reuse/efficiency)
 * @returns Array of matching elements
 */
export function collectElements(
  root: Element,
  predicate: ElementPredicate,
  result: Element[] = []
): Element[] {
  if (predicate(root)) {
    result.push(root);
  }
  if (root.children) {
    for (const child of root.children) {
      collectElements(child, predicate, result);
    }
  }
  return result;
}

/**
 * Check if an element is a descendant of (or equal to) a container
 * @param element - Element to check
 * @param container - Container to search within
 * @returns true if element is within container's tree
 */
export function isDescendant(element: Element, container: Element): boolean {
  if (container === element) return true;
  if (container.children) {
    for (const child of container.children) {
      if (isDescendant(element, child)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if an element with a specific ID exists within a container
 * @param elementId - ID to search for
 * @param container - Container to search within
 * @returns true if element with ID is within container's tree
 */
export function hasElementWithId(elementId: string, container: Element): boolean {
  return hasElement(container, el => el.id === elementId);
}

/**
 * Find an element by ID within a tree
 * @param root - Root element to search from
 * @param elementId - ID to find
 * @returns The element with the given ID, or null if not found
 */
export function findElementById(root: Element, elementId: string): Element | null {
  return findElement(root, el => el.id === elementId);
}

/**
 * Find the parent of an element with a specific ID
 * @param root - Root element to search from
 * @param targetId - ID of the element whose parent we want
 * @returns The parent element, or null if not found or if targetId is the root
 */
export function findParentOf(root: Element, targetId: string): Element | null {
  if (!root.children) {
    return null;
  }

  for (const child of root.children) {
    if (child.id === targetId) {
      return root;
    }
    const foundInChild = findParentOf(child, targetId);
    if (foundInChild) {
      return foundInChild;
    }
  }

  return null;
}

// ============================================================================
// Dialog-specific predicates (convenience functions)
// ============================================================================

/**
 * Predicate for open dialogs
 */
export const isOpenDialog: ElementPredicate = (el) =>
  el.type === 'dialog' && el.props?.open === true;

/**
 * Predicate for open modal dialogs
 */
export const isOpenModalDialog: ElementPredicate = (el) =>
  el.type === 'dialog' && el.props?.open === true && el.props?.modal === true;
