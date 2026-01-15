# TypeScript Types Reference

Scripts in `.melker` files have access to these global types.

## `$melker` Context Object

```typescript
interface MelkerContext {
  // Source info
  url: string;              // Source file URL
  dirname: string;          // Source directory path

  // App exports (same as $app)
  exports: Record<string, unknown>;

  // DOM-like APIs
  getElementById(id: string): Element | null;
  focus(id: string): void;
  createElement(type: string, props?: Record<string, unknown>, ...children: unknown[]): Element;

  // Render control
  render(): void;           // Trigger re-render
  skipRender(): void;       // Skip auto-render after handler

  // App lifecycle
  exit(): Promise<void>;
  quit(): Promise<void>;    // Alias for exit()
  setTitle(title: string): void;

  // Dialogs
  alert(message: string): void;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | null>;

  // System integration
  copyToClipboard(text: string): Promise<boolean>;
  openBrowser(url: string): Promise<boolean>;  // Requires browser: true in policy

  // Engine access
  engine: MelkerEngine;     // Direct engine access (advanced)

  // Logging
  logger: MelkerLogger | null;
  logging: MelkerLogger | null;  // Alias for logger
  getLogger(name: string): MelkerLogger;

  // State persistence
  persistenceEnabled: boolean;
  stateFilePath: string | null;

  // OAuth (when configured via <oauth> tag)
  oauth: unknown;
  oauthConfig: unknown;

  // Dynamic imports
  melkerImport(specifier: string): Promise<unknown>;

  // AI tools
  registerAITool(tool: unknown): void;

  // Configuration
  config: MelkerConfig;
  cacheDir: string;         // App-specific cache directory (always exists)
}

interface MelkerLogger {
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string, ...args: unknown[]): void;
}
```

## Element Interface

```typescript
interface Element {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: Element[];

  // Value access (input, textarea, text, select, etc.)
  getValue(): string | number | boolean;
  setValue(value: string): void;

  // Focus
  focus(): void;
  blur(): void;

  // Dialog-specific
  show?(): void;
  hide?(): void;
}
```

## Event Objects

```typescript
// Input events (onInput, onChange)
interface InputEvent {
  type: 'input' | 'change';
  value: string;
  targetId: string;
}

// Select events (onSelect for combobox, select, autocomplete)
interface SelectEvent {
  type: 'select';
  value: string;
  label: string;
  targetId: string;
}

// Click events
interface ClickEvent {
  type: 'click';
  targetId: string;
  position: { x: number; y: number };
}

// Key events (onKeyPress)
interface KeyEvent {
  type: 'keypress';
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
}

// File browser events
interface FileSelectEvent {
  type: 'select';
  path: string;
  paths: string[];  // For multiple selection
  name: string;
  isDirectory: boolean;
}

// Canvas paint events
interface PaintEvent {
  type: 'paint';
  canvas: CanvasAPI;
}
```

## `$app` Namespace

All exported functions from `<script>` blocks are available via `$app`:

```typescript
// In script:
export function myFunction(arg: string): void { ... }
export async function fetchData(): Promise<void> { ... }

// In handlers:
// $app.myFunction('hello')
// await $app.fetchData()
```
