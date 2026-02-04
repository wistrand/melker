/**
 * iTerm2 Inline Images Protocol Detection
 *
 * Detects terminal support for iTerm2's inline images protocol.
 *
 * ## Detection Strategy
 *
 * Primary detection is environment-based (fast, no terminal queries):
 * - TERM_PROGRAM=iTerm.app
 * - LC_TERMINAL=iTerm2
 * - ITERM_SESSION_ID (set by iTerm2)
 * - WEZTERM_PANE (WezTerm supports iTerm2 protocol)
 * - KONSOLE_VERSION (Konsole has support)
 *
 * ## Multipart Mode
 *
 * When running in tmux, multipart mode is used for compatibility:
 * - MultipartFile: Start sequence with parameters
 * - FilePart: Chunked data
 * - FileEnd: Termination
 */

import { getLogger } from '../logging.ts';
import { Env } from '../env.ts';
import type { ITermCapabilities } from './types.ts';

const logger = getLogger('ITermDetect');

// Default capabilities when detection fails
const DEFAULT_CAPABILITIES: ITermCapabilities = {
  supported: false,
  inMultiplexer: false,
  isRemote: false,
  detectionMethod: 'none',
  useMultipart: false,
};

// Cached capabilities (detected once per session)
let cachedCapabilities: ITermCapabilities | null = null;

/**
 * Check if running inside a terminal multiplexer (tmux/screen)
 * iTerm2 protocol works in tmux with multipart mode
 */
