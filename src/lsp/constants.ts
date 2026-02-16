// Shared constants for LSP modules

// Theme CSS variable names available for :root overrides (29 palette keys)
export const THEME_VAR_NAMES = [
  '--theme-primary', '--theme-secondary', '--theme-background', '--theme-foreground',
  '--theme-surface', '--theme-border',
  '--theme-success', '--theme-warning', '--theme-error', '--theme-info',
  '--theme-button-primary', '--theme-button-secondary', '--theme-button-background',
  '--theme-input-background', '--theme-input-foreground', '--theme-input-border',
  '--theme-focus-primary', '--theme-focus-background',
  '--theme-text-primary', '--theme-text-secondary', '--theme-text-muted',
  '--theme-header-background', '--theme-header-foreground',
  '--theme-sidebar-background', '--theme-sidebar-foreground',
  '--theme-modal-background', '--theme-modal-foreground',
  '--theme-scrollbar-thumb', '--theme-scrollbar-track',
];

// Named colors supported by Melker's cssToRgba()
export const NAMED_COLORS = [
  'black', 'white', 'red', 'green', 'blue', 'yellow',
  'cyan', 'magenta', 'orange', 'purple', 'pink', 'lime',
  'gray', 'grey', 'transparent',
];

// Color format snippet completions
export const COLOR_FORMAT_SNIPPETS: Array<{ label: string; insert: string; detail: string }> = [
  { label: '#rrggbb',          insert: '#${1:000000}',                       detail: 'Hex color' },
  { label: '#rgb',             insert: '#${1:000}',                          detail: 'Hex color (shorthand)' },
  { label: '#rrggbbaa',        insert: '#${1:000000}${2:ff}',                detail: 'Hex color with alpha' },
  { label: 'rgb(r, g, b)',     insert: 'rgb(${1:0}, ${2:0}, ${3:0})',        detail: 'RGB color (0-255)' },
  { label: 'rgba(r, g, b, a)', insert: 'rgba(${1:0}, ${2:0}, ${3:0}, ${4:1})', detail: 'RGBA color with alpha (0-1)' },
  { label: 'hsl(h, s%, l%)',   insert: 'hsl(${1:0}, ${2:50}%, ${3:50}%)',    detail: 'HSL color' },
  { label: 'hsla(h, s%, l%, a)', insert: 'hsla(${1:0}, ${2:50}%, ${3:50}%, ${4:1})', detail: 'HSLA color with alpha' },
  { label: 'oklch(L C H)',     insert: 'oklch(${1:0.5} ${2:0.1} ${3:180})',  detail: 'OKLCH perceptual color' },
  { label: 'oklab(L a b)',     insert: 'oklab(${1:0.5} ${2:0} ${3:0})',      detail: 'OKLAB perceptual color' },
];

// Policy permission types
export const POLICY_PERMISSION_TYPES: Record<string, 'boolean' | 'string[]' | 'boolean | string[]'> = {
  all: 'boolean',
  read: 'string[]',
  write: 'string[]',
  net: 'string[]',
  run: 'string[]',
  env: 'string[]',
  ffi: 'string[]',
  sys: 'string[]',
  ai: 'boolean | string[]',
  clipboard: 'boolean',
  keyring: 'boolean',
  browser: 'boolean',
  shader: 'boolean',
};

// Valid policy permission keys
export const VALID_POLICY_PERMISSIONS = new Set(Object.keys(POLICY_PERMISSION_TYPES));

// Policy top-level key types
export const POLICY_KEY_TYPES: Record<string, string> = {
  name: 'string',
  version: 'string',
  description: 'string',
  comment: 'string',
  permissions: 'object',
  config: 'object',
  configSchema: 'object',
};

// Valid top-level policy keys
export const VALID_POLICY_KEYS = new Set(Object.keys(POLICY_KEY_TYPES));

// Event handler property names that contain TypeScript code
export const EVENT_HANDLER_PROPS = new Set([
  'onClick', 'onKeyPress', 'onFocus', 'onBlur', 'onChange', 'onInput',
  'onMouseDown', 'onMouseUp', 'onMouseMove', 'onScroll',
  'onLogin', 'onLogout', 'onFail', // oauth handlers
  'onPlay', 'onPause', 'onError', 'onEnd', 'onFrame', // video handlers
]);

// Color property names for color-related completions and extraction
export const COLOR_PROPERTY_NAMES = new Set([
  'color', 'backgroundColor', 'borderColor',
  'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'connectorColor', 'background', 'foreground', 'dividerColor',
]);

// Schemas for special melker tags
export const SPECIAL_TAG_SCHEMAS: Record<string, Record<string, boolean>> = {
  'melker': {},
  'script': { type: true, src: true },
  'style': {},
  'title': {},
  'oauth': {
    wellknown: true,
    'client-id': true,
    'redirect-uri': true,
    scopes: true,
    scope: true,
    audience: true,
    'auto-login': true,
    'debug-server': true,
    onLogin: true,
    onLogout: true,
    onFail: true,
  },
  'policy': {
    src: true,
  },
  'help': {
    src: true,
  },
};

// Special tags with their attributes and descriptions (for completions)
export const SPECIAL_TAGS: Record<string, { description: string; attrs: Record<string, string> }> = {
  'melker': {
    description: 'Root wrapper element for .melker files',
    attrs: {},
  },
  'script': {
    description: 'TypeScript/JavaScript code block',
    attrs: {
      'type': 'Script type (e.g., "typescript")',
      'src': 'External script file path',
    },
  },
  'style': {
    description: 'CSS stylesheet block',
    attrs: {},
  },
  'title': {
    description: 'Application title',
    attrs: {},
  },
  'oauth': {
    description: 'OAuth2 PKCE authentication configuration',
    attrs: {
      'wellknown': 'OAuth well-known configuration URL (required)',
      'client-id': 'OAuth client ID',
      'redirect-uri': 'OAuth redirect URI',
      'scopes': 'OAuth scopes (space-separated)',
      'scope': 'OAuth scopes (alias for scopes)',
      'audience': 'OAuth audience',
      'auto-login': 'Automatically trigger login on load',
      'debug-server': 'Enable debug server for OAuth flow',
      'onLogin': 'Handler called after successful login',
      'onLogout': 'Handler called after logout',
      'onFail': 'Handler called on authentication failure',
    },
  },
  'policy': {
    description: 'Permission policy declaration for sandboxed execution',
    attrs: {
      'src': 'External policy JSON file path',
    },
  },
  'help': {
    description: 'Help content for the application (markdown)',
    attrs: {
      'src': 'External help file path',
    },
  },
};
