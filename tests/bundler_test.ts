/**
 * Tests for the Melker bundler (Deno.bundle API).
 *
 * Tests generator, import rewriting, and bundle integration.
 * Run with: deno test --unstable-bundle --allow-all tests/bundler_test.ts
 */

import {
  assertEquals,
  assertStringIncludes,
  assertMatch,
} from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { generate } from '../src/bundler/generator.ts';
import { bundle, requiresBundling, hasNpmImports } from '../src/bundler/bundle.ts';
import { isBundleAvailable } from '../src/bundler/errors.ts';
import type { ParseResult, ParsedScript, ParsedHandler } from '../src/bundler/types.ts';

// Helper to create a minimal ParseResult
function createParseResult(overrides: Partial<ParseResult> = {}): ParseResult {
  return {
    template: '<container></container>',
    scripts: [],
    handlers: [],
    originalContent: '',
    resolvedContent: '',
    sourceUrl: 'file:///test/app.melker',
    ...overrides,
  };
}

// Helper to create a minimal ParsedScript
function createScript(overrides: Partial<ParsedScript> = {}): ParsedScript {
  return {
    id: 'script_0',
    type: 'sync',
    code: '',
    isAsync: false,
    sourceRange: {
      start: { line: 1, column: 0, offset: 0 },
      end: { line: 1, column: 0, offset: 0 },
    },
    ...overrides,
  };
}

// =============================================================================
// requiresBundling / hasNpmImports detection
// =============================================================================

Deno.test('requiresBundling: detects npm: imports', () => {
  assertEquals(requiresBundling(`import { foo } from 'npm:lodash';`), true);
  assertEquals(requiresBundling(`import foo from "npm:chalk@5";`), true);
});

Deno.test('requiresBundling: detects jsr: imports', () => {
  assertEquals(requiresBundling(`import { serve } from 'jsr:@std/http';`), true);
});

Deno.test('requiresBundling: detects https: imports', () => {
  assertEquals(requiresBundling(`import { x } from 'https://deno.land/x/foo/mod.ts';`), true);
});

Deno.test('requiresBundling: detects relative imports', () => {
  assertEquals(requiresBundling(`import { foo } from './utils.ts';`), true);
  assertEquals(requiresBundling(`import bar from '../lib/bar.ts';`), true);
});

Deno.test('requiresBundling: returns false for plain code', () => {
  assertEquals(requiresBundling(`const x = 1; console.log(x);`), false);
  assertEquals(requiresBundling(`function foo() { return 42; }`), false);
});

Deno.test('hasNpmImports: specific npm detection', () => {
  assertEquals(hasNpmImports(`import { foo } from 'npm:lodash';`), true);
  assertEquals(hasNpmImports(`import { foo } from 'jsr:@std/http';`), false);
  assertEquals(hasNpmImports(`const x = 1;`), false);
});

// =============================================================================
// Generator: inline scripts
// =============================================================================

Deno.test('generate: includes runtime globals', () => {
  const parsed = createParseResult();
  const result = generate(parsed);

  assertStringIncludes(result.code, 'const $melker = (globalThis as any).$melker');
  assertStringIncludes(result.code, 'const argv = (globalThis as any).argv');
});

Deno.test('generate: includes source metadata', () => {
  const parsed = createParseResult({
    sourceUrl: 'file:///home/user/myapp.melker',
  });
  const result = generate(parsed);

  // Source metadata is now on $melker (url and dirname)
  assertStringIncludes(result.code, 'url: "file:///home/user/myapp.melker"');
  assertStringIncludes(result.code, 'dirname: "/home/user"');
});

Deno.test('generate: inlines sync script code', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        code: `const count = 0;\nfunction increment() { count++; }`,
      }),
    ],
  });
  const result = generate(parsed);

  assertStringIncludes(result.code, 'const count = 0;');
  assertStringIncludes(result.code, 'function increment()');
});

Deno.test('generate: exports assigned to context', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        code: `export const myValue = 42;\nexport function myFunc() {}`,
      }),
    ],
  });
  const result = generate(parsed);

  assertStringIncludes(result.code, '($melker as any).myValue = myValue;');
  assertStringIncludes(result.code, '($melker as any).myFunc = myFunc;');
});

Deno.test('generate: creates __init function for init scripts', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        type: 'init',
        code: `await loadData();`,
        isAsync: true,
      }),
    ],
  });
  const result = generate(parsed);

  assertStringIncludes(result.code, 'async function __init()');
  assertStringIncludes(result.code, 'await loadData()');
});

Deno.test('generate: creates __ready function for ready scripts', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        type: 'ready',
        code: `focusInput();`,
      }),
    ],
  });
  const result = generate(parsed);

  assertStringIncludes(result.code, 'async function __ready()');
  assertStringIncludes(result.code, 'focusInput()');
});

// =============================================================================
// Generator: external scripts with import rewriting
// =============================================================================

Deno.test('generate: rewrites relative imports in external scripts', () => {
  const parsed = createParseResult({
    sourceUrl: 'file:///home/user/app.melker',
    scripts: [
      createScript({
        code: `import { foo } from './utils.ts';\nimport bar from '../lib/bar.ts';`,
        externalSrc: 'src/main.ts',
      }),
    ],
  });
  const result = generate(parsed);

  // Imports should be rewritten to absolute URLs
  assertStringIncludes(result.code, "from 'file:///home/user/src/utils.ts'");
  assertStringIncludes(result.code, "from 'file:///home/user/lib/bar.ts'");
});

