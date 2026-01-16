// Theme system for Melker UI - Environment variable driven theming

import type { TerminalColor } from './types.ts';
import { Env } from './env.ts';
import { MelkerConfig } from './config/mod.ts';

// Theme definitions
export type ThemeType = 'bw' | 'gray' | 'color' | 'fullcolor';
export type ThemeMode = 'std' | 'dark';

export interface ColorPalette {
  // Basic UI colors
  primary: TerminalColor;
  secondary: TerminalColor;
  background: TerminalColor;
  foreground: TerminalColor;
  surface: TerminalColor;
  border: TerminalColor;

  // Status colors
  success: TerminalColor;
  warning: TerminalColor;
  error: TerminalColor;
  info: TerminalColor;

  // Interactive element colors
  buttonPrimary: TerminalColor;
  buttonSecondary: TerminalColor;
  buttonBackground: TerminalColor;
  inputBackground: TerminalColor;
  inputForeground: TerminalColor;
  inputBorder: TerminalColor;

  // Focus states
  focusPrimary: TerminalColor;
  focusBackground: TerminalColor;

  // Content colors
  textPrimary: TerminalColor;
  textSecondary: TerminalColor;
  textMuted: TerminalColor;

  // Component-specific colors
  headerBackground: TerminalColor;
  headerForeground: TerminalColor;
  sidebarBackground: TerminalColor;
  sidebarForeground: TerminalColor;
  modalBackground: TerminalColor;
  modalForeground: TerminalColor;

  // Scrollbar colors
  scrollbarThumb: TerminalColor;
  scrollbarTrack: TerminalColor;
}

export interface Theme {
  type: ThemeType;
  mode: ThemeMode;
  colorSupport: 'none' | '16' | '256' | 'truecolor';
  palette: ColorPalette;
}

// Black & White theme - maximum compatibility
const BW_STD_PALETTE: ColorPalette = {
  primary: 'white',
  secondary: 'white',
  background: 'black',
  foreground: 'white',
  surface: 'black',
  border: 'white',

  success: 'white',
  warning: 'white',
  error: 'white',
  info: 'white',

  buttonPrimary: 'black',
  buttonSecondary: 'white',
  buttonBackground: 'white',
  inputBackground: 'black',
  inputForeground: 'white',
  inputBorder: 'white',

  focusPrimary: 'black',
  focusBackground: 'white',

  textPrimary: 'white',
  textSecondary: 'white',
  textMuted: 'white',

  headerBackground: 'black',
  headerForeground: 'white',
  sidebarBackground: 'black',
  sidebarForeground: 'white',
  modalBackground: 'black',
  modalForeground: 'white',

  scrollbarThumb: 'white',
  scrollbarTrack: 'brightBlack',
};

const BW_DARK_PALETTE: ColorPalette = {
  primary: 'black',
  secondary: 'black',
  background: 'white',
  foreground: 'black',
  surface: 'white',
  border: 'black',

  success: 'black',
  warning: 'black',
  error: 'black',
  info: 'black',

  buttonPrimary: 'white',
  buttonSecondary: 'black',
  buttonBackground: 'black',
  inputBackground: 'white',
  inputForeground: 'black',
  inputBorder: 'black',

  focusPrimary: 'white',
  focusBackground: 'black',

  textPrimary: 'black',
  textSecondary: 'black',
  textMuted: 'black',

  headerBackground: 'white',
  headerForeground: 'black',
  sidebarBackground: 'white',
  sidebarForeground: 'black',
  modalBackground: 'white',
  modalForeground: 'black',

  scrollbarThumb: 'black',
  scrollbarTrack: 'gray',
};

