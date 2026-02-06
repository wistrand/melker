// Audio capture and transcription for AI accessibility
// Based on debug_scripts/debug_audio_listen.ts and debug_scripts/debug_audio_analyze.ts

import { encodeBase64 } from "jsr:@std/encoding@^1.0.0/base64";
import { getLogger } from '../logging.ts';
import { getOpenRouterConfig } from './openrouter.ts';
import { MelkerConfig } from '../config/mod.ts';
import { ensureError } from '../utils/error.ts';

const logger = getLogger('ai:audio');

// Audio transcription model (supports audio input)
const AUDIO_MODEL = 'openai/gpt-4o-audio-preview'; // 'google/gemini-2.5-flash';
const TRANSCRIPTION_PROMPT = 'Transcribe this audio exactly. Output only the spoken words, nothing else. If there is no speech or the audio is unclear, respond with [no speech detected].';

// Silence detection threshold (RMS level below this is considered silence)
const SILENCE_THRESHOLD = 0.01;
// Duration of silence before auto-stop (milliseconds)
const SILENCE_TIMEOUT_MS = 2000;
// Default audio gain multiplier (1.0 = no change, 2.0 = double volume)
const DEFAULT_AUDIO_GAIN = 2.0;

interface AudioInput {
  format: string;
  device: string;
  description: string;
}

/**
 * Audio recorder that captures audio for a specified duration or until stopped
 */
export class AudioRecorder {
  private _process: Deno.ChildProcess | null = null;
  private _reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private _audioChunks: Uint8Array[] = [];
  private _isRecording = false;
  private _stopRequested = false;
  private _onLevelUpdate?: (level: number, remainingSeconds: number) => void;
  private _currentDeviceDescription: string | null = null;
  private _tempSwiftScript: string | null = null; // Temp file for remote Swift script

  /**
   * Check if currently recording
   */
  isRecording(): boolean {
    return this._isRecording;
  }

  /**
   * Set callback for audio level updates
   */
  setLevelCallback(callback: (level: number, remainingSeconds: number) => void): void {
    this._onLevelUpdate = callback;
  }

  /**
   * Get the current audio device description (available after recording starts)
   */
  getDeviceDescription(): string | null {
    return this._currentDeviceDescription;
  }

  /**
   * Start recording audio
   * @param durationSeconds Maximum recording duration (default: 5)
   * @returns Promise that resolves to WAV data as Uint8Array, or null if stopped early with no audio
   */
  async startRecording(durationSeconds: number = 5): Promise<Uint8Array | null> {
    if (this._isRecording) {
      logger.warn('Already recording');
      return null;
    }

    this._isRecording = true;
    this._stopRequested = false;
    this._audioChunks = [];

    const sampleRate = 16000;
    const channels = 1;
    const bitsPerSample = 16;

    // Get gain from config
    const config = MelkerConfig.get();
    const gain = config.aiAudioGain;

    try {
      // Use platform-specific recording
      const forceFFmpeg = config.terminalForceFFmpeg;
      if (Deno.build.os === 'darwin' && !forceFFmpeg) {
        return await this._recordMacOS(durationSeconds, gain, sampleRate, channels, bitsPerSample);
      } else {
        return await this._recordFFmpeg(durationSeconds, gain, sampleRate, channels, bitsPerSample);
      }
    } catch (error) {
      logger.error('Audio recording failed', ensureError(error));
      await this._cleanup();
      throw error;
    } finally {
      this._isRecording = false;
    }
  }

