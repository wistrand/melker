// Minimal Example - Shows how easy it is to create a terminal UI
import { createApp, createElement, getTerminalSize } from '../src/melker.ts';

function createUI(width: number, height: number) {
  return createElement('container', {
    width,
    height,
    style: { border: 'thin', padding: 1 }
  },
    createElement('text', {
      text: 'Hello, Melker!',
      style: { color: 'cyan', fontWeight: 'bold' }
    }),
    createElement('text', {
      text: 'This is a minimal terminal UI example.',
      style: { marginTop: 1 }
    }),
    createElement('button', {
      title: 'Click Me!',
      style: { marginTop: 2 }
    }),
    createElement('input', {
      placeholder: 'Type something...',
      style: { marginTop: 1 }
    })
  );
}

// Create the UI and start the app
const { width, height } = getTerminalSize();
const ui = createUI(width, height);
const app = await createApp(ui);

console.log('[OK] Minimal terminal UI started!');
console.log('Features automatically enabled:');
console.log('  • Auto-resize on terminal size change');
console.log('  • Auto-render on UI changes');
console.log('  • Full-screen alternate buffer');
console.log('  • Hidden cursor');
console.log('  • Keyboard and mouse events');
console.log('  • Component registry with proper instances');
console.log('Press Ctrl+C to exit');