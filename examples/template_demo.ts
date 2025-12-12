// Template Literal Demo - Shows HTML-style syntax for Melker
// Usage: deno run --allow-env examples/template_demo.ts

import {
  createApp,
  melker,
  getThemeColor,
  type ClickEvent,
  type KeyPressEvent,
  type Style,
} from '../melker.ts';

// Demo state
let counter = 0;
let inputValue = '';
let displayedText = 'Hello Template Literals!';
let engine: any;

// Event handlers - update elements directly instead of recreating UI
function handleIncrement() {
  counter++;
  updateCounterDisplay();
}

function handleDecrement() {
  counter--;
  updateCounterDisplay();
}

function handleReset() {
  counter = 0;
  updateCounterDisplay();
}

function handleInputChange(event: any) {
  inputValue = event.value;
  // Don't update display immediately - wait for Enter key
}

function handleInputKeyPress(event: KeyPressEvent) {
  if (event.key === 'Enter') {
    handleInputSubmit();
  }
}

function handleInputSubmit() {
  if (inputValue && typeof inputValue === 'string' && inputValue.trim()) {
    displayedText = inputValue;
    inputValue = ''; // Clear the input
    updateTextDisplay();
    updateInputDisplay();
  }
}

// Update specific components instead of recreating entire UI
function updateCounterDisplay() {
  const counterElement = engine.document.getElementById('counter-display');
  if (counterElement) {
    counterElement.props.text = `Counter: ${counter}`;
    engine.render(); // Trigger a redraw
  }
}

function updateInputDisplay() {
  const inputElement = engine.document.getElementById('input-field');
  if (inputElement) {
    inputElement.props.value = inputValue;
    engine.render(); // Trigger a redraw
  }
}

function updateTextDisplay() {
  const textElement = engine.document.getElementById('text-display');
  if (textElement) {
    textElement.props.text = displayedText;
    engine.render(); // Trigger a redraw
  }
}

function handleKeyPress(event: KeyPressEvent): void {
  if (event.key === 'Escape') {
    Deno.exit(0);
  }
}

// Create UI using template literals
function createTemplateUI() {
  const headerStyle : Style = {
    backgroundColor: getThemeColor('primary'),
    color: getThemeColor('surface'),
    fontWeight: 'bold',
    padding: 1,
    textAlign: 'center',
    marginBottom: 2,
  };

  const mainStyle = {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '50%',
    border: 'thin',
    borderColor: getThemeColor('primary'),
    padding: 2,
  };

  const buttonRowStyle = {
    display: 'flex',
    flexDirection: 'row',
    gap: 2,
    justifyContent: 'center',
    marginBottom: 2,
  };

  const inputRowStyle = {
    display: 'flex',
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  };

  return melker`
    <container id="main" style=${mainStyle}>
      <text style=${headerStyle}>🎯 Template Literal Demo</text>

      <container style=${buttonRowStyle}>
        <button title="Decrement" onClick=${handleDecrement} tabIndex=${1} />
        <text
          id="counter-display"
          style=${{ color: getThemeColor('success'), fontWeight: 'bold', minWidth: 15, textAlign: 'center' }}
        >Counter: ${counter}</text>
        <button title="Increment" onClick=${handleIncrement} tabIndex=${2} />
      </container>

      <container style=${buttonRowStyle}>
        <button title="Reset" onClick=${handleReset} tabIndex=${3} style=${{ color: getThemeColor('warning') }} />
      </container>

      <container style=${inputRowStyle}>
        <text style=${{ marginRight: 1 }}>Input: </text>
        <input
          id="input-field"
          value=${inputValue}
          onChange=${handleInputChange}
          onKeyPress=${handleInputKeyPress}
          placeholder="Type something and press Enter..."
          tabIndex=${4}
          style=${{ flex: 1 }}
        />
      </container>

      <container style=${{ marginBottom: 2, padding: 1, border: 'thin', borderColor: getThemeColor('textSecondary') }}>
        <text style=${{ fontWeight: 'bold', marginBottom: 1 }}>Submitted Text:</text>
        <text
          id="text-display"
          style=${{
            color: getThemeColor('success'),
            fontWeight: 'bold',
            backgroundColor: getThemeColor('surface'),
            padding: 1,
            minHeight: 1
          }}
        >${displayedText}</text>
      </container>

      <text style=${{ marginBottom: 1 }}>HTML-style syntax • Expression interpolation • Event handling</text>
      <text style=${{ marginBottom: 1 }}>Enter key support • Efficient state updates • All components</text>

      <text style=${{ marginTop: 1, fontWeight: 'bold' }}>Press Escape to exit</text>
    </container>
  `;
}

async function runTemplateDemo() {
  console.log('=== Template Literal Demo ===');
  console.log('Demonstrating HTML-style syntax for Melker UI creation');
  console.log('Features: Tagged templates, expression interpolation, state management');
  console.log('');

  try {
    const ui = createTemplateUI();
    engine = await createApp(ui);

    // Add key handler for ESC to exit
    if (engine.addEventListener) {
      engine.addEventListener('keyPress', handleKeyPress);
    }
  } catch (error) {
    console.error('Demo failed:', error);
    console.error('Stack trace:', error instanceof Error ? error.stack : 'No stack trace');
  }
}

runTemplateDemo().catch(console.error);