  /**
   * Get the Swift script path, downloading to temp file if running from remote URL
   */
  private async _getSwiftScriptPath(): Promise<string> {
    const scriptUrl = new URL('./macos-audio-record.swift', import.meta.url);

    // Check if running from a remote URL
    if (scriptUrl.protocol === 'http:' || scriptUrl.protocol === 'https:') {
      // Reuse existing temp file if available
      if (this._tempSwiftScript) {
        try {
          await Deno.stat(this._tempSwiftScript);
          return this._tempSwiftScript;
        } catch {
          // Temp file was deleted, need to re-download
          this._tempSwiftScript = null;
        }
      }

      // Fetch the Swift script from remote URL
      logger.info('Fetching Swift script from remote URL', { url: scriptUrl.href });
      const response = await fetch(scriptUrl.href);
      if (!response.ok) {
        throw new Error(`Failed to fetch Swift script: ${response.status} ${response.statusText}`);
      }
      const scriptContent = await response.text();

      // Write to temp file
      this._tempSwiftScript = await Deno.makeTempFile({ suffix: '.swift' });
      await Deno.writeTextFile(this._tempSwiftScript, scriptContent);
      logger.info('Swift script cached to temp file', { path: this._tempSwiftScript });

      return this._tempSwiftScript;
    }

    // Local file - use pathname directly
    return scriptUrl.pathname;
  }

  /**
   * Clean up temporary Swift script file if it exists
   */
  private async _cleanupTempSwiftScript(): Promise<void> {
    if (this._tempSwiftScript) {
      try {
        await Deno.remove(this._tempSwiftScript);
        logger.debug('Cleaned up temp Swift script', { path: this._tempSwiftScript });
      } catch {
        // Ignore cleanup errors
      }
      this._tempSwiftScript = null;
    }
  }

  /**
   * Record audio using the native Swift script on macOS
   */
  private async _recordMacOS(
    durationSeconds: number,
    gain: number,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
  ): Promise<Uint8Array | null> {
    // Get Swift script path (downloads to temp if remote)
    const scriptPath = await this._getSwiftScriptPath();

    logger.info('Starting macOS audio capture', { scriptPath, gain, durationSeconds });

    const command = new Deno.Command('swift', {
      args: [scriptPath, String(gain)],
      stdout: 'piped',
      stderr: 'piped',
    });

    this._process = command.spawn();
    this._reader = this._process.stdout.getReader();
    this._currentDeviceDescription = 'macOS';

    // Capture stderr for error detection
    const stderrReader = this._process.stderr.getReader();
    let stderrText = '';
    const stderrPromise = (async () => {
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await stderrReader.read();
        if (done) break;
        if (value) {
          stderrText += decoder.decode(value, { stream: true });
        }
      }
    })();

    // Start reading audio, but check for early stderr errors
    const result = await this._readAudioStream(durationSeconds, sampleRate, channels, bitsPerSample);

    // Wait briefly for any final stderr output
    await Promise.race([stderrPromise, new Promise(resolve => setTimeout(resolve, 100))]);

    // Check for errors in stderr
    if (stderrText) {
      const lines = stderrText.trim().split('\n');
      for (const line of lines) {
        if (line.startsWith('Error:') || line.toLowerCase().includes('error')) {
          logger.error('macOS audio error', new Error(line));
          // If we got no audio data, throw the error
          if (!result || result.length <= 44) {
            throw new Error(line);
          }
        }
      }
    }

