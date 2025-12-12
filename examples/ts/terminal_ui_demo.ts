// Terminal UI Demo - Complete MelkerEngine application
// Shows: MelkerEngine, responsive layouts, automatic terminal management

import {
  MelkerEngine,
  createApp,
  createElement,
  getTerminalSize,
  type Element,
} from '../../melker.ts';

console.log('=== Terminal UI Demo ===');

// Responsive UI that adapts to terminal size
function createResponsiveUI(): Element {
  const { width, height } = getTerminalSize();
  const cols = width < 60 ? 1 : width < 100 ? 2 : 3;

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
      // Header
      createElement('container', {
          height: 3,
          style: {
            backgroundColor: 'blue',
            color: 'white',
            fontWeight: 'bold',
            padding: 1,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center'
          },
          id: 'header'
        },
          createElement('text', {
              text: 'Melker Terminal UI',
              style: { color: 'white', fontWeight: 'bold' },
              id: 'title'
            }),
          createElement('text', {
              text: `${width}×${height}`,
              style: { color: 'yellow', fontWeight: 'bold' },
              id: 'size-display'
            }),
        ),

      // Responsive content flex layout
      createElement('container', {
          style: {
            flex: '1',
            padding: 1,
            display: 'flex',
            flexDirection: 'row',
            justifyContent: 'space-evenly'
          },
          id: 'content-flex'
        }, ...Array.from({ length: cols }, (_, i) =>
          createElement('container', {
              style: {
                border: 'thin',
                borderColor: ['red', 'green', 'blue'][i % 3],
                padding: 1
              },
              id: `panel-${i}`
            },
              createElement('text', {
                  text: `Panel ${i + 1}`,
                  style: { fontWeight: 'bold', color: ['red', 'green', 'blue'][i % 3] },
                  id: `panel-title-${i}`
                }),
              createElement('text', {
                  text: `Responsive layout with ${cols} columns`,
                  style: { marginTop: 1 },
                  id: `panel-content-${i}`
                }),
              createElement('button', {
                  title: `Action ${i + 1}`,
                  variant: 'primary',
                  style: { marginTop: 1 },
                  onClick: () => {
                    console.log(`Panel ${i + 1} button clicked`);
                  },
                  id: `panel-button-${i}`
                })
            )
        )),

      // Footer
      createElement('container', {
          height: 2,
          style: {
            backgroundColor: 'magenta',
            color: 'white',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center'
          },
          id: 'footer'
        },
          createElement('text', {
              text: 'Resize terminal to see responsive adaptation',
              style: { color: 'white' },
              id: 'footer-text'
            }),
        )
  );
}

// Start the terminal application with excellent defaults
const ui = createResponsiveUI();
const app = await createApp(ui);

console.log('[OK] Terminal UI started! Resize your terminal to see responsive behavior.');