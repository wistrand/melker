// Centralized LSP dependencies — version pins live here only.
// These are resolved lazily by Deno (npm: specifiers) and stripped by the
// Node loader's stripNpmSpecifier() for node_modules resolution.

// vscode-languageserver — runtime values
export {
  CodeActionKind,
  CompletionItemKind,
  createConnection,
  DiagnosticSeverity,
  InsertTextFormat,
  MarkupKind,
  ProposedFeatures,
  SemanticTokensBuilder,
  SymbolKind,
  TextDocumentSyncKind,
  TextDocuments,
} from 'npm:vscode-languageserver@9.0.1/node.js';

// vscode-languageserver — type-only exports
export type {
  CodeAction,
  CodeActionParams,
  Color,
  ColorInformation,
  ColorPresentation,
  CompletionItem,
  Definition,
  Diagnostic,
  DocumentColorParams,
  DocumentLink,
  DocumentSymbol,
  FoldingRange,
  Hover,
  InitializeParams,
  InitializeResult,
  LinkedEditingRanges,
  Location,
  Position,
  Range,
  SemanticTokensParams,
  TextDocumentPositionParams,
} from 'npm:vscode-languageserver@9.0.1/node.js';

// vscode-languageserver-textdocument
export { TextDocument } from 'npm:vscode-languageserver-textdocument@1.0.12';
