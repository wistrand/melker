// State Management Example - Shows proper patterns for updating UI
// Demonstrates: Direct element updates vs UI recreation

import {
  createApp,
  melker,
  getThemeColor,
  type KeyPressEvent,
} from '../src/melker.ts';

let counter = 0;
let message = 'Initial message';
let engine: any;

// ❌ ANTI-PATTERN: Don't recreate entire UI on every state change
function badUpdatePattern() {
  // This recreates the entire element tree - inefficient!
  const newUI = createCompleteUI();
  engine.updateUI(newUI);
}

// ✅ GOOD PATTERN: Update specific elements and trigger redraw
function updateCounter() {
  const counterElement = engine.document.getElementById('counter-display');
  if (counterElement) {
    counterElement.props.text = `Count: ${counter}`;
    engine.render(); // Efficient redraw of only what changed
  }
}

function updateMessage() {
  const messageElement = engine.document.getElementById('message-display');
  if (messageElement) {
    messageElement.props.text = message;
    engine.render(); // Efficient redraw
  }
}

// Event handlers using proper state management
function handleIncrement() {
  counter++;
  updateCounter(); // Update only the counter element
}

function handleDecrement() {
  counter--;
  updateCounter(); // Update only the counter element
}

function handleUpdateMessage() {
  message = `Updated at ${new Date().toLocaleTimeString()}`;
  updateMessage(); // Update only the message element
}

function handleReset() {
  counter = 0;
  message = 'Reset!';
  // Update multiple elements efficiently
  updateCounter();
  updateMessage();
}

function handleKeyPress(event: KeyPressEvent): void {
  if (event.key === 'Escape') {
    Deno.exit(0);
  }
}

// Create UI once - elements will be updated in-place
function createCompleteUI() {
  const containerStyle = {
    width: 65,
    height: 18,
    display: 'flex',
    flexDirection: 'column',
    border: 'thin',
    borderColor: getThemeColor('primary'),
    padding: 2,
  };

  const headerStyle = {
    backgroundColor: getThemeColor('primary'),
    color: getThemeColor('surface'),
    fontWeight: 'bold',
    padding: 1,
    textAlign: 'center',
    marginBottom: 2,
  };

  const buttonRowStyle = {
    display: 'flex',
    flexDirection: 'row',
    gap: 2,
    justifyContent: 'center',
    marginBottom: 1,
  };

  return melker`
    <container id="main" style=${containerStyle}>
      <text style=${headerStyle}>🔄 State Management Example</text>

      <text style=${{ color: getThemeColor('success'), marginBottom: 1 }}>✅ Proper Pattern: Update elements directly</text>

      <!-- Counter section with ID for targeted updates -->
      <container style=${buttonRowStyle}>
        <button title="Decrement" onClick=${handleDecrement} tabIndex=${1} />
        <text
          id="counter-display"
          style=${{
            color: getThemeColor('success'),
            fontWeight: 'bold',
            minWidth: 15,
            textAlign: 'center'
          }}
        >Count: ${counter}</text>
        <button title="Increment" onClick=${handleIncrement} tabIndex=${2} />
      </container>

      <!-- Message section with ID for targeted updates -->
      <container style=${{ marginBottom: 2 }}>
        <text
          id="message-display"
          style=${{
            color: getThemeColor('textSecondary'),
            textAlign: 'center',
            marginBottom: 1
          }}
        >${message}</text>
        <container style=${buttonRowStyle}>
          <button title="Update Message" onClick=${handleUpdateMessage} tabIndex=${3} />
          <button title="Reset All" onClick=${handleReset} tabIndex=${4} style=${{ color: getThemeColor('warning') }} />
        </container>
      </container>

      <text>
Key principles:
• Use element IDs for targeted updates
• Modify element.props directly
• Call engine.render() to trigger redraw
• Avoid recreating entire UI trees
• Only use updateUI() when structure changes

❌ BAD: engine.updateUI(newCompleteTree)
✅ GOOD: element.props.text = newValue; engine.render()
      </text>

      <text style=${{ marginTop: 1, fontWeight: 'bold' }}>Press Escape to exit</text>
    </container>
  `;
}

async function runStateManagementExample() {
  console.log('=== State Management Example ===');
  console.log('Demonstrates proper patterns for updating UI components');
  console.log('Shows efficient element updates vs expensive UI recreation');
  console.log('');

  const ui = createCompleteUI();
  engine = await createApp(ui);

  if (engine.addEventListener) {
    engine.addEventListener('keyPress', handleKeyPress);
  }

  console.log('Demo running. Interact with buttons to see efficient updates.');
  console.log('Watch console for performance differences.');
}

runStateManagementExample().catch(console.error);