    return result;
  }

  /**
   * Record audio using ffmpeg (Linux/Windows)
   */
  private async _recordFFmpeg(
    durationSeconds: number,
    gain: number,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
  ): Promise<Uint8Array | null> {
    const { args: inputArgs, description } = await this._getAudioInputArgs();
    this._currentDeviceDescription = description;
    logger.info('Starting audio capture', { description, durationSeconds });

    const ffmpegArgs = [
      ...inputArgs,
      '-af', `volume=${gain}`,  // Apply gain filter
      '-f', 's16le',
      '-ac', String(channels),
      '-ar', String(sampleRate),
      '-',
    ];

    const command = new Deno.Command('ffmpeg', {
      args: ffmpegArgs,
      stdout: 'piped',
      stderr: 'piped',
    });

    this._process = command.spawn();
    this._reader = this._process.stdout.getReader();

    // Consume stderr in background to prevent blocking
    const stderrReader = this._process.stderr.getReader();
    (async () => {
      while (true) {
        const { done } = await stderrReader.read();
        if (done) break;
      }
    })();

    return await this._readAudioStream(durationSeconds, sampleRate, channels, bitsPerSample);
  }

  /**
   * Read audio data from the stream and create WAV
   */
  private async _readAudioStream(
    durationSeconds: number,
    sampleRate: number,
    channels: number,
    bitsPerSample: number
  ): Promise<Uint8Array | null> {
    const startTime = Date.now();
    const durationMs = durationSeconds * 1000;
    let lastSoundTime = Date.now();
    let hasHadSound = false;

    while (!this._stopRequested) {
      const elapsed = Date.now() - startTime;
      if (elapsed >= durationMs) {
        logger.info('Recording duration reached');
        break;
      }

      const { value, done } = await this._reader!.read();
      if (done) {
        logger.warn('Audio stream ended unexpectedly');
        break;
      }

      this._audioChunks.push(new Uint8Array(value));

      // Calculate audio level (RMS)
      // Ensure we have an even number of bytes for Int16Array alignment
      const byteLength = value.byteLength - (value.byteLength % 2);
      if (byteLength < 2) {
        continue; // Skip if not enough data for at least one sample
      }
      const samples = new Int16Array(value.buffer, value.byteOffset, byteLength / 2);
      let sum = 0;
      for (const sample of samples) {
        sum += (sample / 32768) ** 2;
      }
      const rms = Math.sqrt(sum / samples.length);

      // Track silence duration for auto-stop
      if (rms > SILENCE_THRESHOLD) {
        lastSoundTime = Date.now();
        hasHadSound = true;
      } else if (hasHadSound) {
        // Only auto-stop after we've had some sound (not at the very beginning)
        const silenceDuration = Date.now() - lastSoundTime;
        if (silenceDuration >= SILENCE_TIMEOUT_MS) {
          logger.info('Auto-stopping due to silence', { silenceDuration });
          break;
        }
      }

      const remainingSeconds = Math.ceil((durationMs - elapsed) / 1000);
      if (this._onLevelUpdate) {
        this._onLevelUpdate(rms, remainingSeconds);
      }
    }

    // Stop the process
    await this._cleanup();

    if (this._audioChunks.length === 0) {
      logger.warn('No audio data captured');
      return null;
    }

    // Create WAV file
    const wavData = this._createWav(this._audioChunks, sampleRate, channels, bitsPerSample);
    logger.info('Audio capture complete', { bytes: wavData.length });

    return wavData;
  }

  /**
   * Stop recording early
   */
  async stopRecording(): Promise<void> {
    if (!this._isRecording) return;
    logger.info('Stop recording requested');
    this._stopRequested = true;
    // Give a moment for the loop to exit cleanly
    await new Promise(resolve => setTimeout(resolve, 100));
    await this._cleanup();
  }

  private async _cleanup(): Promise<void> {
    if (this._process) {
      try {
        this._process.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }
      this._process = null;
    }
    this._reader = null;
  }

  private async _getAudioInputArgs(): Promise<{ args: string[]; description: string }> {
    switch (Deno.build.os) {
      case 'darwin':
        // Used when MELKER_FFMPEG=true on macOS
        return {
          args: ['-f', 'avfoundation', '-i', ':0'],
          description: 'AVFoundation (macOS)',
        };
      case 'linux': {
        const audio = await this._detectLinuxAudioSystem();
        return {
          args: ['-f', audio.format, '-i', audio.device],
          description: audio.description,
        };
      }
      case 'windows':
        return {
          args: ['-f', 'dshow', '-i', 'audio=Microphone'],
          description: 'DirectShow (Windows)',
        };
      default:
        throw new Error(`Unsupported platform: ${Deno.build.os}`);
    }
  }

  private async _detectLinuxAudioSystem(): Promise<AudioInput> {
    // Try PulseAudio/PipeWire first
    try {
      const command = new Deno.Command('pactl', {
        args: ['list', 'sources', 'short'],
        stdout: 'piped',
        stderr: 'piped',
      });
      const { success, stdout } = await command.output();
      if (success) {
        const output = new TextDecoder().decode(stdout);
        const lines = output.trim().split('\n');
        for (const line of lines) {
          const parts = line.split('\t');
          if (parts.length >= 2 && !parts[1].includes('.monitor')) {
            return {
              format: 'pulse',
              device: parts[1],
              description: `PulseAudio (${parts[1]})`,
            };
          }
        }
        return {
          format: 'pulse',
          device: 'default',
          description: 'PulseAudio (default)',
        };
      }
    } catch {
      // PulseAudio not available
    }

    // Fallback to ALSA
    return {
      format: 'alsa',
      device: 'default',
      description: 'ALSA (default)',
    };
  }

  private _createWav(chunks: Uint8Array[], sampleRate: number, channels: number, bitsPerSample: number): Uint8Array {
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);

    // Create WAV header
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    const byteRate = sampleRate * channels * (bitsPerSample / 8);
    const blockAlign = channels * (bitsPerSample / 8);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + totalLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(36, 'data');
    view.setUint32(40, totalLength, true);

    // Combine header and audio data
    const wav = new Uint8Array(44 + totalLength);
    wav.set(new Uint8Array(header), 0);
    let offset = 44;
    for (const chunk of chunks) {
      wav.set(chunk, offset);
      offset += chunk.length;
    }

    return wav;
  }
}