// Grayscale theme - uses basic terminal grays
// Gray std is now the inverse (previously dark)
const GRAY_STD_PALETTE: ColorPalette = {
  primary: 'black',
  secondary: 'gray',
  background: 'white',
  foreground: 'black',
  surface: 'gray',
  border: 'gray',

  success: 'black',
  warning: 'gray',
  error: 'black',
  info: 'gray',

  buttonPrimary: 'white',
  buttonSecondary: 'gray',
  buttonBackground: 'black',
  inputBackground: 'gray',
  inputForeground: 'black',
  inputBorder: 'gray',

  focusPrimary: 'white',
  focusBackground: 'black',

  textPrimary: 'black',
  textSecondary: 'gray',
  textMuted: 'gray',

  headerBackground: 'gray',
  headerForeground: 'black',
  sidebarBackground: 'white',
  sidebarForeground: 'gray',
  modalBackground: 'gray',
  modalForeground: 'black',

  scrollbarThumb: 'black',
  scrollbarTrack: 'gray',
};

// Gray dark is now the original std palette
const GRAY_DARK_PALETTE: ColorPalette = {
  primary: 'white',
  secondary: 'gray',
  background: 'black',
  foreground: 'white',
  surface: 'brightBlack',
  border: 'gray',

  success: 'white',
  warning: 'gray',
  error: 'white',
  info: 'gray',

  buttonPrimary: 'black',
  buttonSecondary: 'gray',
  buttonBackground: 'white',
  inputBackground: 'brightBlack',
  inputForeground: 'white',
  inputBorder: 'gray',

  focusPrimary: 'black',
  focusBackground: 'white',

  textPrimary: 'white',
  textSecondary: 'gray',
  textMuted: 'brightBlack',

  headerBackground: 'brightBlack',
  headerForeground: 'white',
  sidebarBackground: 'black',
  sidebarForeground: 'gray',
  modalBackground: 'brightBlack',
  modalForeground: 'white',

  scrollbarThumb: 'white',
  scrollbarTrack: 'brightBlack',
};

// Color theme - uses 16 basic ANSI colors
const COLOR_STD_PALETTE: ColorPalette = {
  primary: 'brightBlue',
  secondary: 'brightCyan',
  background: 'white',
  foreground: 'black',
  surface: 'gray',
  border: 'brightBlack',

  success: 'brightGreen',
  warning: 'brightYellow',
  error: 'brightRed',
  info: 'brightCyan',

  buttonPrimary: 'black',
  buttonSecondary: 'brightCyan',
  buttonBackground: 'brightBlue',
  inputBackground: 'gray',
  inputForeground: 'black',
  inputBorder: 'brightCyan',

  focusPrimary: 'brightYellow',
  focusBackground: 'brightBlue',

  textPrimary: 'black',
  textSecondary: 'brightBlack',
  textMuted: 'gray',

  headerBackground: 'brightBlue',
  headerForeground: 'black',
  sidebarBackground: 'gray',
  sidebarForeground: 'brightCyan',
  modalBackground: 'brightBlue',
  modalForeground: 'black',

  scrollbarThumb: 'brightBlue',
  scrollbarTrack: 'gray',
};

const COLOR_DARK_PALETTE: ColorPalette = {
  primary: 'brightBlue',
  secondary: 'cyan',
  background: 'black',
  foreground: 'white',
  surface: 'brightBlack',
  border: 'white',

  success: 'green',
  warning: 'yellow',
  error: 'red',
  info: 'cyan',

  buttonPrimary: 'white',
  buttonSecondary: 'cyan',
  buttonBackground: 'blue',
  inputBackground: 'brightBlack',
  inputForeground: 'white',
  inputBorder: 'cyan',

  focusPrimary: 'yellow',
  focusBackground: 'blue',

  textPrimary: 'brightWhite',
  textSecondary: 'white',
  textMuted: 'gray',

  headerBackground: 'blue',
  headerForeground: 'white',
  sidebarBackground: 'brightBlack',
  sidebarForeground: 'cyan',
  modalBackground: 'blue',
  modalForeground: 'white',

  scrollbarThumb: 'cyan',
  scrollbarTrack: 'brightBlack',
};

