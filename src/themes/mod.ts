// Built-in theme CSS strings — embedded for reliable loading without runtime I/O.
// Source of truth: the .css files in this directory.
// Regenerate: deno task themes:generate

export const BUILTIN_THEME_CSS: Record<string, string> = {
  'bw-std': `/* Black & White Standard — maximum compatibility */
:root {
  --theme-type: bw;
  --theme-mode: std;
  --theme-color-support: none;

  --theme-primary: white;
  --theme-secondary: white;
  --theme-background: black;
  --theme-foreground: white;
  --theme-surface: black;
  --theme-border: white;

  --theme-success: white;
  --theme-warning: white;
  --theme-error: white;
  --theme-info: white;

  --theme-button-primary: black;
  --theme-button-secondary: white;
  --theme-button-background: white;
  --theme-input-background: black;
  --theme-input-foreground: white;
  --theme-input-border: white;

  --theme-focus-primary: black;
  --theme-focus-background: white;
  --theme-focus-border: black;

  --theme-text-primary: white;
  --theme-text-secondary: white;
  --theme-text-muted: white;

  --theme-header-background: black;
  --theme-header-foreground: white;
  --theme-sidebar-background: black;
  --theme-sidebar-foreground: white;
  --theme-modal-background: black;
  --theme-modal-foreground: white;

  --theme-scrollbar-thumb: white;
  --theme-scrollbar-track: gray;
}`,

  'bw-dark': `/* Black & White Dark — inverted BW for light terminals */
:root {
  --theme-type: bw;
  --theme-mode: dark;
  --theme-color-support: none;

  --theme-primary: black;
  --theme-secondary: black;
  --theme-background: white;
  --theme-foreground: black;
  --theme-surface: white;
  --theme-border: black;

  --theme-success: black;
  --theme-warning: black;
  --theme-error: black;
  --theme-info: black;

  --theme-button-primary: white;
  --theme-button-secondary: black;
  --theme-button-background: black;
  --theme-input-background: white;
  --theme-input-foreground: black;
  --theme-input-border: black;

  --theme-focus-primary: white;
  --theme-focus-background: black;
  --theme-focus-border: white;

  --theme-text-primary: black;
  --theme-text-secondary: black;
  --theme-text-muted: black;

  --theme-header-background: white;
  --theme-header-foreground: black;
  --theme-sidebar-background: white;
  --theme-sidebar-foreground: black;
  --theme-modal-background: white;
  --theme-modal-foreground: black;

  --theme-scrollbar-thumb: black;
  --theme-scrollbar-track: gray;
}`,

  'gray-std': `/* Grayscale Standard — light background with grays */
:root {
  --theme-type: gray;
  --theme-mode: std;
  --theme-color-support: 16;

  --theme-primary: black;
  --theme-secondary: gray;
  --theme-background: white;
  --theme-foreground: black;
  --theme-surface: gray;
  --theme-border: gray;

  --theme-success: black;
  --theme-warning: gray;
  --theme-error: black;
  --theme-info: gray;

  --theme-button-primary: white;
  --theme-button-secondary: gray;
  --theme-button-background: black;
  --theme-input-background: gray;
  --theme-input-foreground: black;
  --theme-input-border: gray;

  --theme-focus-primary: white;
  --theme-focus-background: black;
  --theme-focus-border: black;

  --theme-text-primary: black;
  --theme-text-secondary: gray;
  --theme-text-muted: gray;

  --theme-header-background: gray;
  --theme-header-foreground: black;
  --theme-sidebar-background: white;
  --theme-sidebar-foreground: gray;
  --theme-modal-background: gray;
  --theme-modal-foreground: black;

  --theme-scrollbar-thumb: black;
  --theme-scrollbar-track: gray;
}`,

  'gray-dark': `/* Grayscale Dark — dark background with grays */
:root {
  --theme-type: gray;
  --theme-mode: dark;
  --theme-color-support: 16;

  --theme-primary: white;
  --theme-secondary: gray;
  --theme-background: black;
  --theme-foreground: white;
  --theme-surface: gray;
  --theme-border: gray;

  --theme-success: white;
  --theme-warning: gray;
  --theme-error: white;
  --theme-info: gray;

  --theme-button-primary: black;
  --theme-button-secondary: gray;
  --theme-button-background: white;
  --theme-input-background: gray;
  --theme-input-foreground: white;
  --theme-input-border: gray;

  --theme-focus-primary: black;
  --theme-focus-background: white;
  --theme-focus-border: white;

  --theme-text-primary: white;
  --theme-text-secondary: gray;
  --theme-text-muted: gray;

  --theme-header-background: gray;
  --theme-header-foreground: white;
  --theme-sidebar-background: black;
  --theme-sidebar-foreground: gray;
  --theme-modal-background: gray;
  --theme-modal-foreground: white;

  --theme-scrollbar-thumb: white;
  --theme-scrollbar-track: gray;
}`,

  'color16-std': `/* Color16 Standard — 16 ANSI colors, light background */
:root {
  --theme-type: color16;
  --theme-mode: std;
  --theme-color-support: 16;

  --theme-primary: blue;
  --theme-secondary: cyan;
  --theme-background: white;
  --theme-foreground: black;
  --theme-surface: white;
  --theme-border: gray;

  --theme-success: lime;
  --theme-warning: yellow;
  --theme-error: red;
  --theme-info: cyan;

  --theme-button-primary: black;
  --theme-button-secondary: cyan;
  --theme-button-background: blue;
  --theme-input-background: #555555;
  --theme-input-foreground: white;
  --theme-input-border: cyan;

  --theme-focus-primary: black;
  --theme-focus-background: cyan;
  --theme-focus-border: gray;

  --theme-text-primary: black;
  --theme-text-secondary: gray;
  --theme-text-muted: gray;

  --theme-header-background: blue;
  --theme-header-foreground: black;
  --theme-sidebar-background: gray;
  --theme-sidebar-foreground: cyan;
  --theme-modal-background: blue;
  --theme-modal-foreground: black;

  --theme-scrollbar-thumb: blue;
  --theme-scrollbar-track: gray;
}`,

  'color16-dark': `/* Color16 Dark — 16 ANSI colors, dark background */
:root {
  --theme-type: color16;
  --theme-mode: dark;
  --theme-color-support: 16;

  --theme-primary: blue;
  --theme-secondary: cyan;
  --theme-background: black;
  --theme-foreground: white;
  --theme-surface: black;
  --theme-border: white;

  --theme-success: lime;
  --theme-warning: yellow;
  --theme-error: red;
  --theme-info: cyan;

  --theme-button-primary: white;
  --theme-button-secondary: cyan;
  --theme-button-background: blue;
  --theme-input-background: #555555;
  --theme-input-foreground: white;
  --theme-input-border: cyan;

  --theme-focus-primary: black;
  --theme-focus-background: cyan;
  --theme-focus-border: white;

  --theme-text-primary: white;
  --theme-text-secondary: white;
  --theme-text-muted: gray;

  --theme-header-background: blue;
  --theme-header-foreground: white;
  --theme-sidebar-background: gray;
  --theme-sidebar-foreground: cyan;
  --theme-modal-background: blue;
  --theme-modal-foreground: white;

  --theme-scrollbar-thumb: cyan;
  --theme-scrollbar-track: gray;
}`,

  'color-std': `/* Color Standard — 16 ANSI colors, light background */
:root {
  --theme-type: color;
  --theme-mode: std;
  --theme-color-support: 256;

  --theme-primary: #5555ff;
  --theme-secondary: #55ffff;
  --theme-background: white;
  --theme-foreground: black;
  --theme-surface: gray;
  --theme-border: gray;

  --theme-success: #55ff55;
  --theme-warning: #ffff55;
  --theme-error: #ff5555;
  --theme-info: #55ffff;

  --theme-button-primary: black;
  --theme-button-secondary: #55ffff;
  --theme-button-background: #5555ff;
  --theme-input-background: gray;
  --theme-input-foreground: black;
  --theme-input-border: #55ffff;

  --theme-focus-primary: #ffff55;
  --theme-focus-background: #5555ff;
  --theme-focus-border: #5555ff;

  --theme-text-primary: black;
  --theme-text-secondary: gray;
  --theme-text-muted: gray;

  --theme-header-background: #5555ff;
  --theme-header-foreground: black;
  --theme-sidebar-background: gray;
  --theme-sidebar-foreground: #55ffff;
  --theme-modal-background: #5555ff;
  --theme-modal-foreground: black;

  --theme-scrollbar-thumb: #5555ff;
  --theme-scrollbar-track: gray;
}`,

  'color-dark': `/* Color Dark — 16 ANSI colors, dark background */
:root {
  --theme-type: color;
  --theme-mode: dark;
  --theme-color-support: 256;

  --theme-primary: #5555ff;
  --theme-secondary: cyan;
  --theme-background: black;
  --theme-foreground: white;
  --theme-surface: gray;
  --theme-border: white;

  --theme-success: lime;
  --theme-warning: yellow;
  --theme-error: red;
  --theme-info: cyan;

  --theme-button-primary: white;
  --theme-button-secondary: cyan;
  --theme-button-background: blue;
  --theme-input-background: gray;
  --theme-input-foreground: white;
  --theme-input-border: cyan;

  --theme-focus-primary: yellow;
  --theme-focus-background: blue;
  --theme-focus-border: cyan;

  --theme-text-primary: white;
  --theme-text-secondary: white;
  --theme-text-muted: gray;

  --theme-header-background: blue;
  --theme-header-foreground: white;
  --theme-sidebar-background: gray;
  --theme-sidebar-foreground: cyan;
  --theme-modal-background: blue;
  --theme-modal-foreground: white;

  --theme-scrollbar-thumb: cyan;
  --theme-scrollbar-track: gray;
}`,

  'fullcolor-std': `/*
 * Melker Theme: Full Color Standard — truecolor, light background
 *
 * Copy this file as a starting point for custom themes.
 * See fullcolor-dark.css for format documentation.
 */
:root {
  --theme-type: fullcolor;
  --theme-mode: std;
  --theme-color-support: truecolor;

  --theme-primary: #60a5fa;
  --theme-secondary: #22d3ee;
  --theme-background: white;
  --theme-foreground: black;
  --theme-surface: #f3f4f6;
  --theme-border: #9ca3af;

  --theme-success: #34d399;
  --theme-warning: #fbbf24;
  --theme-error: #f87171;
  --theme-info: #60a5fa;

  --theme-button-primary: black;
  --theme-button-secondary: #22d3ee;
  --theme-button-background: #60a5fa;
  --theme-input-background: #f9fafb;
  --theme-input-foreground: #111827;
  --theme-input-border: #d1d5db;

  --theme-focus-primary: #f59e0b;
  --theme-focus-background: #3b82f6;
  --theme-focus-border: #3b82f6;

  --theme-text-primary: #111827;
  --theme-text-secondary: #374151;
  --theme-text-muted: #9ca3af;

  --theme-header-background: #3b82f6;
  --theme-header-foreground: #f9fafb;
  --theme-sidebar-background: #f3f4f6;
  --theme-sidebar-foreground: #374151;
  --theme-modal-background: #2563eb;
  --theme-modal-foreground: #f9fafb;

  --theme-scrollbar-thumb: #60a5fa;
  --theme-scrollbar-track: #e5e7eb;
}`,

  'fullcolor-dark': `/*
 * Melker Theme: Full Color Dark — truecolor, dark background
 *
 * Custom themes: copy this file, edit the colors, and load with:
 *   MELKER_THEME_FILE=./my-theme.css melker app.melker
 *   melker --theme-file ./my-theme.css app.melker
 *
 * Metadata (--theme-type, --theme-mode, --theme-color-support) controls
 * color capabilities. All 33 properties are required (3 metadata + 30 colors).
 * Values: CSS named colors (white, red, cyan) or hex (#3b82f6).
 */
:root {
  --theme-type: fullcolor;
  --theme-mode: dark;
  --theme-color-support: truecolor;

  --theme-primary: #3b82f6;
  --theme-secondary: #06b6d4;
  --theme-background: black;
  --theme-foreground: white;
  --theme-surface: #1f2937;
  --theme-border: #6b7280;

  --theme-success: #10b981;
  --theme-warning: #f59e0b;
  --theme-error: #ef4444;
  --theme-info: #3b82f6;

  --theme-button-primary: white;
  --theme-button-secondary: #06b6d4;
  --theme-button-background: #3b82f6;
  --theme-input-background: #111827;
  --theme-input-foreground: #f9fafb;
  --theme-input-border: #374151;

  --theme-focus-primary: #fbbf24;
  --theme-focus-background: #1e40af;
  --theme-focus-border: #60a5fa;

  --theme-text-primary: #f9fafb;
  --theme-text-secondary: #d1d5db;
  --theme-text-muted: #6b7280;

  --theme-header-background: #1e40af;
  --theme-header-foreground: #f9fafb;
  --theme-sidebar-background: #1f2937;
  --theme-sidebar-foreground: #d1d5db;
  --theme-modal-background: #1e3a8a;
  --theme-modal-foreground: #f9fafb;

  --theme-scrollbar-thumb: #3b82f6;
  --theme-scrollbar-track: #374151;
}`,
};
