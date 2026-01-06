// Filter algorithms for filterable list components

/**
 * Result of a fuzzy match operation
 */
export interface FuzzyMatchResult {
  /** Whether the pattern matched */
  matched: boolean;
  /** Score for ranking (higher = better match) */
  score: number;
  /** Indices of matched characters in the text (for highlighting) */
  matchIndices: number[];
}

/**
 * Filter mode for filterable list components
 */
export type FilterMode = 'fuzzy' | 'prefix' | 'contains' | 'exact' | 'none';

/**
 * Fuzzy match algorithm.
 * Matches characters in order, not necessarily consecutive.
 * Scores based on:
 * - Consecutive character matches (bonus)
 * - Matches at word starts (bonus)
 * - Case-exact matches (bonus)
 * - Shorter strings with same matches (bonus)
 */
export function fuzzyMatch(pattern: string, text: string): FuzzyMatchResult {
  if (!pattern) {
    return { matched: true, score: 0, matchIndices: [] };
  }

  if (!text) {
    return { matched: false, score: 0, matchIndices: [] };
  }

  const patternLower = pattern.toLowerCase();
  const textLower = text.toLowerCase();

  const matchIndices: number[] = [];
  let patternIdx = 0;
  let score = 0;
  let lastMatchIdx = -1;
  let consecutiveCount = 0;

  for (let textIdx = 0; textIdx < text.length && patternIdx < pattern.length; textIdx++) {
    if (textLower[textIdx] === patternLower[patternIdx]) {
      matchIndices.push(textIdx);

      // Consecutive match bonus
      if (lastMatchIdx === textIdx - 1) {
        consecutiveCount++;
        score += 5 * consecutiveCount; // Increasing bonus for longer runs
      } else {
        consecutiveCount = 1;
      }

      // Word start bonus (after space, underscore, hyphen, or camelCase)
      if (textIdx === 0) {
        score += 10; // Start of string
      } else {
        const prevChar = text[textIdx - 1];
        if (prevChar === ' ' || prevChar === '_' || prevChar === '-') {
          score += 8; // After separator
        } else if (
          prevChar === prevChar.toLowerCase() &&
          text[textIdx] === text[textIdx].toUpperCase() &&
          text[textIdx] !== text[textIdx].toLowerCase()
        ) {
          score += 8; // CamelCase boundary
        }
      }

      // Exact case match bonus
      if (pattern[patternIdx] === text[textIdx]) {
        score += 1;
      }

      lastMatchIdx = textIdx;
      patternIdx++;
    }
  }

  // Did we match all pattern characters?
  if (patternIdx !== pattern.length) {
    return { matched: false, score: 0, matchIndices: [] };
  }

  // Bonus for shorter strings (more relevant matches)
  score += Math.max(0, 20 - text.length);

  // Bonus for pattern being a larger portion of the text
  score += Math.floor((pattern.length / text.length) * 10);

  return { matched: true, score, matchIndices };
}

/**
 * Prefix match - text must start with pattern
 */
export function prefixMatch(pattern: string, text: string): FuzzyMatchResult {
  if (!pattern) {
    return { matched: true, score: 100, matchIndices: [] };
  }

  if (!text) {
    return { matched: false, score: 0, matchIndices: [] };
  }

  const patternLower = pattern.toLowerCase();
  const textLower = text.toLowerCase();

  if (!textLower.startsWith(patternLower)) {
    return { matched: false, score: 0, matchIndices: [] };
  }

  // Match indices are the first N characters
  const matchIndices = Array.from({ length: pattern.length }, (_, i) => i);

  // Score based on how much of the text is matched
  const score = 100 + Math.floor((pattern.length / text.length) * 50);

  return { matched: true, score, matchIndices };
}

/**
 * Contains match - text must contain pattern as substring
 */
export function containsMatch(pattern: string, text: string): FuzzyMatchResult {
  if (!pattern) {
    return { matched: true, score: 50, matchIndices: [] };
  }

  if (!text) {
    return { matched: false, score: 0, matchIndices: [] };
  }

  const patternLower = pattern.toLowerCase();
  const textLower = text.toLowerCase();

  const startIndex = textLower.indexOf(patternLower);
  if (startIndex === -1) {
    return { matched: false, score: 0, matchIndices: [] };
  }

  // Match indices are the consecutive characters starting at startIndex
  const matchIndices = Array.from({ length: pattern.length }, (_, i) => startIndex + i);

  // Score: bonus for earlier matches and longer matches
  let score = 50;
  score += Math.max(0, 20 - startIndex); // Earlier = better
  score += Math.floor((pattern.length / text.length) * 30); // Longer match = better

  // Bonus if it's actually a prefix match
  if (startIndex === 0) {
    score += 30;
  }

  return { matched: true, score, matchIndices };
}

/**
 * Exact match - text must equal pattern (case-insensitive)
 */
export function exactMatch(pattern: string, text: string): FuzzyMatchResult {
  if (!pattern) {
    return { matched: true, score: 200, matchIndices: [] };
  }

  if (!text) {
    return { matched: false, score: 0, matchIndices: [] };
  }

  const patternLower = pattern.toLowerCase();
  const textLower = text.toLowerCase();

  if (textLower !== patternLower) {
    return { matched: false, score: 0, matchIndices: [] };
  }

  // All characters match
  const matchIndices = Array.from({ length: text.length }, (_, i) => i);

  // High score for exact match, bonus for case-exact
  let score = 200;
  if (pattern === text) {
    score += 50; // Case-exact bonus
  }

  return { matched: true, score, matchIndices };
}

/**
 * Apply filter based on mode
 */
export function applyFilter(
  pattern: string,
  text: string,
  mode: FilterMode
): FuzzyMatchResult {
  switch (mode) {
    case 'fuzzy':
      return fuzzyMatch(pattern, text);
    case 'prefix':
      return prefixMatch(pattern, text);
    case 'contains':
      return containsMatch(pattern, text);
    case 'exact':
      return exactMatch(pattern, text);
    case 'none':
      // No filtering - everything matches with neutral score
      return { matched: true, score: 0, matchIndices: [] };
    default:
      return fuzzyMatch(pattern, text);
  }
}

/**
 * Option data with match result for sorting/rendering
 */
export interface FilteredOption<T = unknown> {
  /** Original option data */
  option: T;
  /** Match result from filter */
  match: FuzzyMatchResult;
}

/**
 * Filter and sort a list of options by label
 */
export function filterOptions<T extends { label: string }>(
  options: T[],
  pattern: string,
  mode: FilterMode
): FilteredOption<T>[] {
  if (!pattern || mode === 'none') {
    // Return all options with neutral match
    return options.map(option => ({
      option,
      match: { matched: true, score: 0, matchIndices: [] },
    }));
  }

  const results: FilteredOption<T>[] = [];

  for (const option of options) {
    const match = applyFilter(pattern, option.label, mode);
    if (match.matched) {
      results.push({ option, match });
    }
  }

  // Sort by score (descending)
  results.sort((a, b) => b.match.score - a.match.score);

  return results;
}
