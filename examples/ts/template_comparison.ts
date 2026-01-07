// Template Literal Comparison - Shows side-by-side comparison of syntax styles
// Demonstrates the same UI built with both createElement and template literals

import {
  createApp,
  createElement,
  melker,
  getThemeColor,
  type ClickEvent,
} from '../../mod.ts';

let useTemplate = true;
let counter = 0;
let engine: any;

function handleToggle() {
  useTemplate = !useTemplate;
  // For this demo we do need to recreate UI since we're switching syntax styles
  updateUI();
}

function handleIncrement() {
  counter++;
  updateCounterDisplay();
}

function handleReset() {
  counter = 0;
  updateCounterDisplay();
}

// Update counter display without recreating UI
function updateCounterDisplay() {
  const counterElement = engine.document.getElementById('counter-display');
  if (counterElement) {
    counterElement.props.text = `Count: ${counter}`;
    engine.render();
  }
}

// UI using createElement (traditional approach)
function createElementUI() {
  return createElement('container', {
    id: 'main',
    style: {
      width: 70,
      height: 22,
      display: 'flex',
      flexDirection: 'column',
      border: 'thin',
      borderColor: getThemeColor('primary'),
      padding: 2
    }
  },
    // Header
    createElement('text', {
      text: '📝 createElement Syntax',
      style: {
        backgroundColor: getThemeColor('primary'),
        color: getThemeColor('surface'),
        fontWeight: 'bold',
        padding: 1,
        marginBottom: 2
      }
    }),

    // Counter section
    createElement('container', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        gap: 2,
        justifyContent: 'center',
        marginBottom: 2
      }
    },
      createElement('button', {
        title: 'Increment',
        onClick: handleIncrement,
        tabIndex: 1
      }),
      createElement('text', {
        id: 'counter-display',
        text: `Count: ${counter}`,
        style: {
          color: getThemeColor('success'),
          fontWeight: 'bold',
          minWidth: 12,
          textAlign: 'center'
        }
      }),
      createElement('button', {
        title: 'Reset',
        onClick: handleReset,
        tabIndex: 2,
        style: { color: getThemeColor('warning') }
      })
    ),

    // Toggle button
    createElement('container', {
      style: {
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'center',
        marginBottom: 2
      }
    },
      createElement('button', {
        title: 'Switch to Template Syntax',
        onClick: handleToggle,
        tabIndex: 3,
        style: {
          backgroundColor: getThemeColor('primary'),
          color: getThemeColor('surface')
        }
      })
    ),

    // Code example
    createElement('text', {
      text: `
// createElement approach:
createElement('button', {
  title: 'Click me',
  onClick: handleClick,
  style: { color: 'blue' }
})

// More verbose, especially with nesting
// Requires manual calls for each element
// Props are JavaScript objects
      `.trim()
    })
  );
}

// UI using template literals (modern approach)
function createTemplateUI() {
  const headerStyle = {
    backgroundColor: getThemeColor('success'),
    color: getThemeColor('surface'),
    fontWeight: 'bold',
    padding: 1,
    marginBottom: 2,
  };

  const containerStyle = {
    width: 70,
    height: 22,
    display: 'flex',
    flexDirection: 'column',
    border: 'thin',
    borderColor: getThemeColor('success'),
    padding: 2,
  };

  return melker`
    <container id="main" style=${containerStyle}>
      <text style=${headerStyle}>🎯 Template Literal Syntax</text>

      <container style=${{ display: 'flex', flexDirection: 'row', gap: 2, justifyContent: 'center', marginBottom: 2 }}>
        <button title="Increment" onClick=${handleIncrement} tabIndex=${1} />
        <text
          id="counter-display"
          style=${{ color: getThemeColor('success'), fontWeight: 'bold', minWidth: 12, textAlign: 'center' }}
        >Count: ${counter}</text>
        <button
          title="Reset"
          onClick=${handleReset}
          tabIndex=${2}
          style=${{ color: getThemeColor('warning') }}
        />
      </container>

      <container style=${{ display: 'flex', flexDirection: 'row', justifyContent: 'center', marginBottom: 2 }}>
        <button
          title="Switch to createElement Syntax"
          onClick=${handleToggle}
          tabIndex=${3}
          style=${{ backgroundColor: getThemeColor('success'), color: getThemeColor('surface') }}
        />
      </container>

      <text>Template literal advantages:
- HTML-like familiar syntax
- JavaScript object styling
- Expression interpolation
- More readable with nesting
- Cleaner code structure</text>
    </container>
  `;
}

async function updateUI() {
  if (engine) {
    const newUI = useTemplate ? createTemplateUI() : createElementUI();
    engine.updateUI(newUI);
  }
}

async function runComparison() {
  console.log('=== Template Literal vs createElement Comparison ===');
  console.log('Toggle between the two syntax styles to see the differences');
  console.log('');

  const initialUI = useTemplate ? createTemplateUI() : createElementUI();
  engine = await createApp(initialUI);

  console.log('Demo running. Use buttons to toggle between syntax styles.');
  console.log('Current syntax:', useTemplate ? 'Template Literals' : 'createElement');
}

runComparison().catch(console.error);