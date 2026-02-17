// Theme system for Melker UI - Environment variable driven theming

import type { PackedRGBA } from './types.ts';
import { Env } from './env.ts';
import { MelkerConfig } from './config/mod.ts';
import { COLORS, cssToRgba, packRGBA } from './components/color-utils.ts';
import { extractVariableDeclarations } from './stylesheet.ts';
import { getLogger } from './logging.ts';

const logger = getLogger('Theme');

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
  focusBorder: PackedRGBA;

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
  source?: string;  // CSS file path (e.g. 'fullcolor-dark' or 'examples/themes/nord.css')
}

// All 30 ColorPalette keys in definition order
const PALETTE_KEYS: (keyof ColorPalette)[] = [
  'primary', 'secondary', 'background', 'foreground', 'surface', 'border',
  'success', 'warning', 'error', 'info',
  'buttonPrimary', 'buttonSecondary', 'buttonBackground',
  'inputBackground', 'inputForeground', 'inputBorder',
  'focusPrimary', 'focusBackground', 'focusBorder',
  'textPrimary', 'textSecondary', 'textMuted',
  'headerBackground', 'headerForeground',
  'sidebarBackground', 'sidebarForeground',
  'modalBackground', 'modalForeground',
  'scrollbarThumb', 'scrollbarTrack',
];

// camelCase → kebab-case: "inputBackground" → "input-background"
function camelToKebab(s: string): string {
  return s.replace(/[A-Z]/g, (ch) => '-' + ch.toLowerCase());
}

const FALLBACK_COLOR: PackedRGBA = 0xFF00FFFF; // magenta — visible mistake

// Minimal BW-dark fallback for when initThemes() hasn't been called (tests, library)
// Uses packRGBA() to match the signed 32-bit representation that cssToRgba() produces
const FALLBACK_THEME: Theme = {
  type: 'bw', mode: 'dark', colorSupport: 'none',
  palette: Object.fromEntries(PALETTE_KEYS.map(k => {
    const isDark = k.toLowerCase().includes('background') || k.toLowerCase().includes('track');
    return [k, isDark ? packRGBA(0, 0, 0, 255) : packRGBA(255, 255, 255, 255)];
  })) as unknown as ColorPalette,
};

/**
 * Build a Theme from CSS text containing :root { --*: value } declarations.
 * Parses metadata (--theme-type, --theme-mode, --theme-color-support) and
 * all 30 ColorPalette fields from CSS custom properties.
 */
export function buildThemeFromCSS(css: string, sourcePath?: string): Theme {
  const decls = extractVariableDeclarations(css);
  const vars = new Map<string, string>();
  for (const d of decls) {
    vars.set(d.name, d.value);
  }

  // Extract metadata
  const type = (vars.get('--theme-type') || 'fullcolor') as ThemeType;
  const mode = (vars.get('--theme-mode') || 'dark') as ThemeMode;
  const colorSupport = (vars.get('--theme-color-support') || 'truecolor') as Theme['colorSupport'];

  // Build palette
  const palette = {} as ColorPalette;
  for (const key of PALETTE_KEYS) {
    const cssName = `--${camelToKebab(key)}`;
    const value = vars.get(cssName);
    if (value === undefined) {
      const src = sourcePath ? ` (${sourcePath})` : '';
      logger.warn(`Theme CSS${src}: missing property ${cssName}`);
      palette[key] = FALLBACK_COLOR;
    } else {
      palette[key] = cssToRgba(value.trim());
    }
  }

  return { type, mode, colorSupport, palette, source: sourcePath };
}

// Built-in theme names
const BUILTIN_THEME_NAMES = [
  'bw-std', 'bw-dark', 'gray-std', 'gray-dark',
  'color-std', 'color-dark', 'fullcolor-std', 'fullcolor-dark',
] as const;

// Theme registry — populated by initThemes() before first use
let THEMES: Record<string, Theme> = {};

/**
 * Load all built-in themes from CSS files in themes/ directory.
 * Uses fetch() with import.meta.url for portability.
 */
