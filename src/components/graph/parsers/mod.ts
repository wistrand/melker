/**
 * Graph Parsers Module
 */

export * from './types.ts';
export * from './json.ts';
export * from './mermaid-flowchart.ts';
export * from './mermaid-sequence.ts';
export * from './mermaid-class.ts';

import type { GraphParser, SequenceDiagramParser, ClassDiagramParser } from './types.ts';
import { JsonParser } from './json.ts';
import { MermaidParser } from './mermaid-flowchart.ts';
import { SequenceParser, isSequenceDiagram } from './mermaid-sequence.ts';
import { ClassDiagramParserImpl, isClassDiagram } from './mermaid-class.ts';

/** Supported parser types */
export type ParserType = 'json' | 'mermaid' | 'sequence' | 'class';

/** Get a graph parser (for flowcharts) */
export function getGraphParser(type: 'json' | 'mermaid'): GraphParser {
  if (type === 'json') return new JsonParser();
  return new MermaidParser();
}

/** Get a sequence parser */
export function getSequenceParser(): SequenceDiagramParser {
  return new SequenceParser();
}

/** Get a class diagram parser */
export function getClassDiagramParser(): ClassDiagramParser {
  return new ClassDiagramParserImpl();
}

/**
 * Get a parser by type (returns union type)
 */
export function getParser(type: ParserType): GraphParser | SequenceDiagramParser | ClassDiagramParser {
  if (type === 'sequence') return new SequenceParser();
  if (type === 'class') return new ClassDiagramParserImpl();
  if (type === 'json') return new JsonParser();
  return new MermaidParser();
}

/**
 * Auto-detect parser type from content
 */
export function detectParserType(content: string): ParserType {
  if (isSequenceDiagram(content)) {
    return 'sequence';
  }
  if (isClassDiagram(content)) {
    return 'class';
  }
  // Default to mermaid for flowcharts/graphs
  return 'mermaid';
}