// Full color theme - uses 256 colors and true color
const FULLCOLOR_STD_PALETTE: ColorPalette = {
  primary: '#60a5fa',      // Blue-400
  secondary: '#22d3ee',    // Cyan-400
  background: '#ffffff',   // True white
  foreground: '#000000',   // True black
  surface: '#f3f4f6',      // Gray-100
  border: '#9ca3af',       // Gray-400

  success: '#34d399',      // Emerald-400
  warning: '#fbbf24',      // Amber-400
  error: '#f87171',        // Red-400
  info: '#60a5fa',         // Blue-400

  buttonPrimary: '#000000',
  buttonSecondary: '#22d3ee',
  buttonBackground: '#60a5fa',
  inputBackground: '#f9fafb',  // Gray-50
  inputForeground: '#111827',  // Gray-900
  inputBorder: '#d1d5db',      // Gray-300

  focusPrimary: '#f59e0b',     // Amber-500
  focusBackground: '#3b82f6',  // Blue-500

  textPrimary: '#111827',      // Gray-900
  textSecondary: '#374151',    // Gray-700
  textMuted: '#9ca3af',        // Gray-400

  headerBackground: '#3b82f6', // Blue-500
  headerForeground: '#f9fafb', // Gray-50
  sidebarBackground: '#f3f4f6', // Gray-100
  sidebarForeground: '#374151', // Gray-700
  modalBackground: '#2563eb',   // Blue-600
  modalForeground: '#f9fafb',   // Gray-50

  scrollbarThumb: '#60a5fa',    // Blue-400
  scrollbarTrack: '#e5e7eb',    // Gray-200
};

const FULLCOLOR_DARK_PALETTE: ColorPalette = {
  primary: '#3b82f6',      // Blue-500
  secondary: '#06b6d4',    // Cyan-500
  background: '#000000',   // True black
  foreground: '#ffffff',   // True white
  surface: '#1f2937',      // Gray-800
  border: '#6b7280',       // Gray-500

  success: '#10b981',      // Emerald-500
  warning: '#f59e0b',      // Amber-500
  error: '#ef4444',        // Red-500
  info: '#3b82f6',         // Blue-500

  buttonPrimary: '#ffffff',
  buttonSecondary: '#06b6d4',
  buttonBackground: '#3b82f6',
  inputBackground: '#111827',  // Gray-900
  inputForeground: '#f9fafb',  // Gray-50
  inputBorder: '#374151',      // Gray-700

  focusPrimary: '#fbbf24',     // Amber-400
  focusBackground: '#1e40af',  // Blue-800

  textPrimary: '#f9fafb',      // Gray-50
  textSecondary: '#d1d5db',    // Gray-300
  textMuted: '#6b7280',        // Gray-500

  headerBackground: '#1e40af', // Blue-800
  headerForeground: '#f9fafb', // Gray-50
  sidebarBackground: '#1f2937', // Gray-800
  sidebarForeground: '#d1d5db', // Gray-300
  modalBackground: '#1e3a8a',   // Blue-900
  modalForeground: '#f9fafb',   // Gray-50

  scrollbarThumb: '#3b82f6',    // Blue-500
  scrollbarTrack: '#374151',    // Gray-700
};

// Theme definitions
export const THEMES: Record<string, Theme> = {
  'bw-std': {
    type: 'bw',
    mode: 'std',
    colorSupport: 'none',
    palette: BW_STD_PALETTE,
  },
  'bw-dark': {
    type: 'bw',
    mode: 'dark',
    colorSupport: 'none',
    palette: BW_DARK_PALETTE,
  },
  'gray-std': {
    type: 'gray',
    mode: 'std',
    colorSupport: '16',
    palette: GRAY_STD_PALETTE,
  },
  'gray-dark': {
    type: 'gray',
    mode: 'dark',
    colorSupport: '16',
    palette: GRAY_DARK_PALETTE,
  },
  'color-std': {
    type: 'color',
    mode: 'std',
    colorSupport: '256',
    palette: COLOR_STD_PALETTE,
  },
  'color-dark': {
    type: 'color',
    mode: 'dark',
    colorSupport: '256',
    palette: COLOR_DARK_PALETTE,
  },
  'fullcolor-std': {
    type: 'fullcolor',
    mode: 'std',
    colorSupport: 'truecolor',
    palette: FULLCOLOR_STD_PALETTE,
  },
  'fullcolor-dark': {
    type: 'fullcolor',
    mode: 'dark',
    colorSupport: 'truecolor',
    palette: FULLCOLOR_DARK_PALETTE,
  },
};

