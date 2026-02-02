// Toast Renderer - renders toast container as an overlay

import type { DualBuffer, Cell } from '../buffer.ts';
import type { Bounds, Overlay } from '../types.ts';
import { getThemeColor } from '../theme.ts';
import type { ToastEntry, ToastConfig, ToastType } from './types.ts';
import { TOAST_ICONS } from './types.ts';
import { getToastManager } from './toast-manager.ts';

/** Border characters for toast container */
const BORDER = {
  topLeft: '╭',
  topRight: '╮',
  bottomLeft: '╰',
  bottomRight: '╯',
  horizontal: '─',
  vertical: '│',
};

/** Cached bounds for click handling */
let _lastBounds: Bounds | null = null;

/**
 * Render toast overlay directly to buffer.
 * Returns true if toasts were rendered.
 */
export function renderToastOverlay(buffer: DualBuffer): boolean {
  const manager = getToastManager();

  if (!manager.hasVisibleToasts()) {
    _lastBounds = null;
    return false;
  }

  const config = manager.getConfig();
  const toasts = manager.getActiveToasts();

  if (toasts.length === 0) {
    _lastBounds = null;
    return false;
  }

  const viewportWidth = buffer.width;
  const viewportHeight = buffer.height;

  // Calculate dimensions
  const width = Math.min(config.width, viewportWidth - 4);
  const height = toasts.length + 2; // border + toasts + border (close-all on border)

  // Calculate position (centered horizontally)
  const x = Math.floor((viewportWidth - width) / 2);
  const y = config.position === 'bottom'
    ? viewportHeight - height - 1
    : 1;

  const bounds: Bounds = { x, y, width, height };
  _lastBounds = bounds;

  renderToastContainer(buffer, bounds, toasts, config);
  return true;
}

/**
 * Handle click at coordinates.
 * Returns true if click was handled by toast system.
 */
export function handleToastClick(x: number, y: number): boolean {
  if (!_lastBounds) return false;

  const bounds = _lastBounds;

  // Check if click is within bounds
  if (x < bounds.x || x >= bounds.x + bounds.width ||
      y < bounds.y || y >= bounds.y + bounds.height) {
    return false;
  }

  return getToastManager().handleClick(x, y, bounds);
}

/**
 * Check if there are visible toasts
 */
export function hasVisibleToasts(): boolean {
  return getToastManager().hasVisibleToasts();
}

/**
 * Create toast overlay for rendering (legacy overlay API)
 */
export function createToastOverlay(
  viewportWidth: number,
  viewportHeight: number
): Overlay | null {
  const manager = getToastManager();

  if (!manager.hasVisibleToasts()) {
    return null;
  }

  const config = manager.getConfig();
  const toasts = manager.getActiveToasts();

  if (toasts.length === 0) {
    return null;
  }

  // Calculate dimensions
  const width = Math.min(config.width, viewportWidth - 4);
  const height = toasts.length + 2; // border + toasts + border (close-all on border)

  // Calculate position (centered horizontally)
  const x = Math.floor((viewportWidth - width) / 2);
  const y = config.position === 'bottom'
    ? viewportHeight - height - 1
    : 1;

  const bounds: Bounds = { x, y, width, height };

  return {
    id: 'toast-container',
    zIndex: 300, // Above dialogs (200) and dropdowns (100)
    bounds,
    hitTestBounds: bounds,
    render: (buffer: DualBuffer, _bounds: Bounds, _style: Partial<Cell>) => {
      renderToastContainer(buffer, bounds, toasts, config);
    },
    onClick: (clickX: number, clickY: number) => {
      return manager.handleClick(clickX, clickY, bounds);
    },
  };
}

/**
 * Render the toast container
 */
