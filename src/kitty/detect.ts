/**
 * Kitty Graphics Protocol Detection
 *
 * Detects terminal kitty graphics support via query action.
 *
 * ## Architecture
 *
 * Uses the same async query/response pattern as sixel detection:
 * - Detection code WRITES queries to stdout (synchronous)
 * - Main input loop READS responses from stdin
 * - Responses are routed back here via feedKittyDetectionInput()
 *
 * ## Detection Method
 *
 * Send a query action with a minimal 1x1 RGB image:
 * ```
 * <ESC>_Gi=31,s=1,v=1,a=q,t=d,f=24;AAAA<ESC>\
 * ```
 *
 * - `i=31` - Image ID (arbitrary, used to match response)
 * - `s=1,v=1` - Width and height (1x1 pixel)
 * - `a=q` - Query action (test if image can be loaded, don't store)
 * - `t=d` - Direct transmission (data in escape sequence)
 * - `f=24` - 24-bit RGB format
 * - `AAAA` - Base64 encoded RGB pixel (black)
 *
 * Response:
 * - Success: `<ESC>_Gi=31;OK<ESC>\`
 * - Error: `<ESC>_Gi=31;ENOENT:...<ESC>\`
 *
 * If no response within timeout, kitty is not supported.
 */

import { getLogger } from '../logging.ts';
import { Env } from '../env.ts';
import type { KittyCapabilities } from './types.ts';

const logger = getLogger('KittyDetect');

// Default capabilities when detection fails or kitty unsupported
const DEFAULT_CAPABILITIES: KittyCapabilities = {
  supported: false,
  inMultiplexer: false,
  isRemote: false,
  detectionMethod: 'none',
};

// Cached capabilities (detected once per session)
let cachedCapabilities: KittyCapabilities | null = null;

// Detection state for async query/response pattern
interface DetectionState {
  phase: 'idle' | 'query' | 'complete';
  capabilities: KittyCapabilities;
  responseBuffer: string;
  startTime: number;
  timeoutMs: number;
  resolve: ((caps: KittyCapabilities) => void) | null;
}

let detectionState: DetectionState | null = null;

// Query image ID - arbitrary value to match response
const QUERY_IMAGE_ID = 31;

/**
 * Check if running inside a terminal multiplexer (tmux/screen)
 * Kitty protocol is NOT supported in tmux/screen
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
 * Check terminal type from environment for kitty hints
 */
function checkTerminalEnv(): { likelyKitty: boolean; terminalProgram?: string } {
  const termProgram = Env.get('TERM_PROGRAM') || '';
  const kittyWindowId = Env.get('KITTY_WINDOW_ID');
  const weztermPane = Env.get('WEZTERM_PANE');
  const ghosttyResourceDir = Env.get('GHOSTTY_RESOURCES_DIR');

  // Direct indicators
  if (kittyWindowId) {
    logger.debug('Kitty detected via KITTY_WINDOW_ID');
    return { likelyKitty: true, terminalProgram: 'kitty' };
  }

  if (weztermPane) {
    logger.debug('WezTerm detected via WEZTERM_PANE');
    return { likelyKitty: true, terminalProgram: 'WezTerm' };
  }

  if (ghosttyResourceDir) {
    logger.debug('Ghostty detected via GHOSTTY_RESOURCES_DIR');
    return { likelyKitty: true, terminalProgram: 'Ghostty' };
  }

  // Known kitty-supporting terminals
  const kittyTerminals = [
    'kitty',
    'WezTerm',
    'Ghostty',
    'ghostty',
    'Konsole',
    'konsole',
  ];

  if (kittyTerminals.some(t => termProgram.toLowerCase().includes(t.toLowerCase()))) {
    logger.debug('Kitty-capable terminal detected via TERM_PROGRAM', { termProgram });
    return { likelyKitty: true, terminalProgram: termProgram };
  }

  return { likelyKitty: false };
}

/**
 * Write a terminal query (no read - that's done by main input loop)
 */
function writeQuery(query: string): void {
  const encoder = new TextEncoder();
  Deno.stdout.writeSync(encoder.encode(query));
}

/**
 * Parse kitty graphics response
 * Response format: <ESC>_Gi=<id>;<status><ESC>\
 */
