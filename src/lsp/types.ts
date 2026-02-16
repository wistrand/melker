// Shared types for LSP modules

// AST node types from html5parser
export interface AstAttribute {
  start: number;
  end: number;
  name: { start: number; end: number; value: string };
  value?: { start: number; end: number; value: string; quote?: string };
}

export interface AstNode {
  start: number;
  end: number;
  type: 'Tag' | 'Text';
  name?: string;
  rawName?: string;
  attributes?: AstAttribute[];
  body?: AstNode[];
  open?: { start: number; end: number };
  close?: { start: number; end: number };
  value?: string;
}
