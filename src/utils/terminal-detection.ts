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
 * Three-tier Unicode capability model.
 *
 * - **full**  — Modern terminal emulators (xterm, kitty, etc.): sextants,
 *               braille, rounded corners, fine eighth-blocks, all of Unicode.
 * - **basic** — Linux virtual console (TERM=linux): thin + double box-drawing,
 *               common block elements (█ ▄ ▀ ▌ ▐ ░ ▒ ▓), Latin-1 supplement.
 * - **ascii** — Legacy hardware terminals (vt100, vt220): ASCII only.
 */
export type UnicodeTier = 'full' | 'basic' | 'ascii';

let _unicodeTier: UnicodeTier | undefined;
export function getUnicodeTier(): UnicodeTier {
  if (_unicodeTier !== undefined) return _unicodeTier;
  const term = Env.get('TERM') || '';
  if (term === 'vt100' || term === 'vt220') {
    _unicodeTier = 'ascii';
  } else if (term === 'linux') {
    _unicodeTier = 'basic';
  } else {
    _unicodeTier = 'full';
  }
  logger.debug(`Unicode tier: ${_unicodeTier} (TERM=${term})`);
  return _unicodeTier;
}

/**
 * Returns true when the terminal supports at least basic Unicode (box-drawing,
 * block elements). Kept for backward compatibility — returns true for both
 * 'full' and 'basic' tiers.
 */
export function isUnicodeSupported(): boolean {
  return getUnicodeTier() !== 'ascii';
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