// Minimum RMS threshold to consider audio as having meaningful content
// This is roughly equivalent to quiet speech
const MIN_RMS_THRESHOLD = 0.01;
// Minimum percentage of samples that must exceed the threshold
const MIN_ACTIVE_PERCENTAGE = 0.05;
// Padding to keep around trimmed audio (in samples) - ~200ms at 16kHz
const TRIM_PADDING_SAMPLES = 3200;

/**
 * Analyze audio chunks and return RMS values per chunk
 */
function analyzeAudioChunks(samples: Int16Array, chunkSize: number): { rmsValues: number[]; peakRms: number } {
  const rmsValues: number[] = [];
  let peakRms = 0;

  for (let i = 0; i < samples.length; i += chunkSize) {
    const end = Math.min(i + chunkSize, samples.length);
    let sum = 0;
    for (let j = i; j < end; j++) {
      const normalized = samples[j] / 32768;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / (end - i));
    rmsValues.push(rms);
    peakRms = Math.max(peakRms, rms);
  }

  return { rmsValues, peakRms };
}

/**
 * Check if audio data has meaningful volume (not just silence/noise)
 * @param wavData WAV audio data as Uint8Array
 * @returns true if audio has meaningful content, false if mostly silence
 */
export function hasAudioContent(wavData: Uint8Array): boolean {
  // Skip 44-byte WAV header
  if (wavData.length <= 44) {
    logger.warn('WAV data too short');
    return false;
  }

  // Extract raw PCM samples (16-bit signed integers)
  const pcmData = wavData.slice(44);
  const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, Math.floor(pcmData.length / 2));

  if (samples.length === 0) {
    logger.warn('No audio samples in WAV data');
    return false;
  }

  const chunkSize = 1600; // ~100ms at 16kHz
  const { rmsValues, peakRms } = analyzeAudioChunks(samples, chunkSize);

  const activeChunks = rmsValues.filter(rms => rms > MIN_RMS_THRESHOLD).length;
  const activePercentage = activeChunks / rmsValues.length;

  logger.info('Audio content analysis', {
    totalChunks: rmsValues.length,
    activeChunks,
    activePercentage: `${(activePercentage * 100).toFixed(1)}%`,
    peakRms: peakRms.toFixed(4),
    threshold: MIN_RMS_THRESHOLD
  });

  return activePercentage >= MIN_ACTIVE_PERCENTAGE;
}

/**
 * Trim silence from the beginning and end of audio data
 * @param wavData WAV audio data as Uint8Array
 * @returns Trimmed WAV data, or null if no meaningful content found
 */
