// UI Context Builder for AI Accessibility
// Gathers information about current UI state to send to the LLM

import { Document } from '../document.ts';
import { Element } from '../types.ts';

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
function buildScreenContent(root: Element, excludeIds: Set<string>): string {
  const lines: string[] = [];

  function traverse(element: Element, depth: number): void {
    if (excludeIds.has(element.id)) {
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

      case 'button':
        if (element.props.title) {
          lines.push(`${indent}[Button: ${element.props.title}]`);
        }
        break;

      case 'input': {
        const placeholder = element.props.placeholder || 'text input';
        const value = element.props.value || '';
        lines.push(`${indent}[Input: ${placeholder}${value ? ' = "' + value + '"' : ''}]`);
        break;
      }

      case 'checkbox': {
        const checked = element.props.checked ? 'checked' : 'unchecked';
        const cbTitle = element.props.title || 'checkbox';
        lines.push(`${indent}[Checkbox: ${cbTitle} (${checked})]`);
        break;
      }

      case 'radio': {
        const selected = element.props.checked ? 'selected' : 'unselected';
        const rbTitle = element.props.title || 'radio';
        lines.push(`${indent}[Radio: ${rbTitle} (${selected})]`);
        break;
      }

      case 'dialog':
        if (element.props.open && element.props.title) {
          lines.push(`${indent}[Dialog: ${element.props.title}]`);
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
        const placeholder = element.props.placeholder || 'text area';
        const value = element.props.value || '';
        const lineCount = value.split('\n').length;
        lines.push(`${indent}[TextArea: ${placeholder}${value ? ` (${lineCount} lines)` : ''}]`);
        break;
      }

      case 'markdown': {
        const text = element.props.text || '';
        const preview = text.length > 50 ? text.substring(0, 47) + '...' : text;
        lines.push(`${indent}[Markdown: "${preview}"]`);
        break;
      }

      case 'container': {
        // Add info about container purpose if it has an id
        if (element.id && !element.id.startsWith('doc-')) {
          const scrollable = element.props.scrollable ? ', scrollable' : '';
          lines.push(`${indent}[Container: ${element.id}${scrollable}]`);
        }
        break;
      }

      default:
        // Unknown element type - show it
        if (element.type !== 'container') {
          lines.push(`${indent}[${element.type}]`);
        }
        break;
    }

    // Traverse children
    if (element.children) {
      for (const child of element.children) {
        traverse(child, depth + 1);
      }
    }

    // Traverse subtree elements (e.g., mermaid graphs in markdown)
    const component = element as any;
    if (typeof component.getSubtreeElements === 'function') {
      const subtreeElements = component.getSubtreeElements() as Element[];
      for (const subtreeEl of subtreeElements) {
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
function buildElementTree(root: Element, excludeIds: Set<string>): string {
  const lines: string[] = [];

  function traverse(element: Element, prefix: string, isLast: boolean): void {
    if (excludeIds.has(element.id)) {
      return;
    }

    const connector = isLast ? '\\-- ' : '+-- ';
    const childPrefix = prefix + (isLast ? '    ' : '|   ');

    // Format element node
    let node = element.type;
    if (element.id && !element.id.startsWith('doc-')) {
      node += `#${element.id}`;
    }

    // Add key info
    const info: string[] = [];
    if (element.props.title) info.push(`"${element.props.title}"`);
    if (element.props.text && element.props.text.length < 30) {
      info.push(`"${element.props.text}"`);
    }
    if (element.props.disabled) info.push('disabled');
    if (element.props.focused) info.push('focused');

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
    const component = element as any;
    const subtreeElements: Element[] = typeof component.getSubtreeElements === 'function'
      ? component.getSubtreeElements().filter((c: Element) => !excludeIds.has(c.id))
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
  parts.push(`Type: ${focused.type}`);

  if (focused.id && !focused.id.startsWith('doc-')) {
    parts.push(`ID: ${focused.id}`);
  }

  if (focused.props.title) {
    parts.push(`Title: "${focused.props.title}"`);
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

  if (focused.props.disabled) {
    parts.push('(disabled)');
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
        if (focused.props.scrollable) {
          actions.push('Arrow keys: Scroll content');
        }
        break;
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
    screenContent: buildScreenContent(document.root, excludeSet),
    focusedElement: describeFocusedElement(document),
    elementTree: buildElementTree(document.root, excludeSet),
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