function detectMultiplexer(): boolean {
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
 * Check if running over SSH
 */
function detectRemoteSession(): boolean {
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

/**
 * Check terminal type from environment for iTerm2 hints
 */
function checkTerminalEnv(): { likelyITerm: boolean; terminalProgram?: string } {
  const termProgram = Env.get('TERM_PROGRAM') || '';
  const term = Env.get('TERM') || '';
  const lcTerminal = Env.get('LC_TERMINAL') || '';
  const itermSessionId = Env.get('ITERM_SESSION_ID');
  const weztermPane = Env.get('WEZTERM_PANE');
  const konsoleVersion = Env.get('KONSOLE_VERSION');

  // Direct iTerm2 indicators
  if (itermSessionId) {
    logger.debug('iTerm2 detected via ITERM_SESSION_ID');
    return { likelyITerm: true, terminalProgram: 'iTerm2' };
  }

  if (termProgram === 'iTerm.app' || lcTerminal === 'iTerm2') {
    logger.debug('iTerm2 detected via TERM_PROGRAM/LC_TERMINAL');
    return { likelyITerm: true, terminalProgram: 'iTerm2' };
  }

  // WezTerm supports iTerm2 protocol
  if (weztermPane) {
    logger.debug('WezTerm detected via WEZTERM_PANE (supports iTerm2 protocol)');
    return { likelyITerm: true, terminalProgram: 'WezTerm' };
  }

  // Konsole has iTerm2 protocol support
  if (konsoleVersion) {
    logger.debug('Konsole detected via KONSOLE_VERSION (supports iTerm2 protocol)');
    return { likelyITerm: true, terminalProgram: 'Konsole' };
  }

  // Rio terminal supports iTerm2 protocol (sets TERM=rio)
  if (term === 'rio' || term.startsWith('rio-')) {
    logger.debug('Rio detected via TERM (supports iTerm2 protocol)');
    return { likelyITerm: true, terminalProgram: 'Rio' };
  }

  // Check TERM_PROGRAM for known supporting terminals
  const itermSupportingTerminals = [
    'iTerm.app',
    'WezTerm',
    'Konsole',
    'konsole',
    'Hyper',
    'hyper',
    'rio',      // Rio terminal supports iTerm2 protocol
    'Rio',
  ];

  for (const terminal of itermSupportingTerminals) {
    if (termProgram.toLowerCase().includes(terminal.toLowerCase())) {
      logger.debug('iTerm2-compatible terminal detected via TERM_PROGRAM', { termProgram });
      return { likelyITerm: true, terminalProgram: termProgram };
    }
  }

  // Known terminals that do NOT support iTerm2 protocol
  const nonItermTerminals = [
    'Apple_Terminal',  // macOS Terminal.app
    'vscode',          // VS Code uses sixel, not iTerm2
    'Alacritty',       // No image protocol support
  ];

  for (const terminal of nonItermTerminals) {
    if (termProgram.includes(terminal)) {
      logger.debug('Non-iTerm2 terminal detected', { termProgram });
      return { likelyITerm: false };
    }
  }

  return { likelyITerm: false };
}

/**
 * Detect iTerm2 capabilities.
 *
 * Uses environment-based detection (no terminal queries needed).
 *
 * @param forceRedetect - Force re-detection even if cached
 */
export function detectITermCapabilities(
  forceRedetect: boolean = false
): ITermCapabilities {
  // Return cached if available
  if (cachedCapabilities && !forceRedetect) {
    return cachedCapabilities;
  }

  if (forceRedetect) {
    cachedCapabilities = null;
  }

  logger.debug('Starting iTerm2 capability detection');

  // Start with defaults
  const capabilities: ITermCapabilities = { ...DEFAULT_CAPABILITIES };

  // Detect environment
  capabilities.inMultiplexer = detectMultiplexer();
  capabilities.isRemote = detectRemoteSession();

  // iTerm2 protocol works in tmux with multipart mode
  if (capabilities.inMultiplexer) {
    capabilities.useMultipart = true;
    logger.debug('Multiplexer detected - will use multipart mode');
  }

  // Check if stdout is a terminal
  if (!Deno.stdout.isTerminal()) {
    logger.debug('Not a terminal - iTerm2 disabled');
    cachedCapabilities = capabilities;
    return capabilities;
  }

  // Check environment hints
  const envCheck = checkTerminalEnv();

  if (envCheck.likelyITerm) {
    capabilities.supported = true;
    capabilities.detectionMethod = 'env';
    capabilities.terminalProgram = envCheck.terminalProgram;

    logger.info('iTerm2 protocol detected', {
      terminal: capabilities.terminalProgram,
      multiplexer: capabilities.inMultiplexer,
      multipart: capabilities.useMultipart,
      remote: capabilities.isRemote,
    });
  } else {
    logger.debug('No iTerm2 environment hints found');
  }

  cachedCapabilities = capabilities;
  return capabilities;
}

/**
 * Start iTerm2 capability detection (async interface for consistency with other protocols)
 *
 * Note: Unlike sixel/kitty, iTerm2 detection is synchronous (environment-based only).
 * This async wrapper maintains API consistency.
 */
export function startITermDetection(
  _skipTerminalQueries: boolean = false,
  _timeoutMs: number = 100
): Promise<ITermCapabilities> {
  return Promise.resolve(detectITermCapabilities());
}

/**
 * Get cached iTerm2 capabilities without triggering detection
 */
export function getCachedITermCapabilities(): ITermCapabilities | null {
  return cachedCapabilities;
}

/**
 * Clear cached capabilities (for testing)
 */
export function clearITermCapabilitiesCache(): void {
  cachedCapabilities = null;
}

/**
 * Check if iTerm2 is available (quick check using cache)
 */
export function isITermAvailable(): boolean {
  return cachedCapabilities?.supported ?? false;
}

/**
 * Check if iTerm2 detection is in progress
 * Note: Always false since iTerm2 detection is synchronous
 */
export function isITermDetectionInProgress(): boolean {
  return false;
}

/**
 * Feed input data to iTerm2 detection (no-op, for API consistency)
 * iTerm2 detection is environment-based and doesn't need terminal responses
 */
export function feedITermDetectionInput(_data: Uint8Array): boolean {
  return false;
}

/**
 * Check iTerm2 detection timeout (no-op, for API consistency)
 */
export function checkITermDetectionTimeout(): void {
  // No-op - iTerm2 detection is synchronous
}
