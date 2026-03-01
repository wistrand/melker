// Stdout mode for Melker applications
// Outputs rendered buffer to stdout without cursor movement sequences
// Used for debugging, testing, and piping output to other tools

import { DualBuffer, Cell, EMPTY_CHAR } from './buffer.ts';
import { MelkerConfig } from './config/mod.ts';
import { getLogger, type ComponentLogger } from './logging.ts';
import { getThemeManager } from './theme.ts';
import { ANSI, getColorCode } from './ansi-output.ts';
import { stdout, consoleSize } from './runtime/mod.ts';

// Lazy logger initialization to avoid triggering MelkerConfig.get() before CLI flags are applied
let _logger: ComponentLogger | undefined;
function getStdoutLogger(): ComponentLogger {
  if (!_logger) {
    _logger = getLogger('stdout');
  }
  return _logger;
}

export interface StdoutOptions {
  width: number;
  height: number;
  timeout: number;
  colorSupport: 'none' | '16' | '256' | 'truecolor';
  stripAnsi: boolean;
  trim: 'none' | 'right' | 'bottom' | 'both';
}

/**
 * Check if stdout is a TTY (interactive terminal)
 */
export function isStdoutTTY(): boolean {
  try {
    return stdout.isTerminal();
  } catch {
    // If we can't determine, assume not a TTY (safer for piping)
    return false;
  }
}

/**
 * Check if stdout mode is enabled (explicit flag OR auto-detected non-TTY)
 * Respects --interactive flag which forces TUI mode even when piped
 */
export function isStdoutEnabled(): boolean {
  const config = MelkerConfig.get();
  const explicitlyEnabled = !!(config as any).stdoutEnabled;
  const forceInteractive = !!(config as any).stdoutInteractive;

  // --interactive flag overrides auto-detection
  if (forceInteractive) {
    return explicitlyEnabled; // Only enable stdout mode if explicitly requested
  }

  // Auto-enable if stdout is not a TTY (piped or redirected)
  if (!explicitlyEnabled && !isStdoutTTY()) {
    return true;
  }

  return explicitlyEnabled;
}

/**
 * Check if stdout mode was auto-enabled (not explicitly set via --stdout flag)
 */
export function isStdoutAutoEnabled(): boolean {
  const config = MelkerConfig.get();
  const explicitlyEnabled = !!(config as any).stdoutEnabled;
  const forceInteractive = !!(config as any).stdoutInteractive;

  // --interactive flag prevents auto-enabling
  if (forceInteractive) {
    return false;
  }

  return !explicitlyEnabled && !isStdoutTTY();
}

/**
 * Get actual terminal size (for default stdout dimensions)
 */
function getActualTerminalSize(): { width: number; height: number } {
  const size = consoleSize();
  if (size) {
    return { width: size.columns, height: size.rows };
  }
  return { width: 80, height: 24 };
}

/**
 * Get stdout configuration from MelkerConfig
 */
export function getStdoutConfig(): StdoutOptions {
  const config = MelkerConfig.get();
  // Get color support from theme manager (respects MELKER_THEME)
  const colorSupport = getThemeManager().getColorSupport();
  // Default to terminal size if not explicitly set
  const terminalSize = getActualTerminalSize();

  // Determine ANSI stripping based on --color flag
  // auto (default): strip when piped (not a TTY)
  // always: force colors even when piped
  // never: strip colors even on TTY
  const colorMode = config.stdoutColor;
  let stripAnsi: boolean;
  if (colorMode === 'always') {
    stripAnsi = false;
  } else if (colorMode === 'never') {
    stripAnsi = true;
  } else {
    // auto: strip when piped (not a TTY)
    stripAnsi = !isStdoutTTY();
  }

  return {
    width: config.stdoutWidth ?? terminalSize.width,
    height: config.stdoutHeight ?? terminalSize.height,
    timeout: config.stdoutTimeout ?? 500,
    colorSupport: stripAnsi ? 'none' : colorSupport,
    stripAnsi,
    trim: config.stdoutTrim ?? 'none',
  };
}

/**
 * Convert a buffer to stdout-friendly output (no cursor moves, only style + chars)
 * Each row is printed as a line with style sequences and newline at end
 *
 * When stripAnsi is true (auto-detected when piped), outputs plain text only.
 */
