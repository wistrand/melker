// Dialog Demo - Modal dialog functionality
// Shows: Modal dialogs, backdrop, themed dialog UI, focus management

import {
  MelkerEngine,
  createApp,
  createElement,
  getThemeColor,
  type Element,
  type KeyPressEvent,
  type ClickEvent,
} from '../../mod.ts';

console.log('=== Dialog Component Demo ===');
console.log('Features:');
console.log('- Modal dialogs with backdrop');
console.log('- Themed dialog UI');
console.log('- Centered modal positioning');
console.log('- Escape to close dialog');
console.log('');

let isDialogOpen = false;
let engine: MelkerEngine;

// Create main UI with dialog
function createMainUI(): Element {
  return createElement('container', {
    id: 'main',
    style: {
      border: 'thin',
      width: 'fill',
      height: 'fill',
      display: 'flex',
      flexDirection: 'column',
      padding: 2
    }
  },
    createElement('text', {
      text: 'Dialog Dialog Component Demo',
      style: {
        fontWeight: 'bold',
        marginBottom: 2,
        color: getThemeColor('primary')
      },
      id: 'title'
    }),

    createElement('text', {
      text: 'This demo shows the modal dialog component in action.',
      style: { marginBottom: 2 },
      id: 'description'
    }),

    createElement('button', {
      title: 'Open Dialog',
      style: {
        backgroundColor: getThemeColor('buttonBackground'),
        color: getThemeColor('buttonPrimary'),
        fontWeight: 'bold',
        width: 15,
        marginBottom: 2
      },
      onClick: openDialog,
      id: 'open-button',
      tabIndex: 1
    }),

    createElement('text', {
      text: `Press Tab to navigate, Enter to activate buttons, Escape to ${isDialogOpen ? 'close dialog' : 'exit'}.`,
      style: {
        color: getThemeColor('textSecondary'),
        marginTop: 2
      },
      id: 'instructions'
    }),

    createElement('text', {
      text: isDialogOpen ? 'Dialog is currently OPEN - you should see the modal overlay!' : 'Click "Open Dialog" to see the modal appear.',
      style: {
        color: isDialogOpen ? getThemeColor('success') : getThemeColor('info'),
        marginTop: 1,
        fontWeight: 'bold'
      },
      id: 'status'
    }),

    // The dialog element
    createElement('dialog', {
      title: 'Example Dialog',
      open: isDialogOpen,
      modal: true,
      backdrop: true,
      id: 'example-dialog'
    },
      createElement('text', {
        text: 'This is a modal dialog!',
        style: { marginBottom: 2 },
        id: 'dialog-message'
      }),

      createElement('text', {
        text: 'Dialogs render on top of all other content with a backdrop.',
        style: { marginBottom: 2 },
        id: 'dialog-description'
      }),

      createElement('button', {
        title: 'Close',
        style: {
          backgroundColor: getThemeColor('buttonBackground'),
          color: getThemeColor('buttonPrimary'),
          fontWeight: 'bold',
          width: 10
        },
        onClick: closeDialog,
        id: 'close-button',
        tabIndex: 2
      })
    )
  );
}

function openDialog(event: ClickEvent): void {
  isDialogOpen = true;
  updateUI();
}

function closeDialog(event: ClickEvent): void {
  isDialogOpen = false;
  updateUI();
}

function updateUI(): void {
  const newUI = createMainUI();
  engine.updateUI(newUI);
}

async function runDialogDemo() {
  const ui = createMainUI();

  // createApp automatically applies theme-based defaults from environment variables
  engine = await createApp(ui);

  console.log('Dialog demo started. Press Escape to exit.');

  // Handle global escape key for both closing dialog and exiting
  engine.document.addEventListener('keypress', (event: KeyPressEvent) => {
    if (event.key === 'Escape') {
      if (isDialogOpen) {
        // Close dialog first
        isDialogOpen = false;
        updateUI();
      } else {
        // Exit app
        console.log('\n[GOODBYE] Thanks for testing dialogs!');
        engine.stop();
        Deno.exit(0);
      }
      return;
    }
  });
}

runDialogDemo().catch(console.error);