// Terminal capability detection for auto theme selection

/**
 * Detect terminal color support level
 */
function detectColorSupport(): ThemeType {
  const colorterm = Env.get('COLORTERM') || '';
  const term = Env.get('TERM') || '';

  // Truecolor support
  if (colorterm === 'truecolor' || colorterm === '24bit') {
    return 'fullcolor';
  }

  // 256 color support
  if (term.includes('256color') || term.includes('256-color')) {
    return 'color';
  }

  // Basic color support (xterm, linux, etc.)
  if (term.includes('color') || term.includes('xterm') || term.includes('screen') || term.includes('tmux')) {
    return 'gray';
  }

  // Fallback to black & white
  return 'bw';
}

/**
 * Detect if terminal is in dark mode
 * Returns true for dark mode, false for light mode
 */
function detectDarkMode(): boolean {
  // Try COLORFGBG first (format: "fg;bg" e.g., "15;0" = white on black)
  const colorfgbg = Env.get('COLORFGBG');
  if (colorfgbg) {
    const parts = colorfgbg.split(';');
    if (parts.length >= 2) {
      const bg = parseInt(parts[parts.length - 1], 10);
      // Background colors 0-7 are dark, 8-15 are light
      if (!isNaN(bg)) {
        return bg < 8;
      }
    }
  }

  // Default to dark (most terminals use dark backgrounds)
  return true;
}

/**
 * Auto-detect the best theme based on terminal capabilities
 * @param forceMode If 'dark' or 'std', force that mode; otherwise auto-detect
 */
function detectTheme(forceMode?: 'dark' | 'std'): string {
  const colorSupport = detectColorSupport();
  let mode: ThemeMode;
  if (forceMode) {
    mode = forceMode;
  } else {
    mode = detectDarkMode() ? 'dark' : 'std';
  }
  return `${colorSupport}-${mode}`;
}

// Theme manager class
// Color to grayscale conversion helper
export function colorToGray(color: TerminalColor, isDark: boolean): TerminalColor {
  // If already a grayscale color, return as-is
  if (color === 'black' || color === 'white' || color === 'gray' || color === 'brightBlack') {
    return color;
  }

  // Hex color conversion
  if (typeof color === 'string' && color.startsWith('#')) {
    const hex = color.substring(1);
    let r: number, g: number, b: number;

    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else {
      return isDark ? 'black' : 'white';
    }

    // Calculate luminance (perceived brightness)
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    // Map to grayscale based on luminance
    if (luminance < 0.25) {
      return 'black';
    } else if (luminance < 0.5) {
      return 'brightBlack';
    } else if (luminance < 0.75) {
      return 'gray';
    } else {
      return 'white';
    }
  }

  // Named color conversion - map to approximate gray based on perceived brightness
  const colorBrightnessMap: Record<string, number> = {
    // Dark colors
    'black': 0.0,
    'red': 0.3,
    'green': 0.4,
    'yellow': 0.6,
    'blue': 0.25,
    'magenta': 0.35,
    'cyan': 0.5,
    'white': 1.0,
    // Bright colors
    'brightBlack': 0.4,
    'brightRed': 0.5,
    'brightGreen': 0.6,
    'brightYellow': 0.8,
    'brightBlue': 0.45,
    'brightMagenta': 0.55,
    'brightCyan': 0.7,
    'brightWhite': 1.0,
    'gray': 0.5,
  };

  const brightness = colorBrightnessMap[color as string] ?? 0.5;

  // Map to available grayscale
  if (brightness < 0.25) {
    return 'black';
  } else if (brightness < 0.5) {
    return 'brightBlack';
  } else if (brightness < 0.75) {
    return 'gray';
  } else {
    return 'white';
  }
}

