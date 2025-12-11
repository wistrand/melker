#!/usr/bin/env deno run --allow-all

// Demo showcasing the HTML mirror view capability
import { createApp, createElement } from '../src/melker.ts';

console.log('🖥️ Mirror View Demo');
console.log('This demo runs a Melker app with debug server enabled.');
console.log('Open the following URLs in your browser to view the mirror:');
console.log('');
console.log('• Mirror View: http://localhost:8080/mirror');
console.log('• Debug Console: http://localhost:8080/debug');
console.log('');
console.log('The mirror view provides:');
console.log('- Live terminal rendering in HTML');
console.log('- Interactive element tree inspection');
console.log('- Click-to-interact with the terminal');
console.log('- Real-time updates and auto-refresh');
console.log('- Focused element highlighting');
console.log('');
console.log('Press Ctrl+C to exit\n');

// Create a sample UI for demonstration
const ui = createElement('container', {
  width: 70,
  height: 18,
  style: {
    padding: 2,
    border: 'thin',
    borderColor: 'green',
    display: 'flex',
    flexDirection: 'column'
  }
},
  createElement('text', {
    text: 'Mirror View Demonstration',
    style: {
      color: 'yellow',
      fontWeight: 'bold',
      marginBottom: 1
    }
  }),

  createElement('text', {
    text: 'This UI is mirrored in your web browser. Try these features:',
    style: { marginBottom: 1 }
  }),

  createElement('text', {
    text: '1. Navigate with Tab/Shift+Tab (watch focus in browser)',
    style: { marginBottom: 0.5 }
  }),

  createElement('text', {
    text: '2. Click elements in the browser to interact',
    style: { marginBottom: 0.5 }
  }),

  createElement('text', {
    text: '3. View the element tree in the inspector panel',
    style: { marginBottom: 1 }
  }),

  createElement('text', {
    text: 'Interactive Elements:',
    style: { color: 'cyan', marginBottom: 0.5 }
  }),

  createElement('button', {
    title: 'Click me!',
    onClick: () => {
      console.log('Button clicked from terminal or browser!');
    }
  }),

  createElement('radio', {
    title: 'Option A',
    value: 'a',
    name: 'demo',
    checked: true
  }),

  createElement('radio', {
    title: 'Option B',
    value: 'b',
    name: 'demo'
  }),

  createElement('checkbox', {
    title: 'Enable feature',
    checked: false
  }),

  createElement('text', {
    text: '\nTip: Open the mirror view URL to see this interface in your browser!',
    style: {
      color: 'gray',
      fontStyle: 'italic'
    }
  })
);

// Enable debug server on port 8080
const debugPort = 8080;

// Note: The debug server will be automatically enabled if MELKER_DEBUG_PORT is set
// Or can be programmatically enabled when creating the app
await createApp(ui);