function renderToastContainer(
  buffer: DualBuffer,
  bounds: Bounds,
  toasts: ToastEntry[],
  config: ToastConfig
): void {
  const { x, y, width, height } = bounds;

  // Get theme colors
  const bgColor = getThemeColor('surface');
  const borderColor = getThemeColor('border');
  const textColor = getThemeColor('textPrimary');
  const dimColor = getThemeColor('textMuted');

  const baseStyle: Partial<Cell> = {
    background: bgColor,
    foreground: textColor,
  };

  const borderStyle: Partial<Cell> = {
    background: bgColor,
    foreground: borderColor,
  };

  // Draw background
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      buffer.currentBuffer.setCell(x + col, y + row, {
        char: ' ',
        width: 1,
        ...baseStyle,
      });
    }
  }

  // Draw border
  // Top
  buffer.currentBuffer.setCell(x, y, { char: BORDER.topLeft, width: 1, ...borderStyle });
  buffer.currentBuffer.setCell(x + width - 1, y, { char: BORDER.topRight, width: 1, ...borderStyle });
  for (let col = 1; col < width - 1; col++) {
    buffer.currentBuffer.setCell(x + col, y, { char: BORDER.horizontal, width: 1, ...borderStyle });
  }

  // Bottom
  buffer.currentBuffer.setCell(x, y + height - 1, { char: BORDER.bottomLeft, width: 1, ...borderStyle });
  buffer.currentBuffer.setCell(x + width - 1, y + height - 1, { char: BORDER.bottomRight, width: 1, ...borderStyle });
  for (let col = 1; col < width - 1; col++) {
    buffer.currentBuffer.setCell(x + col, y + height - 1, { char: BORDER.horizontal, width: 1, ...borderStyle });
  }

  // Sides
  for (let row = 1; row < height - 1; row++) {
    buffer.currentBuffer.setCell(x, y + row, { char: BORDER.vertical, width: 1, ...borderStyle });
    buffer.currentBuffer.setCell(x + width - 1, y + row, { char: BORDER.vertical, width: 1, ...borderStyle });
  }

  // Render toasts
  const toastStartY = y + 1;
  for (let i = 0; i < toasts.length; i++) {
    const toast = toasts[i];
    const toastY = toastStartY + i;
    renderToast(buffer, x + 1, toastY, width - 2, toast, baseStyle, dimColor);
  }

  // Render close-all button on the border
  const closeAllY = config.position === 'bottom' ? y + height - 1 : y;
  const closeAllText = ' Close All ';
  const closeAllX = x + Math.floor((width - closeAllText.length) / 2);
  buffer.currentBuffer.setText(closeAllX, closeAllY, closeAllText, {
    ...borderStyle,
  });
}

/**
 * Render a single toast
 */
function renderToast(
  buffer: DualBuffer,
  x: number,
  y: number,
  width: number,
  toast: ToastEntry,
  baseStyle: Partial<Cell>,
  dimColor: number
): void {
  // Get color for toast type
  const typeColor = getToastTypeColor(toast.type);
  const iconStyle: Partial<Cell> = { ...baseStyle, foreground: typeColor };

  // Icon
  const icon = TOAST_ICONS[toast.type];
  buffer.currentBuffer.setCell(x, y, { char: icon, width: 1, ...iconStyle });
  buffer.currentBuffer.setCell(x + 1, y, { char: ' ', width: 1, ...baseStyle });

  // Close button (if closable)
  let closeButtonWidth = 0;
  if (toast.closable) {
    const closeX = x + width - 2;
    buffer.currentBuffer.setCell(closeX, y, { char: '✕', width: 1, foreground: dimColor, background: baseStyle.background });
    closeButtonWidth = 3;
  }

  // Action button (if present)
  let actionWidth = 0;
  if (toast.action) {
    const actionLabel = `[${toast.action.label}]`;
    actionWidth = actionLabel.length + 1;
    const actionX = x + width - closeButtonWidth - actionWidth;
    buffer.currentBuffer.setText(actionX, y, actionLabel, {
      ...baseStyle,
      foreground: getThemeColor('primary'),
    });
  }

  // Message text (truncated to fit)
  const maxMessageWidth = width - 2 - closeButtonWidth - actionWidth;
  let message = toast.message;
  if (message.length > maxMessageWidth) {
    message = message.slice(0, maxMessageWidth - 1) + '…';
  }
  buffer.currentBuffer.setText(x + 2, y, message, baseStyle);
}

/**
 * Get color for toast type
 */
function getToastTypeColor(type: ToastType): number {
  switch (type) {
    case 'success':
      return getThemeColor('success');
    case 'warning':
      return getThemeColor('warning');
    case 'error':
      return getThemeColor('error');
    case 'info':
    default:
      return getThemeColor('info');
  }
}
