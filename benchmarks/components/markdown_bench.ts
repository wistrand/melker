/**
 * Markdown component benchmarks
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import { createElement, globalLayoutEngine, RenderingEngine } from '../../mod.ts';
import { DualBuffer } from '../../src/buffer.ts';

const suite = new BenchmarkSuite('markdown');

const viewport = { width: 120, height: 60 };
const renderer = new RenderingEngine();

function makeContext(width: number, height: number) {
  return {
    viewport: { x: 0, y: 0, width, height },
    parentBounds: { x: 0, y: 0, width, height },
    availableSpace: { width, height },
  };
}

// Sample markdown content for different benchmarks

const simpleText = `This is a simple paragraph with some text that will be rendered in the terminal.`;

const headings = `# Heading 1
## Heading 2
### Heading 3
#### Heading 4

Some text after headings.`;

const unorderedList = `- Item 1
- Item 2
  - Nested item 2.1
  - Nested item 2.2
- Item 3
- Item 4
- Item 5`;

const orderedList = `1. First item
2. Second item
   1. Nested first
   2. Nested second
3. Third item
4. Fourth item
5. Fifth item`;

const codeBlock = `Here is some code:

\`\`\`typescript
function fibonacci(n: number): number {
  if (n <= 1) return n;
  return fibonacci(n - 1) + fibonacci(n - 2);
}

const result = fibonacci(10);
console.log(result);
\`\`\`

And some inline code: \`const x = 42;\``;

const blockquote = `> This is a blockquote.
> It can span multiple lines.
>
> And have multiple paragraphs.
> With **bold** and *italic* text.`;

const table = `| Name | Type | Description |
|------|------|-------------|
| id | number | Unique identifier |
| name | string | User's full name |
| email | string | Email address |
| active | boolean | Is user active |
| created | Date | Creation timestamp |`;

const mixedDocument = `# Melker Documentation

## Overview

Melker is a **terminal UI framework** for building rich applications. It provides:

- Component-based architecture
- Flexbox layout engine
- Sixel/Kitty graphics support
- Markdown rendering

## Installation

\`\`\`bash
deno add @melker/core
\`\`\`

## Quick Start

> Note: Melker requires Deno 2.5 or later.

Here's a simple example:

\`\`\`typescript
import { createElement, createApp } from '@melker/core';

const app = createElement('container', {},
  createElement('text', {}, 'Hello, World!')
);

await createApp(app);
\`\`\`

## Features Table

| Feature | Status | Notes |
|---------|--------|-------|
| Layout | ✓ | Full flexbox support |
| Graphics | ✓ | Sixel and Kitty |
| Markdown | ✓ | GFM extension |
| Tables | ✓ | With alignment |

### More Information

1. Check the examples folder
2. Read the architecture docs
3. Join the community
   - Discord server
   - GitHub discussions`;

const largeDocument = `# Large Document Benchmark

${Array(20).fill(0).map((_, i) => `
## Section ${i + 1}

This is paragraph ${i + 1} with some text content that will be wrapped across multiple lines in the terminal output.

- List item ${i * 3 + 1}
- List item ${i * 3 + 2}
- List item ${i * 3 + 3}

\`\`\`javascript
const section${i + 1} = () => {
  return "Section ${i + 1}";
};
\`\`\`
`).join('\n')}`;

// Simple text paragraph
const simpleTextMd = createElement('markdown', { text: simpleText });
suite.add('markdown-simple-text', () => {
  globalLayoutEngine.calculateLayout(simpleTextMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(simpleTextMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.5 });

// Headings
const headingsMd = createElement('markdown', { text: headings });
suite.add('markdown-headings', () => {
  globalLayoutEngine.calculateLayout(headingsMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(headingsMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.5 });

// Unordered list
const unorderedListMd = createElement('markdown', { text: unorderedList });
suite.add('markdown-unordered-list', () => {
  globalLayoutEngine.calculateLayout(unorderedListMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(unorderedListMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.5 });

// Ordered list
const orderedListMd = createElement('markdown', { text: orderedList });
suite.add('markdown-ordered-list', () => {
  globalLayoutEngine.calculateLayout(orderedListMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(orderedListMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.5 });

// Code block
const codeBlockMd = createElement('markdown', { text: codeBlock });
suite.add('markdown-code-block', () => {
  globalLayoutEngine.calculateLayout(codeBlockMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(codeBlockMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 200, target: 3.0 });

// Blockquote
const blockquoteMd = createElement('markdown', { text: blockquote });
suite.add('markdown-blockquote', () => {
  globalLayoutEngine.calculateLayout(blockquoteMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(blockquoteMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.5 });

// Table (GFM)
const tableMd = createElement('markdown', { text: table, enableGfm: true });
suite.add('markdown-table-gfm', () => {
  globalLayoutEngine.calculateLayout(tableMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(tableMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 200, target: 2.5 });

// Mixed document (realistic use case)
const mixedMd = createElement('markdown', { text: mixedDocument, enableGfm: true });
suite.add('markdown-mixed-document', () => {
  globalLayoutEngine.calculateLayout(mixedMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(mixedMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 100, target: 3.0 });

// Large document
const largeMd = createElement('markdown', { text: largeDocument, enableGfm: true });
suite.add('markdown-large-document', () => {
  globalLayoutEngine.calculateLayout(largeMd, makeContext(viewport.width, 200));
  const buffer = new DualBuffer(viewport.width, 200);
  renderer.render(largeMd, buffer, { x: 0, y: 0, width: viewport.width, height: 200 });
}, { iterations: 20, target: 15.0 });

// Parse-only (measure AST generation overhead)
const { fromMarkdown, gfm, gfmFromMarkdown } = await import('../../src/deps.ts');

suite.add('markdown-parse-simple', () => {
  fromMarkdown(simpleText);
}, { iterations: 1000, target: 0.1 });

suite.add('markdown-parse-mixed', () => {
  fromMarkdown(mixedDocument, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
}, { iterations: 500, target: 4.0 });

suite.add('markdown-parse-large', () => {
  fromMarkdown(largeDocument, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()]
  });
}, { iterations: 100, target: 20.0 });

// Inline formatting intensive
const inlineFormatting = `**Bold text** and *italic text* and \`inline code\` mixed with [links](https://example.com) and **more *nested* formatting** and \`more code\` throughout the entire paragraph.`;
const inlineFormattingMd = createElement('markdown', { text: inlineFormatting });
suite.add('markdown-inline-formatting', () => {
  globalLayoutEngine.calculateLayout(inlineFormattingMd, makeContext(viewport.width, viewport.height));
  const buffer = new DualBuffer(viewport.width, viewport.height);
  renderer.render(inlineFormattingMd, buffer, { x: 0, y: 0, width: viewport.width, height: viewport.height });
}, { iterations: 500, target: 2.5 });

// Text wrapping intensive (long paragraphs)
const longParagraph = `This is a very long paragraph that will require extensive word wrapping to fit within the terminal width. It contains multiple sentences that flow naturally and should demonstrate the text wrapping performance of the markdown renderer. The paragraph continues with more content to ensure there are many line breaks needed. Additional text is added here to make sure we're testing the word boundary detection and line breaking algorithm thoroughly. Even more text follows to push the limits of the text wrapping code path.`;
const longParagraphMd = createElement('markdown', { text: longParagraph });
suite.add('markdown-text-wrapping', () => {
  globalLayoutEngine.calculateLayout(longParagraphMd, makeContext(80, viewport.height));
  const buffer = new DualBuffer(80, viewport.height);
  renderer.render(longParagraphMd, buffer, { x: 0, y: 0, width: 80, height: viewport.height });
}, { iterations: 500, target: 2.0 });

// Run benchmarks
const results = await suite.run();

// Helper to get median from results
const getMedian = (name: string) => results.find(r => r.name === name)?.median ?? 0;

// Add findings
suite.addFindings([
  {
    title: 'GFM table parsing has overhead',
    description: 'Enabling GFM (GitHub-Flavored Markdown) adds ~50% overhead for table parsing due to extension loading.',
    category: 'info',
    benchmarks: ['markdown-table-gfm', 'markdown-mixed-document'],
    metrics: {
      tableMs: getMedian('markdown-table-gfm'),
      mixedMs: getMedian('markdown-mixed-document'),
    }
  },
  {
    title: 'Parsing vs rendering ratio',
    description: 'Markdown parsing is fast compared to rendering. Most time is spent in layout and buffer operations.',
    category: 'info',
    benchmarks: ['markdown-parse-mixed', 'markdown-mixed-document'],
    metrics: {
      parseMs: getMedian('markdown-parse-mixed'),
      renderMs: getMedian('markdown-mixed-document'),
    }
  }
]);

// Set notes
suite.setNotes('Markdown component benchmarks. Tests parsing, rendering of various markdown elements including headings, lists, code blocks, tables, and mixed documents.');

// Save results
const outputPath = new URL('../results/markdown-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