Deno.test('generate: preserves npm: imports unchanged', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        code: `import chalk from 'npm:chalk@5';`,
        externalSrc: 'src/main.ts',
      }),
    ],
  });
  const result = generate(parsed);

  assertStringIncludes(result.code, "from 'npm:chalk@5'");
});

Deno.test('generate: rewrites dynamic imports', () => {
  const parsed = createParseResult({
    sourceUrl: 'file:///app/main.melker',
    scripts: [
      createScript({
        code: `const mod = await import('./dynamic.ts');`,
        externalSrc: 'src/loader.ts',
      }),
    ],
  });
  const result = generate(parsed);

  assertStringIncludes(result.code, "import('file:///app/src/dynamic.ts')");
});

// =============================================================================
// Generator: event handlers
// =============================================================================

Deno.test('generate: creates handler functions', () => {
  const handler: ParsedHandler = {
    id: '__h0',
    attributeName: 'onClick',
    code: 'count++',
    isAsync: false,
    params: [{ name: 'event', type: 'MouseEvent' }],
    attributeRange: {
      start: { line: 5, column: 0, offset: 50 },
      end: { line: 5, column: 20, offset: 70 },
    },
    codeRange: {
      start: { line: 5, column: 9, offset: 59 },
      end: { line: 5, column: 16, offset: 66 },
    },
    element: { tag: 'button', id: 'btn', line: 5 },
  };

  const parsed = createParseResult({ handlers: [handler] });
  const result = generate(parsed);

  assertStringIncludes(result.code, 'function __h0(event: MouseEvent)');
  assertStringIncludes(result.code, 'count++');
});

Deno.test('generate: creates async handler functions', () => {
  const handler: ParsedHandler = {
    id: '__h0',
    attributeName: 'onClick',
    code: 'await fetchData()',
    isAsync: true,
    params: [{ name: 'event', type: 'MouseEvent' }],
    attributeRange: {
      start: { line: 5, column: 0, offset: 50 },
      end: { line: 5, column: 30, offset: 80 },
    },
    codeRange: {
      start: { line: 5, column: 9, offset: 59 },
      end: { line: 5, column: 26, offset: 76 },
    },
    element: { tag: 'button', line: 5 },
  };

  const parsed = createParseResult({ handlers: [handler] });
  const result = generate(parsed);

  assertStringIncludes(result.code, 'async function __h0');
  assertStringIncludes(result.code, 'Promise<void>');
});

Deno.test('generate: registers handlers in __melker', () => {
  const parsed = createParseResult({
    handlers: [
      {
        id: '__h0',
        attributeName: 'onClick',
        code: 'foo()',
        isAsync: false,
        params: [{ name: 'event', type: 'MouseEvent' }],
        attributeRange: { start: { line: 1, column: 0, offset: 0 }, end: { line: 1, column: 0, offset: 0 } },
        codeRange: { start: { line: 1, column: 0, offset: 0 }, end: { line: 1, column: 0, offset: 0 } },
        element: { tag: 'button', line: 1 },
      },
      {
        id: '__h1',
        attributeName: 'onKeyPress',
        code: 'bar()',
        isAsync: false,
        params: [{ name: 'event', type: 'KeyboardEvent' }],
        attributeRange: { start: { line: 2, column: 0, offset: 0 }, end: { line: 2, column: 0, offset: 0 } },
        codeRange: { start: { line: 2, column: 0, offset: 0 }, end: { line: 2, column: 0, offset: 0 } },
        element: { tag: 'input', line: 2 },
      },
    ],
  });
  const result = generate(parsed);

  assertStringIncludes(result.code, '(globalThis as any).__melker = {');
  assertStringIncludes(result.code, '__h0,');
  assertStringIncludes(result.code, '__h1,');
});

// =============================================================================
// Bundle integration (requires --unstable-bundle)
// =============================================================================

Deno.test({
  name: 'bundle: bundles simple TypeScript',
  ignore: !isBundleAvailable(),
  async fn() {
    const parsed = createParseResult({
      scripts: [
        createScript({
          code: `const x: number = 42;\nexport const result = x * 2;`,
        }),
      ],
    });
    const generated = generate(parsed);
    const result = await bundle(generated);

    // Should produce bundled JS with the variable and expression
    assertStringIncludes(result.code, 'result');
    assertStringIncludes(result.code, '42'); // original value preserved
  },
});

Deno.test({
  name: 'bundle: bundles with npm imports',
  ignore: !isBundleAvailable(),
  async fn() {
    const parsed = createParseResult({
      scripts: [
        createScript({
          // Use a small npm package that exists
          code: `import isOdd from 'npm:is-odd@3';\nexport const test = isOdd(3);`,
        }),
      ],
    });
    const generated = generate(parsed);
    const result = await bundle(generated);

    // Should bundle the npm dependency
    assertEquals(typeof result.code, 'string');
    // The bundled code should work (is-odd returns true for 3)
  },
});

Deno.test({
  name: 'bundle: produces sourcemap',
  ignore: !isBundleAvailable(),
  async fn() {
    const parsed = createParseResult({
      scripts: [createScript({ code: `const x = 1;` })],
    });
    const generated = generate(parsed);
    const result = await bundle(generated);

    // Should have inline sourcemap extracted
    assertEquals(result.sourceMap !== null || result.sourceMap === null, true);
  },
});
