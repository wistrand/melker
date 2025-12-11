// Simple List Component Demo - Minimal demo to test list functionality
// Usage: deno run --allow-env examples/simple_list_demo.ts

import {
  createApp,
  createElement,
  getTerminalSize,
  getThemeColor,
  type Element
} from '../src/melker.ts';
import type { SelectionChangeEvent } from '../src/events.ts';

function createSimpleListDemo(): Element {
  const terminalSize = getTerminalSize();

  // Create list items with text content
  const listItems = [
    createElement('li', {}, createElement('text', { text: 'Apple' })),
    createElement('li', {}, createElement('text', { text: 'Banana' })),
    createElement('li', {}, createElement('text', { text: 'Cherry' })),
    createElement('li', {}, createElement('text', { text: 'Date' })),
    createElement('li', {}, createElement('text', { text: 'Elderberry' })),
    createElement('li', {}, createElement('text', { text: 'Fig' })),
    createElement('li', {}, createElement('text', { text: 'Grape' })),
  ];

  // Create the list element - let it manage its own state
  const listElement = createElement('list', {
    id: 'simple-list',
    selectionMode: 'single',
    selectedItems: [], // Initial empty selection
    focusedItem: 0,    // Start with first item focused
    style: {
      border: 'thin',
      borderColor: getThemeColor('primary'),
      padding: 1,
      backgroundColor: getThemeColor('background'),
    }
  }, ...listItems);

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
      text: '📋 Simple List Demo',
      style: {
        fontWeight: 'bold',
        color: getThemeColor('primary'),
        marginBottom: 2,
      }
    }),
    createElement('text', {
      text: 'Use arrow keys to navigate and Space/Enter to select items',
      style: {
        color: getThemeColor('textSecondary'),
        marginBottom: 1,
      }
    }),
    listElement,
    createElement('text', {
      text: 'Use ↑↓ to navigate, Space/Enter to select, Ctrl+C to quit',
      style: {
        color: getThemeColor('textMuted'),
        marginTop: 1,
      }
    })
  );
}

async function runSimpleListDemo() {
  try {
    console.log('📋 Starting Simple List Demo...');

    // Create UI
    const ui = createSimpleListDemo();
    const engine = await createApp(ui);

    // Focus the list component to enable keyboard navigation
    engine.document.focus('simple-list');

  } catch (error) {
    console.error(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  }
}

// Handle script execution
if (import.meta.main) {
  runSimpleListDemo().catch((error) => {
    console.error(`💥 Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  });
}

export { createSimpleListDemo };