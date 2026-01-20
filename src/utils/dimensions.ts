// Shared dimension parsing utilities for consistent width/height handling

/**
 * Dimension value type - supports multiple formats:
 * - number: absolute value in terminal units (e.g., 30)
 * - "100%", "50%": percentage of available space
 * - "fill": use all available space (same as "100%")
 * - 0.5, 0.8: legacy decimal percentage (0 < value < 1, for backwards compat with dialog)
 *   Note: value must be < 1, so 1 is treated as absolute (1 unit), not 100%
 */
export type Dimension = number | string;

/**
 * Parse a dimension value to pixels/terminal units.
 *
 * Supports:
 * - number >= 1: absolute value (e.g., 30 → 30, 1 → 1)
 * - number 0 < v < 1: percentage as decimal (e.g., 0.5 → 50% of available, for legacy dialog compat)
 * - "100%", "50%": percentage string
 * - "fill": use all available space
 * - numeric string: parsed as number (e.g., "30" → 30)
 *
 * @param value - The dimension value to parse
 * @param available - Available space in terminal units
 * @param defaultValue - Default if value is undefined
 * @returns Resolved dimension in terminal units
 *
 * @example
 * parseDimension(30, 100, 10)        // → 30 (absolute)
 * parseDimension(1, 100, 10)         // → 1 (absolute, NOT 100%)
 * parseDimension(0.5, 100, 10)       // → 50 (50% of 100)
 * parseDimension("50%", 100, 10)     // → 50 (50% of 100)
 * parseDimension("fill", 100, 10)    // → 100 (all available)
 * parseDimension("30", 100, 10)      // → 30 (numeric string)
 * parseDimension(undefined, 100, 10) // → 10 (default)
 */
export function parseDimension(
  value: Dimension | undefined,
  available: number,
  defaultValue: number
): number {
  if (value === undefined) {
    return defaultValue;
  }

  // "fill" means use all available space
  if (value === 'fill') {
    return available;
  }

  if (typeof value === 'number') {
    // Legacy dialog support: decimal 0-1 range means percentage
    // e.g., dialog width={0.5} means 50% of viewport
    // Note: value must be < 1 (not <=) so that 1 is treated as absolute, not 100%
    if (value > 0 && value < 1) {
      return Math.floor(available * value);
    }
    return value;
  }

  // String: "100%", "50%", or numeric "30"
  if (value.endsWith('%')) {
    const percent = parseFloat(value);
    if (!isNaN(percent)) {
      return Math.floor((percent / 100) * available);
    }
  }

  // Try parsing as plain number
  const num = parseFloat(value);
  return isNaN(num) ? defaultValue : num;
}

/**
 * Check if a dimension value is responsive (percentage or fill).
 * Responsive dimensions need to be recalculated when container size changes.
 *
 * @param value - The dimension value to check
 * @returns true if the dimension is responsive
 */
export function isResponsiveDimension(value: Dimension | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  if (value === 'fill') {
    return true;
  }
  if (typeof value === 'string' && value.endsWith('%')) {
    return true;
  }
  // Decimal 0-1 range is also responsive (legacy dialog)
  // Note: value must be < 1 (not <=) so that 1 is treated as fixed, not 100%
  if (typeof value === 'number' && value > 0 && value < 1) {
    return true;
  }
  return false;
}
