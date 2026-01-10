// Input processing system for terminal events
// Handles raw terminal input and converts to melker events

import {
  type MelkerEvent,
  type KeyEvent,
  type MouseEvent,
  type WheelEvent,
  EventManager,
  getGlobalEventManager,
  createKeyEvent,
  createMouseEvent,
  createWheelEvent,
} from './events.ts';

export interface TerminalInputOptions {
  enableMouse?: boolean;
  enableFocusEvents?: boolean;
  enableRawMode?: boolean;
  mouseReporting?: 'none' | 'basic' | 'drag' | 'all';
  /**
   * Map Meta key to Alt key. On macOS, some terminals send the Option key
   * as Meta instead of Alt. Enable this to treat Meta as Alt for keyboard shortcuts.
   * Default: true (enabled by default for better macOS compatibility)
   */
  mapMetaToAlt?: boolean;
}

export interface RawKeyInput {
  sequence: string;
  name?: string;
  ctrl?: boolean;
  alt?: boolean;
  shift?: boolean;
  meta?: boolean;
}

export interface RawMouseInput {
  type: 'mousedown' | 'mouseup' | 'mousemove';
  x: number;
  y: number;
  button: number;
  buttons: number;
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

export interface RawWheelInput {
  type: 'wheel';
  x: number;
  y: number;
  deltaY: number; // Scroll direction: positive = scroll down, negative = scroll up
  deltaX?: number; // Horizontal scroll direction: positive = scroll right, negative = scroll left
  shift?: boolean;
  alt?: boolean;
  ctrl?: boolean;
}

/**
 * Terminal input processor that converts raw terminal events to melker events
 */
export class TerminalInputProcessor {
  private _eventManager: EventManager;
  private _options: Required<TerminalInputOptions>;
  private _isListening = false;
  private _rawModeEnabled = false;

  constructor(
    options: TerminalInputOptions = {},
    eventManager?: EventManager
  ) {
    this._eventManager = eventManager || getGlobalEventManager();
    this._options = {
      enableMouse: options.enableMouse ?? true,
      enableFocusEvents: options.enableFocusEvents ?? false,
      enableRawMode: options.enableRawMode ?? true,
      mouseReporting: options.mouseReporting ?? 'basic',
      mapMetaToAlt: options.mapMetaToAlt ?? true, // Enabled by default for macOS compatibility
    };
  }

  /**
   * Start listening for terminal input
   */
  async startListening(): Promise<void> {
    if (this._isListening) {
      return;
    }

    this._isListening = true;

    // Enable raw mode for better input control
    if (this._options.enableRawMode) {
      await this._enableRawMode();
    }

    // Enable mouse reporting if requested (only if raw mode worked)
    if (this._options.enableMouse && this._rawModeEnabled) {
      await this._enableMouseReporting();
    }

    // Start reading input regardless of raw mode status
    this._startInputLoop();
  }

  /**
   * Immediately stop the input loop (synchronous).
   * Call this before async cleanup to prevent the loop from blocking on stdin.read().
   */
  stopListeningSync(): void {
    this._isListening = false;
  }

  /**
   * Stop listening for terminal input.
   * Always performs cleanup even if already stopped.
   */
  async stopListening(): Promise<void> {
    this._isListening = false;

    // Disable mouse reporting
    if (this._options.enableMouse) {
      await this._disableMouseReporting();
    }

    // Disable raw mode
    if (this._rawModeEnabled) {
      await this._disableRawMode();
    }
  }

  /**
   * Process a raw keyboard input and convert to KeyEvent
   */
  processKeyInput(rawInput: RawKeyInput): KeyEvent | null {
    const key = this._normalizeKeyName(rawInput.name || rawInput.sequence);
    if (!key) return null;

    // Determine key code (similar to web KeyboardEvent.code)
    const code = this._getKeyCode(key, rawInput);

    // Map Meta to Alt if enabled (for macOS Option key compatibility)
    const altKey = rawInput.alt || (this._options.mapMetaToAlt && rawInput.meta) || false;

    return createKeyEvent(
      'keydown', // Terminal input is typically keydown
      key,
      code,
      {
        ctrlKey: rawInput.ctrl || false,
        altKey,
        shiftKey: rawInput.shift || false,
        metaKey: rawInput.meta || false,
      }
    );
  }