export function trimSilence(wavData: Uint8Array): Uint8Array | null {
  // Skip 44-byte WAV header
  if (wavData.length <= 44) {
    logger.warn('WAV data too short to trim');
    return null;
  }

  // Extract raw PCM samples (16-bit signed integers)
  const pcmData = wavData.slice(44);
  const samples = new Int16Array(pcmData.buffer, pcmData.byteOffset, Math.floor(pcmData.length / 2));

  if (samples.length === 0) {
    logger.warn('No audio samples to trim');
    return null;
  }

  const chunkSize = 1600; // ~100ms at 16kHz
  const { rmsValues } = analyzeAudioChunks(samples, chunkSize);

  // Find first and last chunks with meaningful audio
  let firstActiveChunk = -1;
  let lastActiveChunk = -1;

  for (let i = 0; i < rmsValues.length; i++) {
    if (rmsValues[i] > MIN_RMS_THRESHOLD) {
      if (firstActiveChunk === -1) {
        firstActiveChunk = i;
      }
      lastActiveChunk = i;
    }
  }

  // No meaningful audio found
  if (firstActiveChunk === -1) {
    logger.info('No meaningful audio content found for trimming');
    return null;
  }

  // Count active chunks in the detected range
  const activeChunksInRange = rmsValues.slice(firstActiveChunk, lastActiveChunk + 1)
    .filter(rms => rms > MIN_RMS_THRESHOLD).length;
  const rangeLength = lastActiveChunk - firstActiveChunk + 1;
  const activeRatio = activeChunksInRange / rangeLength;

  // Require at least 20% of chunks in the active range to have meaningful audio
  // This filters out cases where there's just a single click/noise spike
  if (activeRatio < 0.2 || activeChunksInRange < 3) {
    logger.info('Insufficient audio content', {
      activeChunksInRange,
      rangeLength,
      activeRatio: `${(activeRatio * 100).toFixed(1)}%`
    });
    return null;
  }

  // Calculate sample indices with padding
  const startSample = Math.max(0, firstActiveChunk * chunkSize - TRIM_PADDING_SAMPLES);
  const endSample = Math.min(samples.length, (lastActiveChunk + 1) * chunkSize + TRIM_PADDING_SAMPLES);

  // If we're not trimming much, return original
  const trimmedLength = endSample - startSample;
  if (trimmedLength >= samples.length * 0.9) {
    logger.debug('Trimming would remove less than 10%, keeping original');
    return wavData;
  }

  logger.info('Trimming audio silence', {
    originalSamples: samples.length,
    trimmedSamples: trimmedLength,
    startMs: Math.round(startSample / 16),
    endMs: Math.round(endSample / 16),
    reduction: `${((1 - trimmedLength / samples.length) * 100).toFixed(1)}%`
  });

  // Extract trimmed samples
  const trimmedSamples = samples.slice(startSample, endSample);

  // Rebuild WAV file with trimmed data
  const trimmedPcmData = new Uint8Array(trimmedSamples.buffer, trimmedSamples.byteOffset, trimmedSamples.byteLength);

  // Read original WAV header values
  const originalView = new DataView(wavData.buffer, wavData.byteOffset, 44);
  const channels = originalView.getUint16(22, true);
  const sampleRate = originalView.getUint32(24, true);
  const bitsPerSample = originalView.getUint16(34, true);

  // Create new WAV with trimmed data
  const newWav = new Uint8Array(44 + trimmedPcmData.length);
  const view = new DataView(newWav.buffer);
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + trimmedPcmData.length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, trimmedPcmData.length, true);

  newWav.set(trimmedPcmData, 44);

  return newWav;
}

/**
 * Get the duration of WAV audio data in seconds
 */
export function getWavDuration(wavData: Uint8Array): number {
  if (wavData.length <= 44) return 0;

  const view = new DataView(wavData.buffer, wavData.byteOffset, 44);
  const sampleRate = view.getUint32(24, true);
  const bitsPerSample = view.getUint16(34, true);
  const channels = view.getUint16(22, true);
  const dataSize = wavData.length - 44;

  const bytesPerSample = (bitsPerSample / 8) * channels;
  const numSamples = dataSize / bytesPerSample;

  return numSamples / sampleRate;
}

