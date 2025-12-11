// Audio waveform types for video component

/**
 * Position of waveform overlay on video
 */
export type WaveformPosition = 'top' | 'bottom' | 'overlay';

/**
 * Visual style for waveform rendering
 */
export type WaveformStyle = 'bars' | 'line' | 'filled';

/**
 * Configuration options for audio waveform display
 */
export interface WaveformOptions {
  enabled?: boolean;          // Enable waveform display (default: false)
  position?: WaveformPosition; // Where to display: 'top', 'bottom', or 'overlay' (default: 'bottom')
  height?: number;            // Height in terminal rows (default: 3)
  style?: WaveformStyle;      // Display style: 'bars', 'line', 'filled' (default: 'bars')
  color?: string;             // Waveform color (default: 'cyan')
  backgroundColor?: string;   // Background color (default: transparent for overlay)
  opacity?: number;           // Opacity for overlay mode, 0-1 (default: 0.7)
}

/**
 * Default waveform options
 */
export const DEFAULT_WAVEFORM_OPTIONS: Required<WaveformOptions> = {
  enabled: false,
  position: 'overlay',
  height: 20,
  style: 'line',
  color: 'gray',
  backgroundColor: '',
  opacity: 0.8,
};
