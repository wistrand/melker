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

  // Toast notifications (non-modal)
  // Duplicate messages (same text+type) reset timer and show count: "Message (2)"
  toast: {
    show(message: string, options?: ToastOptions): string;
    dismiss(id: string): void;
    dismissAll(): void;
    setPosition(position: 'top' | 'bottom'): void;
  };

  // System integration
  copyToClipboard(text: string): Promise<boolean>;  // Requires clipboard: true (auto-policy default)
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

interface ToastOptions {
  type?: 'info' | 'success' | 'warning' | 'error';
  duration?: number;        // Auto-dismiss after ms (default: 5000)
  closable?: boolean;       // Show close button (default: true)
  bell?: boolean;           // Ring terminal bell (default: false, auto for errors if config.bell)
  action?: { label: string; onClick: () => void };
}
```

## Element Interface

```typescript
interface Element {
  id: string;
  type: string;
  props: Record<string, unknown>;
  children?: Element[];

  // Value access - available on most form components
  getValue(): string | number | boolean | undefined;
  setValue(value: string | number | boolean): void;

  // Focus
  focus(): void;
  blur(): void;

  // Dialog-specific
  show?(): void;
  hide?(): void;

  // Image/Canvas-specific (img, canvas, video)
  setSrc?(url: string): Promise<void>;
  loadImage?(url: string): Promise<void>;
  clearImage?(): void;
}
```

**getValue()/setValue() by component type:**

| Component | getValue() returns | setValue() accepts |
|-----------|-------------------|-------------------|
| `input` | string | string |
| `textarea` | string | string |
| `checkbox` | boolean | boolean |
| `radio` | boolean | boolean |
| `slider` | number | number |
| `select` | string \| undefined | string |
| `combobox` | string \| undefined | string (also updates input display) |
| `autocomplete` | string \| undefined | string (also updates input display) |
| `command-palette` | string \| undefined | string (also updates input display) |
| `text` | string | string |
| `segment-display` | string | string |

**Image methods (img, canvas, video):**

| Method | Description |
|--------|-------------|
| `setSrc(url)` | Load image immediately (async, last call wins) |
| `loadImage(url)` | Same as setSrc (low-level) |
| `clearImage()` | Clear the loaded image |

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

// Shader function signature
type ShaderFunction = (
  x: number,
  y: number,
  time: number,
  resolution: { width: number; height: number; pixelAspect: number },
  source: ShaderSource | undefined,
  utils: ShaderUtils
) => [number, number, number] | [number, number, number, number];

interface ShaderSource {
  getPixel(x: number, y: number): [number, number, number, number];
  width: number;
  height: number;
}
```

## ShaderUtils Interface

Built-in utility functions available in `onShader` callbacks:

```typescript
interface ShaderUtils {
  /** 2D Simplex noise - returns value in range [-1, 1] */
  noise2d(x: number, y: number): number;
  /** 2D Simplex noise (alias for noise2d) - returns value in range [-1, 1] */
  simplex2d(x: number, y: number): number;
  /** 3D Simplex noise - returns value in range [-1, 1] */
  simplex3d(x: number, y: number, z: number): number;
  /** 2D Classic Perlin noise (1985) - returns value in range [-1, 1] */
  perlin2d(x: number, y: number): number;
  /** 3D Classic Perlin noise (1985) - returns value in range [-1, 1] */
  perlin3d(x: number, y: number, z: number): number;
  /** Fractal Brownian Motion - layered noise, returns value roughly in range [-1, 1] */
  fbm(x: number, y: number, octaves?: number): number;
  /** 3D Fractal Brownian Motion - layered 3D noise, returns value roughly in range [-1, 1] */
  fbm3d(x: number, y: number, z: number, octaves?: number): number;
  /** Inigo Quilez palette: a + b * cos(2π * (c * t + d)) - returns [r, g, b] in range [0, 255] */
  palette(
    t: number,
    a: [number, number, number],
    b: [number, number, number],
    c: [number, number, number],
    d: [number, number, number]
  ): [number, number, number];
  /** Hermite interpolation: 0 when x <= edge0, 1 when x >= edge1, smooth curve between */
  smoothstep(edge0: number, edge1: number, x: number): number;
  /** Linear interpolation: a + (b - a) * t */
  mix(a: number, b: number, t: number): number;
  /** Fractional part: x - floor(x) */
  fract(x: number): number;
}
```

## Canvas Tooltip Context

```typescript
/** Tooltip context for canvas elements (received in onTooltip handler) */
interface CanvasTooltipContext {
  type: 'canvas';
  pixelX: number;      // Pixel X in canvas buffer coordinates
  pixelY: number;      // Pixel Y in canvas buffer coordinates
  color: number;       // Packed RGBA color at pixel position (0 = transparent)
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
