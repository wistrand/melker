/**
 * Sixel Terminal Capability Detection
 *
 * Detects terminal sixel graphics support via DA1, XTSMGRAPHICS, and WindowOps queries.
 *
 * ## Architecture
 *
 * This module uses an async query/response pattern where:
 * - Detection code WRITES queries to stdout (synchronous)
 * - Main input loop READS responses from stdin
 * - Responses are routed back here via feedDetectionInput()
 *
 * ```
 * ┌─────────────────┐     write query      ┌──────────────┐
 * │  detect.ts      │ ──────────────────▶  │   Terminal   │
 * │  (state machine)│                      │              │
 * │                 │ ◀──────────────────  │              │
 * └────────▲────────┘     response         └──────────────┘
 *          │                                      │
 *          │ feedDetectionInput()                 │
 *          │                                      ▼
 * ┌────────┴────────┐                      ┌──────────────┐
 * │  input.ts       │ ◀────────────────── │    stdin     │
 * │  (input loop)   │     Deno.stdin.read │              │
 * └─────────────────┘                      └──────────────┘
 * ```
 *
 * ## Why This Architecture?
 *
 * The naive approach would be to read responses directly in detect.ts:
 * ```typescript
 * writeQuery('\x1b[c');
 * const response = await readWithTimeout(100);
 * ```
 *
 * But this causes a critical problem: Deno's stdin.read() cannot be cancelled.
 * When using Promise.race with a timeout, the read promise remains pending
 * even after the timeout fires. This "orphaned read" will consume the next
 * input - including Ctrl+C (which appears as byte 0x03 in raw mode).
 *
 * Result: User presses Ctrl+C, but it gets swallowed by the orphaned read.
 * They have to press it multiple times until no orphaned reads remain.
 *
 * ## Solution
 *
 * By routing ALL stdin reads through the main input loop:
 * - There's exactly ONE reader, no orphaned reads possible
 * - Ctrl+C and all input are handled consistently
 * - Detection responses are identified by escape sequence patterns
 *   and routed to the state machine via feedDetectionInput()
 *
 * ## Detection Flow
 *
 * 1. Engine starts input loop (src/input.ts)
 * 2. Engine calls startSixelDetection() which returns a Promise
 * 3. Detection writes DA1 query (\x1b[c) to stdout
 * 4. Terminal responds with capabilities (\x1b[?...c)
 * 5. Input loop reads response, calls feedDetectionInput()
 * 6. State machine parses response, advances to next phase
 * 7. Next query is written, repeat until all queries complete
 * 8. Promise resolves with detected capabilities
 *
 * ## Queries Performed
 *
 * 1. DA1 (Primary Device Attributes): \x1b[c
 *    Response: \x1b[?...c - "4" in params indicates sixel support
 *
 * 2. XTSMGRAPHICS Color Registers: \x1b[?1;1S
 *    Response: \x1b[?1;0;Ncolors;S - number of color registers
 *
 * 3. XTSMGRAPHICS Geometry: \x1b[?2;1S
 *    Response: \x1b[?2;0;width;height;S - max sixel dimensions
 *
 * 4. WindowOps Cell Size: \x1b[16t
 *    Response: \x1b[6;height;width;t - cell size in pixels
 *    (Critical for aligning sixel graphics to character grid)
 */

import { getLogger } from '../logging.ts';
import { Env } from '../env.ts';

const logger = getLogger('SixelDetect');

/**
 * Sixel terminal capabilities
 */
export interface SixelCapabilities {
  /** Whether sixel is supported */
  supported: boolean;
  /** Number of color registers (typically 256) */
  colorRegisters: number;
  /** Maximum pixel width */
  maxWidth: number;
  /** Maximum pixel height */
  maxHeight: number;
  /** Pixels per character cell horizontally */
  cellWidth: number;
  /** Pixels per character cell vertically */
  cellHeight: number;
  /** Whether running inside tmux/screen multiplexer */
  inMultiplexer: boolean;
  /** Whether running over SSH */
  isRemote: boolean;
  /** Known terminal quirks */
  quirks: string[];
  /** Detection method used */
  detectionMethod: 'da1' | 'env' | 'none';
}