/**
 * Convert a color to low-contrast monochrome for modal backdrop effect.
 * This desaturates the color and reduces contrast, making it appear "inactive".
 * Used when modal=true, backdrop=false to visually indicate blocked background.
 */
export function colorToLowContrast(color: TerminalColor, isDark: boolean): string {
  // Parse hex color
  if (typeof color === 'string' && color.startsWith('#')) {
    const hex = color.substring(1);
    let r: number, g: number, b: number;

    if (hex.length === 3) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
    } else if (hex.length === 6) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
    } else {
      return isDark ? '#404040' : '#c0c0c0';
    }

    // Convert to grayscale using luminance
    const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

    // Reduce contrast by pulling toward middle gray
    const middleGray = isDark ? 80 : 180;
    const contrastFactor = 0.4; // How much to reduce contrast (0 = full gray, 1 = original)
    const result = Math.round(middleGray + (gray - middleGray) * contrastFactor);

    // Clamp to valid range
    const clamped = Math.max(0, Math.min(255, result));
    const hexResult = clamped.toString(16).padStart(2, '0');
    return `#${hexResult}${hexResult}${hexResult}`;
  }

  // Handle rgb/rgba format
  if (typeof color === 'string' && color.startsWith('rgb')) {
    const match = color.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
    if (match) {
      const r = parseInt(match[1]);
      const g = parseInt(match[2]);
      const b = parseInt(match[3]);

      const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
      const middleGray = isDark ? 80 : 180;
      const contrastFactor = 0.4;
      const result = Math.round(middleGray + (gray - middleGray) * contrastFactor);
      const clamped = Math.max(0, Math.min(255, result));
      const hexResult = clamped.toString(16).padStart(2, '0');
      return `#${hexResult}${hexResult}${hexResult}`;
    }
  }

  // Named colors - map to approximate gray
  const colorBrightnessMap: Record<string, number> = {
    'black': 0.0, 'red': 0.3, 'green': 0.4, 'yellow': 0.6,
    'blue': 0.25, 'magenta': 0.35, 'cyan': 0.5, 'white': 1.0,
    'brightBlack': 0.4, 'brightRed': 0.5, 'brightGreen': 0.6, 'brightYellow': 0.8,
    'brightBlue': 0.45, 'brightMagenta': 0.55, 'brightCyan': 0.7, 'brightWhite': 1.0,
    'gray': 0.5,
  };

  const brightness = colorBrightnessMap[color as string] ?? 0.5;
  const gray = Math.round(brightness * 255);
  const middleGray = isDark ? 80 : 180;
  const contrastFactor = 0.4;
  const result = Math.round(middleGray + (gray - middleGray) * contrastFactor);
  const clamped = Math.max(0, Math.min(255, result));
  const hexResult = clamped.toString(16).padStart(2, '0');
  return `#${hexResult}${hexResult}${hexResult}`;
}

export class ThemeManager {
  private _currentTheme: Theme;
  private _envTheme: string | null = null;

  constructor() {
    this._envTheme = this._parseThemeFromEnv();
    // Default to auto-detection when no theme is specified
    const themeName = this._envTheme || detectTheme();
    this._currentTheme = this._getThemeByName(themeName);
  }

