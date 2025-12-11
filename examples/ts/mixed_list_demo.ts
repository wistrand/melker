// Mixed List Component Demo - Shows list with different types of children
// Usage: deno run --allow-env examples/mixed_list_demo.ts

import {
  createApp,
  createElement,
  getTerminalSize,
  getThemeColor,
  type Element
} from '../src/melker.ts';
import type { SelectionChangeEvent } from '../src/events.ts';

function createMixedListDemo(): Element {
  const terminalSize = getTerminalSize();

  // Handle selection changes
  function handleSelectionChange(event: SelectionChangeEvent) {
    console.log(`Selection changed: ${event.selectedItems} (focused: ${event.focusedItem})`);
  }

  // Create mixed list items - each li can contain different element types
  const mixedListItems = [
    createElement('li', {}, createElement('text', { text: '📄 Text Element' })),
    createElement('li', {}, createElement('button', { title: 'Button Element' })),
    createElement('li', {}, createElement('text', { text: '🔗 Another Text' })),
    createElement('li', {}, createElement('text', { text: 'Plain text without icon' })),
    createElement('li', {}, createElement('button', { title: 'Another Button' })),
  ];

  // Create the list element
  const listElement = createElement('list', {
    selectionMode: 'multiple', // Test multiple selection
    selectedItems: [0, 2], // Pre-select first and third items
    focusedItem: 1,
    onSelectionChange: handleSelectionChange,
    style: {
      border: 'thin',
      borderColor: getThemeColor('primary'),
      padding: 1,
      backgroundColor: getThemeColor('background'),
    }
  }, ...mixedListItems);

  // Create main container
  return createElement('container', {
    style: {
      display: 'flex',
      flexDirection: 'column',
      width: terminalSize.width,
      height: terminalSize.height,
      padding: 2,
      backgroundColor: getThemeColor('background'),
    }
  },
    createElement('text', {
      text: '🎛️ Mixed Children List Demo',
      style: {
        fontWeight: 'bold',
        color: getThemeColor('primary'),
        marginBottom: 2,
      }
    }),
    createElement('text', {
      text: 'This list contains both text and button elements',
      style: {
        color: getThemeColor('textSecondary'),
        marginBottom: 1,
      }
    }),
    listElement,
    createElement('text', {
      text: 'Use ↑↓ to navigate, Space/Enter to select (multiple selection mode)',
      style: {
        color: getThemeColor('textMuted'),
        marginTop: 1,
      }
    })
  );
}

async function runMixedListDemo() {
  try {
    console.log('🎛️ Starting Mixed Children List Demo...');

    // Create UI
    const ui = createMixedListDemo();
    await createApp(ui);

    console.log('✅ Demo started! Use arrow keys to navigate, Space/Enter to select.');

  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}

// Handle script execution
if (import.meta.main) {
  runMixedListDemo().catch((error) => {
    console.error(`💥 Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  });
}