/**
 * Play back WAV audio data using ffplay (for debugging)
 * @param wavData WAV audio data as Uint8Array
 */
async function playbackAudio(wavData: Uint8Array): Promise<void> {
  logger.info('Playing back recorded audio for debug...');

  // Write to temp file
  const tempFile = await Deno.makeTempFile({ suffix: '.wav' });
  try {
    await Deno.writeFile(tempFile, wavData);

    // Play using ffplay (quiet mode, no display)
    const command = new Deno.Command('ffplay', {
      args: ['-nodisp', '-autoexit', '-loglevel', 'quiet', tempFile],
      stdout: 'null',
      stderr: 'null',
    });

    const process = command.spawn();
    await process.status;
    logger.info('Audio playback complete');
  } finally {
    // Clean up temp file
    try {
      await Deno.remove(tempFile);
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Transcribe audio data using OpenRouter
 * @param wavData WAV audio data as Uint8Array
 * @param onStatus Optional callback for status updates (receives trimmed duration in seconds)
 * @returns Transcribed text, or null if transcription failed
 */
export async function transcribeAudio(
  wavData: Uint8Array,
  onStatus?: (durationSeconds: number) => void
): Promise<string | null> {
  const config = getOpenRouterConfig();
  if (!config) {
    logger.error('OpenRouter not configured for transcription');
    return null;
  }

  // Trim silence from beginning and end, also validates content exists
  const trimmedWav = trimSilence(wavData);
  if (!trimmedWav) {
    logger.info('Audio has no meaningful content, skipping transcription');
    return null;
  }

  const trimmedDuration = getWavDuration(trimmedWav);

  // Notify caller of the trimmed duration
  if (onStatus) {
    onStatus(trimmedDuration);
  }

  // Debug: play back the trimmed audio before sending
  const audioDebug = MelkerConfig.get().audioDebug;
  if (audioDebug) {
    await playbackAudio(trimmedWav);
  }

  logger.info('Transcribing audio', {
    originalBytes: wavData.length,
    trimmedBytes: trimmedWav.length,
    trimmedDuration: `${trimmedDuration.toFixed(1)}s`,
    reduction: `${((1 - trimmedWav.length / wavData.length) * 100).toFixed(1)}%`
  });

  // Encode to base64
  const audioBase64 = encodeBase64(trimmedWav);
  logger.debug('Audio encoded', { base64Length: audioBase64.length });

  const model = MelkerConfig.get().aiAudioModel;

  const endpoint = config.endpoint || 'https://openrouter.ai/api/v1/chat/completions';


  const requestBody = {
    model: model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: TRANSCRIPTION_PROMPT,
          },
          {
            type: 'input_audio',
            input_audio: {
              data: audioBase64,
              format: 'wav',
            },
          },
        ],
      },
    ],
  };

  // Build headers
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${config.apiKey}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': config.siteUrl || 'https://github.com/melker',
    'X-Title': config.siteName || 'Melker',
  };

  // Add custom headers from config
  const customHeaders = MelkerConfig.get().aiHeaders;
  if (customHeaders) {
    for (const [name, value] of Object.entries(customHeaders)) {
      if (name && value) {
        headers[name] = value;
      }
    }
  }


  try {
    const startTime = performance.now();
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody),
    });

    const elapsed = performance.now() - startTime;
    logger.info('Transcription response received', { elapsed: `${elapsed.toFixed(0)}ms`, status: response.status });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('Transcription API error', new Error(errorText), { status: response.status });
      return null;
    }

    const result = await response.json();
    const content = result.choices?.[0]?.message?.content;

    if (!content) {
      logger.error('No content in transcription response');
      return null;
    }

    // Check for "no speech" responses
    if (content.includes('[no speech detected]') || content.toLowerCase().includes('no speech')) {
      logger.info('No speech detected in audio');
      return null;
    }

    logger.info('Transcription complete', { length: content.length });
    return content.trim();
  } catch (error) {
    logger.error('Transcription failed', ensureError(error));
    return null;
  }
}
