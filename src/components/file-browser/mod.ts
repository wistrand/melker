// File Browser Component - Module exports
//
// A file system browser component for selecting files and directories.
// Extends FilterableListCore for fuzzy filtering and keyboard navigation.

// Type definitions
export type {
  FileEntry,
  LoadResult,
  LoadOptions,
  FileSelectEvent,
  FileErrorEvent,
  FileErrorCode,
} from './file-entry.ts';

// Utility functions
export {
  loadDirectory,
  classifyError,
  formatErrorMessage,
  getExtension,
  formatSize,
  formatDate,
  getParentPath,
  isRootPath,
  join,
} from './file-utils.ts';

// Main component
export {
  FileBrowserElement,
  fileBrowserSchema,
  type FileBrowserProps,
} from './file-browser.ts';
