// Theme system for Melker UI - Environment variable driven theming

import type { PackedRGBA } from './types.ts';
import { Env } from './env.ts';
import { MelkerConfig } from './config/mod.ts';
import { COLORS, packRGBA } from './components/color-utils.ts';

// Theme definitions
export type ThemeType = 'bw' | 'gray' | 'color' | 'fullcolor';
export type ThemeMode = 'std' | 'dark';

export interface ColorPalette {
  // Basic UI colors
  primary: PackedRGBA;
  secondary: PackedRGBA;
  background: PackedRGBA;
  foreground: PackedRGBA;
  surface: PackedRGBA;
  border: PackedRGBA;

  // Status colors
  success: PackedRGBA;
  warning: PackedRGBA;
  error: PackedRGBA;
  info: PackedRGBA;

  // Interactive element colors
  buttonPrimary: PackedRGBA;
  buttonSecondary: PackedRGBA;
  buttonBackground: PackedRGBA;
  inputBackground: PackedRGBA;
  inputForeground: PackedRGBA;
  inputBorder: PackedRGBA;

  // Focus states
  focusPrimary: PackedRGBA;
  focusBackground: PackedRGBA;

  // Content colors
  textPrimary: PackedRGBA;
  textSecondary: PackedRGBA;
  textMuted: PackedRGBA;

  // Component-specific colors
  headerBackground: PackedRGBA;
  headerForeground: PackedRGBA;
  sidebarBackground: PackedRGBA;
  sidebarForeground: PackedRGBA;
  modalBackground: PackedRGBA;
  modalForeground: PackedRGBA;

  // Scrollbar colors
  scrollbarThumb: PackedRGBA;
  scrollbarTrack: PackedRGBA;
}

export interface Theme {
  type: ThemeType;
  mode: ThemeMode;
  colorSupport: 'none' | '16' | '256' | 'truecolor';
  palette: ColorPalette;
}

// Black & White theme - maximum compatibility
const BW_STD_PALETTE: ColorPalette = {
  primary: COLORS.white,
  secondary: COLORS.white,
  background: COLORS.black,
  foreground: COLORS.white,
  surface: COLORS.black,
  border: COLORS.white,

  success: COLORS.white,
  warning: COLORS.white,
  error: COLORS.white,
  info: COLORS.white,

  buttonPrimary: COLORS.black,
  buttonSecondary: COLORS.white,
  buttonBackground: COLORS.white,
  inputBackground: COLORS.black,
  inputForeground: COLORS.white,
  inputBorder: COLORS.white,

  focusPrimary: COLORS.black,
  focusBackground: COLORS.white,

  textPrimary: COLORS.white,
  textSecondary: COLORS.white,
  textMuted: COLORS.white,

  headerBackground: COLORS.black,
  headerForeground: COLORS.white,
  sidebarBackground: COLORS.black,
  sidebarForeground: COLORS.white,
  modalBackground: COLORS.black,
  modalForeground: COLORS.white,

  scrollbarThumb: COLORS.white,
  scrollbarTrack: COLORS.brightBlack,
};

const BW_DARK_PALETTE: ColorPalette = {
  primary: COLORS.black,
  secondary: COLORS.black,
  background: COLORS.white,
  foreground: COLORS.black,
  surface: COLORS.white,
  border: COLORS.black,

  success: COLORS.black,
  warning: COLORS.black,
  error: COLORS.black,
  info: COLORS.black,

  buttonPrimary: COLORS.white,
  buttonSecondary: COLORS.black,
  buttonBackground: COLORS.black,
  inputBackground: COLORS.white,
  inputForeground: COLORS.black,
  inputBorder: COLORS.black,

  focusPrimary: COLORS.white,
  focusBackground: COLORS.black,

  textPrimary: COLORS.black,
  textSecondary: COLORS.black,
  textMuted: COLORS.black,

  headerBackground: COLORS.white,
  headerForeground: COLORS.black,
  sidebarBackground: COLORS.white,
  sidebarForeground: COLORS.black,
  modalBackground: COLORS.white,
  modalForeground: COLORS.black,

  scrollbarThumb: COLORS.black,
  scrollbarTrack: COLORS.gray,
};

// Grayscale theme - uses basic terminal grays
// Gray std is now the inverse (previously dark)
const GRAY_STD_PALETTE: ColorPalette = {
  primary: COLORS.black,
  secondary: COLORS.gray,
  background: COLORS.white,
  foreground: COLORS.black,
  surface: COLORS.gray,
  border: COLORS.gray,

  success: COLORS.black,
  warning: COLORS.gray,
  error: COLORS.black,
  info: COLORS.gray,

  buttonPrimary: COLORS.white,
  buttonSecondary: COLORS.gray,
  buttonBackground: COLORS.black,
  inputBackground: COLORS.gray,
  inputForeground: COLORS.black,
  inputBorder: COLORS.gray,

  focusPrimary: COLORS.white,
  focusBackground: COLORS.black,

  textPrimary: COLORS.black,
  textSecondary: COLORS.gray,
  textMuted: COLORS.gray,

  headerBackground: COLORS.gray,
  headerForeground: COLORS.black,
  sidebarBackground: COLORS.white,
  sidebarForeground: COLORS.gray,
  modalBackground: COLORS.gray,
  modalForeground: COLORS.black,

  scrollbarThumb: COLORS.black,
  scrollbarTrack: COLORS.gray,
};

