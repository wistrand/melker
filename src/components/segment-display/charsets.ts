// Character set definitions for segment display
// Each character maps to a 7-segment mask: [a, b, c, d, e, f, g]
//
//    aaaa
//   f    b
//   f    b
//    gggg
//   e    c
//   e    c
//    dddd

export type SegmentMask = [
  a: 0 | 1,
  b: 0 | 1,
  c: 0 | 1,
  d: 0 | 1,
  e: 0 | 1,
  f: 0 | 1,
  g: 0 | 1
];

// Standard digits 0-9
export const DIGIT_SEGMENTS: Record<string, SegmentMask> = {
  '0': [1, 1, 1, 1, 1, 1, 0],
  '1': [0, 1, 1, 0, 0, 0, 0],
  '2': [1, 1, 0, 1, 1, 0, 1],
  '3': [1, 1, 1, 1, 0, 0, 1],
  '4': [0, 1, 1, 0, 0, 1, 1],
  '5': [1, 0, 1, 1, 0, 1, 1],
  '6': [1, 0, 1, 1, 1, 1, 1],
  '7': [1, 1, 1, 0, 0, 0, 0],
  '8': [1, 1, 1, 1, 1, 1, 1],
  '9': [1, 1, 1, 1, 0, 1, 1],
  ' ': [0, 0, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0, 0, 0, 1],
  '_': [0, 0, 0, 1, 0, 0, 0],
};

// Hex digits A-F
export const HEX_SEGMENTS: Record<string, SegmentMask> = {
  'A': [1, 1, 1, 0, 1, 1, 1],
  'a': [1, 1, 1, 0, 1, 1, 1],
  'B': [0, 0, 1, 1, 1, 1, 1], // lowercase b shape
  'b': [0, 0, 1, 1, 1, 1, 1],
  'C': [1, 0, 0, 1, 1, 1, 0],
  'c': [0, 0, 0, 1, 1, 0, 1],
  'D': [0, 1, 1, 1, 1, 0, 1], // lowercase d shape
  'd': [0, 1, 1, 1, 1, 0, 1],
  'E': [1, 0, 0, 1, 1, 1, 1],
  'e': [1, 0, 0, 1, 1, 1, 1],
  'F': [1, 0, 0, 0, 1, 1, 1],
  'f': [1, 0, 0, 0, 1, 1, 1],
};

// Symbol segments
export const SYMBOL_SEGMENTS: Record<string, SegmentMask> = {
  '=': [0, 0, 0, 1, 0, 0, 1],
  '"': [0, 1, 0, 0, 0, 1, 0],
  "'": [0, 1, 0, 0, 0, 0, 0],
  '[': [1, 0, 0, 1, 1, 1, 0],
  ']': [1, 1, 1, 1, 0, 0, 0],
  '(': [1, 0, 0, 1, 1, 1, 0],
  ')': [1, 1, 1, 1, 0, 0, 0],
  '/': [0, 1, 0, 0, 1, 0, 1],
  '\\': [0, 0, 1, 0, 0, 1, 1],
  '?': [1, 1, 0, 0, 1, 0, 1],
  '!': [0, 1, 0, 0, 0, 0, 0], // just top right segment
  '+': [0, 0, 0, 0, 1, 1, 1], // approximation
  '*': [0, 1, 1, 0, 1, 1, 1], // like H
  '#': [0, 1, 1, 1, 1, 1, 1], // full sides
  '%': [1, 1, 0, 0, 0, 0, 1], // approximation
  '&': [1, 1, 1, 1, 1, 1, 1], // full 8
  '@': [1, 1, 1, 1, 1, 0, 1], // like a with tail
  '^': [1, 1, 0, 0, 0, 1, 0], // top segments
  '<': [0, 0, 0, 1, 1, 0, 1], // left pointing
  '>': [0, 1, 1, 1, 0, 0, 1], // right pointing
  '|': [0, 0, 0, 0, 1, 1, 0], // vertical line
};

