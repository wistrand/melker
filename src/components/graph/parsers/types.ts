/**
 * Graph Parser Interface
 *
 * All graph parsers must implement this interface.
 */

import type { GraphDefinition, SequenceDefinition, ClassDiagramDefinition } from '../types.ts';

/**
 * Interface for graph parsers
 */
export interface GraphParser {
  /**
   * Parse input text into a GraphDefinition
   * @param input The input text to parse
   * @returns Parsed graph definition
   * @throws Error if parsing fails
   */
  parse(input: string): GraphDefinition;
}

/**
 * Interface for sequence diagram parsers
 */
export interface SequenceDiagramParser {
  /**
   * Parse input text into a SequenceDefinition
   * @param input The input text to parse
   * @returns Parsed sequence definition
   * @throws Error if parsing fails
   */
  parse(input: string): SequenceDefinition;
}

/**
 * Interface for class diagram parsers
 */
export interface ClassDiagramParser {
  /**
   * Parse input text into a ClassDiagramDefinition
   * @param input The input text to parse
   * @returns Parsed class diagram definition
   * @throws Error if parsing fails
   */
  parse(input: string): ClassDiagramDefinition;
}

/**
 * Parser error with location information
 */
export class GraphParseError extends Error {
  constructor(
    message: string,
    public line?: number,
    public column?: number
  ) {
    super(message);
    this.name = 'GraphParseError';
  }
}
