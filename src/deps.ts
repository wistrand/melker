// Centralized npm dependencies for Melker
// This allows the codebase to avoid scattered npm: imports while still
// supporting remote URL execution (deps.ts gets fetched along with the code)

// HTML parsing
export { parse as parseHtml } from 'npm:html5parser@2.0.2';

// Image decoding and encoding
export { decode as decodePng, encode as encodePng } from 'npm:fast-png@8.0.0';
export { decode as decodeJpeg } from 'npm:jpeg-js@0.4.4';
export { GifReader } from 'npm:omggif@1.0.10';

// Markdown parsing
export { fromMarkdown } from 'npm:mdast-util-from-markdown@2.0.2';
export { gfm } from 'npm:micromark-extension-gfm@3.0.0';
export { gfmFromMarkdown } from 'npm:mdast-util-gfm@3.1.0';

// LSP (Language Server Protocol)
export {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  CompletionItemKind,
  DiagnosticSeverity,
  MarkupKind,
  SemanticTokensBuilder,
  type InitializeParams,
  type InitializeResult,
  type TextDocumentPositionParams,
  type CompletionItem,
  type Hover,
  type Diagnostic,
  type Range,
  type Position,
  type SemanticTokensParams,
} from 'npm:vscode-languageserver@9.0.1/node.js';
export { TextDocument } from 'npm:vscode-languageserver-textdocument@1.0.12';
