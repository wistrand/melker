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
import { DetectionModule } from '../graphics/detection-base.ts';
import type { ITermCapabilities } from './types.ts';
import { stdout } from '../runtime/mod.ts';

const logger = getLogger('ITermDetect');

const DEFAULT_CAPABILITIES: ITermCapabilities = {
  supported: false,
  inMultiplexer: false,
  isRemote: false,
  detectionMethod: 'none',
  useMultipart: false,
};

const dm = new DetectionModule<ITermCapabilities>('iterm2', DEFAULT_CAPABILITIES, logger);

// --- Protocol-specific helpers ---

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

// --- Exported API (unchanged signatures) ---

/**
 * Detect iTerm2 capabilities.
 * Uses environment-based detection (no terminal queries needed).
 */
export function detectITermCapabilities(
  forceRedetect: boolean = false
): ITermCapabilities {
  if (!forceRedetect) {
    const cached = dm.getCached();
    if (cached) return cached;
  } else {
    dm.clearCache();
  }

  logger.debug('Starting iTerm2 capability detection');
  const capabilities = dm.createCapabilities();

  // iTerm2 protocol works in tmux with multipart mode
  if (capabilities.inMultiplexer) {
    capabilities.useMultipart = true;
    logger.debug('Multiplexer detected - will use multipart mode');
  }

  // Check if stdout is a terminal
  if (!stdout.isTerminal()) {
    logger.debug('Not a terminal - iTerm2 disabled');
    dm.setCached(capabilities);
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

  dm.setCached(capabilities);
  return capabilities;
}

/**
 * Start iTerm2 capability detection (async interface for consistency with other protocols).
 * Note: Unlike sixel/kitty, iTerm2 detection is synchronous (environment-based only).
 */
export function startITermDetection(
  _skipTerminalQueries: boolean = false,
  _timeoutMs: number = 100
): Promise<ITermCapabilities> {
  return Promise.resolve(detectITermCapabilities());
}

export function getCachedITermCapabilities(): ITermCapabilities | null {
  return dm.getCached();
}

export function clearITermCapabilitiesCache(): void {
  dm.clearCache();
}

export function isITermAvailable(): boolean {
  return dm.isAvailable();
}

/**
 * Always false — iTerm2 detection is synchronous (environment-based)
 */
export function isITermDetectionInProgress(): boolean {
  return dm.isInProgress();
}

/**
 * No-op — iTerm2 detection doesn't need terminal responses
 */
export function feedITermDetectionInput(_data: Uint8Array): boolean {
  return false;
}

/**
 * No-op — iTerm2 detection is synchronous
 */
export function checkITermDetectionTimeout(): void {
  // No-op - iTerm2 detection is synchronous
}
