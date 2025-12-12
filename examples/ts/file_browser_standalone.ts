// File Browser Standalone Demo - Direct document child with flexible layout
// Shows: File browser as main app content, responsive sizing, no modal

import {
  MelkerEngine,
  createApp,
  createElement,
  getThemeColor,
  type Element,
  type KeyPressEvent,
} from '../../melker.ts';
import { createAsyncFileBrowser, type FileInfo } from '../src/components/file-browser.ts';


console.log('=== File Browser Standalone Demo ===');
console.log('Usage: deno run --allow-read [--allow-env] file_browser_standalone.ts [directory]');
console.log('  directory: Optional path to browse (default: current directory)');
console.log('');

// Get directory from command line argument or use current directory
const targetDir = Deno.args[0] || Deno.cwd();
let currentPath = targetDir;
let selectedFile: FileInfo | null = null;
let engine: MelkerEngine;
let expandedTreePath: string = '';

console.log(`Starting file browser for: ${currentPath}`);

// Create main UI with file browser as primary content
async function createMainUI(): Promise<Element> {
  return createElement('container', {
    id: 'main',
    style: {
      width: 80,
      height: 24,
      display: 'flex',
      flexDirection: 'column',
      border: 'thin',
      borderColor: getThemeColor('primary')
    }
  },
    // Title bar - minimal height
    createElement('container', {
      id: 'title-bar',
      style: {
        height: 1,
        backgroundColor: getThemeColor('primary'),
        color: getThemeColor('surface'),
        padding: 0,
        borderBottom: 'thin'
      }
    },
      createElement('text', {
        text: '[FILES] File Browser',
        style: {
          fontWeight: 'bold',
          marginBottom: 0
        },
        id: 'title'
      })
    ),

    // Status bar - minimal height
    createElement('container', {
      id: 'status-bar',
      style: {
        height: 1,
        backgroundColor: getThemeColor('headerBackground'),
        color: getThemeColor('headerForeground'),
        padding: 0,
        borderBottom: 'thin',
        borderColor: getThemeColor('textSecondary')
      }
    },
      createElement('text', {
        text: selectedFile ?
          `Selected: ${selectedFile.name}` :
          'No file selected',
        style: {
          marginBottom: 0,
          color: selectedFile ? getThemeColor('success') : getThemeColor('textSecondary'),
          fontWeight: selectedFile ? 'bold' : 'normal'
        },
        id: 'selection-status'
      })
    ),

    // Main file browser - takes up remaining space
    await createAsyncFileBrowser({
      currentPath: currentPath,
      selectedFile: selectedFile?.path || '',
      rootDirectory: targetDir,
      onFileSelect: handleFileSelect,
      onDirectoryChange: handleDirectoryChange,
      onTreeExpand: handleTreeExpand,
      onOk: handleOk,
      onCancel: handleCancel,
      showButtons: true,
      useRealFileSystem: true,
      expandedTreePath: expandedTreePath,
      // No width/height - will use flex: 1 and min values
      id: 'main-file-browser'
    })
  );
}

function handleFileSelect(file: FileInfo): void {
  if (!file.isDirectory) {
    selectedFile = file;
    updateUI().catch(console.error);
  }
}

function handleDirectoryChange(path: string): void {
  currentPath = path;
  updateUI().catch(console.error);
}

function handleTreeExpand(path: string): void {
  expandedTreePath = path;
  updateUI().catch(console.error);
}

function handleOk(selected: FileInfo | null): void {
  if (selected) {
    selectedFile = selected;
  }
  updateUI().catch(console.error);
}

function handleCancel(): void {
  selectedFile = null;
  updateUI().catch(console.error);
}

async function updateUI(): Promise<void> {
  const newUI = await createMainUI();
  engine.updateUI(newUI);
}

function handleKeyPress(event: KeyPressEvent): void {
  if (event.key === 'Escape') {
    Deno.exit(0);
  }
}

async function runStandaloneDemo() {
  const ui = await createMainUI();

  engine = await createApp(ui);

  // Add key handler for ESC to exit (if supported)
  engine.document.addEventListener('keypress', handleKeyPress);

}

runStandaloneDemo().catch(console.error);