// File Browser Component - Reusable file selection interface
// Features: Directory tree, file list, selection, OK/Cancel buttons

import { Element, BaseProps, ClickEvent } from '../types.ts';
import { createElement } from '../element.ts';
import { getThemeColor } from '../theme.ts';

export interface FileInfo {
  name: string;
  path: string;
  isDirectory: boolean;
  size?: number;
  modified?: Date;
}

export interface DirectoryNode {
  name: string;
  path: string;
  isExpanded: boolean;
  isDirectory: boolean;
  children: DirectoryNode[];
  files: FileInfo[];
}

export interface FileBrowserProps extends BaseProps {
  currentPath?: string;
  selectedFile?: string;
  expandedTreePath?: string; // Single expanded path in the tree
  rootDirectory?: string; // Root directory for the file browser (tree starts here)
  onFileSelect?: (file: FileInfo) => void;
  onDirectoryChange?: (path: string) => void;
  onTreeExpand?: (path: string) => void;
  onOk?: (selectedFile: FileInfo | null) => void;
  onCancel?: () => void;
  showButtons?: boolean;
  width?: number;
  height?: number;
  useRealFileSystem?: boolean; // Whether to use real file system or mock data
}

// Build a lazy tree structure that shows directories up to the current path and expanded path
async function buildLazyTree(currentPath: string, expandedTreePath?: string, useRealFS = false, rootDirectory?: string): Promise<DirectoryNode> {
  const rootPath = rootDirectory || '/';

  // Create the root node
  const root: DirectoryNode = {
    name: rootPath.split('/').pop() || rootPath,
    path: rootPath,
    isExpanded: true,
    isDirectory: true,
    children: [],
    files: []
  };

  // Get all unique paths that need to be loaded (current path ancestry + expanded path ancestry)
  const pathsToLoad = new Set<string>();

  // Always add the root path
  pathsToLoad.add(rootPath);

  // Add current path ancestry (only if it's within the root)
  if (currentPath.startsWith(rootPath)) {
    const relativePath = currentPath.slice(rootPath.length);
    const pathParts = relativePath.split('/').filter(part => part);
    let buildPath = rootPath;
    for (const part of pathParts) {
      buildPath = buildPath.endsWith('/') ? buildPath + part : buildPath + '/' + part;
      pathsToLoad.add(buildPath);
    }
  }

  // Add expanded path ancestry if different (only if it's within the root)
  if (expandedTreePath && expandedTreePath !== currentPath && expandedTreePath.startsWith(rootPath)) {
    const relativePath = expandedTreePath.slice(rootPath.length);
    const expandedParts = relativePath.split('/').filter(part => part);
    let expandedBuildPath = rootPath;
    for (const part of expandedParts) {
      expandedBuildPath = expandedBuildPath.endsWith('/') ? expandedBuildPath + part : expandedBuildPath + '/' + part;
      pathsToLoad.add(expandedBuildPath);
    }
  }

  // Load directory contents for each required path
  for (const pathToLoad of pathsToLoad) {
    if (useRealFS) {
      await loadRealDirectoryIntoTree(root, pathToLoad, expandedTreePath);
    } else {
      loadMockDirectoryIntoTree(root, pathToLoad, expandedTreePath);
    }
  }

  return root;
}

