// Scrolling List Demo - Test scroll bars in containers
// Shows: Scrollable list of text rows, dynamic content addition, scroll indicators

import {
  MelkerEngine,
  createApp,
  createElement,
  melker,
  getThemeColor,
  type Element,
  type KeyPressEvent,
} from '../src/melker.ts';

console.log('=== Scrolling List Demo ===');
console.log('Note: This demo requires a real terminal (TTY) for keyboard input.');
console.log('Run directly in your terminal with:');
console.log('  deno run --allow-env examples/scrolling_list_demo.ts');
console.log('');
console.log('Features:');
console.log('- Scrollable container with many text rows');
console.log('- Button to add new random rows');
console.log('- Scroll bars to indicate position');
console.log('- Arrow keys to scroll up/down');
console.log('- Tab to switch between button and scrollable area');

let textRows: string[] = [
  'Row 1 - Lorem ipsum dolor sit amet, consectetur adipiscing elit',
  'Row 2 - Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua',
  'Row 3 - Ut enim ad minim veniam, quis nostrud exercitation ullamco',
  'Row 4 - Duis aute irure dolor in reprehenderit in voluptate velit esse',
  'Row 5 - Excepteur sint occaecat cupidatat non proident, sunt in culpa',
  'Row 6 - Sed ut perspiciatis unde omnis iste natus error sit voluptatem',
  'Row 7 - Nemo enim ipsam voluptatem quia voluptas sit aspernatur aut odit',
  'Row 8 - Neque porro quisquam est, qui dolorem ipsum quia dolor sit amet',
  'Row 9 - Ut enim ad minima veniam, quis nostrum exercitationem ullam',
  'Row 10 - At vero eos et accusamus et iusto odio dignissimos ducimus',
  'Row 11 - Quis autem vel eum iure reprehenderit qui in ea voluptate velit',
  'Row 12 - Sed ut perspiciatis unde omnis iste natus error sit voluptatem',
  'Row 13 - Accusantium doloremque laudantium, totam rem aperiam eaque ipsa',
  'Row 14 - Quae ab illo inventore veritatis et quasi architecto beatae',
  'Row 15 - Vitae dicta sunt explicabo nemo enim ipsam voluptatem quia voluptas',
  'Row 16 - Sit aspernatur aut odit aut fugit, sed quia consequuntur magni',
  'Row 17 - Dolores eos qui ratione voluptatem sequi nesciunt neque porro',
  'Row 18 - Quisquam est, qui dolorem ipsum quia dolor sit amet consectetur',
];

let engine: MelkerEngine;

// Sample text snippets for generating random rows
const randomTexts = [
  'The quick brown fox jumps over the lazy dog',
  'Pack my box with five dozen liquor jugs',
  'How vexingly quick daft zebras jump!',
  'Sphinx of black quartz, judge my vow',
  'Two driven jocks help fax my big quiz',
  'Five quacking zephyrs jolt my wax bed',
  'The five boxing wizards jump quickly',
  'Jackdaws love my big sphinx of quartz',
  'Mr. Jock, TV quiz PhD., bags few lynx',
  'Waltz, bad nymph, for quick jigs vex',
  'Glib jocks quiz nymph to vex dwarf',
  'Brawny gods just flocked up to quiz and vex him',
];

function getRandomText(): string {
  const text = randomTexts[Math.floor(Math.random() * randomTexts.length)];
  const rowNumber = textRows.length + 1;
  return `Row ${rowNumber} - ${text}`;
}

function addRandomRow() {
  const newRow = getRandomText();
  textRows.push(newRow);
  console.log(`Added: ${newRow}`);
  updateScrollableList();
}

function updateScrollableList() {
  const scrollContainer = engine.document.getElementById('scrollable-list');
  if (scrollContainer) {
    scrollContainer.children = createTextRows();
    // Auto-scroll to bottom when new content is added
    engine.scrollToBottom('scrollable-list');
    // Update the row count display
    updateRowCount();
    engine.render();
  }
}

function updateRowCount() {
  const countElement = engine.document.getElementById('row-count');
  if (countElement && countElement.props) {
    countElement.props.text = `Total rows: ${textRows.length}`;
  }
}