// L33t/extended letters - all letters with best-effort 7-segment approximations
export const L33T_SEGMENTS: Record<string, SegmentMask> = {
  // Hex letters
  ...HEX_SEGMENTS,
  // Symbols
  ...SYMBOL_SEGMENTS,
  // Additional letters
  'G': [1, 0, 1, 1, 1, 1, 0],
  'g': [1, 1, 1, 1, 0, 1, 1], // looks like 9
  'H': [0, 1, 1, 0, 1, 1, 1],
  'h': [0, 0, 1, 0, 1, 1, 1],
  'I': [0, 0, 0, 0, 1, 1, 0],
  'i': [0, 0, 1, 0, 0, 0, 0],
  'J': [0, 1, 1, 1, 0, 0, 0],
  'j': [0, 1, 1, 1, 0, 0, 0],
  'K': [0, 0, 1, 0, 1, 1, 1], // similar to H but asymmetric
  'k': [0, 0, 1, 0, 1, 1, 1],
  'L': [0, 0, 0, 1, 1, 1, 0],
  'l': [0, 0, 0, 0, 1, 1, 0],
  'M': [1, 1, 1, 0, 1, 1, 0], // top + both sides
  'm': [0, 0, 1, 0, 1, 0, 1], // two humps approximation
  'N': [1, 1, 1, 0, 1, 1, 0], // same as M uppercase
  'n': [0, 0, 1, 0, 1, 0, 1],
  'O': [1, 1, 1, 1, 1, 1, 0], // same as 0
  'o': [0, 0, 1, 1, 1, 0, 1],
  'P': [1, 1, 0, 0, 1, 1, 1],
  'p': [1, 1, 0, 0, 1, 1, 1],
  'Q': [1, 1, 1, 0, 0, 1, 1],
  'q': [1, 1, 1, 0, 0, 1, 1],
  'R': [0, 0, 0, 0, 1, 0, 1], // lowercase r
  'r': [0, 0, 0, 0, 1, 0, 1],
  'S': [1, 0, 1, 1, 0, 1, 1], // same as 5
  's': [1, 0, 1, 1, 0, 1, 1],
  'T': [0, 0, 0, 1, 1, 1, 1], // lowercase t
  't': [0, 0, 0, 1, 1, 1, 1],
  'U': [0, 1, 1, 1, 1, 1, 0],
  'u': [0, 0, 1, 1, 1, 0, 0],
  'V': [0, 1, 1, 1, 1, 1, 0], // same as U
  'v': [0, 0, 1, 1, 1, 0, 0], // same as u
  'W': [0, 1, 1, 1, 1, 1, 1], // U with middle
  'w': [0, 0, 1, 1, 1, 0, 1], // u with middle
  'X': [0, 1, 1, 0, 1, 1, 1], // same as H
  'x': [0, 1, 1, 0, 1, 1, 1],
  'Y': [0, 1, 1, 1, 0, 1, 1],
  'y': [0, 1, 1, 1, 0, 1, 1],
  'Z': [1, 1, 0, 1, 1, 0, 1], // same as 2
  'z': [1, 1, 0, 1, 1, 0, 1],
  // Accented characters (best effort - accents not representable)
  'Å': [1, 1, 1, 0, 1, 1, 1], // same as A
  'å': [1, 1, 1, 0, 1, 1, 1],
  'Ä': [1, 1, 1, 0, 1, 1, 1], // same as A
  'ä': [1, 1, 1, 0, 1, 1, 1],
  'Ö': [1, 1, 1, 1, 1, 1, 0], // same as O
  'ö': [0, 0, 1, 1, 1, 0, 1], // same as o
  'É': [1, 0, 0, 1, 1, 1, 1], // same as E
  'é': [1, 0, 0, 1, 1, 1, 1],
  'È': [1, 0, 0, 1, 1, 1, 1], // same as E
  'è': [1, 0, 0, 1, 1, 1, 1],
};

// Get charset by name
export function getCharset(name: string): Record<string, SegmentMask> {
  switch (name) {
    case 'hex':
      return { ...DIGIT_SEGMENTS, ...HEX_SEGMENTS };
    case 'l33t':
      return { ...DIGIT_SEGMENTS, ...L33T_SEGMENTS };
    case 'full':
      return { ...DIGIT_SEGMENTS, ...L33T_SEGMENTS, ...SYMBOL_SEGMENTS };
    case 'digits':
    default:
      return { ...DIGIT_SEGMENTS };
  }
}

// Special characters that need custom rendering
export type SpecialChar = ':' | '.' | ',';

export function isSpecialChar(char: string): char is SpecialChar {
  return char === ':' || char === '.' || char === ',';
}