// Mock file system for demo - in real use, this would connect to actual FS
function getMockDirectoryStructure(path: string = '/'): DirectoryNode {
  const mockData: Record<string, DirectoryNode> = {
    '/': {
      name: '/',
      path: '/',
      isExpanded: true,
      isDirectory: true,
      children: [
        {
          name: 'src',
          path: '/src',
          isExpanded: false,
          isDirectory: true,
          children: [
            {
              name: 'components',
              path: '/src/components',
              isExpanded: false,
              isDirectory: true,
              children: [],
              files: [
                { name: '..', path: '/src', isDirectory: true },
                { name: 'button.ts', path: '/src/components/button.ts', isDirectory: false, size: 2540 },
                { name: 'container.ts', path: '/src/components/container.ts', isDirectory: false, size: 4120 },
                { name: 'dialog.ts', path: '/src/components/dialog.ts', isDirectory: false, size: 3650 },
                { name: 'file-browser.ts', path: '/src/components/file-browser.ts', isDirectory: false, size: 8900 },
              ]
            }
          ],
          files: [
            { name: '..', path: '/', isDirectory: true },
            { name: 'melker.ts', path: '/src/melker.ts', isDirectory: false, size: 1250 },
            { name: 'types.ts', path: '/src/types.ts', isDirectory: false, size: 2890 },
            { name: 'element.ts', path: '/src/element.ts', isDirectory: false, size: 1780 },
            { name: 'theme.ts', path: '/src/theme.ts', isDirectory: false, size: 5200 },
          ]
        },
        {
          name: 'examples',
          path: '/examples',
          isExpanded: false,
          isDirectory: true,
          children: [],
          files: [
            { name: '..', path: '/', isDirectory: true },
            { name: 'basic_usage.ts', path: '/examples/basic_usage.ts', isDirectory: false, size: 2145 },
            { name: 'chat_demo.ts', path: '/examples/chat_demo.ts', isDirectory: false, size: 6780 },
            { name: 'dialog_demo.ts', path: '/examples/dialog_demo.ts', isDirectory: false, size: 4320 },
            { name: 'theme_demo.ts', path: '/examples/theme_demo.ts', isDirectory: false, size: 3890 },
          ]
        }
      ],
      files: [
        { name: 'README.md', path: '/README.md', isDirectory: false, size: 1024 },
        { name: 'deno.json', path: '/deno.json', isDirectory: false, size: 512 },
        { name: 'CLAUDE.md', path: '/CLAUDE.md', isDirectory: false, size: 2048 },
      ]
    }
  };

  const structure = mockData[path] || mockData['/'];
  return structure;
}

function loadMockDirectoryIntoTree(root: DirectoryNode, targetPath: string, expandedTreePath?: string): void {
  const mockData = getMockDirectoryStructure();

  // Find the target directory data
  let targetData: DirectoryNode | null = null;
  if (targetPath === '/') {
    targetData = mockData;
  } else {
    // For simplicity, map some common paths
    const pathMap: Record<string, DirectoryNode> = {
      '/src': mockData.children.find(c => c.name === 'src')!,
      '/examples': mockData.children.find(c => c.name === 'examples')!,
      '/src/components': mockData.children.find(c => c.name === 'src')!.children.find(c => c.name === 'components')!
    };
    targetData = pathMap[targetPath];
  }

  if (!targetData) return;

  // Find or create the target node in the tree
  const targetNode = findDirectoryInStructure(root, targetPath);
  if (!targetNode) return;

  // Load children if this path is expanded (root is always expanded)
  const isExpanded = expandedTreePath === targetPath || targetPath === root.path;
  targetNode.isExpanded = isExpanded;

  if (isExpanded) {
    // Add child directories (not files) to the tree
    targetNode.children = targetData.children.map(child => ({
      ...child,
      isExpanded: expandedTreePath === child.path,
      children: [] // Will be loaded lazily
    }));
  }
}

async function loadRealDirectoryIntoTree(root: DirectoryNode, targetPath: string, expandedTreePath?: string): Promise<void> {
  try {
    const resolvedPath = await Deno.realPath(targetPath);

    // Find or create the target node in the tree
    let targetNode = findDirectoryInStructure(root, targetPath);
    if (!targetNode) {
      // Create path if it doesn't exist
      targetNode = createPathInTree(root, targetPath);
    }

    // Load children if this path is expanded (root is always expanded)
    const isExpanded = expandedTreePath === targetPath || targetPath === root.path;
    targetNode.isExpanded = isExpanded;

    if (isExpanded) {
      // Read directory contents
      const entries = [];
      try {
        for await (const entry of Deno.readDir(resolvedPath)) {
          if (entry.isDirectory) {
            entries.push(entry);
          }
        }
      } catch {
        // Directory not readable, skip
        return;
      }

      // Sort directories alphabetically
      entries.sort((a, b) => a.name.localeCompare(b.name));

      // Add child directories to the tree
      targetNode.children = entries.map(entry => ({
        name: entry.name,
        path: `${targetPath}/${entry.name}`.replace('//', '/'),
        isExpanded: false,
        isDirectory: true,
        children: [],
        files: []
      }));
    }
  } catch (error) {
    console.error(`Failed to load directory ${targetPath}:`, error);
  }
}

