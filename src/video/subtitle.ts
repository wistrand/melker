// Subtitle parsing and handling for video component

/**
 * Represents a single subtitle cue/entry
 */
export interface SubtitleCue {
  index: number;
  startTime: number;  // in seconds
  endTime: number;    // in seconds
  text: string;
}

/**
 * Parse SRT timestamp to seconds
 * Format: HH:MM:SS,mmm or HH:MM:SS.mmm
 */
export function parseSrtTimestamp(timestamp: string): number {
  const match = timestamp.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/);
  if (!match) return 0;
  const [, hours, minutes, seconds, millis] = match;
  return parseInt(hours) * 3600 + parseInt(minutes) * 60 + parseInt(seconds) + parseInt(millis) / 1000;
}

/**
 * Parse SRT file content into subtitle cues
 */
export function parseSrt(content: string): SubtitleCue[] {
  const cues: SubtitleCue[] = [];
  const blocks = content.trim().split(/\n\s*\n/);

  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 3) continue;

    const index = parseInt(lines[0]);
    if (isNaN(index)) continue;

    const timingMatch = lines[1].match(/(.+?)\s*-->\s*(.+)/);
    if (!timingMatch) continue;

    const startTime = parseSrtTimestamp(timingMatch[1].trim());
    const endTime = parseSrtTimestamp(timingMatch[2].trim());

    // Join remaining lines as text, strip HTML tags
    const text = lines.slice(2).join('\n').replace(/<[^>]+>/g, '');

    cues.push({ index, startTime, endTime, text });
  }

  return cues.sort((a, b) => a.startTime - b.startTime);
}

/**
 * Find the active subtitle cue for a given timestamp
 */
export function findActiveCue(cues: SubtitleCue[], timestamp: number): SubtitleCue | null {
  for (const cue of cues) {
    if (timestamp >= cue.startTime && timestamp <= cue.endTime) {
      return cue;
    }
    // Optimization: if we've passed all possible cues, stop searching
    if (cue.startTime > timestamp) break;
  }
  return null;
}

/**
 * Parse a time string to seconds
 * Supports formats:
 *   "90" or "90.5" - seconds
 *   "1:30" - minutes:seconds
 *   "1:30.5" - minutes:seconds.milliseconds
 *   "1:05:30" - hours:minutes:seconds
 *   "1:05:30.5" - hours:minutes:seconds.milliseconds
 */
export function parseTimeString(timeStr: string): number {
  if (!timeStr) return 0;

  const trimmed = timeStr.trim();

  // Check for colon-separated format
  const parts = trimmed.split(':');

  if (parts.length === 1) {
    // Just seconds (possibly with decimals)
    return parseFloat(parts[0]) || 0;
  } else if (parts.length === 2) {
    // MM:SS or MM:SS.mmm
    const minutes = parseInt(parts[0]) || 0;
    const seconds = parseFloat(parts[1]) || 0;
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // HH:MM:SS or HH:MM:SS.mmm
    const hours = parseInt(parts[0]) || 0;
    const minutes = parseInt(parts[1]) || 0;
    const seconds = parseFloat(parts[2]) || 0;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return 0;
}
