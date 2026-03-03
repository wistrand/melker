// Centralized external dependencies for Melker
// All npm, jsr, and URL imports go here to avoid scattered external imports
// and to support remote URL execution (deps.ts gets fetched along with the code)

// HTML parsing
export { parse as parseHtml } from 'npm:html5parser@2.0.2';

// Image decoding and encoding
export { decode as decodePng, encode as encodePng } from 'npm:fast-png@8.0.0';
export { decode as decodeJpeg } from 'npm:jpeg-js@0.4.4';
export { GifReader } from 'npm:omggif@1.0.10';
export { decode as decodeWebp } from 'npm:@jsquash/webp@1.5.0';

// Markdown parsing
export { fromMarkdown } from 'npm:mdast-util-from-markdown@2.0.2';
export { gfm } from 'npm:micromark-extension-gfm@3.0.0';
export { gfmFromMarkdown } from 'npm:mdast-util-gfm@3.1.0';

// Path utilities (node: builtins work in both Deno and Node)
export { dirname, join, resolve } from 'node:path';
export { fileURLToPath as fromFileUrl } from 'node:url';

// Base64 + JWT utilities
export { encodeBase64, decodeJwt } from './jwt-util.ts';

// LSP dependencies (vscode-languageserver, vscode-languageserver-textdocument)
// are imported directly in src/lsp.ts to avoid downloading them for normal usage
