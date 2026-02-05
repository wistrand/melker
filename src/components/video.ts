// Video component for video playback in terminal UI
// Extends CanvasElement with video-specific functionality

import { CanvasElement, CanvasProps } from './canvas.ts';
import { packRGBA, COLORS } from './color-utils.ts';
import { Element, Bounds, ComponentRenderContext } from '../types.ts';
import type { DualBuffer, Cell } from '../buffer.ts';
import { getLogger } from '../logging.ts';
import { getThemeManager } from '../theme.ts';
import { isRemoteUrl } from '../utils/content-loader.ts';
import {
  applyFloydSteinbergDither,
  applyFloydSteinbergStableDither,
  applyAtkinsonDither,
  applyAtkinsonStableDither,
  applyBlueNoiseDither,
  applyOrderedDither,
  applySierraDither,
  applySierraStableDither,
  colorSupportToBits,
  type DitherMode,
} from '../video/dither.ts';
import {
  findActiveCue,
  parseSrt,
  parseTimeString,
  type SubtitleCue,
} from '../video/subtitle.ts';
import {
  DEFAULT_WAVEFORM_OPTIONS,
  type WaveformOptions,
  type WaveformPosition,
  type WaveformStyle,
} from '../video/waveform.ts';
import {
  buildAudioExtractorArgs,
  buildAudioPlayerArgs,
  buildVideoDecoderArgs,
  calculateOutputDimensions,
  getVideoDimensions,
} from '../video/ffmpeg.ts';
import { MelkerConfig } from '../config/mod.ts';
import { getGlobalPaletteCache } from '../sixel/palette.ts';
import { isStdoutEnabled } from '../stdout.ts';

// Re-export types for backwards compatibility
export type { DitherMode } from '../video/dither.ts';
export type { WaveformOptions, WaveformPosition, WaveformStyle } from '../video/waveform.ts';

const logger = getLogger('video');

// Video playback options
export interface VideoOptions {
  fps?: number;              // Target frame rate (default: 30)
  loop?: boolean;            // Loop video playback (default: false)
  autoplay?: boolean;        // Start playing immediately (default: true)
  startTime?: number;        // Start playback at this timestamp in seconds
  onFrame?: (frame: number) => void;  // Callback per frame
  onEnd?: () => void;        // Callback when video ends
  onError?: (error: Error) => void;   // Callback on error
}

export interface VideoProps extends CanvasProps {
  src?: string;           // Video file path
  subtitle?: string;      // Path to .srt subtitle file
  startTime?: string;     // Start time as string (e.g., "1:30", "0:05:30", "90")
  autoplay?: boolean;     // Start playing automatically (default: true)
  loop?: boolean;         // Loop video playback (default: false)
  fps?: number;           // Target frame rate (default: 24)
  dither?: DitherMode | boolean;  // Dithering mode: 'ordered' (stable), 'floyd-steinberg', or boolean (default: false)
  colorDepth?: number;    // Bits per channel for dithering, 1-8 (default: from theme)
  muted?: boolean;        // Mute audio playback (default: false)
  audio?: boolean;        // Enable audio playback via ffplay (default: false)
  volume?: number;        // Audio volume 0-100 (default: 100)
  poster?: string;        // Image to show before video starts (not implemented yet)
  waveform?: boolean | WaveformOptions;  // Audio waveform overlay options
  onFrame?: (frame: number) => void;  // Callback per frame
  onEnd?: () => void;     // Callback when video ends
  onError?: (error: Error) => void;   // Callback on error
  onPlay?: () => void;    // Callback when playback starts
  onPause?: () => void;   // Callback when playback pauses
  renderCallback?: () => void;  // Callback to trigger re-render (required for autoplay)
}

export class VideoElement extends CanvasElement {
  declare props: VideoProps;

  private _autoplayStarted = false;
  private _lastBounds: Bounds | null = null;
  private _resizeInProgress = false;

  // Video playback support
  private _videoProcess: Deno.ChildProcess | null = null;
  private _videoPlaying: boolean = false;
  private _videoPaused: boolean = false;
  private _videoOptions: VideoOptions | null = null;
  private _videoFrameCount: number = 0;
  private _frameWriteInProgress: boolean = false;  // Guard against concurrent buffer access

  // Subtitle support
  private _subtitleCues: SubtitleCue[] = [];
  private _currentSubtitle: string | null = null;
  private _videoWidth: number = 0;
  private _videoHeight: number = 0;
  private _videoAbortController: AbortController | null = null;
  private _videoSrc: string | null = null;

  // Audio waveform support
  private _audioProcess: Deno.ChildProcess | null = null;
  private _audioSamples: Float32Array = new Float32Array(0);
  private _audioSampleRate: number = 44100;
  private _audioSamplesPerFrame: number = 0;
  // Reusable waveform buffers (avoid per-frame allocations)
  private _waveformData: Float32Array = new Float32Array(0);  // Normalized amplitudes 0-1
  private _waveformDataLength: number = 0;  // Actual used length
  private _resampledWaveform: Float32Array = new Float32Array(0);  // Resampled for rendering

  // Audio playback support (via ffplay)
  private _audioPlaybackProcess: Deno.ChildProcess | null = null;

  constructor(props: VideoProps, children: Element[] = []) {
    // Set default video props
    const videoProps: VideoProps = {
      autoplay: true,
      loop: false,
      fps: 24,
      dither: false,
      muted: false,
      ...props,
    };

    super(videoProps, children);

    // Override type to 'video'
    (this as unknown as { type: string }).type = 'video';

    // Warn about common sizing footgun: style dimensions don't affect buffer size
    if (props.style?.width !== undefined) {
      logger.warn(`video: style.width only affects layout, not buffer resolution. Use width prop for buffer sizing.`);
    }
    if (props.style?.height !== undefined) {
      logger.warn(`video: style.height only affects layout, not buffer resolution. Use height prop for buffer sizing.`);
    }
  }

  /**
   * Skip buffer copy since video rewrites buffers each frame.
   * - Image buffers: completely rewritten by _renderVideoFrame
   * - Drawing buffers: cleared per-region by _drawWaveformPixels (when enabled)
   * This avoids an O(n) copy per frame.
   */
  protected override _copyPreviousToCurrent(): void {
    // No-op: video doesn't need to preserve drawing buffer state
  }