  private _parseThemeFromEnv(): string | null {
    // Respect NO_COLOR standard (https://no-color.org/)
    // When NO_COLOR is set (any value), use black-and-white theme
    if (Env.get('NO_COLOR') !== undefined) {
      // Detect light/dark mode but force bw type
      const isDark = detectDarkMode();
      return isDark ? 'bw-dark' : 'bw-std';
    }

    // Check theme from config (file config, policy, CLI, or env var override)
    // Format: "type-mode" (e.g., "color-dark", "bw-std", "fullcolor-dark")
    // Special values: "auto" (detect capabilities + light/dark), "auto-dark" (detect capabilities, force dark)
    const configTheme = MelkerConfig.get().theme;

    const normalized = configTheme.toLowerCase().trim();

    // Handle auto-detection themes
    if (normalized === 'auto') {
      return detectTheme();
    }

    if (normalized === 'auto-dark') {
      return detectTheme('dark');
    }

    if (normalized === 'auto-std') {
      return detectTheme('std');
    }

    // Validate format and return normalized name
    if (THEMES[normalized]) {
      return normalized;
    }

    // Handle legacy format without mode (default to std)
    if (['bw', 'gray', 'color', 'fullcolor'].includes(normalized)) {
      return `${normalized}-std`;
    }

    console.warn(`[Melker] Invalid theme '${configTheme}'. Using default 'bw-std'`);
    return null;
  }

  private _getThemeByName(name: string): Theme {
    const theme = THEMES[name];
    if (!theme) {
      console.warn(`[Melker] Theme '${name}' not found. Using 'bw-std'`);
      return THEMES['bw-std'];
    }
    return theme;
  }

  getCurrentTheme(): Theme {
    return this._currentTheme;
  }

  setTheme(themeName: string): void {
    const newTheme = this._getThemeByName(themeName);
    this._currentTheme = newTheme;
  }

  getAvailableThemes(): string[] {
    return Object.keys(THEMES);
  }

  // Helper methods for common theme queries
  isColorSupported(): boolean {
    return this._currentTheme.colorSupport !== 'none';
  }

  getColorSupport(): 'none' | '16' | '256' | 'truecolor' {
    return this._currentTheme.colorSupport;
  }

  isDarkMode(): boolean {
    return this._currentTheme.mode === 'dark';
  }

  getThemeType(): ThemeType {
    return this._currentTheme.type;
  }

  // Get themed colors
  getColor(colorName: keyof ColorPalette): TerminalColor {
    return this._currentTheme.palette[colorName];
  }

  // Apply theme to style object
  applyTheme(style: Record<string, any>): Record<string, any> {
    const themedStyle = { ...style };

    // Map common style properties to theme colors
    if (!themedStyle.color && !themedStyle.backgroundColor) {
      themedStyle.color = this.getColor('textPrimary');
      themedStyle.backgroundColor = this.getColor('background');
    }

    // For gray themes, enforce grayscale by converting all colors
    if (this._currentTheme.type === 'gray') {
      const isDark = this._currentTheme.mode === 'dark';

      // Convert foreground color
      if (themedStyle.color) {
        themedStyle.color = colorToGray(themedStyle.color, isDark);
      }

      // Convert background color
      if (themedStyle.backgroundColor) {
        themedStyle.backgroundColor = colorToGray(themedStyle.backgroundColor, isDark);
      }

      // Convert border color
      if (themedStyle.borderColor) {
        themedStyle.borderColor = colorToGray(themedStyle.borderColor, isDark);
      }
    }

    return themedStyle;
  }
}

// Global theme manager instance
let globalThemeManager: ThemeManager | null = null;

export function getThemeManager(): ThemeManager {
  if (!globalThemeManager) {
    globalThemeManager = new ThemeManager();
  }
  return globalThemeManager;
}

// Convenience functions
export function getCurrentTheme(): Theme {
  return getThemeManager().getCurrentTheme();
}

export function getThemeColor(colorName: keyof ColorPalette): TerminalColor {
  return getThemeManager().getColor(colorName);
}

export function applyCurrentTheme(style: Record<string, any>): Record<string, any> {
  return getThemeManager().applyTheme(style);
}