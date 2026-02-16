// CSS utility functions — deduplicated from 3 copies in the original lsp.ts

/**
 * Strip CSS block comments from a string.
 */
export function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/**
 * Unwrap at-rules so flat regex can handle inner rules.
 * @keyframes blocks are removed entirely (from/to/% are not element selectors).
 * @media/@container wrappers are removed, exposing their inner rules.
 */
export function unwrapAtRules(css: string): string {
  let result = '';
  let i = 0;
  while (i < css.length) {
    if (css[i] === '@') {
      const braceIdx = css.indexOf('{', i);
      if (braceIdx === -1) { result += css.substring(i); break; }
      const atName = css.substring(i, braceIdx).trim();

      // Find matching closing brace
      let depth = 1;
      let j = braceIdx + 1;
      while (j < css.length && depth > 0) {
        if (css[j] === '{') depth++;
        else if (css[j] === '}') depth--;
        j++;
      }
      const innerBody = css.substring(braceIdx + 1, j - 1);

      if (atName.startsWith('@keyframes')) {
        // Drop entirely — inner selectors (from/to/%) aren't element selectors
      } else {
        // @media, @container — unwrap, keep inner rules
        result += innerBody;
      }
      i = j;
    } else {
      result += css[i];
      i++;
    }
  }
  return result;
}