  /**
   * Process a raw mouse input and convert to MouseEvent
   */
  processMouseInput(rawInput: RawMouseInput): MouseEvent | null {
    // Convert terminal coordinates to 0-based
    const x = Math.max(0, rawInput.x - 1);
    const y = Math.max(0, rawInput.y - 1);

    return createMouseEvent(
      rawInput.type,
      x,
      y,
      rawInput.button,
      rawInput.buttons,
      undefined, // target
      {
        altKey: rawInput.alt,
        shiftKey: rawInput.shift,
        ctrlKey: rawInput.ctrl,
      }
    );
  }

  /**
   * Process a raw wheel input and convert to WheelEvent
   */
  processWheelInput(rawInput: RawWheelInput): WheelEvent | null {
    // Convert terminal coordinates to 0-based
    const x = Math.max(0, rawInput.x - 1);
    const y = Math.max(0, rawInput.y - 1);

    return createWheelEvent(
      x,
      y,
      rawInput.deltaX || 0, // Use horizontal scroll delta from input
      rawInput.deltaY,
      0  // deltaZ - z-axis scrolling not used
    );
  }

  /**
   * Process raw terminal input data
   */
  processRawInput(data: Uint8Array): MelkerEvent[] {
    const events: MelkerEvent[] = [];
    const text = new TextDecoder().decode(data);

    // Parse input sequences
    const sequences = this._parseInputSequences(text);

    for (const sequence of sequences) {
      if (this._isMouseSequence(sequence)) {
        const result = this._parseMouseSequence(sequence);
        if (result) {
          if (result.type === 'wheel') {
            const wheelEvent = this.processWheelInput(result as RawWheelInput);
            if (wheelEvent) {
              events.push(wheelEvent);
            }
          } else {
            const mouseEvent = this.processMouseInput(result as RawMouseInput);
            if (mouseEvent) {
              events.push(mouseEvent);
            }
          }
        }
      } else {
        const keyInput = this._parseKeySequence(sequence);
        if (keyInput) {
          const keyEvent = this.processKeyInput(keyInput);
          if (keyEvent) {
            events.push(keyEvent);
          }
        }
      }
    }

    return events;
  }

  /**
   * Enable raw mode for better input control
   */
  private async _enableRawMode(): Promise<void> {
    if (typeof Deno !== 'undefined' && Deno.stdin.setRaw) {
      try {
        Deno.stdin.setRaw(true);
        this._rawModeEnabled = true;
      } catch (error) {
        // Raw mode not available - mouse events will not work
        this._rawModeEnabled = false;
      }
    } else {
      // Raw mode not available in this environment
      this._rawModeEnabled = false;
    }
  }

  /**
   * Disable raw mode
   */
  private async _disableRawMode(): Promise<void> {
    if (typeof Deno !== 'undefined' && Deno.stdin.setRaw && this._rawModeEnabled) {
      try {
        Deno.stdin.setRaw(false);
        this._rawModeEnabled = false;
      } catch (error) {
        console.warn('Failed to disable raw mode:', error);
      }
    }
  }

  /**
   * Enable mouse reporting based on configuration
   */
  private async _enableMouseReporting(): Promise<void> {
    if (typeof Deno === 'undefined') return;

    let mouseSequence = '';

    switch (this._options.mouseReporting) {
      case 'basic':
        // Enable basic mouse reporting (click events)
        mouseSequence = '\x1b[?1000h';
        break;
      case 'drag':
        // Enable drag events
        mouseSequence = '\x1b[?1002h';
        break;
      case 'all':
        // Enable all mouse events including movement
        mouseSequence = '\x1b[?1003h';
        break;
      default:
        return;
    }

    // Also enable SGR mouse mode for better coordinate reporting
    mouseSequence += '\x1b[?1006h';

    try {
      await Deno.stdout.write(new TextEncoder().encode(mouseSequence));
    } catch (error) {
      // Mouse reporting failed - silent fallback
    }
  }