  /**
   * Start video playback
   * @param startTime Optional timestamp in seconds to start from (overrides props.startTime)
   */
  async play(startTime?: number): Promise<void> {
    if (!this.props.src) {
      throw new Error('No video source specified');
    }

    // Load subtitles if specified
    if (this.props.subtitle) {
      await this._loadSubtitles(this.props.subtitle);
    }

    // Use provided startTime, or parse from props, or default to 0
    const effectiveStartTime = startTime ?? (this.props.startTime ? parseTimeString(this.props.startTime) : undefined);

    const options: VideoOptions = {
      fps: this.props.fps ?? 24,
      loop: this.props.loop ?? false,
      startTime: effectiveStartTime,
      onFrame: (frame: number) => {
        this.props.onFrame?.(frame);
        this._updateSubtitle();
        this.markDirty();
        this.props.renderCallback?.();
      },
      onEnd: () => {
        this.props.onEnd?.();
      },
      onError: (error: Error) => {
        this.props.onError?.(error);
      },
    };

    logger.info('Starting playback', { src: this.props.src, startTime: effectiveStartTime, fps: options.fps });
    this.props.onPlay?.();
    await this.playVideo(this.props.src, options);

    // Start audio stream for waveform if enabled
    const resolvedSrc = this.props.src.startsWith('/') ? this.props.src : `${Deno.cwd()}/${this.props.src}`;
    await this._startAudioStream(resolvedSrc, effectiveStartTime ?? 0);
  }

  /**
   * Load subtitles from an SRT file
   * If subtitlePath is ".srt", derives the path from the video source file
   */
  private async _loadSubtitles(subtitlePath: string): Promise<void> {
    try {
      let resolvedPath: string;

      if (subtitlePath === '.srt') {
        // Derive subtitle path from video source by replacing extension with .srt
        if (!this.props.src) {
          logger.warn('Cannot derive subtitle path: no video source specified');
          return;
        }
        if (isRemoteUrl(this.props.src)) {
          logger.info("no subtitles for remote video " + this.props.src);
          return;
        }

        const srcPath = this.props.src.startsWith('/') ? this.props.src : `${Deno.cwd()}/${this.props.src}`;
        // Replace extension with .srt
        const lastDot = srcPath.lastIndexOf('.');
        if (lastDot === -1) {
          resolvedPath = srcPath + '.srt';
        } else {
          resolvedPath = srcPath.substring(0, lastDot) + '.srt';
        }
        logger.info('Deriving subtitle path from video source', { videoSrc: this.props.src, subtitlePath: resolvedPath });
      } else {
        // Resolve relative paths from cwd
        resolvedPath = subtitlePath.startsWith('/') ? subtitlePath : `${Deno.cwd()}/${subtitlePath}`;
        logger.info('Loading subtitles from explicit path', { subtitlePath: resolvedPath });
      }

      logger.info('Reading subtitle file', { path: resolvedPath });
      const content = await Deno.readTextFile(resolvedPath);
      this._subtitleCues = parseSrt(content);
      this._currentSubtitle = null;
      logger.info('Loaded subtitles successfully', { path: resolvedPath, cueCount: this._subtitleCues.length });
    } catch (error) {
      logger.error('Failed to load subtitles: ' + String(error));
      this._subtitleCues = [];
    }
  }

  /**
   * Update the current subtitle based on playback timestamp
   */
  private _updateSubtitle(): void {
    if (this._subtitleCues.length === 0) {
      this._currentSubtitle = null;
      return;
    }

    const timestamp = this.getVideoTimestamp();
    const cue = findActiveCue(this._subtitleCues, timestamp);
    this._currentSubtitle = cue ? cue.text : null;
  }

  /**
   * Get the current subtitle text (if any)
   */
  getCurrentSubtitle(): string | null {
    return this._currentSubtitle;
  }

  /**
   * Start audio streaming for waveform display
   */
  private async _startAudioStream(src: string, startTime: number): Promise<void> {
    const waveformOpts = this._getWaveformOptions();
    if (!waveformOpts.enabled) return;

    // Stop any existing audio stream
    await this._stopAudioStream();

    const fps = this._videoOptions?.fps ?? 24;
    // Calculate samples per frame for audio-video sync
    this._audioSamplesPerFrame = Math.floor(this._audioSampleRate / fps);

    // Get buffer width for number of waveform columns
    const bufferSize = this.getBufferSize();
    const numColumns = bufferSize.width;

    // Spawn ffmpeg to extract audio as raw PCM samples
    const ffmpegArgs = buildAudioExtractorArgs(src, {
      startTime,
      sampleRate: this._audioSampleRate,
      channels: 1
    });

    const ffmpegCmd = new Deno.Command('ffmpeg', {
      args: ffmpegArgs,
      stdout: 'piped',
      stderr: 'piped'
    });

    this._audioProcess = ffmpegCmd.spawn();
    logger.info('Started audio stream for waveform', { src, startTime, samplesPerFrame: this._audioSamplesPerFrame });

    // Start reading audio samples
    this._readAudioSamples(numColumns).catch((error) => {
      logger.error('Audio stream error: ' + String(error));
    });
  }

