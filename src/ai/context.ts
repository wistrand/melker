// UI Context Builder for AI Accessibility
// Gathers information about current UI state to send to the LLM

import { Document } from '../document.ts';
import { Element, isScrollingEnabled, hasSubtreeElements } from '../types.ts';
import { discoverPaletteItems } from '../command-palette-components.ts';

/** Check if an ARIA boolean attribute is truthy (handles both boolean and string values) */
function isAriaTrue(value: unknown): boolean {
  return value === true || value === 'true';
}

/** Extract accessible text from an element */
function getAccessibleText(el: Element): string | undefined {
  return el.props['aria-label'] || el.props.title || el.props.text || el.props.label;
}

/** Resolve aria-labelledby by looking up referenced elements' text content */
function resolveAriaLabelledBy(element: Element, document: Document): string | undefined {
  const labelledBy = element.props['aria-labelledby'];
  if (!labelledBy || typeof labelledBy !== 'string') return undefined;

  const ids = labelledBy.trim().split(/\s+/);
  const texts: string[] = [];
  for (const id of ids) {
    const ref = document.getElementById(id);
    if (ref) {
      const text = getAccessibleText(ref);
      if (text) texts.push(text);
    }
  }
  return texts.length > 0 ? texts.join(' ') : undefined;
}

export interface UIContext {
  screenContent: string;
  focusedElement: string;
  elementTree: string;
  availableActions: string[];
  selectedText?: string;
}

/**
 * Build a text representation of the screen content
 * Excludes elements with IDs in the excludeIds array
 */
