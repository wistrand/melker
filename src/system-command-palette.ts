// System Command Palette - Default commands available in all .melker apps
import { Element } from './types.ts';
import { melker } from './template.ts';

/**
 * Handlers for system commands
 */
export interface SystemHandlers {
  exit?: () => void;
  aiDialog?: () => void;
  devTools?: () => void;
  performance?: () => void;
}


/**
 * Create a System group element containing system commands
 */
export function createSystemGroup(handlers: SystemHandlers): Element {
  return melker`<group label="System">
    <option value="exit" label="Exit" shortcut="Ctrl+C" onSelect=${handlers.exit} />
    <option value="ai-dialog" label="AI Assistant" shortcut="F8" onSelect=${handlers.aiDialog} />
    <option value="dev-tools" label="Dev Tools" shortcut="F12" onSelect=${handlers.devTools} />
    <option value="performance" label="Performance Dialog" shortcut="F6" onSelect=${handlers.performance} />
  </group>`;
}

/**
 * Create the default system command palette
 * Used when a .melker file doesn't include its own command palette
 */
export function createDefaultCommandPalette(handlers: SystemHandlers): Element {
  const group = createSystemGroup(handlers);
  return melker`
    <command-palette
      id="__system-command-palette"
      title="Command Palette"
      placeholder="Type a command..."
      open=${false}
    >${group}</command-palette>
  `;
}

/**
 * Marker value for including system group in custom command palettes
 * Usage in .melker: <group system="true" />
 */
export const SYSTEM_GROUP_MARKER = '__melker_system_group__';
