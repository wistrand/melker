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
  // Scandinavian
  'Å': [1, 1, 1, 0, 1, 1, 1], // same as A
  'å': [1, 1, 1, 0, 1, 1, 1],
  'Ä': [1, 1, 1, 0, 1, 1, 1], // same as A
  'ä': [1, 1, 1, 0, 1, 1, 1],
  'Ö': [1, 1, 1, 1, 1, 1, 0], // same as O
  'ö': [0, 0, 1, 1, 1, 0, 1], // same as o
  'Ø': [1, 1, 1, 1, 1, 1, 1], // O with slash = 8
  'ø': [0, 0, 1, 1, 1, 0, 1], // same as o
  'Æ': [1, 1, 1, 0, 1, 1, 1], // approximated as A
  'æ': [1, 1, 1, 0, 1, 1, 1],
  // French
  'É': [1, 0, 0, 1, 1, 1, 1], // same as E
  'é': [1, 0, 0, 1, 1, 1, 1],
  'È': [1, 0, 0, 1, 1, 1, 1], // same as E
  'è': [1, 0, 0, 1, 1, 1, 1],
  'Ê': [1, 0, 0, 1, 1, 1, 1], // same as E
  'ê': [1, 0, 0, 1, 1, 1, 1],
  'Ë': [1, 0, 0, 1, 1, 1, 1], // same as E
  'ë': [1, 0, 0, 1, 1, 1, 1],
  'À': [1, 1, 1, 0, 1, 1, 1], // same as A
  'à': [1, 1, 1, 0, 1, 1, 1],
  'Â': [1, 1, 1, 0, 1, 1, 1], // same as A
  'â': [1, 1, 1, 0, 1, 1, 1],
  'Ç': [1, 0, 0, 1, 1, 1, 0], // same as C
  'ç': [0, 0, 0, 1, 1, 0, 1], // same as c
  'Î': [0, 0, 0, 0, 1, 1, 0], // same as I
  'î': [0, 0, 1, 0, 0, 0, 0], // same as i
  'Ï': [0, 0, 0, 0, 1, 1, 0], // same as I
  'ï': [0, 0, 1, 0, 0, 0, 0], // same as i
  'Ô': [1, 1, 1, 1, 1, 1, 0], // same as O
  'ô': [0, 0, 1, 1, 1, 0, 1], // same as o
  'Ù': [0, 1, 1, 1, 1, 1, 0], // same as U
  'ù': [0, 0, 1, 1, 1, 0, 0], // same as u
  'Û': [0, 1, 1, 1, 1, 1, 0], // same as U
  'û': [0, 0, 1, 1, 1, 0, 0], // same as u
  'Ü': [0, 1, 1, 1, 1, 1, 0], // same as U
  'ü': [0, 0, 1, 1, 1, 0, 0], // same as u
  // Spanish
  'Ñ': [1, 1, 1, 0, 1, 1, 0], // same as N
  'ñ': [0, 0, 1, 0, 1, 0, 1], // same as n
  'Á': [1, 1, 1, 0, 1, 1, 1], // same as A
  'á': [1, 1, 1, 0, 1, 1, 1],
  'Í': [0, 0, 0, 0, 1, 1, 0], // same as I
  'í': [0, 0, 1, 0, 0, 0, 0], // same as i
  'Ó': [1, 1, 1, 1, 1, 1, 0], // same as O
  'ó': [0, 0, 1, 1, 1, 0, 1], // same as o
  'Ú': [0, 1, 1, 1, 1, 1, 0], // same as U
  'ú': [0, 0, 1, 1, 1, 0, 0], // same as u
  // Portuguese
  'Ã': [1, 1, 1, 0, 1, 1, 1], // same as A
  'ã': [1, 1, 1, 0, 1, 1, 1],
  'Õ': [1, 1, 1, 1, 1, 1, 0], // same as O
  'õ': [0, 0, 1, 1, 1, 0, 1], // same as o
  // German
  'ß': [1, 0, 1, 0, 1, 1, 1], // Eszett - unique shape
  // Polish
  'Ł': [0, 0, 0, 1, 1, 1, 1], // L with stroke
  'ł': [0, 0, 0, 0, 1, 1, 1],
  'Ż': [1, 1, 0, 1, 1, 0, 1], // same as Z
  'ż': [1, 1, 0, 1, 1, 0, 1],
  'Ź': [1, 1, 0, 1, 1, 0, 1], // same as Z
  'ź': [1, 1, 0, 1, 1, 0, 1],
  'Ś': [1, 0, 1, 1, 0, 1, 1], // same as S
  'ś': [1, 0, 1, 1, 0, 1, 1],
  'Ć': [1, 0, 0, 1, 1, 1, 0], // same as C
  'ć': [0, 0, 0, 1, 1, 0, 1], // same as c
  'Ń': [1, 1, 1, 0, 1, 1, 0], // same as N
  'ń': [0, 0, 1, 0, 1, 0, 1], // same as n
  // Czech/Slovak
  'Č': [1, 0, 0, 1, 1, 1, 0], // same as C
  'č': [0, 0, 0, 1, 1, 0, 1], // same as c
  'Ř': [0, 0, 0, 0, 1, 0, 1], // same as R
  'ř': [0, 0, 0, 0, 1, 0, 1], // same as r
  'Š': [1, 0, 1, 1, 0, 1, 1], // same as S
  'š': [1, 0, 1, 1, 0, 1, 1],
  'Ž': [1, 1, 0, 1, 1, 0, 1], // same as Z
  'ž': [1, 1, 0, 1, 1, 0, 1],
  'Ď': [0, 1, 1, 1, 1, 0, 1], // same as D
  'ď': [0, 1, 1, 1, 1, 0, 1], // same as d
  'Ť': [0, 0, 0, 1, 1, 1, 1], // same as T
  'ť': [0, 0, 0, 1, 1, 1, 1], // same as t
  'Ň': [1, 1, 1, 0, 1, 1, 0], // same as N
  'ň': [0, 0, 1, 0, 1, 0, 1], // same as n
  // Turkish
  'İ': [0, 0, 0, 0, 1, 1, 0], // I with dot
  'ı': [0, 0, 1, 0, 0, 0, 0], // dotless i
  'Ğ': [1, 0, 1, 1, 1, 1, 0], // same as G
  'ğ': [1, 1, 1, 1, 0, 1, 1], // same as g
  'Ş': [1, 0, 1, 1, 0, 1, 1], // same as S
  'ş': [1, 0, 1, 1, 0, 1, 1],
  // Romanian
  'Ă': [1, 1, 1, 0, 1, 1, 1], // same as A
  'ă': [1, 1, 1, 0, 1, 1, 1],
  'Ș': [1, 0, 1, 1, 0, 1, 1], // same as S
  'ș': [1, 0, 1, 1, 0, 1, 1],
  'Ț': [0, 0, 0, 1, 1, 1, 1], // same as T
  'ț': [0, 0, 0, 1, 1, 1, 1],
  // Icelandic
  'Þ': [1, 1, 0, 0, 1, 1, 1], // Thorn - like P
  'þ': [1, 1, 0, 0, 1, 1, 1],
  'Ð': [0, 1, 1, 1, 1, 0, 1], // Eth - like D
  'ð': [0, 1, 1, 1, 1, 0, 1],
  // Greek letters (commonly used)
  'Γ': [1, 0, 0, 0, 1, 1, 0], // Gamma
  'Δ': [1, 1, 1, 1, 1, 1, 0], // Delta - like triangle/0
  'Θ': [1, 1, 1, 1, 1, 1, 1], // Theta - 8
  'Λ': [0, 0, 0, 1, 1, 1, 0], // Lambda - inverted V
  'Π': [1, 1, 0, 0, 1, 1, 0], // Pi
  'Σ': [1, 0, 0, 1, 1, 1, 1], // Sigma - like E
  'Φ': [1, 1, 1, 0, 1, 1, 1], // Phi - like A
  'Ψ': [0, 1, 1, 0, 0, 1, 1], // Psi
  'Ω': [1, 1, 1, 1, 1, 1, 0], // Omega - like horseshoe/0
  'α': [1, 1, 1, 1, 1, 0, 1], // alpha
  'β': [0, 0, 1, 1, 1, 1, 1], // beta - like b
  'γ': [0, 1, 1, 1, 0, 1, 1], // gamma - like y
  'δ': [0, 1, 1, 1, 1, 0, 1], // delta - like d
  'π': [1, 1, 0, 0, 1, 0, 1], // pi
  'μ': [0, 0, 1, 1, 1, 0, 0], // mu - like u
  // Currency symbols
  '€': [1, 0, 0, 1, 1, 1, 1], // Euro - like E
  '£': [0, 0, 0, 1, 1, 1, 1], // Pound - like L with middle
  '¥': [0, 1, 1, 1, 0, 1, 1], // Yen - like Y
  '¢': [0, 0, 0, 1, 1, 0, 1], // Cent - like c
  // Math symbols
  '°': [1, 1, 0, 0, 0, 1, 1], // Degree
  '±': [0, 0, 0, 0, 1, 1, 1], // Plus-minus (approximation)
  '²': [1, 1, 0, 1, 1, 0, 1], // Superscript 2 - like 2
  '³': [1, 1, 1, 1, 0, 0, 1], // Superscript 3 - like 3
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