function parseKittyResponse(response: string): { id: number; ok: boolean; error?: string } | null {
  // Match: ESC _ G i = <id> ; <status> ESC \
  const match = response.match(/\x1b_Gi=(\d+);([^\x1b]*)\x1b\\/);
  if (!match) {
    return null;
  }

  const id = parseInt(match[1], 10);
  const status = match[2];

  return {
    id,
    ok: status === 'OK',
    error: status !== 'OK' ? status : undefined,
  };
}

/**
 * Check if response buffer contains a complete kitty response
 */
function hasCompleteResponse(buffer: string): boolean {
  // Kitty response: ESC _ G ... ESC \
  return /\x1b_Gi=\d+;[^\x1b]*\x1b\\/.test(buffer);
}

/**
 * Complete detection and resolve promise
 */
function completeDetection(): void {
  if (!detectionState) return;

  const state = detectionState;
  const caps = state.capabilities;

  logger.info('Kitty detection complete', {
    supported: caps.supported,
    method: caps.detectionMethod,
    terminal: caps.terminalProgram,
    multiplexer: caps.inMultiplexer,
    remote: caps.isRemote,
  });

  cachedCapabilities = caps;

  if (state.resolve) {
    state.resolve(caps);
  }

  detectionState = null;
}

/**
 * Handle detection timeout
 */
function handleDetectionTimeout(): void {
  if (!detectionState) return;

  const state = detectionState;
  logger.debug('Kitty detection timeout - protocol not supported');

  state.capabilities.supported = false;
  state.capabilities.detectionMethod = 'none';
  state.phase = 'complete';

  completeDetection();
}

/**
 * Check if kitty detection is in progress
 */
export function isKittyDetectionInProgress(): boolean {
  return detectionState !== null && detectionState.phase !== 'complete';
}

/**
 * Get the current detection timeout (ms remaining)
 */
export function getKittyDetectionTimeout(): number {
  if (!detectionState) return 0;
  const elapsed = Date.now() - detectionState.startTime;
  return Math.max(0, detectionState.timeoutMs - elapsed);
}

/**
 * Check if input looks like a kitty graphics response.
 * Kitty response format: \x1b_G... (APC sequence starting with G)
 *
 * User input doesn't use APC sequences, so this is safe.
 *
 * @param combinedBuffer - The response buffer + new input combined
 */
function looksLikeKittyResponse(combinedBuffer: string): boolean {
  // Kitty response: ESC _ G ...
  if (combinedBuffer.startsWith('\x1b_G')) {
    return true;
  }

  // For partial sequences like bare ESC or \x1b_, we let them through.
  // If it was actually the start of a kitty response, bytes usually
  // arrive together or we'll catch it on the next read.

  return false;
}

/**
 * Feed input data to kitty detection state machine.
 * Called by the main input loop with raw terminal data.
 * Returns true if data was consumed by detection, false if it should be processed normally.
 */
export function feedKittyDetectionInput(data: Uint8Array): boolean {
  if (!detectionState || detectionState.phase === 'idle' || detectionState.phase === 'complete') {
    return false;
  }

  // Always let Ctrl+C (0x03) through - user must be able to interrupt during detection
  if (data.length === 1 && data[0] === 0x03) {
    logger.debug('Ctrl+C during kitty detection - passing through');
    return false;
  }

  const state = detectionState;
  const text = new TextDecoder().decode(data);

  // Check for timeout
  if (Date.now() - state.startTime > state.timeoutMs) {
    logger.debug('Kitty detection timeout');
    handleDetectionTimeout();
    // Don't consume the input - let it be processed as user input
    return false;
  }

  // Only consume input that looks like a kitty response
  // User input (regular keys, arrow keys, etc.) should pass through
  if (!looksLikeKittyResponse(state.responseBuffer + text)) {
    logger.debug('User input during kitty detection - passing through', {
      inputPreview: text.slice(0, 10).replace(/\x1b/g, 'ESC'),
    });
    return false;
  }

  // Accumulate response
  state.responseBuffer += text;

  // Check for complete kitty response
  if (state.phase === 'query' && hasCompleteResponse(state.responseBuffer)) {
    const parsed = parseKittyResponse(state.responseBuffer);

    if (parsed && parsed.id === QUERY_IMAGE_ID) {
      if (parsed.ok) {
        logger.info('Kitty graphics protocol detected');
        state.capabilities.supported = true;
        state.capabilities.detectionMethod = 'query';
      } else {
        logger.debug('Kitty query failed', { error: parsed.error });
        state.capabilities.supported = false;
        state.capabilities.detectionMethod = 'query';
      }

      state.phase = 'complete';
      completeDetection();
      return true;
    }
  }

  return true; // Data was consumed by detection
}

