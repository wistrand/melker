#!/usr/bin/env deno run --allow-all

// Demo showcasing radio buttons and checkboxes
import { createApp, createElement } from '../src/melker.ts';

console.log('Form Components Demo - Radio buttons and checkboxes');
console.log('Navigate with Tab/Shift+Tab, toggle with Space/Enter');
console.log('Press Ctrl+C to exit\n');

const ui = createElement('container', {
  width: 60,
  height: 20,
  style: {
    padding: 2,
    border: 'thin',
    borderColor: 'cyan',
    display: 'flex',
    flexDirection: 'column'
  }
},
  createElement('text', {
    text: 'User Preferences Form',
    style: {
      color: 'yellow',
      fontWeight: 'bold',
      marginBottom: 1
    }
  }),

  createElement('text', {
    text: 'Theme Selection (radio buttons):',
    style: { marginBottom: 1 }
  }),

  createElement('radio', {
    title: 'Light Theme',
    value: 'light',
    name: 'theme',
    checked: true,
    onClick: () => {}
  }),

  createElement('radio', {
    title: 'Dark Theme',
    value: 'dark',
    name: 'theme',
    onClick: () => {}
  }),

  createElement('radio', {
    title: 'Auto (System)',
    value: 'auto',
    name: 'theme',
    onClick: () => {}
  }),

  createElement('text', {
    text: 'Feature Options (checkboxes):',
    style: { marginTop: 1, marginBottom: 1 }
  }),

  createElement('checkbox', {
    title: 'Enable notifications',
    checked: true,
    onClick: () => {}
  }),

  createElement('checkbox', {
    title: 'Auto-save documents',
    checked: false,
    onClick: () => {}
  }),

  createElement('checkbox', {
    title: 'Send analytics data',
    indeterminate: true,
    onClick: () => {}
  }),

  createElement('checkbox', {
    title: 'Enable experimental features',
    checked: false,
    onClick: () => {}
  }),

  createElement('text', {
    text: '\nTip: Use Tab to navigate, Space/Enter to toggle',
    style: {
      color: 'gray',
      fontStyle: 'italic'
    }
  })
);

await createApp(ui);