/**
 * Shared Terminal Environment Detection Utilities
 *
 * Provides common functions for detecting terminal multiplexers (tmux, screen)
 * and remote sessions (SSH). Used by sixel, kitty, and iterm2 detection modules
 * to avoid code duplication.
 */

import { getLogger } from '../logging.ts';
import { Env } from '../env.ts';

const logger = getLogger('TerminalDetect');

/**
 * Detect if running inside a terminal multiplexer (tmux, screen, etc.)
 */
export function detectMultiplexer(): boolean {
  const tmux = Env.get('TMUX');
  const sty = Env.get('STY'); // screen session
  const termProgram = Env.get('TERM_PROGRAM');

  if (tmux || sty) {
    logger.debug('Multiplexer detected', { tmux: !!tmux, screen: !!sty });
    return true;
  }

  if (termProgram === 'tmux') {
    logger.debug('Multiplexer detected via TERM_PROGRAM');
    return true;
  }

  return false;
}

/**
 * Detect if running in a remote/SSH session
 */
/**
 * Detect if the terminal supports Unicode characters.
 * Returns false for terminals known to lack Unicode support
 * (Linux virtual console, VT100/VT220 hardware terminals).
 * Result is cached — TERM never changes during a process lifetime.
 */
let _unicodeSupported: boolean | undefined;
export function isUnicodeSupported(): boolean {
  if (_unicodeSupported !== undefined) return _unicodeSupported;
  const term = Env.get('TERM') || '';
  _unicodeSupported = !(term === 'linux' || term === 'vt100' || term === 'vt220');
  return _unicodeSupported;
}

/**
 * Detect if running in a remote/SSH session
 */
export function detectRemoteSession(): boolean {
  const sshClient = Env.get('SSH_CLIENT');
  const sshConnection = Env.get('SSH_CONNECTION');
  const sshTty = Env.get('SSH_TTY');

  if (sshClient || sshConnection || sshTty) {
    logger.debug('Remote session detected', {
      sshClient: !!sshClient,
      sshConnection: !!sshConnection,
      sshTty: !!sshTty,
    });
    return true;
  }

  return false;
}
