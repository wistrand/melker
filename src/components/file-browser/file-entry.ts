// File Browser - Type definitions

/**
 * File entry data representing a file or directory
 */
export interface FileEntry {
  /** File or directory name */
  name: string;
  /** Full absolute path */
  path: string;
  /** Whether this is a directory */
  isDirectory: boolean;
  /** Whether this is a symbolic link */
  isSymlink: boolean;
  /** File size in bytes (-1 if unknown) */
  size: number;
  /** Last modification time (null if unknown) */
  modified: Date | null;
  /** Display icon: [D] for directory, [F] for file, [?] for unknown */
  icon: string;
}

/**
 * Result of loading a directory
 */
export interface LoadResult {
  /** Successfully loaded entries */
  entries: FileEntry[];
  /** Error if directory read failed, null on success */
  error: FileErrorEvent | null;
}

/**
 * Options for directory loading
 */
export interface LoadOptions {
  /** Show hidden files (dotfiles) */
  showHidden: boolean;
  /** Filter by file extensions (e.g., ['.ts', '.js']) */
  extensions?: string[];
}

/**
 * Event fired when a file or directory is selected
 */
export interface FileSelectEvent {
  type: 'select';
  /** Full path to selected file/directory */
  path: string;
  /** Array of paths for multiple selection */
  paths: string[];
  /** Just the filename */
  name: string;
  /** Whether the selected item is a directory */
  isDirectory: boolean;
  /** Target element ID */
  targetId: string;
}

/**
 * Event fired when an error occurs
 */
export interface FileErrorEvent {
  type: 'error';
  /** Path that caused the error */
  path: string;
  /** Error code */
  code: FileErrorCode;
  /** Human-readable error message */
  message: string;
  /** Target element ID */
  targetId: string;
}

/**
 * Error codes for file operations
 */
export type FileErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'NOT_DIRECTORY'
  | 'UNKNOWN';