/**
 * Check and handle kitty detection timeout (called by input loop periodically)
 */
export function checkKittyDetectionTimeout(): void {
  if (!detectionState || detectionState.phase === 'idle' || detectionState.phase === 'complete') {
    return;
  }

  if (Date.now() - detectionState.startTime > detectionState.timeoutMs) {
    handleDetectionTimeout();
  }
}

/**
 * Start kitty capability detection.
 * Writes query to terminal, response is handled via feedKittyDetectionInput().
 *
 * @param skipTerminalQueries - Skip terminal queries (for testing/CI)
 * @param timeoutMs - Timeout for query (default 100ms)
 */
export function startKittyDetection(
  skipTerminalQueries: boolean = false,
  timeoutMs: number = 100
): Promise<KittyCapabilities> {
  // Return cached if available
  if (cachedCapabilities) {
    return Promise.resolve(cachedCapabilities);
  }

  // Return existing detection promise if in progress
  if (detectionState && detectionState.resolve) {
    return new Promise(resolve => {
      const oldResolve = detectionState!.resolve;
      detectionState!.resolve = (caps) => {
        oldResolve?.(caps);
        resolve(caps);
      };
    });
  }

  logger.debug('Starting kitty capability detection');

  // Start with defaults
  const capabilities: KittyCapabilities = { ...DEFAULT_CAPABILITIES };

  // Detect environment
  capabilities.inMultiplexer = detectMultiplexer();
  capabilities.isRemote = detectRemoteSession();

  // If in multiplexer, kitty is not supported
  if (capabilities.inMultiplexer) {
    logger.info('Kitty disabled - running in terminal multiplexer');
    cachedCapabilities = capabilities;
    return Promise.resolve(capabilities);
  }

  // Check environment hints
  const envCheck = checkTerminalEnv();
  if (envCheck.terminalProgram) {
    capabilities.terminalProgram = envCheck.terminalProgram;
  }

  // Skip terminal queries if requested
  if (skipTerminalQueries) {
    logger.debug('Kitty detection skipped - terminal queries disabled');
    capabilities.supported = false;
    capabilities.detectionMethod = 'env';
    cachedCapabilities = capabilities;
    return Promise.resolve(capabilities);
  }

  // Check if stdout is a terminal
  if (!Deno.stdout.isTerminal()) {
    logger.debug('Not a terminal - kitty disabled');
    cachedCapabilities = capabilities;
    return Promise.resolve(capabilities);
  }

  // Skip query for terminals without kitty environment hints
  // This avoids the 100ms timeout wait for terminals that won't respond
  if (!envCheck.likelyKitty) {
    logger.debug('No kitty environment hints - skipping query');
    capabilities.supported = false;
    capabilities.detectionMethod = 'env';
    cachedCapabilities = capabilities;
    return Promise.resolve(capabilities);
  }

  return new Promise(resolve => {
    detectionState = {
      phase: 'query',
      capabilities,
      responseBuffer: '',
      startTime: Date.now(),
      timeoutMs,
      resolve,
    };

    // Send kitty query: 1x1 RGB image with query action
    // ESC _ G i=31,s=1,v=1,a=q,t=d,f=24;AAAA ESC \
    // AAAA = base64 of 3 zero bytes (black RGB pixel)
    const query = `\x1b_Gi=${QUERY_IMAGE_ID},s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\`;
    writeQuery(query);
    logger.debug('Sent kitty query');
  });
}

/**
 * Detect kitty capabilities (convenience wrapper)
 */
export async function detectKittyCapabilities(
  forceRedetect: boolean = false,
  skipTerminalQueries: boolean = false
): Promise<KittyCapabilities> {
  if (cachedCapabilities && !forceRedetect) {
    return cachedCapabilities;
  }

  if (forceRedetect) {
    cachedCapabilities = null;
    detectionState = null;
  }

  return startKittyDetection(skipTerminalQueries);
}

/**
 * Get cached kitty capabilities without triggering detection
 */
export function getCachedKittyCapabilities(): KittyCapabilities | null {
  return cachedCapabilities;
}

/**
 * Clear cached capabilities (for testing)
 */
export function clearKittyCapabilitiesCache(): void {
  cachedCapabilities = null;
  detectionState = null;
}

/**
 * Check if kitty is available (quick check using cache)
 */
export function isKittyAvailable(): boolean {
  return cachedCapabilities?.supported ?? false;
}