async function loadBuiltinThemes(): Promise<Record<string, Theme>> {
  const themes: Record<string, Theme> = {};
  for (const name of BUILTIN_THEME_NAMES) {
    const url = new URL(`./themes/${name}.css`, import.meta.url);
    logger.debug(`Loading theme CSS: ${url}`);
    try {
      const css = await (await fetch(url)).text();
      themes[name] = buildThemeFromCSS(css, name);
      logger.debug(`Loaded theme '${name}': type=${themes[name].type}, mode=${themes[name].mode}`);
    } catch (e) {
      logger.warn(`Failed to load built-in theme '${name}' from ${url}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return themes;
}

/**
 * Load a custom theme CSS file from the given path.
 * Returns the Theme or null on failure.
 */
async function loadCustomTheme(path: string): Promise<Theme | null> {
  try {
    const resolved = path.startsWith('file://') ? path
      : path.startsWith('/') ? `file://${path}`
      : `file://${Deno.cwd()}/${path}`;
    const css = await (await fetch(resolved)).text();
    return buildThemeFromCSS(css, path);
  } catch (e) {
    logger.warn(`Failed to load custom theme '${path}': ${e instanceof Error ? e.message : e}`);
    return null;
  }
}

/**
 * Initialize the theme system by loading built-in CSS theme files
 * and an optional custom theme from config.
 * Must be called (and awaited) before any theme access.
 * Safe to call multiple times — no-ops after first successful init.
 */
export async function initThemes(): Promise<void> {
  if (Object.keys(THEMES).length > 0) {
    logger.debug('initThemes: already initialized');
    return;
  }
  logger.debug('initThemes: loading built-in themes...');
  THEMES = await loadBuiltinThemes();
  globalThemeManager = null; // Reset so next access picks up loaded themes
  logger.info(`initThemes: loaded ${Object.keys(THEMES).length} themes`);

  // Load custom theme file if configured
  const config = MelkerConfig.get();
  const themeFile = config.themeFile;
  const themeValue = config.theme;

  logger.debug(`initThemes: themeFile=${themeFile}, theme=${themeValue}`);

  // theme.file config or theme value ending in .css
  const customPath = themeFile || (themeValue?.endsWith('.css') ? themeValue : undefined);
  if (customPath) {
    logger.debug(`initThemes: loading custom theme from '${customPath}'`);
    const custom = await loadCustomTheme(customPath);
    if (custom) {
      THEMES['custom'] = custom;
      logger.info(`initThemes: loaded custom theme (type=${custom.type}, mode=${custom.mode})`);
    }
  }
}

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

  // Basic color support (xterm, etc.)
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
  private _colorOverrides: Partial<Record<keyof ColorPalette, PackedRGBA>> = {};

  constructor() {
    this._envTheme = this._parseThemeFromEnv();
    // Default to auto-detection when no theme is specified
    const themeName = this._envTheme || detectTheme();
    logger.debug(`ThemeManager: selected theme '${themeName}'`);
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
    const config = MelkerConfig.get();

    // Custom theme file takes priority
    if (config.themeFile || config.theme?.endsWith('.css')) {
      if (THEMES['custom']) return 'custom';
    }

    const configTheme = config.theme;
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

    logger.warn(`Invalid theme '${configTheme}'. Using default 'bw-std'`);
    return null;
  }

  private _getThemeByName(name: string): Theme {
    if (Object.keys(THEMES).length === 0) {
      logger.debug('Theme: initThemes() not yet called, using fallback');
      return FALLBACK_THEME;
    }
    const theme = THEMES[name];
    if (!theme) {
      logger.warn(`Theme '${name}' not found. Using 'bw-std'`);
      return THEMES['bw-std'] ?? FALLBACK_THEME;
    }
    return theme;
  }

  getCurrentTheme(): Theme {
    return this._currentTheme;
  }

  getCurrentThemeName(): string {
    return this._envTheme || `${this._currentTheme.type}-${this._currentTheme.mode}`;
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

  // Get themed colors (CSS variable overrides take priority over palette)
  getColor(colorName: keyof ColorPalette): PackedRGBA {
    return this._colorOverrides[colorName] ?? this._currentTheme.palette[colorName];
  }

  setColorOverrides(overrides: Partial<Record<keyof ColorPalette, PackedRGBA>>): void {
    this._colorOverrides = overrides;
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