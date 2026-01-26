// Theme Demo - Shows different theme support through environment variables
// Run with: MELKER_THEME=bw-std deno run --allow-env examples/theme_demo.ts
// Run with: MELKER_THEME=fullcolor-dark deno run --allow-env examples/theme_demo.ts

import {
  MelkerEngine,
  createApp,
  createElement,
  getThemeManager,
  getCurrentTheme,
  getThemeColor,
} from '../../mod.ts';

console.log('=== Theme System Demo ===');
console.log('Available themes: bw-std, bw-dark, gray-std, gray-dark, color-std, color-dark, fullcolor-std, fullcolor-dark');
console.log('Set MELKER_THEME environment variable to test different themes');
console.log('Example: MELKER_THEME=fullcolor-dark deno run --allow-env examples/theme_demo.ts');
console.log('');

// Get current theme from environment or default
const themeManager = getThemeManager();
const currentTheme = getCurrentTheme();

console.log(`Current theme: ${currentTheme.type}-${currentTheme.mode}`);
console.log(`Color support: ${currentTheme.colorSupport}`);
console.log(`Primary color: ${getThemeColor('primary')}`);
console.log(`Background: ${getThemeColor('background')}`);
console.log(`Success color: ${getThemeColor('success')}`);
console.log('');

function createThemedUI() {
  const theme = getCurrentTheme();

  return createElement('container', {
    id: 'theme-root',
    style: {
      border: 'thin',
      width: 'fill',
      height: 'fill',
      display: 'flex',
      flexDirection: 'column'
    }
  },
    // Header with theme info
    createElement('container', {
      id: 'header',
      style: {
        backgroundColor: getThemeColor('headerBackground'),
        color: getThemeColor('headerForeground'),
        fontWeight: 'bold',
        padding: 1,
        borderBottom: 'thin',
        flex: '0 0 auto',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center'
      }
    },
      createElement('text', {
        text: `Theme Demo Theme Demo - ${theme.type.toUpperCase()} ${theme.mode.toUpperCase()} (${theme.colorSupport})`,
        style: {
          fontWeight: 'bold'
        },
        id: 'title',
      })
    ),

    // Main content area
    createElement('container', {
      id: 'content',
      style: {
        padding: 2,
        flex: '1 1 0',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: getThemeColor('surface')
      }
    },
      // Theme information
      createElement('text', {
        text: 'Theme Information:',
        style: {
          fontWeight: 'bold',
          marginBottom: 1
        },
        id: 'info-title',
      }),

      createElement('text', {
        text: `Type: ${theme.type}`,
        style: {
          color: getThemeColor('textSecondary'),
          marginBottom: 1
        },
        id: 'info-type',
      }),

      createElement('text', {
        text: `Mode: ${theme.mode}`,
        style: {
          color: getThemeColor('textSecondary'),
          marginBottom: 1
        },
        id: 'info-mode',
      }),

      createElement('text', {
        text: `Color Support: ${theme.colorSupport}`,
        style: {
          color: getThemeColor('textSecondary'),
          marginBottom: 2
        },
        id: 'info-colors',
      }),

      // Status indicators
      createElement('text', {
        text: '[OK] Success Message',
        style: { color: getThemeColor('success'), marginBottom: 1 },
        id: 'success-msg',
      }),

      createElement('text', {
        text: '[WARNING] Warning Message',
        style: { color: getThemeColor('warning'), marginBottom: 1 },
        id: 'warning-msg',
      }),

      createElement('text', {
        text: '[ERROR] Error Message',
        style: { color: getThemeColor('error'), marginBottom: 1 },
        id: 'error-msg',
      }),

      createElement('text', {
        text: '[INFO] Info Message',
        style: { color: getThemeColor('info'), marginBottom: 2 },
        id: 'info-msg',
      }),

      // Interactive elements
      createElement('input', {
        placeholder: 'Type something here...',
        value: '',
        style: {
          width: 'auto',
          height: 1,
          backgroundColor: getThemeColor('inputBackground'),
          color: getThemeColor('inputForeground'),
          marginBottom: 1
        },
        tabIndex: 1,
        id: 'themed-input',
      }),

      createElement('button', {
        title: 'Primary Button',
        style: {
          color: getThemeColor('buttonPrimary'),
          backgroundColor: getThemeColor('buttonBackground'),
          fontWeight: 'bold',
          width: 20,
          marginBottom: 1
        },
        id: 'primary-button',
        tabIndex: 2,
      }),

      createElement('button', {
        title: 'Secondary Button',
        style: {
          width: 20
        },
        id: 'secondary-button',
        tabIndex: 3,
      })
    ),

    // Footer with instructions
    createElement('container', {
      id: 'footer',
      style: {
        backgroundColor: getThemeColor('sidebarBackground'),
        color: getThemeColor('sidebarForeground'),
        padding: 1,
        borderTop: 'thin',
        flex: '0 0 auto'
      }
    },
      createElement('text', {
        text: 'Press Tab to navigate, Escape to exit. Try different themes with MELKER_THEME env var.',
        id: 'footer-text',
      })
    )
  );
}

async function runThemeDemo() {
  const ui = createThemedUI();

  // createApp automatically applies theme-based defaults from environment variables
  const engine = await createApp(ui);

  console.log('Theme demo started. Press Escape to exit.');

  // Handle Escape key to exit gracefully
  engine.document.addEventListener('keypress', (event: any) => {
    if (event.key === 'Escape') {
      console.log('\n[GOODBYE] Thanks for testing themes!');
      engine.stop();
      Deno.exit(0);
    }
  });
}

runThemeDemo().catch(console.error);