export function bufferToStdout(
  buffer: DualBuffer,
  options: { colorSupport: 'none' | '16' | '256' | 'truecolor'; stripAnsi?: boolean } = { colorSupport: 'truecolor' }
): string {
  const lines: string[] = [];
  // Use display buffer (previousBuffer) which has the rendered content after swap
  const termBuffer = buffer.getDisplayBuffer();
  const width = termBuffer.width;
  const height = termBuffer.height;

  // Strip ANSI when piped or when color support is 'none'
  const stripAnsi = options.stripAnsi ?? (options.colorSupport === 'none');

  for (let y = 0; y < height; y++) {
    let line = '';
    let currentStyle = '';
    let currentLink: string | undefined;

    for (let x = 0; x < width; x++) {
      const cell = termBuffer.getCell(x, y);
      if (!cell) {
        line += EMPTY_CHAR;
        continue;
      }

      // Skip continuation cells (second half of wide chars)
      if (cell.isWideCharContinuation) {
        continue;
      }

      // Only add style codes if not stripping ANSI
      if (!stripAnsi) {
        // Generate style code for this cell
        const cellStyle = generateCellStyle(cell, options.colorSupport);

        // Only emit style change if different from current
        if (cellStyle !== currentStyle) {
          line += cellStyle;
          currentStyle = cellStyle;
        }

        // OSC 8 hyperlink: only emit on transitions
        if (cell.link !== currentLink) {
          if (cell.link) {
            line += ANSI.linkOpen + cell.link + ANSI.linkEnd;
          } else {
            line += ANSI.linkClose;
          }
          currentLink = cell.link;
        }
      }

      // Output the character
      line += cell.char || EMPTY_CHAR;
    }

    // Reset at end of line (only if using ANSI)
    if (!stripAnsi) {
      // Close any open hyperlink before line end
      if (currentLink) {
        line += ANSI.linkClose;
      }
      line += ANSI.reset;
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Trim stdout output based on trim mode
 * - right: trim trailing spaces from each line
 * - bottom: trim trailing empty lines
 * - both: trim both right and bottom
 * - none: no trimming
 */
export function trimStdoutOutput(
  output: string,
  trim: 'none' | 'right' | 'bottom' | 'both'
): string {
  if (trim === 'none') {
    return output;
  }

  let lines = output.split('\n');

  // Trim trailing spaces from each line (right trim)
  if (trim === 'right' || trim === 'both') {
    lines = lines.map(line => line.replace(/\s+$/, ''));
  }

  // Trim trailing empty lines (bottom trim)
  if (trim === 'bottom' || trim === 'both') {
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
      lines.pop();
    }
  }

  return lines.join('\n');
}

/**
 * Generate ANSI style codes for a cell (no cursor movement)
 */
function generateCellStyle(cell: Cell, colorSupport: 'none' | '16' | '256' | 'truecolor'): string {
  const codes: string[] = [ANSI.reset];

  // Colors only if color support is enabled
  if (colorSupport !== 'none') {
    // Foreground color
    if (cell.foreground) {
      codes.push(getColorCode(cell.foreground, false, colorSupport));
    }

    // Background color
    if (cell.background) {
      codes.push(getColorCode(cell.background, true, colorSupport));
    }
  }

  // Text attributes
  if (cell.bold) codes.push(ANSI.bold);
  if (cell.dim) codes.push(ANSI.dim);
  if (cell.italic) codes.push(ANSI.italic);
  if (cell.underline) codes.push(ANSI.underline);
  if (cell.reverse) codes.push(ANSI.reverse);

  return codes.join('');
}

/**
 * Stdout mode manager - handles running app and outputting buffer
 */
export class StdoutManager {
  private _config: StdoutOptions;
  private _buffer: DualBuffer | null = null;

  constructor() {
    this._config = getStdoutConfig();
  }

  get config(): StdoutOptions {
    return this._config;
  }

  /**
   * Set the buffer to output (called by engine)
   */
  setBuffer(buffer: DualBuffer): void {
    this._buffer = buffer;
  }

  /**
   * Output the buffer content to stdout
   */
  async outputBuffer(): Promise<void> {
    if (!this._buffer) {
      getStdoutLogger().warn('No buffer to output');
      return;
    }

    let output = bufferToStdout(this._buffer, {
      colorSupport: this._config.colorSupport,
      stripAnsi: this._config.stripAnsi,
    });

    // Apply trimming if configured
    output = trimStdoutOutput(output, this._config.trim);

    // Write to stdout
    const encoder = new TextEncoder();
    await stdout.write(encoder.encode(output + '\n'));
  }

  /**
   * Wait for timeout then output buffer
   */
  async waitAndOutput(): Promise<void> {
    getStdoutLogger().debug(`Waiting ${this._config.timeout}ms before output`);
    await new Promise(resolve => setTimeout(resolve, this._config.timeout));
    await this.outputBuffer();
  }
}

// Global stdout manager instance
let globalStdoutManager: StdoutManager | undefined;

/**
 * Get or create global stdout manager
 */
export function getStdoutManager(): StdoutManager {
  if (!globalStdoutManager) {
    globalStdoutManager = new StdoutManager();
  }
  return globalStdoutManager;
}

/**
 * Initialize stdout mode if enabled
 */
export function initializeStdoutMode(): StdoutManager | null {
  if (!isStdoutEnabled()) {
    return null;
  }

  const manager = getStdoutManager();
  getStdoutLogger().info(`Stdout mode enabled, timeout=${manager.config.timeout}ms`);
  return manager;
}

/**
 * Cleanup stdout mode
 */
export function cleanupStdoutMode(): void {
  globalStdoutManager = undefined;
}
