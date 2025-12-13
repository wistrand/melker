// Error types and formatting for ASCII parser

import { ParseError } from './types.ts';

export class AsciiParseError extends Error {
  constructor(
    message: string,
    public line?: number,
    public column?: number
  ) {
    const location = line !== undefined
      ? column !== undefined
        ? ` at line ${line}, column ${column}`
        : ` at line ${line}`
      : '';
    super(`${message}${location}`);
    this.name = 'AsciiParseError';
  }

  toParseError(): ParseError {
    return {
      message: this.message,
      line: this.line,
      column: this.column,
    };
  }
}

export function formatParseError(error: ParseError, filePath?: string): string {
  const parts: string[] = [];

  if (filePath) {
    parts.push(filePath);
  }

  if (error.line !== undefined) {
    parts.push(String(error.line));
    if (error.column !== undefined) {
      parts.push(String(error.column));
    }
  }

  const location = parts.length > 0 ? `${parts.join(':')}: ` : '';
  return `${location}${error.message}`;
}

export const ERROR_MESSAGES = {
  overlappingBoxes: (a: string, b: string) =>
    `Boxes "${a}" and "${b}" overlap. Boxes must be fully nested or fully separate.`,

  unclosedBox: (name: string) =>
    `Box "${name}" is not properly closed. Missing bottom border.`,

  invalidBoxSyntax: () =>
    `Invalid box syntax. Expected "+--name--+"`,

  missingRoot: () =>
    `No melker-block found. This doesn't appear to be a melker markdown file. Add a \`\`\`melker-block with an ASCII box layout.`,

  missingReference: (name: string) =>
    `Box "${name}" references undefined component. Add a \`\`\`melker-block section with root box "${name}".`,

  circularReference: (chain: string[]) =>
    `Circular reference detected: ${chain.join(' -> ')}`,

  unknownElementType: (type: string) =>
    `Unknown element type "${type}". Valid types: container, text, button, input, textarea, checkbox, radio, list, li`,

  unknownProperty: (prop: string, boxName: string) =>
    `Unknown property "${prop}" in box "${boxName}". Will be passed as attribute.`,

  invalidHintSyntax: (hint: string) =>
    `Invalid layout hint "${hint}". See documentation for valid hint codes.`,

  duplicateHandlerBlock: (id: string, event: string) =>
    `Multiple handler blocks for "${id}.${event}". Only one handler per element event is allowed.`,

  duplicatePropertyBlock: (id: string) =>
    `Multiple JSON property blocks for "${id}". Properties will be merged (later overrides earlier).`,
};