function buildScreenContent(root: Element, excludeIds: Set<string>, document: Document): string {
  const lines: string[] = [];

  function traverse(element: Element, depth: number): void {
    if (excludeIds.has(element.id)) {
      return;
    }

    // Skip elements hidden from accessibility tree
    if (isAriaTrue(element.props['aria-hidden'])) {
      return;
    }

    const indent = '  '.repeat(depth);

    // Extract meaningful text content based on element type
    switch (element.type) {
      case 'text':
        if (element.props.text) {
          lines.push(`${indent}${element.props.text}`);
        }
        break;

      case 'button': {
        const buttonName = resolveAriaLabelledBy(element, document) || element.props['aria-label'] || element.props.title;
        if (buttonName) {
          const states: string[] = [];
          if (isAriaTrue(element.props['aria-expanded'])) states.push('expanded');
          else if (element.props['aria-expanded'] === false || element.props['aria-expanded'] === 'false') states.push('collapsed');
          if (element.props['aria-controls']) states.push(`controls: ${element.props['aria-controls']}`);
          const suffix = states.length > 0 ? ` (${states.join(', ')})` : '';
          lines.push(`${indent}[Button: ${buttonName}${suffix}]`);
        }
        break;
      }

      case 'input': {
        const inputName = resolveAriaLabelledBy(element, document) || element.props['aria-label'] || element.props.placeholder || 'text input';
        const value = element.props.value || '';
        const states: string[] = [];
        if (isAriaTrue(element.props['aria-required'])) states.push('required');
        if (isAriaTrue(element.props['aria-invalid'])) states.push('invalid');
        const stateStr = states.length > 0 ? ` (${states.join(', ')})` : '';
        lines.push(`${indent}[Input: ${inputName}${stateStr}${value ? ' = "' + value + '"' : ''}]`);
        break;
      }

      case 'checkbox': {
        const cbStates: string[] = [element.props.checked ? 'checked' : 'unchecked'];
        if (isAriaTrue(element.props['aria-required'])) cbStates.push('required');
        const cbTitle = resolveAriaLabelledBy(element, document) || element.props['aria-label'] || element.props.title || 'checkbox';
        lines.push(`${indent}[Checkbox: ${cbTitle} (${cbStates.join(', ')})]`);
        break;
      }

      case 'radio': {
        const selected = element.props.checked ? 'selected' : 'unselected';
        const rbTitle = resolveAriaLabelledBy(element, document) || element.props['aria-label'] || element.props.title || 'radio';
        lines.push(`${indent}[Radio: ${rbTitle} (${selected})]`);
        break;
      }

      case 'dialog':
        if (element.props.open) {
          const dialogName = resolveAriaLabelledBy(element, document) || element.props['aria-label'] || element.props.title;
          if (dialogName) {
            lines.push(`${indent}[Dialog: ${dialogName}]`);
          }
        }
        break;

      case 'tabs': {
        // Find which tab is active by looking for visible child tab
        const tabChildren = (element.children || []).filter(c => c.type === 'tab');
        const activeTab = tabChildren.find(t => t.props.visible === true);
        const activeIndex = activeTab ? tabChildren.indexOf(activeTab) : 0;
        const tabNames = tabChildren.map(t => t.props.title || 'Untitled').join(', ');
        lines.push(`${indent}[Tabs: ${tabNames}] (active: ${activeTab?.props.title || tabChildren[activeIndex]?.props.title || 'Tab ' + (activeIndex + 1)})`);
        break;
      }

      case 'tab': {
        const isActive = element.props.visible === true;
        if (element.props.title) {
          lines.push(`${indent}[Tab: ${element.props.title}${isActive ? ' (ACTIVE)' : ' (hidden)'}]`);
        }
        break;
      }

      case 'list': {
        const itemCount = (element.children || []).filter(c => c.type === 'li').length;
        const selectedItem = (element.children || []).find(c => c.props.selected === true);
        const selectedText = selectedItem?.props.text || selectedItem?.props.title;
        lines.push(`${indent}[List: ${itemCount} items${selectedText ? ', selected: ' + selectedText : ''}]`);
        break;
      }

      case 'li': {
        const isSelected = element.props.selected === true;
        if (element.props.text || element.props.title) {
          lines.push(`${indent}- ${element.props.text || element.props.title}${isSelected ? ' (selected)' : ''}`);
        }
        break;
      }

      case 'textarea': {
        const taName = resolveAriaLabelledBy(element, document) || element.props['aria-label'] || element.props.placeholder || 'text area';
        const value = element.props.value || '';
        const lineCount = value.split('\n').length;
        const taExtras: string[] = [];
        if (isAriaTrue(element.props['aria-required'])) taExtras.push('required');
        if (isAriaTrue(element.props['aria-invalid'])) taExtras.push('invalid');
        if (value) taExtras.push(`${lineCount} lines`);
        const taSuffix = taExtras.length > 0 ? ` (${taExtras.join(', ')})` : '';
        lines.push(`${indent}[TextArea: ${taName}${taSuffix}]`);
        break;
      }

      case 'markdown': {
        const text = element.props.text || '';
        const preview = text.length > 50 ? text.substring(0, 47) + '...' : text;
        lines.push(`${indent}[Markdown: "${preview}"]`);
        break;
      }

      case 'container': {
        const role = element.props.role;
        const ariaLabel = resolveAriaLabelledBy(element, document) || element.props['aria-label'];
        const cStates: string[] = [];
        if (isAriaTrue(element.props['aria-expanded'])) cStates.push('expanded');
        else if (element.props['aria-expanded'] === false || element.props['aria-expanded'] === 'false') cStates.push('collapsed');
        if (isAriaTrue(element.props['aria-busy'])) cStates.push('loading');
        if (!role && !ariaLabel && isScrollingEnabled(element)) cStates.push('scrollable');
        const cSuffix = cStates.length > 0 ? `, ${cStates.join(', ')}` : '';
        if (role) {
          const roleName = role.charAt(0).toUpperCase() + role.slice(1);
          lines.push(`${indent}[${roleName}${ariaLabel ? ': ' + ariaLabel : ''}${cSuffix}]`);
        } else if (ariaLabel) {
          lines.push(`${indent}[Container: ${ariaLabel}${cSuffix}]`);
        } else if (element.id && !element.id.startsWith('doc-')) {
          lines.push(`${indent}[Container: ${element.id}${cSuffix}]`);
        } else if (cStates.length > 0) {
          lines.push(`${indent}[Container${cSuffix}]`);
        }
        break;
      }

      default: {
        if (element.type !== 'container') {
          const role = element.props.role;
          const ariaLabel = resolveAriaLabelledBy(element, document) || element.props['aria-label'];
          const typeName = role
            ? role.charAt(0).toUpperCase() + role.slice(1)
            : element.type;
          const dStates: string[] = [];
          if (isAriaTrue(element.props['aria-expanded'])) dStates.push('expanded');
          else if (element.props['aria-expanded'] === false || element.props['aria-expanded'] === 'false') dStates.push('collapsed');
          if (isAriaTrue(element.props['aria-busy'])) dStates.push('loading');
          const dSuffix = dStates.length > 0 ? ` (${dStates.join(', ')})` : '';
          lines.push(`${indent}[${typeName}${ariaLabel ? ': ' + ariaLabel : ''}${dSuffix}]`);
        }
        break;
      }
    }

    // Add aria-description as supplementary context
    if (element.props['aria-description']) {
      lines.push(`${indent}  (${element.props['aria-description']})`);
    }

    // Traverse children
    if (element.children) {
      for (const child of element.children) {
        traverse(child, depth + 1);
      }
    }

    // Traverse subtree elements (e.g., mermaid graphs in markdown)
    if (hasSubtreeElements(element)) {
      for (const subtreeEl of element.getSubtreeElements()) {
        traverse(subtreeEl, depth + 1);
      }
    }
  }

  traverse(root, 0);
  return lines.join('\n');
}