function createPathInTree(root: DirectoryNode, targetPath: string): DirectoryNode {
  if (targetPath === root.path) return root;

  const rootPathLength = root.path.length;
  const relativePath = targetPath.slice(rootPathLength);
  const pathParts = relativePath.split('/').filter(part => part);
  let currentNode = root;
  let currentPath = root.path;

  for (const part of pathParts) {
    currentPath = currentPath.endsWith('/') ? currentPath + part : currentPath + '/' + part;

    let childNode = currentNode.children.find(child => child.path === currentPath);
    if (!childNode) {
      childNode = {
        name: part,
        path: currentPath,
        isExpanded: false,
        isDirectory: true,
        children: [],
        files: []
      };
      currentNode.children.push(childNode);
    }
    currentNode = childNode;
  }

  return currentNode;
}

function findDirectoryInStructure(root: DirectoryNode, path: string): DirectoryNode | null {
  if (root.path === path) return root;

  for (const child of root.children) {
    const found = findDirectoryInStructure(child, path);
    if (found) return found;
  }

  return null;
}

function toggleDirectoryExpansion(root: DirectoryNode, path: string, expanded: boolean): DirectoryNode {
  if (root.path === path) {
    return { ...root, isExpanded: expanded };
  }

  return {
    ...root,
    children: root.children.map(child => toggleDirectoryExpansion(child, path, expanded))
  };
}

// Real file system functions for actual directory browsing
async function getRealDirectoryStructure(path: string): Promise<DirectoryNode> {
  try {
    // Normalize and resolve the path
    const resolvedPath = path ? await Deno.realPath(path) : Deno.cwd();
    const dirInfo = await Deno.stat(resolvedPath);

    if (!dirInfo.isDirectory) {
      throw new Error(`Path ${resolvedPath} is not a directory`);
    }

    const node: DirectoryNode = {
      name: resolvedPath.split('/').pop() || '/',
      path: resolvedPath,
      isExpanded: true,
      isDirectory: true,
      children: [],
      files: []
    };

    // Add parent directory entry if not at root
    const parentPath = resolvedPath !== '/' ? resolvedPath.split('/').slice(0, -1).join('/') || '/' : null;
    if (parentPath) {
      node.files.push({
        name: '..',
        path: parentPath,
        isDirectory: true,
        size: undefined,
        modified: new Date()
      });
    }

    // Read directory contents
    const entries = [];
    for await (const entry of Deno.readDir(resolvedPath)) {
      entries.push(entry);
    }

    // Sort entries: directories first, then files, alphabetically
    entries.sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    // Process entries
    for (const entry of entries) {
      const entryPath = `${resolvedPath}/${entry.name}`.replace('//', '/');

      if (entry.isDirectory) {
        // Add as child directory (not expanded by default)
        node.children.push({
          name: entry.name,
          path: entryPath,
          isExpanded: false,
          isDirectory: true,
          children: [],
          files: []
        });
      } else if (entry.isFile) {
        // Get file size
        let size: number | undefined;
        try {
          const fileInfo = await Deno.stat(entryPath);
          size = fileInfo.size;
        } catch {
          size = undefined;
        }

        // Add as file
        node.files.push({
          name: entry.name,
          path: entryPath,
          isDirectory: false,
          size: size,
          modified: new Date()
        });
      }
    }

    return node;
  } catch (error) {
    console.error(`Failed to read directory ${path}:`, error);
    // Fallback to a simple error structure
    return {
      name: 'Error',
      path: path || '/',
      isExpanded: true,
      isDirectory: true,
      children: [],
      files: [{
        name: `Error: Cannot read directory`,
        path: '',
        isDirectory: false
      }]
    };
  }
}

async function findRealDirectoryInStructure(rootPath: string, targetPath: string): Promise<DirectoryNode | null> {
  try {
    // For real file system, we can directly access the target path
    return await getRealDirectoryStructure(targetPath);
  } catch {
    return null;
  }
}

