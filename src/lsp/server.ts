// LSP Server for .melker files
// Provides diagnostics, hover, completion, and other language features

import process from 'node:process';
import {
  createConnection,
  TextDocuments,
  ProposedFeatures,
  TextDocumentSyncKind,
  CodeActionKind,
  SemanticTokensBuilder,
  type InitializeParams,
  type InitializeResult,
  type TextDocumentPositionParams,
  type CompletionItem,
  type Hover,
  type SemanticTokensParams,
  type CodeActionParams,
  type DocumentColorParams,
} from 'npm:vscode-languageserver@9.0.1/node.js';
import { TextDocument } from 'npm:vscode-languageserver-textdocument@1.0.12';

// Import logging
import { getLogger } from '../logging.ts';

// Import mod.ts to register all component schemas
import '../../mod.ts';

// Import feature modules
import { validateDocument } from './validators.ts';
import { getHover } from './hover.ts';
import { getCompletions } from './completions.ts';
import { getDocumentSymbols } from './symbols.ts';
import { getFoldingRanges } from './folding.ts';
import { getCodeActions } from './code-actions.ts';
import { getLinkedEditingRanges } from './linked-editing.ts';
import { getDocumentLinks } from './links.ts';
import { extractColors, getColorPresentations } from './colors.ts';
import { getDefinition } from './definition.ts';
import { findTypeScriptRanges, tokenTypes, tokenModifiers } from './semantic-tokens.ts';
import { levenshteinDistance, findSimilarNames } from './fuzzy.ts';
import { stripShebang } from '../utils/content-loader.ts';

const logger = getLogger('LSP');

// Get document text with shebang stripped
function getText(doc: TextDocument): string {
  return stripShebang(doc.getText());
}

// Exports for testing
export const _testing = {
  validateDocument,
  getHover,
  getCompletions,
  getDocumentSymbols,
  getFoldingRanges,
  getCodeActions,
  getLinkedEditingRanges,
  getDocumentLinks,
  extractColors,
  getColorPresentations,
  getDefinition,
  levenshteinDistance,
  findSimilarNames,
};

// Start the LSP server
export async function startLspServer(): Promise<void> {
  logger.info('Starting LSP server');

  // Simulate --stdio flag for vscode-languageserver auto-detection
  if (!process.argv.includes('--stdio')) {
    process.argv.push('--stdio');
  }

  // Create connection - it will auto-detect stdio mode from argv
  const connection = createConnection(ProposedFeatures.all);
  const documents = new TextDocuments(TextDocument);

  connection.onInitialize((params: InitializeParams): InitializeResult => {
    logger.info('Client initialized', {
      clientName: params.clientInfo?.name ?? 'unknown',
      rootUri: params.rootUri,
    });
    return {
      capabilities: {
        textDocumentSync: TextDocumentSyncKind.Full,
        completionProvider: {
          triggerCharacters: ['<', ' ', '=', '"', "'", ':', ';', '{'],
        },
        hoverProvider: true,
        semanticTokensProvider: {
          legend: {
            tokenTypes,
            tokenModifiers,
          },
          full: true,
        },
        documentSymbolProvider: true,
        foldingRangeProvider: true,
        codeActionProvider: {
          codeActionKinds: [CodeActionKind.QuickFix],
        },
        definitionProvider: true,
        documentLinkProvider: { resolveProvider: false },
        linkedEditingRangeProvider: true,
        colorProvider: true,
      },
    };
  });

  // Validate on open and change
  documents.onDidChangeContent((change) => {
    logger.debug('Document changed', { uri: change.document.uri });
    const diagnostics = validateDocument(getText(change.document));

    for (const diag of diagnostics) {
      logger.debug('Diagnostic', {
        message: diag.message,
        severity: diag.severity,
        range: `${diag.range.start.line}:${diag.range.start.character}-${diag.range.end.line}:${diag.range.end.character}`,
        source: diag.source,
      });
    }

    connection.sendDiagnostics({
      uri: change.document.uri,
      diagnostics,
    });
    logger.debug('Diagnostics published', { uri: change.document.uri, count: diagnostics.length });
  });

  // Hover
  connection.onHover((params: TextDocumentPositionParams): Hover | null => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getHover(getText(document), params.position);
  });

  // Completion
  connection.onCompletion((params: TextDocumentPositionParams): CompletionItem[] => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getCompletions(getText(document), params.position);
  });

  // Semantic tokens - mark TypeScript regions (event handlers and script content)
  connection.languages.semanticTokens.on((params: SemanticTokensParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return { data: [] };

    const text = getText(document);
    const ranges = findTypeScriptRanges(text);
    const builder = new SemanticTokensBuilder();

    ranges.sort((a, b) => a.line - b.line || a.char - b.char);

    for (const range of ranges) {
      builder.push(range.line, range.char, range.length, 0, 1);
    }

    logger.debug('Semantic tokens', { count: ranges.length });
    return builder.build();
  });

  // Document symbols (outline)
  connection.onDocumentSymbol((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getDocumentSymbols(getText(document));
  });

  // Folding ranges
  connection.onFoldingRanges((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getFoldingRanges(getText(document));
  });

  // Code actions (quick fixes)
  connection.onCodeAction((params: CodeActionParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getCodeActions(getText(document), params);
  });

  // Linked editing ranges (rename open/close tags in sync)
  connection.languages.onLinkedEditingRange((params: TextDocumentPositionParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getLinkedEditingRanges(getText(document), params.position);
  });

  // Document links (clickable src/href)
  connection.onDocumentLinks((params) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return getDocumentLinks(getText(document), params.textDocument.uri);
  });

  // Color provider
  connection.onDocumentColor((params: DocumentColorParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return [];
    return extractColors(getText(document));
  });

  connection.onColorPresentation((params) => {
    return getColorPresentations(params.color);
  });

  // Go to definition
  connection.onDefinition((params: TextDocumentPositionParams) => {
    const document = documents.get(params.textDocument.uri);
    if (!document) return null;
    return getDefinition(getText(document), params.position, params.textDocument.uri);
  });

  documents.listen(connection);
  connection.listen();

  logger.info('LSP server listening on stdio');

  // Keep the server running until the connection is closed
  await new Promise<void>((resolve) => {
    connection.onExit(() => {
      logger.info('LSP server exiting');
      resolve();
    });
  });
}