// Default capabilities when detection fails or sixel unsupported
const DEFAULT_CAPABILITIES: SixelCapabilities = {
  supported: false,
  colorRegisters: 0,
  maxWidth: 0,
  maxHeight: 0,
  cellWidth: 0,
  cellHeight: 0,
  inMultiplexer: false,
  isRemote: false,
  quirks: [],
  detectionMethod: 'none',
};

// Cached capabilities (detected once per session)
let cachedCapabilities: SixelCapabilities | null = null;

// Detection state for async query/response pattern
interface DetectionState {
  phase: 'idle' | 'da1' | 'xtsmgraphics-colors' | 'xtsmgraphics-geometry' | 'cellsize' | 'complete';
  capabilities: SixelCapabilities;
  responseBuffer: string;
  startTime: number;
  timeoutMs: number;
  resolve: ((caps: SixelCapabilities) => void) | null;
}

let detectionState: DetectionState | null = null;

/**
 * Check if running inside a terminal multiplexer (tmux/screen)
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
 * Check terminal type from environment for sixel hints
 */
function checkTerminalEnv(): { likelySixel: boolean; quirks: string[] } {
  const term = Env.get('TERM') || '';
  const termProgram = Env.get('TERM_PROGRAM') || '';
  const wtSession = Env.get('WT_SESSION'); // Windows Terminal
  const quirks: string[] = [];

  // Known sixel-capable terminals
  const sixelTerms = [
    'xterm-256color', // xterm with -ti vt340
    'mlterm',
    'foot',
    'foot-extra',
    'contour',
    'wezterm',
    'yaft-256color',
  ];

  const sixelPrograms = [
    'WezTerm',
    'iTerm.app',
    'vscode', // VS Code integrated terminal
    'Konsole',
    'foot',
    'mlterm',
    'contour',
  ];

  // Known non-sixel terminals
  const nonSixelTerms = [
    'Apple_Terminal', // macOS Terminal.app
    'linux', // Linux VT
  ];

  // Check for VTE-based terminals (no sixel)
  const vteVersion = Env.get('VTE_VERSION');
  if (vteVersion) {
    quirks.push('vte-based');
    logger.debug('VTE terminal detected - sixel unlikely', { vteVersion });
    return { likelySixel: false, quirks };
  }

  // Check term program
  if (nonSixelTerms.includes(termProgram)) {
    return { likelySixel: false, quirks };
  }

  if (sixelPrograms.some(p => termProgram.includes(p))) {
    // Konsole has a right-edge rendering quirk that leaves artifacts when scrolling
    if (termProgram.includes('Konsole')) {
      quirks.push('konsole-sixel-edge');
    }
    return { likelySixel: true, quirks };
  }

  // Check TERM
  if (sixelTerms.some(t => term.includes(t))) {
    return { likelySixel: true, quirks };
  }

  // Windows Terminal
  if (wtSession) {
    quirks.push('windows-terminal');
    return { likelySixel: true, quirks };
  }

  return { likelySixel: false, quirks };
}

/**
 * Write a terminal query (no read - that's done by main input loop)
 */
function writeQuery(query: string): void {
  const encoder = new TextEncoder();
  Deno.stdout.writeSync(encoder.encode(query));
}

/**
 * Parse DA1 response for sixel support
 * Response format: ESC [ ? params c
 * Sixel support indicated by "4" in params
 */