// Async version that supports real file system
export async function createAsyncFileBrowser(props: FileBrowserProps): Promise<Element> {
  const currentPath = props.currentPath || Deno.cwd();
  const selectedFile = props.selectedFile || '';
  const showButtons = props.showButtons !== false; // Default to true
  const useRealFS = props.useRealFileSystem || false;

  // Build lazy tree structure
  const rootStructure = await buildLazyTree(currentPath, props.expandedTreePath, useRealFS, props.rootDirectory);

  // Get current directory data (for file list)
  let currentDir: DirectoryNode;
  if (useRealFS) {
    currentDir = await getRealDirectoryStructure(currentPath);
  } else {
    currentDir = findDirectoryInStructure(getMockDirectoryStructure(), currentPath) || getMockDirectoryStructure();
  }

  return createFileBrowserElement(props, rootStructure, currentDir, currentPath, selectedFile, showButtons);
}

// Synchronous version (original) for compatibility
export function createFileBrowser(props: FileBrowserProps): Element {
  const currentPath = props.currentPath || '/';
  const selectedFile = props.selectedFile || '';
  const showButtons = props.showButtons !== false; // Default to true

  // Always use mock data for sync version - but we can't use async buildLazyTree
  // For sync version, fall back to simple mock structure
  const mockData = getMockDirectoryStructure();
  const currentDir = findDirectoryInStructure(mockData, currentPath) || mockData;

  // Create a simplified tree for the sync version
  const rootStructure = {
    ...mockData,
    children: mockData.children.map(child => ({
      ...child,
      isExpanded: props.expandedTreePath === child.path,
      children: []
    }))
  };

  return createFileBrowserElement(props, rootStructure, currentDir, currentPath, selectedFile, showButtons);
}

