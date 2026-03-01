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
 * If no response within timeout, kitty is not supported.
 */

import { getLogger } from '../logging.ts';
import { Env } from '../env.ts';
import { DetectionModule, writeDetectionQuery } from '../graphics/detection-base.ts';
import type { KittyCapabilities } from './types.ts';
import { stdout } from '../runtime/mod.ts';

const logger = getLogger('KittyDetect');

const DEFAULT_CAPABILITIES: KittyCapabilities = {
  supported: false,
  inMultiplexer: false,
  isRemote: false,
  detectionMethod: 'none',
};

const dm = new DetectionModule<KittyCapabilities>('kitty', DEFAULT_CAPABILITIES, logger);

// Query image ID - arbitrary value to match response
const QUERY_IMAGE_ID = 31;

// --- Protocol-specific helpers ---

function checkTerminalEnv(): { likelyKitty: boolean; terminalProgram?: string } {
  const termProgram = Env.get('TERM_PROGRAM') || '';
  const kittyWindowId = Env.get('KITTY_WINDOW_ID');
  const weztermPane = Env.get('WEZTERM_PANE');
  const ghosttyResourceDir = Env.get('GHOSTTY_RESOURCES_DIR');

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

  const kittyTerminals = ['kitty', 'WezTerm', 'Ghostty', 'ghostty', 'Konsole', 'konsole'];
  if (kittyTerminals.some(t => termProgram.toLowerCase().includes(t.toLowerCase()))) {
    logger.debug('Kitty-capable terminal detected via TERM_PROGRAM', { termProgram });
    return { likelyKitty: true, terminalProgram: termProgram };
  }

  return { likelyKitty: false };
}

function parseKittyResponse(response: string): { id: number; ok: boolean; error?: string } | null {
  const match = response.match(/\x1b_Gi=(\d+);([^\x1b]*)\x1b\\/);
  if (!match) return null;
  const id = parseInt(match[1], 10);
  const status = match[2];
  return { id, ok: status === 'OK', error: status !== 'OK' ? status : undefined };
}

function hasCompleteResponse(buffer: string): boolean {
  return /\x1b_Gi=\d+;[^\x1b]*\x1b\\/.test(buffer);
}

function looksLikeKittyResponse(combinedBuffer: string): boolean {
  return combinedBuffer.startsWith('\x1b_G');
}

function handleDetectionTimeout(): void {
  const state = dm.getState();
  if (!state) return;
  logger.debug('Kitty detection timeout - protocol not supported');
  state.capabilities.supported = false;
  state.capabilities.detectionMethod = 'none';
  state.phase = 'complete';
  dm.complete();
}

// --- Exported API (unchanged signatures) ---

export function isKittyDetectionInProgress(): boolean {
  return dm.isInProgress();
}

export function getKittyDetectionTimeout(): number {
  return dm.getTimeout();
}

export function feedKittyDetectionInput(data: Uint8Array): boolean {
  const guard = dm.feedGuards(data, handleDetectionTimeout);
  if (guard !== 'feed') return false;

  const state = dm.getState()!;
  const text = new TextDecoder().decode(data);

  if (!looksLikeKittyResponse(state.responseBuffer + text)) {
    logger.debug('User input during kitty detection - passing through', {
      inputPreview: text.slice(0, 10).replace(/\x1b/g, 'ESC'),
    });
    return false;
  }

  state.responseBuffer += text;

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
      dm.complete();
      return true;
    }
  }

  return true;
}

export function checkKittyDetectionTimeout(): void {
  dm.checkTimeout(handleDetectionTimeout);
}

export function startKittyDetection(
  skipTerminalQueries: boolean = false,
  timeoutMs: number = 100
): Promise<KittyCapabilities> {
  const early = dm.tryResolveEarly();
  if (early) return early;

  logger.debug('Starting kitty capability detection');
  const capabilities = dm.createCapabilities();

  if (capabilities.inMultiplexer) {
    logger.info('Kitty disabled - running in terminal multiplexer');
    return dm.earlyReturn(capabilities);
  }

  const envCheck = checkTerminalEnv();
  if (envCheck.terminalProgram) {
    capabilities.terminalProgram = envCheck.terminalProgram;
  }

  if (skipTerminalQueries) {
    logger.debug('Kitty detection skipped - terminal queries disabled');
    capabilities.supported = false;
    capabilities.detectionMethod = 'env';
    return dm.earlyReturn(capabilities);
  }

  if (!stdout.isTerminal()) {
    logger.debug('Not a terminal - kitty disabled');
    return dm.earlyReturn(capabilities);
  }

  if (!envCheck.likelyKitty) {
    logger.debug('No kitty environment hints - skipping query');
    capabilities.supported = false;
    capabilities.detectionMethod = 'env';
    return dm.earlyReturn(capabilities);
  }

  return new Promise(resolve => {
    dm.initState('query', capabilities, timeoutMs, resolve);
    const query = `\x1b_Gi=${QUERY_IMAGE_ID},s=1,v=1,a=q,t=d,f=24;AAAA\x1b\\`;
    writeDetectionQuery(query);
    logger.debug('Sent kitty query');
  });
}

export function detectKittyCapabilities(
  forceRedetect: boolean = false,
  skipTerminalQueries: boolean = false
): Promise<KittyCapabilities> {
  return dm.detectCapabilities(forceRedetect, () => startKittyDetection(skipTerminalQueries));
}

export function getCachedKittyCapabilities(): KittyCapabilities | null {
  return dm.getCached();
}

export function clearKittyCapabilitiesCache(): void {
  dm.clearCache();
}

export function isKittyAvailable(): boolean {
  return dm.isAvailable();
}
