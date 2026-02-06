// Melker library entry point
// Import this for library usage: import { ... } from './mod.ts'

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

// Export server
export * from './src/server.ts';

// Export headless mode
export * from './src/headless.ts';

// Export stdout mode
export * from './src/stdout.ts';

// Export theme system
export * from './src/theme.ts';

// Export toast notifications
export * from './src/toast/mod.ts';

// Export tooltip system
export * from './src/tooltip/mod.ts';

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
  type CustomEvent,
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

// Template literal system
export {
  melker,
} from './src/template.ts';

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
  } catch (_error) {
    // Fallback if terminal size detection fails
  }

  // Default fallback size
  return {
    width: 80,
    height: 24,
  };
}

// Components are auto-registered when imported via 'export * from ./src/components/mod.ts' above
