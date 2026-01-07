// Basic Usage - Core API demonstration
// Shows: createElement, JSON serialization, element manipulation, component registration

import {
  createElement,
  elementToJson,
  elementFromJson,
  findElementById,
  appendChild,
  registerComponent,
  ComponentDefinition,
  type Element,
  type ClickEvent,
} from '../../mod.ts';

console.log('=== Melker Core API Demo ===');

// Example 1: Element creation with createElement
console.log('\n1. Element Creation:');
const container = createElement('container', {
  style: { border: 'thin', padding: 1, width: 'fill', maxWidth: 80, height: 'fill', maxHeight: 30 },
  id: 'main-container',
},
  createElement('text', {
    text: 'Welcome to Melker!',
    style: { fontWeight: 'bold' },
    id: 'welcome-text',
  }),
  createElement('button', {
    title: 'Click Me',
    variant: 'primary',
    onClick: (event: ClickEvent) => {
      console.log('Button clicked at position:', event.position);
    },
    id: 'click-button',
  })
);

console.log('[OK] Created container with', container.children?.length, 'children');

// Example 2: JSON serialization
console.log('\n2. JSON Serialization:');
const json = elementToJson(container);
console.log('[OK] Serialized to JSON (' + json.length + ' chars)');

const restored = elementFromJson(json);
console.log('[OK] Restored from JSON:', restored.type, 'with ID:', restored.id);

// Example 3: Element manipulation
console.log('\n3. Element Manipulation:');
const dynamicContainer = createElement('container', {
  id: 'dynamic-container',
});

// Add children dynamically
appendChild(dynamicContainer, createElement('text', {
  text: 'Dynamic content',
  id: 'dynamic-text',
}));

appendChild(dynamicContainer, createElement('button', {
  title: 'Dynamic button',
  id: 'dynamic-button',
}));

console.log('[OK] Dynamic container now has', dynamicContainer.children?.length, 'children');

// Find element by ID
const found = findElementById(dynamicContainer, 'dynamic-text');
console.log('[OK] Found element by ID:', found?.type);

// Example 4: Component Registration
console.log('\n4. Component Registration:');
console.log('[OK] All built-in components are auto-registered (container, input, text, button, dialog)');
console.log('[OK] Custom components can extend Element class and be registered via ComponentDefinition');

console.log('\n=== Core API Demo Complete ===');
console.log('[OK] createElement for consistent element creation');
console.log('[OK] JSON serialization/deserialization');
console.log('[OK] Element tree manipulation');
console.log('[OK] Component extensibility framework');