function createTextRows(): Element[] {
  return textRows.map((text, index) => {
    return createElement('text', {
      id: `row-${index}`,
      text: text,
      style: {
        marginBottom: 0,
        color: index % 2 === 0 ? getThemeColor('info') : getThemeColor('warning'),
        padding: 0
      }
    });
  });
}

function handleKeyPress(event: KeyPressEvent) {
  if (event.key === 'Escape') {
    console.log('\n[GOODBYE] Thanks for using the scrolling demo!');
    console.log('[EXIT] Exiting gracefully...');
    if (engine) {
      engine.stop();
    }
    Deno.exit(0);
  }
  // Return false to allow engine to handle other keys (like arrow keys for scrolling)
  return false;
}

function createScrollingUI(): Element {
  const mainContainer = melker`
    <container id="main-container" style=${{
      border: 'thin',
      borderColor: 'cyan',
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column'
    }}>
      <container id="header" style=${{
        backgroundColor: getThemeColor('headerBackground'),
        color: getThemeColor('headerForeground'),
        fontWeight: 'bold',
        padding: 0,
        borderBottom: 'thin',
        borderColor: 'cyan',
        flex: '0 0 auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }}>
        <text id="title" style=${{ fontWeight: 'bold' }}>
          Scrolling List Demo (${textRows.length} rows)
        </text>
      </container>

      <container
        id="scrollable-list"
        scrollable=${true}
        scrollY=${0}
        tabIndex=${1}
        style=${{
          padding: 1,
          backgroundColor: 'black',
          borderBottom: 'thin',
          borderColor: 'cyan',
          flex: '1 1 0',
          overflow: 'scroll'
        }}
        onKeyPress=${handleKeyPress}
      >
      </container>

      <container id="control-area" style=${{
        backgroundColor: 'gray',
        padding: 0,
        borderBottom: 'thin',
        borderColor: 'cyan',
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center'
      }}>
        <button
          title="Add Random Row"
          id="add-button"
          tabIndex=${2}
          style=${{
            minWidth: 16,
            flex: '0 0 auto',
            marginRight: 2
          }}
          onClick=${() => {
            addRandomRow();
          }}
        >
        </button>

        <text id="instructions" style=${{
          flex: '1 1 0',
          marginRight: 2
        }}>
          Tab to switch focus | Arrow keys to scroll | Esc to exit
        </text>
      </container>

      <container id="status-bar" style=${{
        backgroundColor: getThemeColor('sidebarBackground'),
        color: getThemeColor('sidebarForeground'),
        padding: 0,
        flex: '0 0 auto',
        display: 'flex',
        flexDirection: 'row',
        alignItems: 'center'
      }}>
        <text id="row-count" style=${{
          backgroundColor: getThemeColor('headerBackground'),
          color: getThemeColor('headerForeground'),
          flex: '1 0 0',
          marginRight: 1
        }}>
          Total rows: ${textRows.length}
        </text>

        <button
          title="Exit"
          id="exit-button"
          tabIndex=${3}
          style=${{
            minWidth: 8,
            flex: '0 0 8'
          }}
          onClick=${async () => {
            console.log('\n[GOODBYE] Thanks for using the scrolling demo!');
            console.log('[EXIT] Exiting gracefully...');
            if (engine) {
              try {
                await engine.stop();
              } catch (error) {
                console.error('Error during cleanup:', error);
              }
            }
            Deno.exit(0);
          }}
        >
        </button>
      </container>
    </container>
  `;

  // Add initial text rows to the scrollable container after creation
  const scrollContainer = mainContainer.children?.find((child: any) => child.id === 'scrollable-list');
  if (scrollContainer) {
    scrollContainer.children = createTextRows();
  }

  return mainContainer;
}

async function runScrollingDemo() {
  const ui = createScrollingUI();
  engine = await createApp(ui);

  // Focus the scrollable area initially
  if (engine.document) {
    engine.document.focus('scrollable-list');
  }
}

runScrollingDemo().catch(console.error);