  /**
   * Read audio samples from ffmpeg stdout
   */
  private async _readAudioSamples(numColumns: number): Promise<void> {
    if (!this._audioProcess) return;

    const reader = this._audioProcess.stdout.getReader();
    // Buffer to accumulate samples for analysis
    // Keep a rolling buffer of samples for the waveform display
    const samplesPerColumn = Math.ceil(this._audioSamplesPerFrame / numColumns);
    let sampleBuffer = new Float32Array(this._audioSamplesPerFrame * 2);  // 2 frames worth
    let sampleOffset = 0;

    try {
      while (this._videoPlaying) {
        if (this._videoPaused) {
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }

        const { done, value } = await reader.read();
        if (done) break;

        if (value) {
          // Convert 16-bit PCM to float samples
          const int16View = new Int16Array(value.buffer, value.byteOffset, value.byteLength / 2);

          for (let i = 0; i < int16View.length; i++) {
            if (sampleOffset >= sampleBuffer.length) {
              // Shift buffer - keep last half
              sampleBuffer.copyWithin(0, sampleBuffer.length / 2);
              sampleOffset = sampleBuffer.length / 2;
            }
            sampleBuffer[sampleOffset++] = int16View[i] / 32768.0;
          }

          // Update waveform data from recent samples
          this._updateWaveformData(sampleBuffer, sampleOffset, numColumns, samplesPerColumn);
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Update waveform data from audio samples
   */
  private _updateWaveformData(
    samples: Float32Array,
    sampleCount: number,
    numColumns: number,
    _samplesPerColumn: number
  ): void {
    // Use the most recent frame's worth of samples
    const startSample = Math.max(0, sampleCount - this._audioSamplesPerFrame);
    const frameSamples = sampleCount - startSample;

    // Ensure buffer is large enough (resize only when needed)
    if (this._waveformData.length < numColumns) {
      this._waveformData = new Float32Array(numColumns);
    }
    this._waveformDataLength = numColumns;

    const actualSamplesPerColumn = Math.ceil(frameSamples / numColumns);

    for (let col = 0; col < numColumns; col++) {
      const colStart = startSample + col * actualSamplesPerColumn;
      const colEnd = Math.min(colStart + actualSamplesPerColumn, sampleCount);

      // Find peak amplitude in this column's range
      let peak = 0;
      for (let i = colStart; i < colEnd; i++) {
        const abs = Math.abs(samples[i]);
        if (abs > peak) peak = abs;
      }

      this._waveformData[col] = peak;
    }

    if (this._waveformDataLength > 0 && this._videoFrameCount % 30 === 0) {
      let maxAmp = 0;
      for (let i = 0; i < this._waveformDataLength; i++) {
        if (this._waveformData[i] > maxAmp) maxAmp = this._waveformData[i];
      }
      logger.debug('Waveform data updated', { columns: this._waveformDataLength, maxAmplitude: maxAmp.toFixed(3) });
    }
  }

  /**
   * Stop audio streaming
   */
  private async _stopAudioStream(): Promise<void> {
    if (this._audioProcess) {
      try {
        this._audioProcess.kill('SIGTERM');
        await Promise.race([
          this._audioProcess.status.then(() => {}),
          new Promise<void>(resolve => setTimeout(resolve, 500))
        ]);
      } catch {
        // Ignore cleanup errors
      }
      try {
        this._audioProcess.kill('SIGKILL');
      } catch {
        // Already dead
      }
      this._audioProcess = null;
    }
    this._waveformDataLength = 0;  // Reset length, keep buffer allocated
  }

  /**
   * Start audio playback via ffplay (synchronized with video)
   */
  private _startAudioPlayback(src: string, startTime: number): void {
    // Skip audio in stdout mode (non-interactive single-frame output)
    if (isStdoutEnabled()) return;

    // Skip if audio is disabled, component is muted, or global audio is muted
    if (!this.props.audio || this.props.muted || MelkerConfig.get().audioMuted) return;

    // Stop any existing audio playback
    this._stopAudioPlayback();

    const args = [
      '-nodisp',      // No video display window
      '-autoexit',    // Exit when done
      '-vn',          // Disable video decoding
      '-loglevel', 'quiet',
    ];

    // Add seek position if needed
    if (startTime > 0) {
      args.push('-ss', String(startTime));
    }

    args.push('-i', src);

    // Add volume if specified
    if (this.props.volume !== undefined) {
      args.push('-volume', String(this.props.volume));
    }

    try {
      const cmd = new Deno.Command('ffplay', {
        args,
        stdout: 'null',
        stderr: 'null',
      });
      this._audioPlaybackProcess = cmd.spawn();
      logger.info('Started audio playback', { src, startTime, volume: this.props.volume });
    } catch (error) {
      logger.error('Failed to start audio playback: ' + String(error));
    }
  }

  /**
   * Stop audio playback
   */
  private async _stopAudioPlayback(): Promise<void> {
    if (!this._audioPlaybackProcess) return;

    try {
      this._audioPlaybackProcess.kill('SIGTERM');
      await Promise.race([
        this._audioPlaybackProcess.status.then(() => {}),
        new Promise<void>(resolve => setTimeout(resolve, 300))
      ]);
    } catch {
      // Ignore cleanup errors
    }
    try {
      this._audioPlaybackProcess.kill('SIGKILL');
    } catch {
      // Already dead
    }
    this._audioPlaybackProcess = null;
    logger.debug('Stopped audio playback');
  }

  /**
   * Get normalized waveform options
   */
  private _getWaveformOptions(): Required<WaveformOptions> {
    const waveform = this.props.waveform;

    if (!waveform) return DEFAULT_WAVEFORM_OPTIONS;
    if (typeof waveform === 'boolean') {
      return { ...DEFAULT_WAVEFORM_OPTIONS, enabled: waveform };
    }
    return {
      ...DEFAULT_WAVEFORM_OPTIONS,
      ...waveform,
      enabled: waveform.enabled ?? true
    };
  }

  /**
   * Draw the audio waveform using 2x3 sextant pixels for full resolution
   * This renders directly to the canvas drawing pixel buffer
   * @param frameX X offset of video frame in image buffer
   * @param frameY Y offset of video frame in image buffer
   * @param frameWidth Width of video frame
   * @param frameHeight Height of video frame
   */
  private _drawWaveformPixels(frameX: number, frameY: number, frameWidth: number, frameHeight: number): void {
    const opts = this._getWaveformOptions();
    if (!opts.enabled) return;

    // Calculate waveform region BEFORE clearing (needed for clearRect)
    const waveformHeightPixels = Math.min(opts.height * 3, frameHeight);
    let startYPixel: number;

    switch (opts.position) {
      case 'top':
        startYPixel = frameY;
        break;
      case 'overlay':
        // Center vertically within frame
        startYPixel = frameY + Math.floor((frameHeight - waveformHeightPixels) / 2);
        break;
      case 'bottom':
      default:
        startYPixel = frameY + frameHeight - waveformHeightPixels;
        break;
    }

    // Get buffer bounds for clipping
    const bufferSize = this.getBufferSize();
    const bufW = bufferSize.width;
    const bufH = bufferSize.height;

    // Calculate visible x range (clipped to buffer and frame)
    const visibleStartX = Math.max(0, Math.max(frameX, 0));
    const visibleEndX = Math.min(frameX + frameWidth, bufW);

    // Clear only the waveform region (not entire buffer)
    this.clearRect(visibleStartX, startYPixel, visibleEndX - visibleStartX, waveformHeightPixels);

    if (this._waveformDataLength === 0) {
      logger.debug('Waveform enabled but no data yet');
      return;
    }
    logger.debug('Drawing waveform', { dataLength: this._waveformDataLength, style: opts.style });

    // Set waveform color (must be different from DEFAULT_FG white to show on top of image)
    this.setColor(opts.color || 'cyan');

    // Resample waveform data to match frame width (reuse buffer)
    if (this._resampledWaveform.length < frameWidth) {
      this._resampledWaveform = new Float32Array(frameWidth);
    }
    const waveformLen = this._waveformDataLength;
    for (let px = 0; px < frameWidth; px++) {
      const dataIdx = Math.floor(px * waveformLen / frameWidth);
      this._resampledWaveform[px] = this._waveformData[Math.min(dataIdx, waveformLen - 1)] || 0;
    }

    if (opts.style === 'bars' || opts.style === 'filled') {
      // Draw vertical bars at each pixel column
      for (let px = 0; px < frameWidth; px++) {
        const screenX = frameX + px;
        // Skip if outside visible range
        if (screenX < visibleStartX || screenX >= visibleEndX) continue;

        const amplitude = this._resampledWaveform[px];
        const barHeightPixels = Math.round(amplitude * waveformHeightPixels);

        for (let py = 0; py < barHeightPixels; py++) {
          const screenY = startYPixel + waveformHeightPixels - 1 - py;
          // Bounds check Y
          if (screenY >= 0 && screenY < bufH) {
            this.setPixel(screenX, screenY, true);
          }
        }
      }
    } else if (opts.style === 'line') {
      // Draw connected line at amplitude level
      let prevY: number | null = null;

      for (let px = 0; px < frameWidth; px++) {
        const screenX = frameX + px;
        // Skip if outside visible range
        if (screenX < visibleStartX || screenX >= visibleEndX) continue;

        const amplitude = this._resampledWaveform[px];
        const lineY = startYPixel + waveformHeightPixels - 1 - Math.round(amplitude * (waveformHeightPixels - 1));

        // Bounds check Y before drawing
        if (lineY >= 0 && lineY < bufH) {
          this.setPixel(screenX, lineY, true);
        }

        // Connect to previous point with vertical line if needed
        if (prevY !== null && Math.abs(lineY - prevY) > 1) {
          const minY = Math.min(lineY, prevY);
          const maxY = Math.max(lineY, prevY);
          for (let y = minY + 1; y < maxY; y++) {
            // Bounds check Y
            if (y >= 0 && y < bufH) {
              this.setPixel(screenX, y, true);
            }
          }
        }
        prevY = lineY;
      }
    }
  }

  /**
   * Get current playback timestamp in seconds
   */
  getCurrentTime(): number {
    return this.getVideoTimestamp();
  }

  /**
   * Pause video playback
   */
  pause(): void {
    this.pauseVideo();
    this.props.onPause?.();
  }

  /**
   * Resume video playback
   */
  resume(): void {
    this.resumeVideo();
    this.props.onPlay?.();
  }

  /**
   * Stop video playback
   */
  async stop(): Promise<void> {
    await this.stopVideo();
  }

  /**
   * Check if currently playing
   */
  isPlaying(): boolean {
    return this.isVideoPlaying();
  }

  /**
   * Check if paused
   */
  isPaused(): boolean {
    return this.isVideoPaused();
  }

  /**
   * Set video source and optionally start playback
   */
  override async setSrc(src: string, autoplay = true): Promise<void> {
    this.props.src = src;
    if (autoplay) {
      await this.play();
    }
  }

  /**
   * Set the render callback (triggers autoplay if enabled)
   */
  setRenderCallback(callback: () => void): void {
    this.props.renderCallback = callback;
    // Trigger autoplay if conditions are met
    if (this.props.autoplay && this.props.src && !this._autoplayStarted) {
      this._autoplayStarted = true;
      this.play().catch((err) => {
        this.props.onError?.(err);
      });
    }
  }

  // Track if we've cleared the palette cache for this video session
  private _paletteCacheCleared = false;

  /**
   * Render the video element
   * Captures requestRender from context, handles auto-sizing and triggers autoplay
   */
  override render(bounds: Bounds, style: Partial<Cell>, buffer: DualBuffer, context: ComponentRenderContext): void {
    // IMPORTANT: Handle bounds/size changes BEFORE capturing render callback
    // because setRenderCallback triggers autoplay which needs correct buffer size
    const boundsChanged = !this._lastBounds ||
      this._lastBounds.width !== bounds.width ||
      this._lastBounds.height !== bounds.height;

    if (boundsChanged && !this._resizeInProgress) {
      logger.debug('Bounds changed', {
        old: this._lastBounds,
        new: { width: bounds.width, height: bounds.height }
      });

      // If this is the first render, just set the size
      if (!this._lastBounds) {
        this.setSize(bounds.width, bounds.height);
        this._lastBounds = { ...bounds };
      } else {
        // Size changed during playback - trigger async resize
        // Store target bounds for the async operation
        const targetWidth = bounds.width;
        const targetHeight = bounds.height;
        this._resizeInProgress = true;
        this.handleResize(targetWidth, targetHeight)
          .then(() => {
            this._resizeInProgress = false;
            // Only update _lastBounds on success
            this._lastBounds = { x: bounds.x, y: bounds.y, width: targetWidth, height: targetHeight };
            // Trigger a re-render after resize completes
            this.props.renderCallback?.();
          })
          .catch((err) => {
            this._resizeInProgress = false;
            // Don't update _lastBounds on failure - allows retry on next render
            logger.error('Auto-resize failed: ' + String(err));
            this.props.onError?.(err instanceof Error ? err : new Error(String(err)));
          });
      }
    }

    // Capture requestRender from context AFTER size is set
    // (setRenderCallback triggers autoplay which needs correct buffer size)
    if (context.requestRender && !this.props.renderCallback) {
      logger.debug('Captured requestRender from context');
      this.setRenderCallback(context.requestRender);
    }

    // Clear stale palette cache before first sixel render
    // This must happen before super.render() which calls _generateSixelOutput()
    if (!this._paletteCacheCleared) {
      const cacheKey = this.props.src || this.id;
      getGlobalPaletteCache().invalidate(cacheKey);
      this._paletteCacheCleared = true;
      logger.info('Cleared stale palette cache', { cacheKey });
    }

    // Call parent render
    super.render(bounds, style, buffer, context);

    // Overlay subtitle if present
    if (this._currentSubtitle) {
      this._renderSubtitle(bounds, buffer);
    }
  }

  /**
   * Render subtitle text at the bottom of the video
   */
  private _renderSubtitle(bounds: Bounds, buffer: DualBuffer): void {
    if (!this._currentSubtitle) return;

    const lines = this._currentSubtitle.split('\n');
    const maxWidth = bounds.width - 4; // Leave 2 char margin on each side

    // Word-wrap lines if needed
    const wrappedLines: string[] = [];
    for (const line of lines) {
      if (line.length <= maxWidth) {
        wrappedLines.push(line);
      } else {
        // Simple word wrap
        const words = line.split(' ');
        let currentLine = '';
        for (const word of words) {
          if (currentLine.length + word.length + 1 <= maxWidth) {
            currentLine += (currentLine ? ' ' : '') + word;
          } else {
            if (currentLine) wrappedLines.push(currentLine);
            currentLine = word;
          }
        }
        if (currentLine) wrappedLines.push(currentLine);
      }
    }

    // Position subtitles at bottom with 1 row margin
    const startY = bounds.y + bounds.height - wrappedLines.length - 1;

    for (let i = 0; i < wrappedLines.length; i++) {
      const text = wrappedLines[i];
      const y = startY + i;

      if (y < bounds.y || y >= bounds.y + bounds.height) continue;

      // Center the text
      const startX = bounds.x + Math.floor((bounds.width - text.length) / 2);

      // Render each character
      for (let j = 0; j < text.length; j++) {
        const x = startX + j;
        if (x < bounds.x || x >= bounds.x + bounds.width) continue;

        // Set the character with high contrast (white on black)
        buffer.currentBuffer.setCell(x, y, {
          char: text[j],
          foreground: COLORS.white,
          background: COLORS.black,
          bold: true,
        });
      }
    }
  }

  /**
   * Handle resize - save timestamp, stop ffmpeg, resize buffers, restart at saved position
   * This properly rescales the video to the new terminal size
   */
  async handleResize(width: number, height: number): Promise<void> {
    const wasPlaying = this.isPlaying();
    const wasPaused = this.isPaused();
    const currentTime = this.getCurrentTime();
    const src = this.props.src;

    logger.info('handleResize starting', {
      width, height, wasPlaying, wasPaused, currentTime, src
    });

    try {
      // Stop ffmpeg completely
      if (wasPlaying || wasPaused) {
        logger.info('Stopping video for resize');
        await this.stop();
        logger.info('Video stopped successfully');
      }

      // Resize all buffers
      logger.info('Resizing buffers', { width, height });
      this.setSize(width, height);
      logger.info('Buffers resized successfully');

      // Restart at saved timestamp if was playing
      if ((wasPlaying || wasPaused) && src) {
        logger.info('Restarting video at timestamp', { currentTime });
        await this.play(currentTime);
        // If it was paused, pause again after restart
        if (wasPaused) {
          this.pause();
        }
        logger.info('Video restarted successfully');
      }
    } catch (err) {
      logger.error('handleResize failed: ' + String(err));
      if (err instanceof Error && err.stack) {
        logger.error('Stack trace: ' + err.stack);
      }
      this.props.onError?.(err instanceof Error ? err : new Error(String(err)));
      throw err; // Re-throw so caller knows about the failure
    }
  }

  // ============================================
  // Video Playback Methods
  // ============================================

  /**
   * Play a video file, streaming frames to the canvas background.
   * Requires ffmpeg to be installed and available in PATH.
   * @param src Path to the video file - relative paths resolve from cwd
   * @param options Video playback options
   */
  async playVideo(src: string, options?: VideoOptions): Promise<void> {
    // Stop any existing video
    await this.stopVideo();

    // Resolve relative paths from cwd
    const resolvedSrc = isRemoteUrl(src)
      ? src
      : (src.startsWith('/') ? src : `${Deno.cwd()}/${src}`);

    // Reset palette cache flag so next render clears stale cache
    this._paletteCacheCleared = false;

    this._videoSrc = resolvedSrc;
    this._videoOptions = {
      fps: 30,
      loop: false,
      autoplay: true,
      ...options
    };

    this._videoFrameCount = 0;
    this._videoAbortController = new AbortController();

    // Get video dimensions using ffprobe utility
    const videoDims = await getVideoDimensions(resolvedSrc);
    this._videoWidth = videoDims.width;
    this._videoHeight = videoDims.height;

    // Calculate output size to match buffer while maintaining aspect ratio
    const bufferSize = this.getBufferSize();
    const bufW = bufferSize.width;
    const bufH = bufferSize.height;
    const pixelAspect = this.getPixelAspectRatio();

    const outputDims = calculateOutputDimensions(
      this._videoWidth,
      this._videoHeight,
      bufW,
      bufH,
      pixelAspect
    );
    const outputW = outputDims.width;
    const outputH = outputDims.height;
    const frameSize = outputW * outputH * 4;
    logger.info('Video output dimensions', {
      bufW, bufH, videoW: this._videoWidth, videoH: this._videoHeight,
      pixelAspect: pixelAspect.toFixed(3), outputW, outputH, frameSize
    });

    // Spawn ffmpeg to decode video and output raw RGBA frames
    const fps = this._videoOptions.fps!;
    const startTime = this._videoOptions.startTime ?? 0;

    const ffmpegArgs = buildVideoDecoderArgs(resolvedSrc, {
      startTime,
      outputWidth: outputW,
      outputHeight: outputH,
      fps
    });

    logger.info('ffmpeg command', { args: ffmpegArgs.join(' ') });

    const ffmpegCmd = new Deno.Command('ffmpeg', {
      args: ffmpegArgs,
      stdout: 'piped',
      stderr: 'piped'
    });

    this._videoProcess = ffmpegCmd.spawn();
    this._videoPlaying = true;
    this._videoPaused = false;

    // Start audio playback simultaneously (Option A: shared start time for sync)
    this._startAudioPlayback(resolvedSrc, startTime);

    // Log ffmpeg stderr for debugging frame alignment issues
    (async () => {
      const stderrReader = this._videoProcess!.stderr.getReader();
      const decoder = new TextDecoder();
      let stderrBuffer = '';
      try {
        while (true) {
          const { done, value } = await stderrReader.read();
          if (done) break;
          stderrBuffer += decoder.decode(value, { stream: true });
          // Log lines as they come in
          const lines = stderrBuffer.split('\n');
          stderrBuffer = lines.pop() || '';
          for (const line of lines) {
            if (line.trim()) {
              logger.debug('ffmpeg stderr', { line: line.trim() });
            }
          }
        }
      } finally {
        stderrReader.releaseLock();
      }
    })();

    // Start frame reading loop
    this._readVideoFrames(outputW, outputH).catch((error) => {
      if (this._videoOptions?.onError) {
        this._videoOptions.onError(error);
      }
      this.stopVideo();
    });
  }

  /**
   * Internal method to read and render video frames from ffmpeg stdout
   * Implements frame skipping when rendering can't keep up with playback
   */
  private async _readVideoFrames(frameWidth: number, frameHeight: number): Promise<void> {
    if (!this._videoProcess || !this._videoOptions) return;

    const reader = this._videoProcess.stdout.getReader();
    const frameSize = frameWidth * frameHeight * 4; // RGBA = 4 bytes per pixel
    const frameBuffer = new Uint8Array(frameSize);
    let frameOffset = 0;
    const fps = this._videoOptions.fps!;
    const frameInterval = 1000 / fps;

    // Frame skipping: track where we should be vs where we are
    const playbackStartTime = performance.now();
    let framesDecoded = 0;
    let framesRendered = 0;
    let framesSkipped = 0;

    logger.info('Starting frame reader', { frameWidth, frameHeight, frameSize, fps });

    try {
      while (this._videoPlaying) {
        // Check for abort
        if (this._videoAbortController?.signal.aborted) {
          break;
        }

        // Handle pause
        if (this._videoPaused) {
          await new Promise(resolve => setTimeout(resolve, 50));
          continue;
        }

        const { done, value } = await reader.read();

        if (done) {
          // Video ended
          logger.info('Video playback stats', { framesDecoded, framesRendered, framesSkipped });
          if (this._videoOptions.loop) {
            // Restart the video
            reader.releaseLock();
            await this._restartVideo();
            return;
          } else {
            // End playback
            if (this._videoOptions.onEnd) {
              this._videoOptions.onEnd();
            }
            break;
          }
        }

        if (value) {
          // Accumulate data into frame buffer
          let dataOffset = 0;
          while (dataOffset < value.length) {
            const remaining = frameSize - frameOffset;
            const toCopy = Math.min(remaining, value.length - dataOffset);
            frameBuffer.set(value.subarray(dataOffset, dataOffset + toCopy), frameOffset);
            frameOffset += toCopy;
            dataOffset += toCopy;

            // Complete frame ready
            if (frameOffset >= frameSize) {
              framesDecoded++;
              frameOffset = 0;

              // Frame skipping logic: check if we're behind schedule
              const now = performance.now();
              const elapsed = now - playbackStartTime;
              const expectedFrame = Math.floor(elapsed / frameInterval);

              // Skip this frame if we're more than 1 frame behind
              // (keep the data in buffer, but don't render it)
              if (framesDecoded < expectedFrame - 1) {
                framesSkipped++;
                // Still update frame count for timestamp tracking
                this._videoFrameCount++;
                continue;
              }

              // If we're ahead of schedule, wait
              const targetTime = framesDecoded * frameInterval;
              if (elapsed < targetTime) {
                await new Promise(resolve => setTimeout(resolve, targetTime - elapsed));
              }

              // Render this frame
              this._renderVideoFrame(frameBuffer, frameWidth, frameHeight);
              this._videoFrameCount++;
              framesRendered++;

              // Callback
              if (this._videoOptions?.onFrame) {
                this._videoOptions.onFrame(this._videoFrameCount);
              }

              // Log frame skip stats periodically
              if (framesDecoded % 100 === 0 && framesSkipped > 0) {
                logger.debug('Frame skip stats', {
                  decoded: framesDecoded,
                  rendered: framesRendered,
                  skipped: framesSkipped,
                  skipRate: `${((framesSkipped / framesDecoded) * 100).toFixed(1)}%`,
                });
              }
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
      logger.info('Video playback ended', { framesDecoded, framesRendered, framesSkipped });
    }
  }

  /**
   * Render a single video frame to the image background buffer
   * Optimized for minimal overhead per pixel
   */
  private _renderVideoFrame(frameData: Uint8Array, frameWidth: number, frameHeight: number): void {
    // Guard against concurrent access - if a write is in progress, skip this frame
    // This prevents race conditions where render reads partial frame data
    if (this._frameWriteInProgress) {
      logger.warn('Frame write already in progress, skipping frame', { frameCount: this._videoFrameCount });
      return;
    }
    this._frameWriteInProgress = true;

    const bufferSize = this.getBufferSize();
    const bufW = bufferSize.width;
    const bufH = bufferSize.height;

    // Validate frame fits in buffer (catch any size mismatch bugs)
    if (frameWidth > bufW || frameHeight > bufH) {
      logger.error('Frame size exceeds buffer', undefined, { frameWidth, frameHeight, bufW, bufH });
      this._frameWriteInProgress = false;
      return;  // Skip this frame rather than corrupt the buffer
    }

    // Validate buffer dimensions match actual buffer size
    const expectedBufSize = bufW * bufH;
    const actualBufSize = this.getImageColorBuffer().length;
    if (actualBufSize !== expectedBufSize) {
      logger.error('Buffer size mismatch!', undefined, {
        bufW, bufH,
        expectedSize: expectedBufSize,
        actualSize: actualBufSize,
        frameWidth, frameHeight
      });
      this._frameWriteInProgress = false;
      return;
    }

    // Apply dithering if enabled
    let dither = this.props.dither;
    const isSixel = this.isSixelMode();

    // For sixel mode, default to dithering if not explicitly set
    // This helps median-cut quantization by reducing unique color count
    if (dither === undefined && isSixel) {
      dither = 'auto';
    }

    // Handle 'auto' mode based on config and theme
    if (dither === 'auto') {
      const config = MelkerConfig.get();
      const configDither = config.ditherAlgorithm;
      const configBits = config.ditherBits;

      if (configDither) {
        // Config dither.algorithm is always respected
        dither = configDither as DitherMode;
      } else if (configBits !== undefined) {
        // User specified bits but not algorithm - use blue-noise for video
        dither = 'blue-noise';
      } else if (isSixel) {
        // Sixel mode: always use dithering to reduce color count for better quantization
        dither = 'blue-noise';
      } else {
        // No config override - use theme-based defaults
        const theme = getThemeManager().getCurrentTheme();
        if (theme.type === 'fullcolor') {
          // Fullcolor theme: no dithering needed
          dither = false;
        } else {
          // bw, gray, or color themes: use blue-noise for video (less temporal flicker)
          dither = 'blue-noise';
        }
      }
    }

    if (dither && dither !== 'none') {
      // Use explicit colorDepth if set, then config, otherwise derive from theme's color support
      // For sixel mode, default to 4 bits to ensure good palette quantization
      const config = MelkerConfig.get();
      const sixelDefaultBits = 4; // 16 levels per channel = 4096 colors, good for median-cut
      const bits = this.props.colorDepth ?? config.ditherBits ?? (isSixel ? sixelDefaultBits : colorSupportToBits(getThemeManager().getColorSupport()));

      // Determine dither mode: true defaults to 'floyd-steinberg-stable', string specifies mode
      const mode: DitherMode = typeof dither === 'boolean' ? 'floyd-steinberg-stable' : dither;

      if (mode === 'ordered') {
        applyOrderedDither(frameData, frameWidth, frameHeight, bits);
      } else if (mode === 'floyd-steinberg') {
        applyFloydSteinbergDither(frameData, frameWidth, frameHeight, bits);
      } else if (mode === 'floyd-steinberg-stable') {
        applyFloydSteinbergStableDither(frameData, frameWidth, frameHeight, bits);
      } else if (mode === 'sierra') {
        applySierraDither(frameData, frameWidth, frameHeight, bits);
      } else if (mode === 'sierra-stable') {
        applySierraStableDither(frameData, frameWidth, frameHeight, bits);
      } else if (mode === 'atkinson') {
        applyAtkinsonDither(frameData, frameWidth, frameHeight, bits);
      } else if (mode === 'atkinson-stable') {
        applyAtkinsonStableDither(frameData, frameWidth, frameHeight, bits);
      } else if (mode === 'blue-noise') {
        applyBlueNoiseDither(frameData, frameWidth, frameHeight, bits);
      }
    }

    // Calculate offset to center the frame
    // IMPORTANT: Align offsets to sextant character boundaries (2 pixels horizontal, 3 pixels vertical)
    // This ensures clean rendering without mixing frame and border in the same terminal cell
    let offsetX = Math.floor((bufW - frameWidth) / 2);
    let offsetY = Math.floor((bufH - frameHeight) / 2);

    // Round offsets to nearest character boundary
    offsetX = Math.floor(offsetX / 2) * 2;  // Align to 2-pixel boundary (horizontal sextant width)
    offsetY = Math.floor(offsetY / 3) * 3;  // Align to 3-pixel boundary (vertical sextant height)

    // Log first frame rendering details only
    if (this._videoFrameCount === 0) {
      const imageColorBuffer = this.getImageColorBuffer();
      logger.info('Frame render details', {
        frameNum: this._videoFrameCount,
        bufW, bufH, frameWidth, frameHeight, offsetX, offsetY,
        frameDataLen: frameData.length, expectedLen: frameWidth * frameHeight * 4,
        colorBufLen: imageColorBuffer.length,
        expectedBufLen: bufW * bufH,
        startX: Math.max(0, -offsetX),
        startY: Math.max(0, -offsetY),
        endX: Math.min(frameWidth, bufW - offsetX),
        endY: Math.min(frameHeight, bufH - offsetY)
      });
    }

    // Get direct access to image color buffer for faster writes
    const imageColorBuffer = this.getImageColorBuffer();

    // Pre-compute all bounds once (removes per-pixel checks)
    // These are guaranteed valid by the frame/buffer size validation above
    const startX = offsetX < 0 ? -offsetX : 0;
    const startY = offsetY < 0 ? -offsetY : 0;
    const endX = frameWidth < bufW - offsetX ? frameWidth : bufW - offsetX;
    const endY = frameHeight < bufH - offsetY ? frameHeight : bufH - offsetY;

    // Pre-compute row width multiplier
    const frameWidth4 = frameWidth << 2;  // * 4 for RGBA

    // Copy frame data to image color buffer (optimized inner loop)
    // All bounds checks removed - guaranteed safe by pre-computed bounds
    // TRANSPARENT (0) means pixel off, any other color means pixel on
    for (let y = startY; y < endY; y++) {
      const srcRowStart = y * frameWidth4;
      const dstRowStart = (offsetY + y) * bufW + offsetX;

      for (let x = startX; x < endX; x++) {
        const srcIdx = srcRowStart + (x << 2);
        const dstIdx = dstRowStart + x;

        // Direct array access - no bounds checks needed
        const r = frameData[srcIdx];
        const g = frameData[srcIdx + 1];
        const b = frameData[srcIdx + 2];
        const a = frameData[srcIdx + 3];

        // If alpha < 128, treat as transparent (pixel off)
        // Otherwise, pack RGBA into the color buffer (pixel on)
        imageColorBuffer[dstIdx] = a < 128 ? 0 : ((r << 24) | (g << 16) | (b << 8) | a);
      }
    }

    // Clear pixels outside the video frame area (edges)
    // Optimized: use fill() for contiguous regions where possible
    const topEdgeEnd = offsetY < bufH ? offsetY : bufH;
    const bottomEdgeStart = offsetY + frameHeight;
    const rightEdgeStart = offsetX + frameWidth;

    // Top edge - clear entire rows
    if (topEdgeEnd > 0) {
      const topPixels = topEdgeEnd * bufW;
      imageColorBuffer.fill(0, 0, topPixels);
    }

    // Bottom edge - clear entire rows
    if (bottomEdgeStart < bufH) {
      const bottomStart = bottomEdgeStart * bufW;
      const bottomEnd = bufH * bufW;
      imageColorBuffer.fill(0, bottomStart, bottomEnd);
    }

    // Left and right edges (within video rows) - must loop per row
    const videoRowEnd = (offsetY + frameHeight) < bufH ? (offsetY + frameHeight) : bufH;
    for (let y = offsetY; y < videoRowEnd; y++) {
      const rowStart = y * bufW;

      // Left edge
      if (offsetX > 0) {
        imageColorBuffer.fill(0, rowStart, rowStart + offsetX);
      }

      // Right edge
      if (rightEdgeStart < bufW) {
        imageColorBuffer.fill(0, rowStart + rightEdgeStart, rowStart + bufW);
      }
    }

    // Draw waveform overlay on top of video frame, constrained to frame bounds
    this._drawWaveformPixels(offsetX, offsetY, frameWidth, frameHeight);

    this.markDirty();
    this._frameWriteInProgress = false;
  }

  /**
   * Restart video playback (for looping)
   */
  private async _restartVideo(): Promise<void> {
    if (!this._videoOptions || !this._videoSrc) return;

    // Kill current video process
    if (this._videoProcess) {
      try {
        this._videoProcess.kill('SIGTERM');
        await this._videoProcess.status;
      } catch {
        // Ignore cleanup errors
      }
      this._videoProcess = null;
    }

    // Stop audio playback (will be restarted by playVideo)
    await this._stopAudioPlayback();

    // Store options and restart
    const src = this._videoSrc;
    const options = { ...this._videoOptions };
    this._videoProcess = null;
    this._videoPlaying = false;

    // Restart playback (this will also restart audio)
    await this.playVideo(src, options);
  }

  /**
   * Stop video playback
   */
  async stopVideo(): Promise<void> {
    this._videoPlaying = false;
    this._videoPaused = false;

    // Signal abort
    if (this._videoAbortController) {
      this._videoAbortController.abort();
      this._videoAbortController = null;
    }

    // Kill ffmpeg process with timeout to prevent hanging
    if (this._videoProcess) {
      try {
        this._videoProcess.kill('SIGTERM');
        // Wait for process to exit with a timeout
        const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 1000));
        await Promise.race([
          this._videoProcess.status.then(() => {}),
          timeoutPromise
        ]);
      } catch {
        // Ignore cleanup errors
      }
      // Force kill if still running
      try {
        this._videoProcess.kill('SIGKILL');
      } catch {
        // Already dead
      }
      this._videoProcess = null;
    }

    this._videoOptions = null;
    this._videoFrameCount = 0;
    this._videoSrc = null;

    // Stop audio stream (waveform)
    await this._stopAudioStream();

    // Stop audio playback (ffplay)
    await this._stopAudioPlayback();
  }

  /**
   * Pause video playback
   */
  pauseVideo(): void {
    if (this._videoPlaying && !this._videoPaused) {
      this._videoPaused = true;
      // Pause audio playback via SIGSTOP
      if (this._audioPlaybackProcess) {
        try {
          this._audioPlaybackProcess.kill('SIGSTOP');
        } catch {
          // Ignore errors (process may have exited)
        }
      }
    }
  }

  /**
   * Resume video playback
   */
  resumeVideo(): void {
    if (this._videoPlaying && this._videoPaused) {
      this._videoPaused = false;
      // Resume audio playback via SIGCONT
      if (this._audioPlaybackProcess) {
        try {
          this._audioPlaybackProcess.kill('SIGCONT');
        } catch {
          // Ignore errors (process may have exited)
        }
      }
    }
  }

  /**
   * Check if video is currently playing
   */
  isVideoPlaying(): boolean {
    return this._videoPlaying && !this._videoPaused;
  }

  /**
   * Check if video is paused
   */
  isVideoPaused(): boolean {
    return this._videoPlaying && this._videoPaused;
  }

  /**
   * Get the current video frame count
   */
  getVideoFrameCount(): number {
    return this._videoFrameCount;
  }

  /**
   * Get the current video playback timestamp in seconds
   * Calculated from frame count and fps, plus any initial startTime
   */
  getVideoTimestamp(): number {
    const fps = this._videoOptions?.fps ?? 30;
    const startTime = this._videoOptions?.startTime ?? 0;
    return startTime + (this._videoFrameCount / fps);
  }

  /**
   * Get video dimensions (after loading)
   */
  getVideoSize(): { width: number; height: number } | null {
    if (!this._videoPlaying && this._videoWidth === 0) return null;
    return { width: this._videoWidth, height: this._videoHeight };
  }

  /**
   * Validate video props
   */
  static override validate(props: VideoProps): boolean {
    if (props.width !== undefined && (typeof props.width !== 'number' || props.width <= 0)) {
      return false;
    }
    if (props.height !== undefined && (typeof props.height !== 'number' || props.height <= 0)) {
      return false;
    }
    if (props.fps !== undefined && (typeof props.fps !== 'number' || props.fps <= 0)) {
      return false;
    }
    return true;
  }
}

// Lint schema for video component
import { registerComponent } from '../element.ts';
import { registerComponentSchema, type ComponentSchema } from '../lint.ts';

export const videoSchema: ComponentSchema = {
  description: 'Video player with audio support using FFmpeg',
  props: {
    src: { type: 'string', description: 'Video file path or URL' },
    subtitle: { type: 'string', description: 'Subtitle file path (.srt)' },
    startTime: { type: ['string', 'number'], description: 'Start time ("1:30" or seconds)' },
    autoplay: { type: 'boolean', description: 'Start playing automatically' },
    loop: { type: 'boolean', description: 'Loop playback' },
    fps: { type: 'number', description: 'Playback frames per second' },
    dither: { type: ['string', 'boolean'], enum: ['auto', 'none', 'floyd-steinberg', 'floyd-steinberg-stable', 'sierra', 'sierra-stable', 'atkinson', 'atkinson-stable', 'ordered', 'blue-noise'], description: 'Dithering algorithm (auto adapts to theme, none disables)' },
    colorDepth: { type: 'number', description: 'Color bit depth' },
    muted: { type: 'boolean', description: 'Mute audio' },
    audio: { type: 'boolean', description: 'Enable audio playback' },
    volume: { type: 'number', description: 'Audio volume (0-1)' },
    poster: { type: 'string', description: 'Poster image path' },
    waveform: { type: ['boolean', 'object'], description: 'Show audio waveform' },
    onFrame: { type: 'function', description: 'Frame render callback' },
    onEnd: { type: 'function', description: 'Playback ended callback' },
    onPlay: { type: ['function', 'string'], description: 'Playback started callback' },
    onPause: { type: ['function', 'string'], description: 'Playback paused callback' },
    onError: { type: ['function', 'string'], description: 'Error callback' },
    width: { type: 'number', required: true, description: 'Video width in pixels' },
    height: { type: 'number', required: true, description: 'Video height in pixels' },
    scale: { type: 'number', description: 'Scaling factor' },
    backgroundColor: { type: 'string', description: 'Background color' },
    charAspectRatio: { type: 'number', description: 'Character aspect ratio' },
  },
  styleWarnings: {
    width: 'Use width prop instead of style.width for video buffer sizing. style.width only affects layout, not pixel resolution.',
    height: 'Use height prop instead of style.height for video buffer sizing. style.height only affects layout, not pixel resolution.',
  },
};

registerComponentSchema('video', videoSchema);

// Register video component
registerComponent({
  type: 'video',
  componentClass: VideoElement,
  defaultProps: {
    scale: 1,
    autoplay: true,
    loop: false,
    fps: 24,
    disabled: false,
  },
  validate: (props) => VideoElement.validate(props as any),
});
