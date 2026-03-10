// Converts ANSI-colored terminal output to HTML spans with merged runs.
// Usage: deno run -A melker.ts <app> --stdout --color=always | deno run docs/tools/ansi2html.ts
//
// The common background (rgb(0,0,0)) is omitted from spans — set it on the <pre> element.

const buf: Uint8Array[] = [];
for await (const chunk of Deno.stdin.readable) buf.push(chunk);
const input = new TextDecoder().decode(await new Blob(buf).arrayBuffer());

interface Style {
  fg: string | null;
  bg: string | null;
  bold: boolean;
}

function styleKey(s: Style): string {
  return `${s.fg || ''}|${s.bg || ''}|${s.bold}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Default background that we'll skip in spans (set on <pre> instead)
const DEFAULT_BG = 'rgb(0,0,0)';

function spanFor(style: Style, text: string): string {
  const escaped = escapeHtml(text);
  const parts: string[] = [];
  if (style.fg) parts.push(`color:${style.fg}`);
  if (style.bg && style.bg !== DEFAULT_BG) parts.push(`background:${style.bg}`);
  if (style.bold) parts.push('font-weight:bold');
  if (parts.length === 0) return escaped;
  return `<span style="${parts.join(';')}">${escaped}</span>`;
}

function applySgr(params: number[], style: Style): Style {
  const s = { ...style };
  let i = 0;
  while (i < params.length) {
    const p = params[i];
    if (p === 0) { s.fg = null; s.bg = null; s.bold = false; }
    else if (p === 1) s.bold = true;
    else if (p === 22) s.bold = false;
    else if (p === 38 && params[i + 1] === 2) {
      s.fg = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
      i += 4;
    } else if (p === 48 && params[i + 1] === 2) {
      s.bg = `rgb(${params[i + 2]},${params[i + 3]},${params[i + 4]})`;
      i += 4;
    } else if (p >= 30 && p <= 37) {
      const c = ['#000','#a00','#0a0','#a50','#00a','#a0a','#0aa','#aaa'];
      s.fg = c[p - 30];
    } else if (p >= 40 && p <= 47) {
      const c = ['#000','#a00','#0a0','#a50','#00a','#a0a','#0aa','#aaa'];
      s.bg = c[p - 40];
    } else if (p >= 90 && p <= 97) {
      const c = ['#555','#f55','#5f5','#ff5','#55f','#f5f','#5ff','#fff'];
      s.fg = c[p - 90];
    } else if (p >= 100 && p <= 107) {
      const c = ['#555','#f55','#5f5','#ff5','#55f','#f5f','#5ff','#fff'];
      s.bg = c[p - 100];
    } else if (p === 39) s.fg = null;
    else if (p === 49) s.bg = null;
    i++;
  }
  return s;
}

const ansiRegex = /\x1b\[([0-9;]*)m/g;
const lines = input.split('\n');
const htmlLines: string[] = [];

for (const line of lines) {
  // Build array of {style, char} for this line
  let currentStyle: Style = { fg: null, bg: null, bold: false };
  const segments: { style: Style; text: string }[] = [];

  let lastIndex = 0;
  let match;
  ansiRegex.lastIndex = 0;

  while ((match = ansiRegex.exec(line)) !== null) {
    const text = line.slice(lastIndex, match.index);
    if (text) {
      // Merge with previous segment if same style
      const prev = segments[segments.length - 1];
      if (prev && styleKey(prev.style) === styleKey(currentStyle)) {
        prev.text += text;
      } else {
        segments.push({ style: { ...currentStyle }, text });
      }
    }
    const paramStr = match[1] || '0';
    currentStyle = applySgr(paramStr.split(';').map(Number), currentStyle);
    lastIndex = ansiRegex.lastIndex;
  }

  const remaining = line.slice(lastIndex);
  if (remaining) {
    const prev = segments[segments.length - 1];
    if (prev && styleKey(prev.style) === styleKey(currentStyle)) {
      prev.text += remaining;
    } else {
      segments.push({ style: { ...currentStyle }, text: remaining });
    }
  }

  // Trim trailing spaces from the last segment (line padding)
  if (segments.length > 0) {
    const last = segments[segments.length - 1];
    last.text = last.text.replace(/ +$/, '');
    if (!last.text) segments.pop();
  }

  htmlLines.push(segments.map(s => spanFor(s.style, s.text)).join(''));
}

// Trim trailing empty lines
while (htmlLines.length > 0 && htmlLines[htmlLines.length - 1] === '') {
  htmlLines.pop();
}

console.log(htmlLines.join('\n'));
