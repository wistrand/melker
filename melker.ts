// Main Melker library entry point

// Export all types
export * from './src/types.ts';

// Export element functions
export * from './src/element.ts';

// Export serialization functions
export * from './src/serialization.ts';

// Export document management
export * from './src/document.ts';

// Export buffer system and character width utilities
export * from './src/buffer.ts';
export * from './src/renderer.ts';
export * from './src/char-width.ts';

// Export resize handling system
export * from './src/resize.ts';

// Export high-level engine
export * from './src/engine.ts';

// Export debug server
export * from './src/debug-server.ts';

// Export headless mode
export * from './src/headless.ts';

// Export theme system
export * from './src/theme.ts';

// Export stylesheet system
export * from './src/stylesheet.ts';

// Export OAuth2 PKCE authentication
export * from './src/oauth.ts';

// Export state persistence
export {
  DEFAULT_PERSISTENCE_MAPPINGS,
  readState,
  hashState,
  getStateFilePath,
  saveToFile,
  loadFromFile,
  hashFilePath,
  debounce,
} from './src/state-persistence.ts';
export type {
  PersistenceMapping,
  PersistedState,
  StateFile,
} from './src/state-persistence.ts';
export {
  setPersistenceContext,
  getPersistenceContext,
} from './src/element.ts';
export type { PersistenceContext } from './src/element.ts';

// Export logging system
export * from './src/logging.ts';

// Export lint system
export {
  enableLint,
  isLintEnabled,
  validateElementProps,
  getWarnings,
  clearWarnings,
  reportWarnings,
  registerComponentSchema,
  getComponentSchema,
  getRegisteredComponents,
  BASE_PROPS_SCHEMA,
  BASE_STYLES_SCHEMA,
} from './src/lint.ts';
export type { LintWarning, ComponentSchema, PropSchema, PropType } from './src/lint.ts';

// Export event system
export {
  EventManager,
  getGlobalEventManager,
  setGlobalEventManager,
  isKeyEvent,
  isMouseEvent,
  isWheelEvent,
  isFocusEvent,
  isInputEvent,
  createKeyEvent,
  createMouseEvent,
  createWheelEvent,
  createFocusEvent,
  createInputEvent,
  createKeyPressEvent,
  createChangeEvent,
  type EventType,
  type MelkerEvent,
  type KeyEvent,
  type MouseEvent,
  type WheelEvent,
  type InputEvent,
  type KeyPressEvent,
  type ChangeEvent,
  type EventHandler,
  type EventRegistration,
} from './src/events.ts';
export * from './src/focus.ts';
export * from './src/input.ts';

// Export rendering engine
export * from './src/rendering.ts';

// Export sizing model
export * from './src/sizing.ts';

// Export layout engine (with specific exports to avoid conflicts)
export {
  LayoutEngine,
  globalLayoutEngine,
} from './src/layout.ts';
export type {
  LayoutNode as AdvancedLayoutNode,
  AdvancedLayoutProps,
  LayoutContext,
} from './src/layout.ts';

// Export components
export * from './src/components/mod.ts';

// Re-export commonly used functions for convenience
export {
  createElement,
  registerComponent,
} from './src/element.ts';

// Template literal system
export {
  melker,
} from './src/template.ts';

// Re-export commonly used component classes for convenience
export {
  InputElement,
  ButtonElement,
  TextElement,
  ContainerElement,
  DialogElement,
  CanvasElement,
  VideoElement,
  ListElement,
  LiElement,
} from './src/components/mod.ts';

export {
  elementToJson,
  elementFromJson,
} from './src/serialization.ts';

/**
 * Get the current terminal size
 * @returns Object with width and height in characters
 */
export function getTerminalSize(): { width: number; height: number } {
  try {
    if (typeof Deno !== 'undefined' && Deno.consoleSize) {
      const size = Deno.consoleSize();
      return { width: size.columns, height: size.rows };
    }
  } catch (error) {
    // Fallback if terminal size detection fails
  }

  // Default fallback size
  return {
    width: 80,
    height: 24,
  };
}

// Register built-in components
import { InputElement } from './src/components/input.ts';
import { TextareaElement } from './src/components/textarea.ts';
import { ButtonElement } from './src/components/button.ts';
import { RadioElement } from './src/components/radio.ts';
import { CheckboxElement } from './src/components/checkbox.ts';
import { TextElement } from './src/components/text.ts';
import { ContainerElement } from './src/components/container.ts';
import { DialogElement } from './src/components/dialog.ts';
import { MarkdownElement } from './src/components/markdown.ts';
import { CanvasElement } from './src/components/canvas.ts';
import { ImgElement } from './src/components/img.ts';
import { VideoElement } from './src/components/video.ts';
import { ListElement } from './src/components/list.ts';
import { LiElement } from './src/components/li.ts';
import { MenuItemElement } from './src/components/menu-item.ts';
import { MenuSeparatorElement } from './src/components/menu-separator.ts';
import { MenuElement } from './src/components/menu.ts';
import { MenuBarElement } from './src/components/menu-bar.ts';
import { ProgressElement } from './src/components/progress.ts';
import { registerComponent } from './src/element.ts';