function parseDA1Response(response: string): boolean {
  const match = response.match(/\x1b\[\?([0-9;]+)c/);
  if (!match) {
    logger.debug('DA1 response parse failed', { response: response.replace(/\x1b/g, 'ESC') });
    return false;
  }

  const params = match[1].split(';');
  const hasSixel = params.includes('4');

  logger.debug('DA1 response parsed', { params, hasSixel });
  return hasSixel;
}

/**
 * Parse XTSMGRAPHICS response
 */
function parseXTSMGRAPHICSResponse(
  response: string,
  queryType: 1 | 2
): { value: number; width?: number; height?: number } | null {
  // Try 4-param pattern first (geometry: type;status;width;height)
  const match4 = response.match(/\x1b\[\?(\d+);(\d+);(\d+);(\d+)S/);
  if (match4) {
    const [, pi, ps, pw, ph] = match4.map(Number);
    if (pi !== queryType || ps !== 0) {
      logger.debug('XTSMGRAPHICS response type/status mismatch', { pi, ps, queryType });
      return null;
    }
    return { value: pw, width: pw, height: ph };
  }

  // Try 3-param pattern (colors: type;status;value)
  const match3 = response.match(/\x1b\[\?(\d+);(\d+);(\d+)S/);
  if (match3) {
    const [, pi, ps, pv] = match3.map(Number);
    if (pi !== queryType || ps !== 0) {
      logger.debug('XTSMGRAPHICS response type/status mismatch', { pi, ps, queryType });
      return null;
    }
    return { value: pv };
  }

  logger.debug('XTSMGRAPHICS response parse failed', {
    queryType,
    response: response.replace(/\x1b/g, 'ESC'),
  });
  return null;
}

/**
 * Parse cell size response
 * Response format: ESC [ 6 ; height ; width t
 */
function parseCellSizeResponse(response: string): { width: number; height: number } | null {
  const match = response.match(/\x1b\[6;(\d+);(\d+)t/);
  if (!match) return null;
  return {
    height: parseInt(match[1], 10),
    width: parseInt(match[2], 10),
  };
}

/**
 * Check if response buffer contains a complete terminal response.
 * Uses regex patterns to avoid false positives from user input containing terminator chars.
 */
function hasCompleteResponse(buffer: string, phase: string): boolean {
  switch (phase) {
    case 'da1':
      // DA1 response: ESC [ ? params c
      return /\x1b\[\?[0-9;]+c/.test(buffer);
    case 'xtsmgraphics-colors':
    case 'xtsmgraphics-geometry':
      // XTSMGRAPHICS response: ESC [ ? params S
      return /\x1b\[\?[0-9;]+S/.test(buffer);
    case 'cellsize':
      // Cell size response: ESC [ 6 ; height ; width t
      return /\x1b\[6;\d+;\d+t/.test(buffer);
    default:
      return false;
  }
}

/**
 * Advance to next detection phase and write query
 */
function advanceDetectionPhase(): void {
  if (!detectionState) return;

  const state = detectionState;
  state.responseBuffer = '';
  state.startTime = Date.now();

  switch (state.phase) {
    case 'da1':
      // DA1 query: ESC [ c
      writeQuery('\x1b[c');
      logger.debug('Sent DA1 query');
      break;

    case 'xtsmgraphics-colors':
      // XTSMGRAPHICS color registers: ESC [ ? 1 ; 1 S
      writeQuery('\x1b[?1;1S');
      logger.debug('Sent XTSMGRAPHICS colors query');
      break;

    case 'xtsmgraphics-geometry':
      // XTSMGRAPHICS geometry: ESC [ ? 2 ; 1 S
      writeQuery('\x1b[?2;1S');
      logger.debug('Sent XTSMGRAPHICS geometry query');
      break;

    case 'cellsize':
      // WindowOps cell size: ESC [ 16 t
      writeQuery('\x1b[16t');
      logger.debug('Sent cell size query');
      break;

    case 'complete':
      completeDetection();
      break;
  }
}

/**
 * Complete detection and resolve promise
 */
function completeDetection(): void {
  if (!detectionState) return;

  const state = detectionState;
  const caps = state.capabilities;

  // Calculate max dimensions if not set
  if (caps.supported && (caps.maxWidth === 0 || caps.maxHeight === 0)) {
    try {
      const termSize = Deno.consoleSize();
      caps.maxWidth = termSize.columns * caps.cellWidth;
      caps.maxHeight = termSize.rows * caps.cellHeight;
    } catch {
      caps.maxWidth = 800;
      caps.maxHeight = 600;
    }
  }

  logger.info('Sixel detection complete', {
    supported: caps.supported,
    colorRegisters: caps.colorRegisters,
    cellSize: `${caps.cellWidth}x${caps.cellHeight}`,
    maxSize: `${caps.maxWidth}x${caps.maxHeight}`,
    method: caps.detectionMethod,
    quirks: caps.quirks,
  });

  cachedCapabilities = caps;

  if (state.resolve) {
    state.resolve(caps);
  }

  detectionState = null;
}

/**
 * Check if detection is in progress
 */
export function isDetectionInProgress(): boolean {
  return detectionState !== null && detectionState.phase !== 'complete';
}

/**
 * Get the current detection timeout (ms remaining)
 */
export function getDetectionTimeout(): number {
  if (!detectionState) return 0;
  const elapsed = Date.now() - detectionState.startTime;
  return Math.max(0, detectionState.timeoutMs - elapsed);
}

/**
 * Feed input data to detection state machine.
 * Called by the main input loop with raw terminal data.
 * Returns true if data was consumed by detection, false if it should be processed normally.
 */
export function feedDetectionInput(data: Uint8Array): boolean {
  if (!detectionState || detectionState.phase === 'idle' || detectionState.phase === 'complete') {
    return false;
  }

  // Always let Ctrl+C (0x03) through - user must be able to interrupt during detection
  if (data.length === 1 && data[0] === 0x03) {
    logger.debug('Ctrl+C during detection - passing through');
    return false;
  }

  const state = detectionState;
  const text = new TextDecoder().decode(data);

  // Check for timeout
  if (Date.now() - state.startTime > state.timeoutMs) {
    logger.debug('Detection phase timeout', { phase: state.phase });
    handlePhaseTimeout();
    return true;
  }

  // Accumulate response
  state.responseBuffer += text;

  // Check for complete response based on current phase
  let complete = false;
  switch (state.phase) {
    case 'da1':
      complete = hasCompleteResponse(state.responseBuffer, 'da1');
      if (complete) {
        const hasSixel = parseDA1Response(state.responseBuffer);
        state.capabilities.supported = hasSixel;
        state.capabilities.detectionMethod = 'da1';

        if (hasSixel) {
          logger.info('Sixel support detected via DA1');
          state.phase = 'xtsmgraphics-colors';
        } else {
          // Even without sixel, query cell size for accurate aspect ratio
          state.phase = 'cellsize';
        }
        advanceDetectionPhase();
      }
      break;

    case 'xtsmgraphics-colors':
      complete = hasCompleteResponse(state.responseBuffer, 'xtsmgraphics-colors');
      if (complete) {
        const parsed = parseXTSMGRAPHICSResponse(state.responseBuffer, 1);
        if (parsed) {
          state.capabilities.colorRegisters = parsed.value;
          logger.debug('XTSMGRAPHICS color registers', { colorRegisters: parsed.value });
        } else {
          state.capabilities.colorRegisters = 256; // Default
        }
        state.phase = 'xtsmgraphics-geometry';
        advanceDetectionPhase();
      }
      break;

    case 'xtsmgraphics-geometry':
      complete = hasCompleteResponse(state.responseBuffer, 'xtsmgraphics-geometry');
      if (complete) {
        const parsed = parseXTSMGRAPHICSResponse(state.responseBuffer, 2);
        if (parsed?.width && parsed?.height) {
          state.capabilities.maxWidth = parsed.width;
          state.capabilities.maxHeight = parsed.height;
          logger.debug('XTSMGRAPHICS geometry', { maxWidth: parsed.width, maxHeight: parsed.height });
        }
        state.phase = 'cellsize';
        advanceDetectionPhase();
      }
      break;

    case 'cellsize':
      complete = hasCompleteResponse(state.responseBuffer, 'cellsize');
      if (complete) {
        const cellSize = parseCellSizeResponse(state.responseBuffer);
        if (cellSize) {
          state.capabilities.cellWidth = cellSize.width;
          state.capabilities.cellHeight = cellSize.height;
          logger.debug('Cell size detected', cellSize);
        } else if (state.capabilities.supported) {
          // Cell size is critical for sixel - disable if query failed
          logger.warn('Sixel disabled - cell size query failed');
          state.capabilities.supported = false;
        }
        // Cell size is still useful for aspect ratio even without sixel
        state.phase = 'complete';
        advanceDetectionPhase();
      }
      break;
  }

  return true; // Data was consumed by detection
}

/**
 * Handle timeout for current detection phase
 */
function handlePhaseTimeout(): void {
  if (!detectionState) return;

  const state = detectionState;
  logger.debug('Detection phase timeout', { phase: state.phase });

  switch (state.phase) {
    case 'da1':
      // DA1 failed - cannot detect sixel, but still try to get cell size
      logger.warn('Sixel disabled - DA1 query timeout');
      state.capabilities.supported = false;
      state.capabilities.detectionMethod = 'env';
      state.phase = 'cellsize';  // Still query cell size for aspect ratio
      break;

    case 'xtsmgraphics-colors':
      // Use default color registers
      state.capabilities.colorRegisters = 256;
      state.phase = 'xtsmgraphics-geometry';
      break;

    case 'xtsmgraphics-geometry':
      // Skip geometry, continue to cell size
      state.phase = 'cellsize';
      break;

    case 'cellsize':
      // Cell size query failed
      if (state.capabilities.supported) {
        // Cell size is critical for sixel
        logger.warn('Sixel disabled - cell size query timeout');
        state.capabilities.supported = false;
      }
      state.phase = 'complete';
      break;
  }

  advanceDetectionPhase();
}

/**
 * Check and handle detection timeout (called by input loop periodically)
 */
export function checkDetectionTimeout(): void {
  if (!detectionState || detectionState.phase === 'idle' || detectionState.phase === 'complete') {
    return;
  }

  if (Date.now() - detectionState.startTime > detectionState.timeoutMs) {
    handlePhaseTimeout();
  }
}

/**
 * Start sixel capability detection.
 * Writes queries to terminal, responses are handled via feedDetectionInput().
 *
 * @param skipTerminalQueries - Skip terminal queries (for testing/CI)
 * @param timeoutMs - Timeout per query phase (default 100ms)
 */
export function startSixelDetection(
  skipTerminalQueries: boolean = false,
  timeoutMs: number = 100
): Promise<SixelCapabilities> {
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

  logger.debug('Starting sixel capability detection');

  // Start with defaults
  const capabilities: SixelCapabilities = { ...DEFAULT_CAPABILITIES };

  // Detect environment
  capabilities.inMultiplexer = detectMultiplexer();
  capabilities.isRemote = detectRemoteSession();

  // If in multiplexer, disable sixel
  if (capabilities.inMultiplexer) {
    logger.info('Sixel disabled - running in terminal multiplexer');
    capabilities.quirks.push('multiplexer-disabled');
    cachedCapabilities = capabilities;
    return Promise.resolve(capabilities);
  }

  // If over SSH, disable sixel (bandwidth concern - sixel is 10-100x larger than sextant)
  if (capabilities.isRemote) {
    logger.info('Sixel disabled - running over SSH (bandwidth optimization)');
    capabilities.quirks.push('ssh-disabled');
    cachedCapabilities = capabilities;
    return Promise.resolve(capabilities);
  }

  // Check environment hints
  const envCheck = checkTerminalEnv();
  capabilities.quirks.push(...envCheck.quirks);

  // Skip terminal queries if requested
  if (skipTerminalQueries) {
    logger.warn('Sixel disabled - terminal queries skipped');
    capabilities.supported = false;
    capabilities.detectionMethod = 'env';
    cachedCapabilities = capabilities;
    return Promise.resolve(capabilities);
  }

  // Check if stdout is a terminal
  if (!Deno.stdout.isTerminal()) {
    logger.debug('Not a terminal - sixel disabled');
    cachedCapabilities = capabilities;
    return Promise.resolve(capabilities);
  }

  return new Promise(resolve => {
    detectionState = {
      phase: 'da1',
      capabilities,
      responseBuffer: '',
      startTime: Date.now(),
      timeoutMs,
      resolve,
    };

    // Start first query
    advanceDetectionPhase();
  });
}

/**
 * Detect sixel capabilities (legacy sync-style API)
 * Now just starts detection and waits for completion.
 */
export async function detectSixelCapabilities(
  forceRedetect: boolean = false,
  skipTerminalQueries: boolean = false
): Promise<SixelCapabilities> {
  if (cachedCapabilities && !forceRedetect) {
    return cachedCapabilities;
  }

  if (forceRedetect) {
    cachedCapabilities = null;
    detectionState = null;
  }

  return startSixelDetection(skipTerminalQueries);
}

/**
 * Get cached sixel capabilities without triggering detection
 */
export function getCachedSixelCapabilities(): SixelCapabilities | null {
  return cachedCapabilities;
}

/**
 * Clear cached capabilities (for testing)
 */
export function clearSixelCapabilitiesCache(): void {
  cachedCapabilities = null;
  detectionState = null;
}

/**
 * Check if sixel is available (quick check using cache)
 */
export function isSixelAvailable(): boolean {
  return cachedCapabilities?.supported ?? false;
}