// Shared element creation logic
function createFileBrowserElement(
  props: FileBrowserProps,
  rootStructure: DirectoryNode,
  currentDir: DirectoryNode,
  currentPath: string,
  selectedFile: string,
  showButtons: boolean
): Element {

  // Create directory tree items
  function createTreeItems(node: DirectoryNode, depth: number = 0): Element[] {
    const items: Element[] = [];

    // Directory item
    const indent = '  '.repeat(depth);
    const expandIcon = node.children.length > 0 ? (node.isExpanded ? '[+]' : '[-]') : '[D]';

    items.push(createElement('button', {
      title: `${indent}${expandIcon} ${node.name}`,
      variant: 'plain',
      style: {
        color: node.isDirectory ? getThemeColor('info') : getThemeColor('textPrimary'),
        backgroundColor: node.path === currentPath ? getThemeColor('info') : undefined,
        marginBottom: 0,
        fontWeight: node.path === currentPath ? 'bold' : 'normal',
        width: 'fill'
      },
      id: `tree-${node.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
      onClick: () => {
        // Always navigate to the directory first
        if (props.onDirectoryChange) {
          props.onDirectoryChange(node.path);
        }

        // Then handle tree expansion
        if (props.onTreeExpand) {
          // Toggle expansion: if already expanded, collapse (empty string), otherwise expand to this path
          const newExpandedPath = node.isExpanded ? '' : node.path;
          props.onTreeExpand(newExpandedPath);
        }
      }
    }));

    // Expanded children
    if (node.isExpanded) {
      for (const child of node.children) {
        items.push(...createTreeItems(child, depth + 1));
      }
    }

    return items;
  }

  // Create file list items
  function createFileItems(files: FileInfo[]): Element[] {
    return files.map(file => {
      const icon = file.isDirectory ? '[D]' : '[F]';
      const sizeText = file.size ? ` (${Math.round(file.size / 1024)}KB)` : '';

      return createElement('button', {
        title: `${icon} ${file.name}${sizeText}`,
        variant: 'plain',
        style: {
          color: file.isDirectory ? getThemeColor('info') : getThemeColor('textPrimary'),
          backgroundColor: file.path === selectedFile ? getThemeColor('info') : undefined,
          marginBottom: 0,
          fontWeight: file.path === selectedFile ? 'bold' : 'normal',
          width: 'fill'
        },
        id: `file-${file.path.replace(/[^a-zA-Z0-9]/g, '-')}`,
        onClick: () => {
          if (file.isDirectory) {
            // If it's a directory, trigger navigation
            if (props.onDirectoryChange) {
              props.onDirectoryChange(file.path);
            }
          } else {
            // If it's a file, trigger file selection
            if (props.onFileSelect) {
              props.onFileSelect(file);
            }
          }
        }
      });
    });
  }

  const browserContent = createElement('container', {
    id: 'file-browser',
    style: {
      minWidth: props.width || 60,
      minHeight: props.height || 20,
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      border: 'thin',
      borderColor: getThemeColor('textSecondary')
    }
  },
    // Header - minimal
    createElement('container', {
      id: 'browser-header',
      style: {
        height: 1,
        backgroundColor: getThemeColor('headerBackground'),
        color: getThemeColor('headerForeground'),
        padding: 0,
        borderBottom: 'thin'
      }
    },
      createElement('text', {
        text: `[PATH] ${currentPath}`,
        style: { fontWeight: 'bold', marginBottom: 0 }
      })
    ),

    // Main content area
    createElement('container', {
      id: 'browser-content',
      style: {
        flex: 1,
        display: 'flex',
        flexDirection: 'row'
      }
    },
      // Left side: Directory tree
      createElement('container', {
        id: 'directory-tree',
        style: {
          minWidth: 24,
          flex: '0 0 40%',
          borderRight: 'thin',
          borderColor: getThemeColor('textSecondary'),
          padding: 1,
          backgroundColor: getThemeColor('sidebarBackground'),
          overflow: 'scroll',
          display: 'flex',
          flexDirection: 'column'
        },
        scrollable: true
      },
        createElement('text', {
          text: 'Directories:',
          style: {
            fontWeight: 'bold',
            color: getThemeColor('sidebarForeground'),
            marginBottom: 1
          }
        }),
        ...createTreeItems(rootStructure)
      ),

      // Right side: File list
      createElement('container', {
        id: 'file-list',
        style: {
          minWidth: 30,
          flex: 1,
          padding: 1,
          backgroundColor: getThemeColor('surface'),
          overflow: 'scroll',
          display: 'flex',
          flexDirection: 'column'
        },
        scrollable: true
      },
        createElement('text', {
          text: `Files in ${currentDir.name}:`,
          style: {
            fontWeight: 'bold',
            color: getThemeColor('textPrimary'),
            marginBottom: 1
          }
        }),
        ...createFileItems(currentDir.files)
      )
    ),

    // Bottom buttons (if enabled)
    ...(showButtons ? [
      createElement('container', {
        id: 'browser-buttons',
        style: {
          height: 3,
          backgroundColor: getThemeColor('headerBackground'),
          borderTop: 'thin',
          borderColor: getThemeColor('textSecondary'),
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3
        }
      },
        createElement('button', {
          title: 'Cancel',
          onClick: (event: ClickEvent) => {
            if (props.onCancel) {
              props.onCancel();
            }
          },
          id: 'cancel-button',
          tabIndex: 1
        }),
        createElement('button', {
          title: 'OK',
          onClick: (event: ClickEvent) => {
            if (props.onOk) {
              const selected = selectedFile ?
                currentDir.files.find(f => f.path === selectedFile) || null : null;
              props.onOk(selected);
            }
          },
          id: 'ok-button',
          tabIndex: 2
        })
      )
    ] : [])
  );

  return browserContent;
}

// Lint schema for file-browser component
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const fileBrowserSchema: ComponentSchema = {
  description: 'File system browser with tree and list views',
  props: {
    currentPath: { type: 'string', description: 'Current directory path' },
    selectedFile: { type: 'string', description: 'Currently selected file' },
    expandedTreePath: { type: 'string', description: 'Expanded tree node path' },
    rootDirectory: { type: 'string', description: 'Root directory for browsing' },
    onFileSelect: { type: 'function', description: 'File selection callback' },
    onDirectoryChange: { type: 'function', description: 'Directory change callback' },
    onTreeExpand: { type: 'function', description: 'Tree expand/collapse callback' },
    onOk: { type: 'function', description: 'OK button callback' },
    onCancel: { type: 'function', description: 'Cancel button callback' },
    showButtons: { type: 'boolean', description: 'Show OK/Cancel buttons' },
    useRealFileSystem: { type: 'boolean', description: 'Use actual file system vs mock' },
  },
};

registerComponentSchema('file-browser', fileBrowserSchema);