// Gray dark is now the original std palette
const GRAY_DARK_PALETTE: ColorPalette = {
  primary: COLORS.white,
  secondary: COLORS.gray,
  background: COLORS.black,
  foreground: COLORS.white,
  surface: COLORS.brightBlack,
  border: COLORS.gray,

  success: COLORS.white,
  warning: COLORS.gray,
  error: COLORS.white,
  info: COLORS.gray,

  buttonPrimary: COLORS.black,
  buttonSecondary: COLORS.gray,
  buttonBackground: COLORS.white,
  inputBackground: COLORS.brightBlack,
  inputForeground: COLORS.white,
  inputBorder: COLORS.gray,

  focusPrimary: COLORS.black,
  focusBackground: COLORS.white,

  textPrimary: COLORS.white,
  textSecondary: COLORS.gray,
  textMuted: COLORS.brightBlack,

  headerBackground: COLORS.brightBlack,
  headerForeground: COLORS.white,
  sidebarBackground: COLORS.black,
  sidebarForeground: COLORS.gray,
  modalBackground: COLORS.brightBlack,
  modalForeground: COLORS.white,

  scrollbarThumb: COLORS.white,
  scrollbarTrack: COLORS.brightBlack,
};

// Color theme - uses 16 basic ANSI colors
const COLOR_STD_PALETTE: ColorPalette = {
  primary: COLORS.brightBlue,
  secondary: COLORS.brightCyan,
  background: COLORS.white,
  foreground: COLORS.black,
  surface: COLORS.gray,
  border: COLORS.brightBlack,

  success: COLORS.brightGreen,
  warning: COLORS.brightYellow,
  error: COLORS.brightRed,
  info: COLORS.brightCyan,

  buttonPrimary: COLORS.black,
  buttonSecondary: COLORS.brightCyan,
  buttonBackground: COLORS.brightBlue,
  inputBackground: COLORS.gray,
  inputForeground: COLORS.black,
  inputBorder: COLORS.brightCyan,

  focusPrimary: COLORS.brightYellow,
  focusBackground: COLORS.brightBlue,

  textPrimary: COLORS.black,
  textSecondary: COLORS.brightBlack,
  textMuted: COLORS.gray,

  headerBackground: COLORS.brightBlue,
  headerForeground: COLORS.black,
  sidebarBackground: COLORS.gray,
  sidebarForeground: COLORS.brightCyan,
  modalBackground: COLORS.brightBlue,
  modalForeground: COLORS.black,

  scrollbarThumb: COLORS.brightBlue,
  scrollbarTrack: COLORS.gray,
};

const COLOR_DARK_PALETTE: ColorPalette = {
  primary: COLORS.brightBlue,
  secondary: COLORS.cyan,
  background: COLORS.black,
  foreground: COLORS.white,
  surface: COLORS.brightBlack,
  border: COLORS.white,

  success: COLORS.green,
  warning: COLORS.yellow,
  error: COLORS.red,
  info: COLORS.cyan,

  buttonPrimary: COLORS.white,
  buttonSecondary: COLORS.cyan,
  buttonBackground: COLORS.blue,
  inputBackground: COLORS.brightBlack,
  inputForeground: COLORS.white,
  inputBorder: COLORS.cyan,

  focusPrimary: COLORS.yellow,
  focusBackground: COLORS.blue,

  textPrimary: COLORS.brightWhite,
  textSecondary: COLORS.white,
  textMuted: COLORS.gray,

  headerBackground: COLORS.blue,
  headerForeground: COLORS.white,
  sidebarBackground: COLORS.brightBlack,
  sidebarForeground: COLORS.cyan,
  modalBackground: COLORS.blue,
  modalForeground: COLORS.white,

  scrollbarThumb: COLORS.cyan,
  scrollbarTrack: COLORS.brightBlack,
};