  /**
   * Disable mouse reporting
   */
  private async _disableMouseReporting(): Promise<void> {
    if (typeof Deno === 'undefined') return;

    const disableSequence = '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l';

    try {
      await Deno.stdout.write(new TextEncoder().encode(disableSequence));
    } catch (error) {
      // Silent failure on cleanup
    }
  }

  /**
   * Start the input reading loop
   */
  private _startInputLoop(): void {
    if (typeof Deno === 'undefined') return;

    const readLoop = async () => {
      const buffer = new Uint8Array(1024); // Buffer for reading input

      while (this._isListening) {
        try {
          // Use different reading approach based on raw mode availability
          if (this._rawModeEnabled) {
            // Raw mode: read directly from stdin
            const bytesRead = await Deno.stdin.read(buffer);
            if (bytesRead === null) {
              // EOF reached
              break;
            }

            // Process only the bytes that were actually read
            const inputData = buffer.slice(0, bytesRead);
            const events = this.processRawInput(inputData);

            for (const event of events) {
              this._eventManager.dispatchEvent(event);
            }
          } else {
            // Non-raw mode: try to read line-based input as fallback
            // This is less ideal but works in non-TTY environments
            try {
              const bytesRead = await Deno.stdin.read(buffer);
              if (bytesRead === null) {
                // EOF reached or no input available
                await new Promise(resolve => setTimeout(resolve, 50)); // Small delay
                continue;
              }

              const inputData = buffer.slice(0, bytesRead);
              const events = this.processRawInput(inputData);

              for (const event of events) {
                this._eventManager.dispatchEvent(event);
              }
            } catch (error) {
              // If reading fails in non-raw mode, wait a bit and try again
              await new Promise(resolve => setTimeout(resolve, 100));
            }
          }
        } catch (error) {
          console.error('Input reading error:', error);
          // Wait a bit before trying again
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    };

    readLoop().catch(console.error);
  }

  /**
   * Parse input sequences from raw text
   */
  private _parseInputSequences(text: string): string[] {
    const sequences: string[] = [];
    let i = 0;

    while (i < text.length) {
      if (text[i] === '\x1b') {
        // Escape sequence
        const sequence = this._parseEscapeSequence(text, i);
        sequences.push(sequence);
        i += sequence.length;
      } else {
        // Regular character
        sequences.push(text[i]);
        i++;
      }
    }

    return sequences;
  }

  /**
   * Parse an escape sequence starting at given position
   */
  private _parseEscapeSequence(text: string, start: number): string {
    if (start >= text.length || text[start] !== '\x1b') {
      return text[start] || '';
    }

    let end = start + 1;

    // Look for end of escape sequence
    if (end < text.length && text[end] === '[') {
      // CSI sequence
      end++;

      // Special handling for X10 mouse format: \x1b[M followed by 3 bytes
      if (end < text.length && text[end] === 'M') {
        end++; // Include 'M'
        // Include next 3 bytes (button, x, y)
        for (let i = 0; i < 3 && end < text.length; i++) {
          end++;
        }
      } else {
        // Regular CSI sequence
        while (end < text.length && !this._isCSITerminator(text[end])) {
          end++;
        }
        if (end < text.length) {
          end++; // Include terminator
        }
      }
    } else if (end < text.length) {
      // Other escape sequence
      end++;
    }

    return text.slice(start, end);
  }

  /**
   * Check if character terminates a CSI sequence
   */
  private _isCSITerminator(char: string): boolean {
    const code = char.charCodeAt(0);
    return code >= 0x40 && code <= 0x7E;
  }

  /**
   * Check if sequence is a mouse event
   */
  private _isMouseSequence(sequence: string): boolean {
    return sequence.includes('\x1b[<') || sequence.includes('\x1b[M');
  }

  /**
   * Parse mouse sequence into RawMouseInput or RawWheelInput
   */
  private _parseMouseSequence(sequence: string): RawMouseInput | RawWheelInput | null {
    // SGR mouse format: \x1b[<button;x;yM (press) or \x1b[<button;x;ym (release)
    const sgrMatch = sequence.match(/\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
    if (sgrMatch) {
      const button = parseInt(sgrMatch[1]);
      const x = parseInt(sgrMatch[2]);
      const y = parseInt(sgrMatch[3]);
      const isPress = sgrMatch[4] === 'M';

      // Check for wheel events (button codes 64, 65 for wheel up/down)
      if ((button & 64) === 64) {
        // Wheel event
        const isWheelDown = (button & 1) === 1; // button 65 = wheel down, 64 = wheel up
        const isShift = (button & 4) !== 0;
        const scrollAmount = 3; // Standard scroll amount

        // Convert Shift+scroll to horizontal scrolling
        const deltaY = isShift ? 0 : (isWheelDown ? scrollAmount : -scrollAmount);
        const deltaX = isShift ? (isWheelDown ? scrollAmount : -scrollAmount) : 0;

        return {
          type: 'wheel',
          x,
          y,
          deltaY,
          deltaX,
          shift: isShift,
          alt: (button & 8) !== 0,
          ctrl: (button & 16) !== 0,
        };
      }

      // Determine event type based on button code
      let eventType: 'mousedown' | 'mouseup' | 'mousemove';

      // Button codes 32+ are movement events (mouse move without button press)
      if (button >= 32) {
        eventType = 'mousemove';
      } else {
        eventType = isPress ? 'mousedown' : 'mouseup';
      }

      return {
        type: eventType,
        x,
        y,
        button: button & 3, // Extract button number
        buttons: button,
        shift: (button & 4) !== 0,
        alt: (button & 8) !== 0,
        ctrl: (button & 16) !== 0,
      };
    }

    // X10 mouse format: \x1b[Mbxy (legacy format)
    if (sequence.startsWith('\x1b[M') && sequence.length === 6) {
      const button = sequence.charCodeAt(3) - 32;
      const x = sequence.charCodeAt(4) - 32;
      const y = sequence.charCodeAt(5) - 32;

      return {
        type: (button & 3) === 3 ? 'mouseup' : 'mousedown',
        x,
        y,
        button: button & 3,
        buttons: button,
        shift: (button & 4) !== 0,
        alt: (button & 8) !== 0,
        ctrl: (button & 16) !== 0,
      };
    }

    return null;
  }

  /**
   * Parse key sequence into RawKeyInput
   */
  private _parseKeySequence(sequence: string): RawKeyInput | null {
    if (sequence.length === 1) {
      // Regular character
      const char = sequence;
      const code = char.charCodeAt(0);

      if (code === 127) {
        // DEL character (commonly backspace on Unix systems)
        return {
          sequence: char,
          name: 'backspace',
        };
      } else if (code < 32) {
        // Control character - but Enter, Tab, Backspace, Escape are standalone keys
        const isStandaloneKey = code === 8 || code === 9 || code === 10 || code === 13 || code === 27;
        return {
          sequence: char,
          name: this._getControlKeyName(code),
          ctrl: !isStandaloneKey,  // Only set ctrl for actual Ctrl+letter combinations
        };
      } else {
        // Printable character
        return {
          sequence: char,
          name: char,
        };
      }
    }

    // Escape sequences
    if (sequence.startsWith('\x1b')) {
      return this._parseEscapeKeySequence(sequence);
    }

    return {
      sequence,
      name: sequence,
    };
  }

  /**
   * Parse escape key sequence
   */
  private _parseEscapeKeySequence(sequence: string): RawKeyInput | null {
    // Common escape sequences
    const escapeMap: Record<string, { name: string; modifiers?: any }> = {
      '\x1b[A': { name: 'up' },
      '\x1b[B': { name: 'down' },
      '\x1b[C': { name: 'right' },
      '\x1b[D': { name: 'left' },
      '\x1b[H': { name: 'home' },
      '\x1b[F': { name: 'end' },
      '\x1b[Z': { name: 'tab', modifiers: { shift: true } },
      '\x1b[2~': { name: 'insert' },
      '\x1b[3~': { name: 'delete' },
      '\x1b[5~': { name: 'pageup' },
      '\x1b[6~': { name: 'pagedown' },
      '\x1b[1~': { name: 'home' },
      '\x1b[4~': { name: 'end' },
      // Common backspace escape sequences
      '\x1b\x08': { name: 'backspace' },
      '\x1b\x7f': { name: 'backspace' },
      '\x7f': { name: 'backspace' },
    };

    // Function keys - standard xterm/VT100 sequences
    // Note: F-key sequences have gaps (16 and 22 are skipped)
    const fKeySequences: Record<number, number> = {
      1: 11, 2: 12, 3: 13, 4: 14, 5: 15,
      6: 17, 7: 18, 8: 19, 9: 20, 10: 21,  // Skips 16
      11: 23, 12: 24,  // Skips 22
    };
    for (let i = 1; i <= 12; i++) {
      escapeMap[`\x1b[${fKeySequences[i]}~`] = { name: `f${i}` };
    }
    // SS3 format for F1-F4 (some terminals send these)
    escapeMap['\x1bOP'] = { name: 'f1' };
    escapeMap['\x1bOQ'] = { name: 'f2' };
    escapeMap['\x1bOR'] = { name: 'f3' };
    escapeMap['\x1bOS'] = { name: 'f4' };

    const mapping = escapeMap[sequence];
    if (mapping) {
      return {
        sequence,
        name: mapping.name,
        ...mapping.modifiers,
      };
    }

    // Modified keys (with Ctrl, Alt, Shift)
    const modifiedMatch = sequence.match(/\x1b\[1;(\d+)([ABCD~])/);
    if (modifiedMatch) {
      const modifierCode = parseInt(modifiedMatch[1]);
      const keyCode = modifiedMatch[2];

      const baseKey = {
        'A': 'up',
        'B': 'down',
        'C': 'right',
        'D': 'left',
      }[keyCode] || keyCode;

      return {
        sequence,
        name: baseKey,
        shift: (modifierCode & 1) !== 0,
        alt: (modifierCode & 2) !== 0,
        ctrl: (modifierCode & 4) !== 0,
        meta: (modifierCode & 8) !== 0,
      };
    }

    // Alt + character
    if (sequence.length === 2 && sequence[0] === '\x1b') {
      const char = sequence[1];
      const code = char.charCodeAt(0);
      // Alt+Enter (code 13 or 10)
      if (code === 13 || code === 10) {
        return {
          sequence,
          name: 'enter',
          alt: true,
        };
      }
      return {
        sequence,
        name: char,
        alt: true,
      };
    }

    // Kitty/xterm extended key encoding: CSI number ; modifiers u
    // e.g., \x1b[13;5u = Ctrl+Enter, \x1b[13;3u = Alt+Enter
    const kittyMatch = sequence.match(/\x1b\[(\d+);(\d+)u/);
    if (kittyMatch) {
      const keyCode = parseInt(kittyMatch[1]);
      const modifierCode = parseInt(kittyMatch[2]);
      let name = String.fromCharCode(keyCode);
      if (keyCode === 13 || keyCode === 10) name = 'enter';
      else if (keyCode === 9) name = 'tab';
      else if (keyCode === 27) name = 'escape';

      return {
        sequence,
        name,
        shift: (modifierCode & 1) !== 0,
        alt: (modifierCode & 2) !== 0,
        ctrl: (modifierCode & 4) !== 0,
        meta: (modifierCode & 8) !== 0,
      };
    }

    return {
      sequence,
      name: sequence,
    };
  }

  /**
   * Get control key name from character code
   */
  private _getControlKeyName(code: number): string {
    const controlKeys: Record<number, string> = {
      1: 'a',
      2: 'b',
      3: 'c',
      4: 'd',
      5: 'e',
      6: 'f',
      7: 'g',
      8: 'backspace',
      9: 'tab',
      10: 'enter',
      11: 'k',
      12: 'l',
      13: 'enter',
      14: 'n',
      15: 'o',
      16: 'p',
      17: 'q',
      18: 'r',
      19: 's',
      20: 't',
      21: 'u',
      22: 'v',
      23: 'w',
      24: 'x',
      25: 'y',
      26: 'z',
      27: 'escape',
      28: '\\',
      29: ']',
      30: '^',
      31: '_',
    };

    return controlKeys[code] || `ctrl+${String.fromCharCode(code + 64).toLowerCase()}`;
  }

  /**
   * Normalize key names to consistent format
   */
  private _normalizeKeyName(name: string): string {
    const keyMap: Record<string, string> = {
      'return': 'Enter',
      'enter': 'Enter',
      'backspace': 'Backspace',
      'delete': 'Delete',
      'tab': 'Tab',
      'escape': 'Escape',
      'space': ' ',
      'up': 'ArrowUp',
      'down': 'ArrowDown',
      'left': 'ArrowLeft',
      'right': 'ArrowRight',
      'home': 'Home',
      'end': 'End',
      'pageup': 'PageUp',
      'pagedown': 'PageDown',
      'insert': 'Insert',
      // Function keys
      'f1': 'F1', 'f2': 'F2', 'f3': 'F3', 'f4': 'F4',
      'f5': 'F5', 'f6': 'F6', 'f7': 'F7', 'f8': 'F8',
      'f9': 'F9', 'f10': 'F10', 'f11': 'F11', 'f12': 'F12',
    };

    return keyMap[name.toLowerCase()] || name;
  }

  /**
   * Get key code for KeyEvent.code property
   */
  private _getKeyCode(key: string, rawInput: RawKeyInput): string {
    // Map keys to their physical key codes
    const codeMap: Record<string, string> = {
      'Enter': 'Enter',
      'Backspace': 'Backspace',
      'Delete': 'Delete',
      'Tab': 'Tab',
      'Escape': 'Escape',
      ' ': 'Space',
      'ArrowUp': 'ArrowUp',
      'ArrowDown': 'ArrowDown',
      'ArrowLeft': 'ArrowLeft',
      'ArrowRight': 'ArrowRight',
      'Home': 'Home',
      'End': 'End',
      'PageUp': 'PageUp',
      'PageDown': 'PageDown',
      'Insert': 'Insert',
    };

    // Function keys
    for (let i = 1; i <= 12; i++) {
      codeMap[`f${i}`] = `F${i}`;
      codeMap[`F${i}`] = `F${i}`;
    }

    // Letter keys
    for (let i = 0; i < 26; i++) {
      const letter = String.fromCharCode(97 + i); // a-z
      const upperLetter = String.fromCharCode(65 + i); // A-Z
      codeMap[letter] = `Key${upperLetter}`;
      codeMap[upperLetter] = `Key${upperLetter}`;
    }

    // Number keys
    for (let i = 0; i <= 9; i++) {
      codeMap[i.toString()] = `Digit${i}`;
    }

    return codeMap[key] || key;
  }

  /**
   * Get input processor statistics
   */
  getStats(): {
    isListening: boolean;
    rawModeEnabled: boolean;
    mouseReporting: string;
    mapMetaToAlt: boolean;
    enabledFeatures: string[];
  } {
    const features: string[] = [];
    if (this._options.enableMouse) features.push('mouse');
    if (this._options.enableFocusEvents) features.push('focus');
    if (this._options.enableRawMode) features.push('rawMode');
    if (this._options.mapMetaToAlt) features.push('mapMetaToAlt');

    return {
      isListening: this._isListening,
      rawModeEnabled: this._rawModeEnabled,
      mouseReporting: this._options.mouseReporting,
      mapMetaToAlt: this._options.mapMetaToAlt,
      enabledFeatures: features,
    };
  }
}

// Global input processor instance
let globalInputProcessor: TerminalInputProcessor | undefined;

export function getGlobalInputProcessor(): TerminalInputProcessor {
  if (!globalInputProcessor) {
    globalInputProcessor = new TerminalInputProcessor();
  }
  return globalInputProcessor;
}

export function setGlobalInputProcessor(processor: TerminalInputProcessor): void {
  globalInputProcessor = processor;
}