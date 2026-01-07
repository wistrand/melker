// File Browser Demo - Interactive file selection in modal dialog
// Shows: File browser component, modal dialogs, directory navigation

import {
  MelkerEngine,
  createApp,
  createElement,
  getThemeColor,
  type Element,
  type KeyPressEvent,
  type ClickEvent,
} from '../../mod.ts';
import { createFileBrowser, type FileInfo } from '../src/components/file-browser.ts';

console.log('=== File Browser Component Demo ===');
console.log('Features:');
console.log('- Interactive file browser with directory tree and file list');
console.log('- Modal dialog integration');
console.log('- File selection and navigation');
console.log('- OK/Cancel button handling');
console.log('');

let isFileBrowserOpen = false;
let currentPath = '/';
let selectedFile: FileInfo | null = null;
let selectedFilePath = '';
let engine: MelkerEngine;

// Create main UI with file browser integration
function createMainUI(): Element {
  return createElement('container', {
    id: 'main',
    style: {
      border: 'thin',
      width: 80,
      height: 24,
      display: 'flex',
      flexDirection: 'column',
      padding: 2
    }
  },
    createElement('text', {
      text: 'File Browser File Browser Component Demo',
      style: {
        fontWeight: 'bold',
        marginBottom: 2,
        color: getThemeColor('primary')
      },
      id: 'title'
    }),

    createElement('text', {
      text: 'This demo shows the file browser component in a modal dialog.',
      style: { marginBottom: 2 },
      id: 'description'
    }),

    createElement('button', {
      title: 'Open File Browser',
      style: {
        backgroundColor: getThemeColor('buttonBackground'),
        color: getThemeColor('buttonPrimary'),
        fontWeight: 'bold',
        width: 20,
        marginBottom: 2
      },
      onClick: openFileBrowser,
      id: 'open-button',
      tabIndex: 1
    }),

    createElement('text', {
      text: selectedFile ?
        `Selected: ${selectedFile.name} (${selectedFile.path})` :
        'No file selected',
      style: {
        color: selectedFile ? getThemeColor('success') : getThemeColor('textSecondary'),
        marginBottom: 1,
        fontWeight: selectedFile ? 'bold' : 'normal'
      },
      id: 'selection-status'
    }),

    createElement('text', {
      text: `Current directory: ${currentPath}`,
      style: {
        color: getThemeColor('info'),
        marginBottom: 2
      },
      id: 'directory-status'
    }),

    createElement('text', {
      text: isFileBrowserOpen ?
        'File browser is OPEN - navigate using the modal dialog!' :
        'Click "Open File Browser" to browse and select files.',
      style: {
        color: isFileBrowserOpen ? getThemeColor('success') : getThemeColor('textSecondary'),
        marginTop: 1,
        fontWeight: isFileBrowserOpen ? 'bold' : 'normal'
      },
      id: 'browser-status'
    }),

    createElement('text', {
      text: `Press Tab to navigate, Enter to activate buttons, Escape to ${isFileBrowserOpen ? 'close browser' : 'exit'}.`,
      style: {
        color: getThemeColor('textSecondary'),
        marginTop: 3
      },
      id: 'instructions'
    }),

    // The file browser dialog
    createElement('dialog', {
      title: 'Select File',
      open: isFileBrowserOpen,
      modal: true,
      backdrop: true,
      id: 'file-browser-dialog'
    },
      createFileBrowser({
        currentPath: currentPath,
        selectedFile: selectedFilePath,
        onFileSelect: handleFileSelect,
        onDirectoryChange: handleDirectoryChange,
        onOk: handleOk,
        onCancel: handleCancel,
        showButtons: true,
        width: 58,
        height: 16,
        id: 'file-browser-instance'
      })
    )
  );
}

function openFileBrowser(event: ClickEvent): void {
  isFileBrowserOpen = true;
  updateUI();
}

function handleFileSelect(file: FileInfo): void {
  if (!file.isDirectory) {
    selectedFilePath = file.path;
    updateUI();
  }
}

function handleDirectoryChange(path: string): void {
  currentPath = path;
  updateUI();
}

function handleOk(selected: FileInfo | null): void {
  if (selected) {
    selectedFile = selected;
  }
  isFileBrowserOpen = false;
  updateUI();
}

function handleCancel(): void {
  // Don't change selection, just close
  isFileBrowserOpen = false;
  updateUI();
}

function updateUI(): void {
  const newUI = createMainUI();
  engine.updateUI(newUI);
}

async function runFileBrowserDemo() {
  const ui = createMainUI();

  engine = await createApp(ui);

  console.log('File browser demo started. Press Escape to exit.');

  // For demo purposes, the dialog can be closed by clicking Cancel
  // or by using the OK button to confirm selection
}

runFileBrowserDemo().catch(console.error);