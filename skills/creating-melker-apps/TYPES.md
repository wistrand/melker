# TypeScript Types Reference

Scripts in `.melker` files have access to these global types.

## `$melker` Context Object

```typescript
interface MelkerContext {
  // Element access
  getElementById(id: string): Element | undefined;

  // Rendering
  render(): void;           // Trigger re-render
  skipRender(): void;       // Skip auto-render after handler

  // App lifecycle
  exit(code?: number): void;

  // Dialogs
  alert(message: string): Promise<void>;
  confirm(message: string): Promise<boolean>;
  prompt(message: string, defaultValue?: string): Promise<string | null>;

  // Clipboard
  copyToClipboard(text: string): Promise<boolean>;

  // Logging
  logger: {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
  };

  // Configuration
  config: {
    getString(key: string, defaultValue?: string): string;
    getNumber(key: string, defaultValue?: number): number;
    getBoolean(key: string, defaultValue?: boolean): boolean;
  };

  // File info
  url: string;              // Source file URL
  dirname: string;          // Source directory path
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
