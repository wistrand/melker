// Toast system type definitions

/** Toast notification types */
export type ToastType = 'info' | 'success' | 'warning' | 'error';

/** Toast container position */
export type ToastPosition = 'bottom' | 'top';

/** Options for showing a toast */
export interface ToastOptions {
  /** Toast type - affects icon and styling (default: 'info') */
  type?: ToastType;
  /** Duration in ms before auto-dismiss (default: from config, typically 5000) */
  duration?: number;
  /** Show close button (default: true) */
  closable?: boolean;
  /** Play terminal bell - overrides config setting */
  bell?: boolean;
  /** Action button */
  action?: ToastAction;
}

/** Toast action button */
export interface ToastAction {
  /** Button label */
  label: string;
  /** Click handler */
  onClick: () => void;
}

/** Internal toast entry */
export interface ToastEntry {
  /** Unique ID */
  id: string;
  /** Message text */
  message: string;
  /** Toast type */
  type: ToastType;
  /** Creation timestamp */
  createdAt: number;
  /** Auto-dismiss duration in ms */
  duration: number;
  /** Show close button */
  closable: boolean;
  /** Play bell on show */
  bell: boolean;
  /** Optional action button */
  action?: ToastAction;
  /** Duplicate count (shown when > 1) */
  count: number;
}

/** Toast configuration from schema */
export interface ToastConfig {
  /** Maximum visible toasts (default: 5) */
  maxVisible: number;
  /** Container position (default: 'bottom') */
  position: ToastPosition;
  /** Default toast duration in ms (default: 5000) */
  defaultDuration: number;
  /** Dismiss all after inactivity in ms (default: 8000) */
  inactivityTimeout: number;
  /** Play terminal bell for error toasts (default: false) */
  bell: boolean;
  /** Container width in characters (default: 40) */
  width: number;
}

/** Default toast configuration */
export const DEFAULT_TOAST_CONFIG: ToastConfig = {
  maxVisible: 5,
  position: 'bottom',
  defaultDuration: 5000,
  inactivityTimeout: 8000,
  bell: false,
  width: 40,
};

/** Toast type icons */
export const TOAST_ICONS: Record<ToastType, string> = {
  info: 'ℹ',
  success: '✓',
  warning: '⚠',
  error: '✕',
};
