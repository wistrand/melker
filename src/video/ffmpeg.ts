// FFmpeg utilities for video processing

import { Command } from '../runtime/mod.ts';

/**
 * Video dimensions from probe
 */
export interface VideoDimensions {
  width: number;
  height: number;
}

/**
 * Default dimensions when probe fails
 */
export const DEFAULT_VIDEO_DIMENSIONS: VideoDimensions = {
  width: 640,
  height: 480,
};

/**
 * Get video dimensions using ffprobe
 * @param src Path to video file
 * @returns Video dimensions or defaults if probe fails
 */
export async function getVideoDimensions(src: string): Promise<VideoDimensions> {
  const probeCmd = new Command('ffprobe', {
    args: [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height',
      '-of', 'csv=p=0',
      src
    ],
    stdout: 'piped',
    stderr: 'piped'
  });

  try {
    const probeOutput = await probeCmd.output();
    const probeText = new TextDecoder().decode(probeOutput.stdout).trim();
    const [widthStr, heightStr] = probeText.split(',');
    const width = parseInt(widthStr) || DEFAULT_VIDEO_DIMENSIONS.width;
    const height = parseInt(heightStr) || DEFAULT_VIDEO_DIMENSIONS.height;
    return { width, height };
  } catch {
    return DEFAULT_VIDEO_DIMENSIONS;
  }
}

/**
 * Build ffmpeg args for video decoding to raw RGBA frames
 * @param src Path to video file
 * @param options Decoding options
 */
export function buildVideoDecoderArgs(
  src: string,
  options: {
    startTime?: number;
    outputWidth: number;
    outputHeight: number;
    fps: number;
  }
): string[] {
  const args: string[] = [];

  if (options.startTime && options.startTime > 0) {
    args.push('-ss', String(options.startTime));
  }

  args.push(
    '-i', src,
    '-an',  // Disable audio - we only want video frames
    '-vf', `scale=${options.outputWidth}:${options.outputHeight}:force_original_aspect_ratio=disable,format=rgba`,
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-r', String(options.fps),
    '-'
  );

  return args;
}

/**
 * Build ffmpeg args for audio extraction to raw PCM samples
 * @param src Path to video/audio file
 * @param options Extraction options
 */
export function buildAudioExtractorArgs(
  src: string,
  options: {
    startTime?: number;
    sampleRate?: number;
    channels?: number;
  }
): string[] {
  const sampleRate = options.sampleRate ?? 8000;
  const channels = options.channels ?? 1;

  const args: string[] = [];

  if (options.startTime && options.startTime > 0) {
    args.push('-ss', String(options.startTime));
  }

  args.push(
    '-i', src,
    '-vn',           // No video
    '-acodec', 'pcm_s16le',
    '-ar', String(sampleRate),
    '-ac', String(channels),
    '-f', 's16le',
    '-'
  );

  return args;
}

/**
 * Build ffplay args for audio playback
 * @param src Path to video/audio file
 * @param options Playback options
 */
export function buildAudioPlayerArgs(
  src: string,
  options: {
    startTime?: number;
    volume?: number;  // 0-100
  }
): string[] {
  const args: string[] = [
    '-nodisp',      // No display window
    '-autoexit',    // Exit when done
    '-vn',          // No video
    '-loglevel', 'quiet',
  ];

  if (options.startTime && options.startTime > 0) {
    args.push('-ss', String(options.startTime));
  }

  if (options.volume !== undefined) {
    // ffplay volume is 0-100 (matching our interface)
    args.push('-volume', String(options.volume));
  }

  args.push(src);

  return args;
}

/**
 * Calculate output dimensions for video that fit within buffer
 * while maintaining aspect ratio and ffmpeg alignment requirements
 */
export function calculateOutputDimensions(
  videoWidth: number,
  videoHeight: number,
  bufferWidth: number,
  bufferHeight: number,
  pixelAspectRatio: number = 0.5
): { width: number; height: number } {
  const visualBufW = bufferWidth * pixelAspectRatio;

  const scaleX = visualBufW / videoWidth;
  const scaleY = bufferHeight / videoHeight;
  const scale = Math.min(scaleX, scaleY);

  // Calculate output dimensions
  let outputW = Math.floor(videoWidth * scale / pixelAspectRatio);
  let outputH = Math.floor(videoHeight * scale);

  // Ensure dimensions are divisible by 16 (ffmpeg/codec alignment requirement)
  outputW = Math.max(16, (outputW >> 4) << 4);
  outputH = Math.max(16, (outputH >> 4) << 4);

  // Height should be multiple of 3 for sextant character alignment
  outputH = Math.floor(outputH / 3) * 3;
  outputH = Math.max(48, outputH);

  // Ensure output never equals or exceeds buffer dimensions
  if (outputW >= bufferWidth) outputW = ((bufferWidth - 1) >> 4) << 4;
  if (outputH >= bufferHeight) {
    outputH = Math.floor((bufferHeight - 1) / 3) * 3;
    outputH = Math.floor(outputH / 16) * 16;
  }

  // Safety minimum
  outputW = Math.max(16, outputW);
  outputH = Math.max(48, outputH);

  return { width: outputW, height: outputH };
}
