// List Component Demo - Shows scrollable list with text children and selection capabilities
// Usage: deno run --allow-env examples/list_demo.ts

import {
  createApp,
  melker,
  getTerminalSize,
  getThemeColor,
  type Element
} from '../mod.ts';
import type { SelectionChangeEvent } from '../src/events.ts';

// Sample list items
const fruits = [
  'Apple', 'Banana', 'Cherry', 'Date', 'Elderberry',
  'Fig', 'Grape', 'Honeydew', 'Kiwi', 'Lemon',
  'Mango', 'Nectarine', 'Orange', 'Papaya', 'Quince',
  'Raspberry', 'Strawberry', 'Tangerine', 'Ugli fruit', 'Vanilla bean',
  'Watermelon', 'Ximenia', 'Yellow passion fruit', 'Zucchini'
];

const colors = [
  'Red', 'Blue', 'Green', 'Yellow', 'Purple',
  'Orange', 'Pink', 'Brown', 'Black', 'White',
  'Gray', 'Cyan', 'Magenta', 'Lime', 'Indigo',
  'Violet', 'Turquoise', 'Gold', 'Silver', 'Maroon'
];

const programming = [
  'JavaScript', 'TypeScript', 'Python', 'Rust', 'Go',
  'Java', 'C++', 'C#', 'Swift', 'Kotlin',
  'Ruby', 'PHP', 'HTML', 'CSS', 'SQL',
  'Shell', 'PowerShell', 'Lua', 'Perl', 'R'
];

function createListDemo(): Element {
  const terminalSize = getTerminalSize();

  // Handle selection changes (optional - just for logging)
  function handleSelectionChange(event: SelectionChangeEvent) {
    // Selection change handling
  }

  return melker`
    <container style=${{
      display: 'flex',
      flexDirection: 'column',
      width: terminalSize.width,
      height: terminalSize.height,
      border: 'thin',
      borderColor: getThemeColor('primary')
    }}>
      <!-- Header -->
      <container style=${{
        display: 'flex',
        flexDirection: 'row',
        height: 3,
        padding: 1,
        borderBottom: 'thin',
        borderColor: getThemeColor('border'),
        backgroundColor: getThemeColor('surface')
      }}>
        <text text="List Component Demo" style=${{
          fontWeight: 'bold',
          color: getThemeColor('primary'),
          flex: '1'
        }} />
        <text text="Mode: single" style=${{
          color: getThemeColor('info'),
          marginRight: 2
        }} />
        <text text="Demo Mode" style=${{
          color: getThemeColor('info')
        }} />
      </container>

      <!-- Content area -->
      <container style=${{
        display: 'flex',
        flexDirection: 'row',
        flex: '1 1 0'
      }}>
        <!-- List container -->
        <container style=${{
          flex: '1 1 0',
          padding: 1,
          borderRight: 'thin',
          borderColor: getThemeColor('border')
        }}>
          <list
            id="main-list"
            selectionMode="single"
            selectedItems=${[]}
            focusedItem=${0}
            onSelectionChange=${handleSelectionChange}
            style=${{
              flex: '1 1 0',
              display: 'flex',
              flexDirection: 'column',
              border: 'thin',
              borderColor: getThemeColor('border'),
              padding: 1
            }}
          >
            <li><text text="Apple" /></li>
            <li><text text="Banana" /></li>
            <li><text text="Cherry" /></li>
            <li><text text="Date" /></li>
            <li><text text="Elderberry" /></li>
            <li><text text="Fig" /></li>
            <li><text text="Grape" /></li>
            <li><text text="Honeydew" /></li>
            <li><text text="Kiwi" /></li>
            <li><text text="Lemon" /></li>
          </list>
        </container>

        <!-- Sidebar -->
        <container style=${{
          width: 30,
          padding: 1,
          backgroundColor: getThemeColor('surface')
        }}>
          <text text="List Features" style=${{
            fontWeight: 'bold',
            color: getThemeColor('secondary'),
            marginBottom: 1
          }} />
          <text text="• Arrow key navigation" style=${{
            color: getThemeColor('textSecondary')
          }} />
          <text text="• Space/Enter selection" style=${{
            color: getThemeColor('textSecondary')
          }} />
          <text text="• Visual focus indicators" style=${{
            color: getThemeColor('textSecondary')
          }} />
          <text text="• Selection markers" style=${{
            color: getThemeColor('textSecondary')
          }} />
          <text text="• Self-managed state" style=${{
            color: getThemeColor('textSecondary')
          }} />
          <text text="• Auto-rendering" style=${{
            color: getThemeColor('textSecondary')
          }} />
        </container>
      </container>

      <!-- Footer -->
      <container style=${{
        height: 3,
        borderTop: 'thin',
        borderColor: getThemeColor('border'),
        backgroundColor: getThemeColor('surface'),
        padding: 1
      }}>
        <text text="Controls: ↑↓ Navigate • Space/Enter Select • m Mode • c Clear • Ctrl+C Quit" style=${{
          color: getThemeColor('textMuted')
        }} />
        <text text=${`Items: ${fruits.length} total • List manages its own state internally`} style=${{
          color: getThemeColor('textMuted')
        }} />
      </container>
    </container>
  `;
}

async function runListDemo() {
  try {
    // Create UI using the list component
    const ui = createListDemo();
    const engine = await createApp(ui);

    // Focus the list component to enable keyboard navigation
    engine.document.focus('main-list');

  } catch (error) {
    Deno.exit(1);
  }
}

// Handle script execution
if (import.meta.main) {
  runListDemo().catch(() => {
    Deno.exit(1);
  });
}

export { createListDemo };