// Auto-register core components when library is imported
registerComponent({
  type: 'input',
  componentClass: InputElement,
  defaultProps: {
    value: '',
    placeholder: '',
    readOnly: false,
    disabled: false,
    tabIndex: 0,
    cursorPosition: 0,
  },
  validate: (props) => InputElement.validate(props as any),
});

registerComponent({
  type: 'textarea',
  componentClass: TextareaElement,
  defaultProps: {
    value: '',
    placeholder: '',
    readOnly: false,
    disabled: false,
    tabIndex: 0,
    // rows: undefined - omit to allow expandable mode in scrollable containers
    cols: 40,
    wrap: 'soft',
  },
  validate: (props) => TextareaElement.validate(props as any),
});

registerComponent({
  type: 'button',
  componentClass: ButtonElement,
  defaultProps: {
    variant: 'default',
    disabled: false,
    tabIndex: 0,
  },
  validate: (props) => ButtonElement.validate(props as any),
});

registerComponent({
  type: 'text',
  componentClass: TextElement,
  defaultProps: {
    wrap: false,
    disabled: false,
  },
  validate: (props) => TextElement.validate(props as any),
});

registerComponent({
  type: 'container',
  componentClass: ContainerElement,
  defaultProps: {
    // Note: style defaults are handled by ContainerElement constructor
    // Don't add style here as it would override stylesheet styles
    scrollable: false,
    scrollX: 0,
    scrollY: 0,
  },
  validate: (props) => ContainerElement.validate(props as any),
});

registerComponent({
  type: 'dialog',
  componentClass: DialogElement,
  defaultProps: {
    modal: true,
    backdrop: true,
    disabled: false,
  },
  validate: (props) => DialogElement.validate(props as any),
});

registerComponent({
  type: 'radio',
  componentClass: RadioElement,
  defaultProps: {
    checked: false,
    disabled: false,
    tabIndex: 0,
  },
  validate: (props) => RadioElement.validate(props as any),
});

registerComponent({
  type: 'checkbox',
  componentClass: CheckboxElement,
  defaultProps: {
    checked: false,
    indeterminate: false,
    disabled: false,
    tabIndex: 0,
  },
  validate: (props) => CheckboxElement.validate(props as any),
});

registerComponent({
  type: 'markdown',
  componentClass: MarkdownElement,
  defaultProps: {
    wrap: true,
    disabled: false,
  },
  validate: (props) => MarkdownElement.validate(props as any),
});

registerComponent({
  type: 'canvas',
  componentClass: CanvasElement,
  defaultProps: {
    scale: 1,
    disabled: false,
  },
  validate: (props) => CanvasElement.validate(props as any),
});

registerComponent({
  type: 'img',
  componentClass: ImgElement,
  defaultProps: {
    width: 30,
    height: 15,
    disabled: false,
  },
});

registerComponent({
  type: 'video',
  componentClass: VideoElement,
  defaultProps: {
    scale: 1,
    autoplay: true,
    loop: false,
    fps: 24,
    disabled: false,
  },
  validate: (props) => VideoElement.validate(props as any),
});

registerComponent({
  type: 'progress',
  componentClass: ProgressElement,
  defaultProps: {
    width: 20,
    height: 1,
    value: 0,
    max: 100,
    min: 0,
    indeterminate: false,
    showValue: false,
    animationSpeed: 50,
    disabled: false,
  },
  validate: (props) => ProgressElement.validate(props as any),
});

registerComponent({
  type: 'list',
  componentClass: ListElement,
  defaultProps: {
    selectionMode: 'single',
    selectedItems: [],
    focusedItem: 0,
    scrollTop: 0,
    showSelectionMarkers: true,
  },
  validate: (props) => true, // ListElement doesn't have a validate method
});

registerComponent({
  type: 'li',
  componentClass: LiElement,
  defaultProps: {
    style: {
      display: 'block',
      width: '100%',
      paddingLeft: 2, // Default indentation
    },
    marker: '-', // Default list marker
    indent: 2,   // Default indentation level
    focused: false,
    selected: false,
    selectionMode: 'single',
  },
  validate: (props) => LiElement.validate(props as any),
});

registerComponent({
  type: 'menu-item',
  componentClass: MenuItemElement,
  defaultProps: {
    title: '',
    disabled: false,
    checked: false,
    separator: false,
    tabIndex: 0,
  },
  validate: (props) => MenuItemElement.validate(props as any),
});

registerComponent({
  type: 'menu-separator',
  componentClass: MenuSeparatorElement,
  defaultProps: {
    disabled: true,
  },
  validate: (props) => MenuSeparatorElement.validate(props as any),
});

registerComponent({
  type: 'menu',
  componentClass: MenuElement,
  defaultProps: {
    items: [],
    visible: false,
    position: 'bottom',
    autoClose: true,
    tabIndex: 0,
  },
  validate: (props) => MenuElement.validate(props as any),
});

registerComponent({
  type: 'menu-bar',
  componentClass: MenuBarElement,
  defaultProps: {
    menus: [],
    activated: false,
    tabIndex: 0,
  },
  validate: (props) => MenuBarElement.validate(props as any),
});


// Run main if this is the entry point
if (import.meta.main) {
  // Import main function from melker-main.ts
  import('./src/melker-main.ts').then(({ main }) => {
    return main();
  }).catch((error) => {
    console.error(`💥 Fatal error: ${error instanceof Error ? error.message : String(error)}`);
    Deno.exit(1);
  });
}