/**
 * Build a structural tree representation of the UI
 */
function buildElementTree(root: Element, excludeIds: Set<string>, document: Document): string {
  const lines: string[] = [];

  function traverse(element: Element, prefix: string, isLast: boolean): void {
    if (excludeIds.has(element.id)) {
      return;
    }

    // Skip elements hidden from accessibility tree
    if (isAriaTrue(element.props['aria-hidden'])) {
      return;
    }

    const connector = isLast ? '\\-- ' : '+-- ';
    const childPrefix = prefix + (isLast ? '    ' : '|   ');

    // Format element node — use role if provided
    let node = element.props.role || element.type;
    if (element.id && !element.id.startsWith('doc-')) {
      node += `#${element.id}`;
    }

    // Add key info — aria-labelledby > aria-label > title as accessible name
    const info: string[] = [];
    const accessibleName = resolveAriaLabelledBy(element, document) || element.props['aria-label'] || element.props.title;
    if (accessibleName) info.push(`"${accessibleName}"`);
    if (element.props.text && element.props.text.length < 30) {
      info.push(`"${element.props.text}"`);
    }
    if (element.props.disabled) info.push('disabled');
    if (element.props.focused) info.push('focused');
    if (element.props['aria-description']) {
      info.push(`desc: "${element.props['aria-description']}"`);
    }
    if (isAriaTrue(element.props['aria-expanded'])) info.push('expanded');
    else if (element.props['aria-expanded'] === false || element.props['aria-expanded'] === 'false') info.push('collapsed');
    if (isAriaTrue(element.props['aria-busy'])) info.push('loading');
    if (isAriaTrue(element.props['aria-required'])) info.push('required');
    if (isAriaTrue(element.props['aria-invalid'])) info.push('invalid');
    if (element.props['aria-controls']) info.push(`controls: ${element.props['aria-controls']}`);

    // Add state info for interactive elements
    if (element.props.checked !== undefined) {
      info.push(element.props.checked ? 'checked' : 'unchecked');
    }
    if (element.props.selected !== undefined) {
      info.push(element.props.selected ? 'selected' : 'unselected');
    }
    if (element.props.open !== undefined) {
      info.push(element.props.open ? 'open' : 'closed');
    }
    if (element.type === 'tab' && element.props.visible !== undefined) {
      info.push(element.props.visible ? 'active' : 'hidden');
    }
    if (element.props.value !== undefined && element.props.value !== '') {
      // Mask password values
      if (element.type === 'input' && element.props.format === 'password') {
        info.push(`value="****"`);
      } else {
        const val = String(element.props.value);
        info.push(`value="${val.length > 50 ? val.slice(0, 47) + '...' : val}"`);
      }
    }

    if (info.length > 0) {
      node += ` [${info.join(', ')}]`;
    }

    lines.push(prefix + connector + node);

    // Process children
    const children = (element.children || []).filter(c => !excludeIds.has(c.id));

    // Include subtree elements (e.g., mermaid graphs in markdown)
    const subtreeElements: Element[] = hasSubtreeElements(element)
      ? element.getSubtreeElements().filter(c => !excludeIds.has(c.id))
      : [];

    const allChildren = [...children, ...subtreeElements];
    allChildren.forEach((child, index) => {
      traverse(child, childPrefix, index === allChildren.length - 1);
    });
  }

  traverse(root, '', true);
  return lines.join('\n');
}

/**
 * Get description of the focused element
 */