// Full color theme - uses 256 colors and true color
// Colors stored as packed RGBA (0xRRGGBBAA)
const FULLCOLOR_STD_PALETTE: ColorPalette = {
  primary: 0x60a5faFF,      // Blue-400
  secondary: 0x22d3eeFF,    // Cyan-400
  background: 0xFFFFFFFF,   // True white
  foreground: 0x000000FF,   // True black
  surface: 0xf3f4f6FF,      // Gray-100
  border: 0x9ca3afFF,       // Gray-400

  success: 0x34d399FF,      // Emerald-400
  warning: 0xfbbf24FF,      // Amber-400
  error: 0xf87171FF,        // Red-400
  info: 0x60a5faFF,         // Blue-400

  buttonPrimary: 0x000000FF,
  buttonSecondary: 0x22d3eeFF,
  buttonBackground: 0x60a5faFF,
  inputBackground: 0xf9fafbFF,  // Gray-50
  inputForeground: 0x111827FF,  // Gray-900
  inputBorder: 0xd1d5dbFF,      // Gray-300

  focusPrimary: 0xf59e0bFF,     // Amber-500
  focusBackground: 0x3b82f6FF,  // Blue-500

  textPrimary: 0x111827FF,      // Gray-900
  textSecondary: 0x374151FF,    // Gray-700
  textMuted: 0x9ca3afFF,        // Gray-400

  headerBackground: 0x3b82f6FF, // Blue-500
  headerForeground: 0xf9fafbFF, // Gray-50
  sidebarBackground: 0xf3f4f6FF, // Gray-100
  sidebarForeground: 0x374151FF, // Gray-700
  modalBackground: 0x2563ebFF,   // Blue-600
  modalForeground: 0xf9fafbFF,   // Gray-50

  scrollbarThumb: 0x60a5faFF,    // Blue-400
  scrollbarTrack: 0xe5e7ebFF,    // Gray-200
};

const FULLCOLOR_DARK_PALETTE: ColorPalette = {
  primary: 0x3b82f6FF,      // Blue-500
  secondary: 0x06b6d4FF,    // Cyan-500
  background: 0x000000FF,   // True black
  foreground: 0xFFFFFFFF,   // True white
  surface: 0x1f2937FF,      // Gray-800
  border: 0x6b7280FF,       // Gray-500

  success: 0x10b981FF,      // Emerald-500
  warning: 0xf59e0bFF,      // Amber-500
  error: 0xef4444FF,        // Red-500
  info: 0x3b82f6FF,         // Blue-500

  buttonPrimary: 0xFFFFFFFF,
  buttonSecondary: 0x06b6d4FF,
  buttonBackground: 0x3b82f6FF,
  inputBackground: 0x111827FF,  // Gray-900
  inputForeground: 0xf9fafbFF,  // Gray-50
  inputBorder: 0x374151FF,      // Gray-700

  focusPrimary: 0xfbbf24FF,     // Amber-400
  focusBackground: 0x1e40afFF,  // Blue-800

  textPrimary: 0xf9fafbFF,      // Gray-50
  textSecondary: 0xd1d5dbFF,    // Gray-300
  textMuted: 0x6b7280FF,        // Gray-500

  headerBackground: 0x1e40afFF, // Blue-800
  headerForeground: 0xf9fafbFF, // Gray-50
  sidebarBackground: 0x1f2937FF, // Gray-800
  sidebarForeground: 0xd1d5dbFF, // Gray-300
  modalBackground: 0x1e3a8aFF,   // Blue-900
  modalForeground: 0xf9fafbFF,   // Gray-50

  scrollbarThumb: 0x3b82f6FF,    // Blue-500
  scrollbarTrack: 0x374151FF,    // Gray-700
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
// Takes packed RGBA and returns packed RGBA grayscale equivalent
export function colorToGray(color: PackedRGBA, isDark: boolean): PackedRGBA {
  // Extract RGB from packed color
  const r = (color >> 24) & 0xFF;
  const g = (color >> 16) & 0xFF;
  const b = (color >> 8) & 0xFF;

  // Calculate luminance (perceived brightness)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

  // Map to grayscale based on luminance
  if (luminance < 0.25) {
    return COLORS.black;
  } else if (luminance < 0.5) {
    return COLORS.brightBlack;
  } else if (luminance < 0.75) {
    return COLORS.gray;
  } else {
    return COLORS.white;
  }
}

/**
 * Convert a color to low-contrast monochrome for modal backdrop effect.
 * This desaturates the color and reduces contrast, making it appear "inactive".
 * Used when modal=true, backdrop=false to visually indicate blocked background.
 */
export function colorToLowContrast(color: PackedRGBA, isDark: boolean): PackedRGBA {
  // Extract RGB from packed color
  const r = (color >> 24) & 0xFF;
  const g = (color >> 16) & 0xFF;
  const b = (color >> 8) & 0xFF;

  // Convert to grayscale using luminance
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b);

  // Reduce contrast by pulling toward middle gray
  const middleGray = isDark ? 80 : 180;
  const contrastFactor = 0.4; // How much to reduce contrast (0 = full gray, 1 = original)
  const result = Math.round(middleGray + (gray - middleGray) * contrastFactor);

  // Clamp to valid range
  const clamped = Math.max(0, Math.min(255, result));

  // Return as packed RGBA (grayscale has r=g=b)
  return packRGBA(clamped, clamped, clamped, 255);
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
  getColor(colorName: keyof ColorPalette): PackedRGBA {
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

export function getThemeColor(colorName: keyof ColorPalette): PackedRGBA {
  return getThemeManager().getColor(colorName);
}

export function applyCurrentTheme(style: Record<string, any>): Record<string, any> {
  return getThemeManager().applyTheme(style);
}