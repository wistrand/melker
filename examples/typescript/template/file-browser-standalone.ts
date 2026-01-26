#!/usr/bin/env -S deno run --allow-read --allow-env --allow-write

// File Browser Standalone Example
// Demonstrates using the FileBrowser component programmatically

import { createElement, createApp, getTerminalSize } from '../mod.ts';
import type { FileSelectEvent, FileErrorEvent } from '../src/components/file-browser/mod.ts';

const { height: rows } = getTerminalSize();

// Track state
let selectedPath = '(none)';
let engine: Awaited<ReturnType<typeof createApp>> | null = null;

// Create the UI
const ui = createElement('container', {
  id: 'root',
  style: {
    direction: 'column',
    padding: 1,
    gap: 1,
    height: rows,
  },
},
  createElement('text', { bold: true, text: 'File Browser - Standalone Example' }),
  createElement('text', { dim: true, text: 'Navigate with arrows, Enter to select, Backspace/Left to go up' }),
  createElement('text', { dim: true, text: 'Type to filter, Ctrl+H toggle hidden, Ctrl+C to quit' }),

  createElement('container', {
    style: {
      direction: 'column',
      flex: 1,
      border: 'thin',
    },
  },
    createElement('file-browser', {
      id: 'file-browser',
      path: Deno.cwd(),
      selectionMode: 'single',
      selectType: 'file',
      showHidden: false,
      showBreadcrumb: true,
      showFilter: true,
      showButtons: false,
      showSize: true,
      maxVisible: rows - 10,
      onSelect: (event: FileSelectEvent) => {
        selectedPath = event.path;
        updateSelectedText();

        // Exit after selection - engine.stop() restores terminal
        setTimeout(async () => {
          if (engine) {
            await engine.stop();
            console.log('Selected:', selectedPath);
          }
        }, 100);
      },
      onNavigate: (_path: string) => {
        // Optional: track navigation
      },
      onError: (event: FileErrorEvent) => {
        // Errors are shown in the file browser UI
      },
    }),
  ),

  createElement('container', {
    style: { direction: 'row', gap: 1 },
  },
    createElement('text', { dim: true, text: 'Selected:' }),
    createElement('text', { id: 'selected-text', text: selectedPath }),
  ),
);

// Helper to update selected text
function updateSelectedText() {
  if (engine) {
    const text = engine.document.getElementById('selected-text');
    if (text) {
      text.props.content = selectedPath;
      engine.forceRender();
    }
  }
}

// Create and start the app
engine = await createApp(ui);

// Initialize the file browser after app starts
const fileBrowser = engine.document.getElementById('file-browser');
if (fileBrowser && 'initialize' in fileBrowser) {
  // Set up the render callback so file browser can request re-renders
  if ('setRequestRender' in fileBrowser) {
    (fileBrowser as any).setRequestRender(() => engine?.forceRender());
  }
  await (fileBrowser as any).initialize();
  // Force re-render after initialization to show loaded content
  engine.forceRender();
}
