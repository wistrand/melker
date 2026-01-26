// Interactive Demo - Event handling and user interaction
// Shows: Event handlers, focus management, interactive components

import {
  MelkerEngine,
  createApp,
  createElement,
  getTerminalSize,
  type Element,
  type ClickEvent,
  type KeyPressEvent,
  type ChangeEvent,
} from '../../mod.ts';

console.log('=== Interactive Demo ===');

// State for interactive demo
let counter = 0;
let textInput = '';
let messages: string[] = ['Welcome! Try the interactive controls below.'];

function addMessage(msg: string) {
  messages.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  if (messages.length > 10) {
    messages = messages.slice(-10);
  }
}

// Interactive UI with event handlers
function createInteractiveUI(width: number, height: number): Element {
  return createElement('container', {
      style: {
        border: 'thin',
        padding: 1,
        width: 'fill',
        height: 'fill',
        display: 'flex',
        flexDirection: 'column'
      },
      id: 'root'
    },
      // Title
      createElement('text', {
        text: 'Interactive Interactive Components Demo',
        style: { fontWeight: 'bold', color: 'cyan', marginBottom: 1 },
        id: 'title'
      }),

      // Counter section
      createElement('container', {
          style: {
            marginBottom: 2,
            display: 'flex',
            flexDirection: 'row'
          },
          id: 'counter-section'
        },
          createElement('text', {
              text: `Counter: ${counter}`,
              style: { color: 'green', marginRight: 2 },
              id: 'counter-display'
            }),
          createElement('button', {
              title: '+ Increment',
              variant: 'primary',
              onClick: (event: ClickEvent) => {
                counter++;
                addMessage(`Counter incremented to ${counter}`);
                updateUI();
              },
              id: 'increment-btn'
            }),
          createElement('button', {
              title: 'Reset',
              variant: 'secondary',
              style: { marginLeft: 1 },
              onClick: (event: ClickEvent) => {
                counter = 0;
                addMessage('Counter reset to 0');
                updateUI();
              },
              id: 'reset-btn'
            })
      ),

      // Text input section
      createElement('container', {
          style: {
            marginBottom: 2,
            display: 'flex',
            flexDirection: 'column'
          },
          id: 'input-section'
        },
          createElement('text', {
              text: 'Text Input (Press Enter to submit, Tab to navigate):',
              style: { fontWeight: 'bold', marginBottom: 1 },
              id: 'input-label'
            }),
          createElement('input', {
              placeholder: 'Type something and press Enter...',
              value: textInput,
              style: { width: 'auto', maxWidth: 50 },
              tabIndex: 1,
              onChange: (event: ChangeEvent) => {
                textInput = event.value as string;
              },
              onKeyPress: (event: KeyPressEvent) => {
                if (event.key === 'Enter' && textInput.trim()) {
                  addMessage(`Text submitted: "${textInput}"`);
                  textInput = '';
                  updateUI();
                } else if (event.key === 'Escape') {
                  addMessage('Input cleared with Escape');
                  textInput = '';
                  updateUI();
                }
              },
              id: 'input'
            })
      ),

      // Message log
      createElement('container', {
          style: {
            border: 'thin',
            borderColor: 'gray',
            padding: 1,
            flex: '1',
            minHeight: 8
          },
          id: 'message-log'
        },
          createElement('text', {
              text: 'Activity Log:',
              style: { fontWeight: 'bold', color: 'yellow', marginBottom: 1 },
              id: 'log-title'
            }),
          ...messages.map((msg, i) =>
            createElement('text', {
                text: msg,
                style: {
                  color: i === messages.length - 1 ? 'white' : 'gray',
                  marginBottom: i < messages.length - 1 ? 0 : 0
                },
                id: `log-${i}`
              }
            )
          )
      ),

      // Instructions
      createElement('text', {
          text: 'Controls: Click buttons, type in input, Tab to navigate, Esc to clear input',
          style: { color: 'blue', marginTop: 1 },
          id: 'instructions'
        })
  );
}

let engine: MelkerEngine;

function updateUI() {
  if (engine) {
    const newUI = createInteractiveUI(engine.terminalSize.width, engine.terminalSize.height);
    engine.updateUI(newUI);
    // Focus management is now automatic!
  }
}

async function runInteractiveDemo() {
  addMessage('Starting interactive demo...');

  // Uses excellent defaults: autoResize, autoRender, alternateScreen, hideCursor, enableEvents all true
  const { width, height } = getTerminalSize();
  const ui = createInteractiveUI(width, height);
  engine = await createApp(ui);

  // Focus management is automatic!
  addMessage('Text input focused - start typing!');

  console.log('[OK] Interactive demo started! Try clicking buttons and typing.');
}

runInteractiveDemo().catch(console.error);