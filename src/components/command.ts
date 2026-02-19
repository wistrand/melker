/**
 * Command Component
 *
 * A non-visual element that declares a keyboard shortcut with metadata.
 * Makes shortcuts discoverable by the command palette and AI accessibility dialog.
 * Replaces manual onKeyPress switch blocks with declarative child elements.
 *
 * Usage:
 *   <command key="n" label="New Item" onExecute={handler} />
 *   <command key="Ctrl+S" label="Save" onExecute={handler} global />
 */

import { Element, BaseProps } from '../types.ts';

export interface CommandProps extends BaseProps {
  /** Keyboard shortcut (e.g. 'n', 'Delete', 'Ctrl+S') */
  key: string;
  /** Human-readable command name */
  label: string;
  /** Callback when command is triggered */
  onExecute: Function;
  /** Palette group name (default: 'Commands') */
  group?: string;
  /** Promote to global shortcut (fires regardless of focus) */
  global?: boolean;
  /** Temporarily disable the command */
  disabled?: boolean;
}

export class CommandElement extends Element {
  static readonly type = 'command';
  declare props: CommandProps;

  constructor(props: CommandProps, _children: Element[] = []) {
    super('command', props);
  }

  static validate(props: CommandProps): boolean {
    if (typeof props.key !== 'string' || props.key.length === 0) return false;
    if (typeof props.label !== 'string' || props.label.length === 0) return false;
    if (typeof props.onExecute !== 'function') return false;
    return true;
  }
}

// Register command component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const commandSchema: ComponentSchema = {
  description: 'Declarative keyboard shortcut. Non-visual element that registers a command discoverable by the command palette and AI assistant.',
  props: {
    key: { type: 'string', required: true, description: 'Keyboard shortcut (e.g. "n", "Delete", "Ctrl+S")' },
    label: { type: 'string', required: true, description: 'Human-readable command name' },
    onExecute: { type: 'handler', required: true, description: 'Callback when command is triggered' },
    group: { type: 'string', description: 'Palette group name (default: "Commands")' },
    global: { type: 'boolean', description: 'Promote to global shortcut (fires regardless of focus)' },
    disabled: { type: 'boolean', description: 'Temporarily disable the command' },
  },
};

registerComponentSchema('command', commandSchema);

registerComponent({
  type: 'command',
  componentClass: CommandElement,
  defaultProps: { disabled: false, global: false, style: { display: 'none' } },
  validate: (props) => CommandElement.validate(props as any),
});