function describeFocusedElement(document: Document): string {
  const focused = document.focusedElement;
  if (!focused) {
    return 'No element is currently focused';
  }

  const parts: string[] = [];
  parts.push(`Type: ${focused.props.role || focused.type}`);

  if (focused.id && !focused.id.startsWith('doc-')) {
    parts.push(`ID: ${focused.id}`);
  }

  const focusedName = resolveAriaLabelledBy(focused, document) || focused.props['aria-label'] || focused.props.title;
  if (focusedName) {
    parts.push(`Title: "${focusedName}"`);
  }

  if (focused.props.text) {
    const text = focused.props.text.length > 50
      ? focused.props.text.substring(0, 47) + '...'
      : focused.props.text;
    parts.push(`Text: "${text}"`);
  }

  if (focused.props.value !== undefined) {
    // Mask password values
    if (focused.type === 'input' && focused.props.format === 'password') {
      parts.push(`Value: "****"`);
    } else {
      parts.push(`Value: "${focused.props.value}"`);
    }
  }

  if (focused.props.placeholder) {
    parts.push(`Placeholder: "${focused.props.placeholder}"`);
  }

  if (focused.props['aria-description']) {
    parts.push(`Description: "${focused.props['aria-description']}"`);
  }

  if (focused.props.disabled) {
    parts.push('(disabled)');
  }
  if (isAriaTrue(focused.props['aria-expanded'])) {
    parts.push('(expanded)');
  } else if (focused.props['aria-expanded'] === false || focused.props['aria-expanded'] === 'false') {
    parts.push('(collapsed)');
  }
  if (isAriaTrue(focused.props['aria-busy'])) parts.push('(loading)');
  if (isAriaTrue(focused.props['aria-required'])) parts.push('(required)');
  if (isAriaTrue(focused.props['aria-invalid'])) parts.push('(invalid)');
  if (focused.props['aria-controls']) {
    parts.push(`Controls: "${focused.props['aria-controls']}"`);
  }

  return parts.join(', ');
}

/**
 * Get available keyboard actions
 */
function getAvailableActions(document: Document): string[] {
  const actions: string[] = [];
  const focused = document.focusedElement;

  // Global actions
  actions.push('Tab / Shift+Tab: Navigate between focusable elements');
  actions.push('Escape: Close dialogs');
  actions.push('F11 or Alt+H: Open accessibility assistant (this dialog)');

  // Context-specific actions
  if (focused) {
    switch (focused.type) {
      case 'button':
        actions.push('Enter / Space: Activate button');
        break;

      case 'input':
        actions.push('Type to enter text');
        actions.push('Enter: Submit (if in form)');
        break;

      case 'checkbox':
        actions.push('Space: Toggle checkbox');
        break;

      case 'radio':
        actions.push('Space: Select radio option');
        actions.push('Arrow keys: Navigate radio group');
        break;

      case 'tabs':
        actions.push('Arrow Left/Right: Switch tabs');
        break;

      case 'list':
        actions.push('Arrow Up/Down: Navigate list items');
        actions.push('Enter: Select item');
        break;

      case 'container':
        if (isScrollingEnabled(focused)) {
          actions.push('Arrow keys: Scroll content');
        }
        break;
    }
  }

  // Discovered commands and palette shortcuts
  const noop = () => {};
  const items = discoverPaletteItems(document, noop);
  for (const item of items) {
    const key = item.hint || item.shortcut;
    if (key) {
      actions.push(`${key}: ${item.label}`);
    }
  }

  return actions;
}

/**
 * Hash the context for cache key generation
 */
export function hashContext(context: UIContext): string {
  const content = [
    context.screenContent,
    context.focusedElement,
    context.elementTree,
    context.selectedText || '',
  ].join('|');

  // Simple hash function
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString(36);
}

/**
 * Build complete UI context for the AI
 * @param document The Melker document
 * @param excludeIds IDs of elements to exclude (e.g., the accessibility dialog)
 * @param selectedText Currently selected text in the UI (if any)
 */
export function buildContext(document: Document, excludeIds: string[] = [], selectedText?: string): UIContext {
  const excludeSet = new Set(excludeIds);

  return {
    screenContent: buildScreenContent(document.root, excludeSet, document),
    focusedElement: describeFocusedElement(document),
    elementTree: buildElementTree(document.root, excludeSet, document),
    availableActions: getAvailableActions(document),
    selectedText: selectedText || undefined,
  };
}

/**
 * Build the system prompt for the AI
 */
export function buildSystemPrompt(context: UIContext): string {
  let prompt = `You are an accessibility assistant for a terminal user interface (TUI) application.
The user may be visually impaired or need help understanding the current screen.
Provide concise, helpful answers about the UI.

Current screen content:
${context.screenContent}

Currently focused: ${context.focusedElement}`;

  // Include selected text if present
  if (context.selectedText) {
    prompt += `

Currently selected text:
"${context.selectedText}"`;
  }

  prompt += `

UI structure:
${context.elementTree}

Available keyboard actions:
${context.availableActions.map(a => '- ' + a).join('\n')}

Answer the user's question about the UI concisely and helpfully.
Focus on what they can do and how to navigate.
Keep responses brief - typically 1-3 sentences.`;

  return prompt;
}
