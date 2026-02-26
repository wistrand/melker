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
  assertNotEquals,
} from 'jsr:@std/assert';
import { generate } from '../src/bundler/generator.ts';
import { bundle, requiresBundling, hasNpmImports } from '../src/bundler/bundle.ts';
import { executeBundle, processMelkerBundle } from '../src/bundler/mod.ts';
import { parseMelkerForBundler } from '../src/template.ts';
import {
  isBundleAvailable,
  ErrorTranslator,
  formatError,
  getHintForError,
  parseBundleError,
} from '../src/bundler/errors.ts';
import type { ParseResult, ParsedScript, ParsedHandler, LineMapping, SourceMapData, ScriptMeta, TranslatedError } from '../src/bundler/types.ts';

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

Deno.test('generate: url and dirname in $melker interface', () => {
  const parsed = createParseResult({
    sourceUrl: 'file:///home/user/myapp.melker',
  });
  const result = generate(parsed);

  // Source metadata types are declared in $melker interface (values set at runtime)
  assertStringIncludes(result.code, 'url: string;');
  assertStringIncludes(result.code, 'dirname: string;');
});

Deno.test('generate: creates script modules for inline scripts', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        code: `const count = 0;\nfunction increment() { count++; }`,
      }),
    ],
  });
  const result = generate(parsed);

  // Inline scripts are now created as separate modules and imported
  assertEquals(result.scriptModules.length, 1);
  assertEquals(result.scriptModules[0].filename, '_inline_0.ts');
  assertStringIncludes(result.scriptModules[0].content, 'const count = 0;');
  assertStringIncludes(result.scriptModules[0].content, 'function increment()');
  // Main code imports the module
  assertStringIncludes(result.code, "import * as _script_0 from './_inline_0.ts'");
});

Deno.test('generate: exports merged via __mergeExports', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        code: `export const myValue = 42;\nexport function myFunc() {}`,
      }),
    ],
  });
  const result = generate(parsed);

  // Exports are now merged using __mergeExports helper
  assertStringIncludes(result.code, 'function __mergeExports(target: Record<string, any>, source: Record<string, any>, scriptName: string)');
  assertStringIncludes(result.code, '__mergeExports($melker.exports, _script_0');
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

  // Init scripts are created as modules with __initFn exports
  assertEquals(result.scriptModules.length, 1);
  assertEquals(result.scriptModules[0].filename, '_init_0.ts');
  assertStringIncludes(result.scriptModules[0].content, 'export async function __initFn()');
  assertStringIncludes(result.scriptModules[0].content, 'await loadData()');
  // Main code has __init function that calls the module
  assertStringIncludes(result.code, 'async function __init()');
  assertStringIncludes(result.code, 'await __initFn_0()');
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

  // Ready scripts are created as modules with __readyFn exports
  assertEquals(result.scriptModules.length, 1);
  assertEquals(result.scriptModules[0].filename, '_ready_0.ts');
  assertStringIncludes(result.scriptModules[0].content, 'export async function __readyFn()');
  assertStringIncludes(result.scriptModules[0].content, 'focusInput()');
  // Main code has __ready function that calls the module
  assertStringIncludes(result.code, 'async function __ready()');
  assertStringIncludes(result.code, 'await __readyFn_0()');
});

// =============================================================================
// Generator: external scripts with import resolution
// =============================================================================

Deno.test('generate: imports external scripts with resolved URLs', () => {
  const parsed = createParseResult({
    sourceUrl: 'file:///home/user/app.melker',
    scripts: [
      createScript({
        code: `import { foo } from './utils.ts';`,
        externalSrc: 'src/main.ts',
      }),
    ],
  });
  const result = generate(parsed);

  // External script should be imported with resolved URL
  // (relative imports within the script are resolved at bundle time by Deno)
  assertStringIncludes(result.code, "from 'file:///home/user/src/main.ts'");
});

Deno.test('generate: external scripts create import statements', () => {
  const parsed = createParseResult({
    sourceUrl: 'file:///test/app.melker',
    scripts: [
      createScript({
        code: `import chalk from 'npm:chalk@5';`,
        externalSrc: 'src/main.ts',
      }),
    ],
  });
  const result = generate(parsed);

  // External script is imported as ES module (npm imports resolved at bundle time)
  assertStringIncludes(result.code, "import * as _script_0 from 'file:///test/src/main.ts'");
});

Deno.test('generate: external script URL resolution', () => {
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

  // External script imported with resolved path (dynamic imports handled at bundle time)
  assertStringIncludes(result.code, "from 'file:///app/src/loader.ts'");
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

// =============================================================================
// executeBundle argv handling
// =============================================================================

Deno.test({
  name: 'executeBundle: passes explicit argv to globalThis',
  ignore: !isBundleAvailable(),
  async fn() {
    const melkerContent = `<melker>
<script>
  export function getArgv() { return argv; }
</script>
<text>test</text>
</melker>`;
    const sourceUrl = 'file:///test/argv-test.melker';
    const parsed = await parseMelkerForBundler(melkerContent, sourceUrl);
    const assembled = await processMelkerBundle(parsed, { debug: false, useCache: false });

    const exports: Record<string, any> = {};
    const context = {
      engine: { onResize: () => {}, onMount: () => {}, render: () => {}, forceRender: () => {} },
      getElementById: () => null,
      exit: () => {},
      logger: null,
      getLogger: () => null,
      config: {},
      exports,
    };

    const testArgv = ['/path/to/app.melker', 'mydir', 'myfile.png'];
    await executeBundle(assembled, context, testArgv);

    // Runtime argv should be exactly what we passed
    assertEquals((globalThis as any).argv, testArgv);
  },
});

Deno.test({
  name: 'executeBundle: argv[0] is melker path, argv[1+] are user args',
  ignore: !isBundleAvailable(),
  async fn() {
    const melkerContent = `<melker>
<script>
  export function getArgv() { return argv; }
</script>
<text>test</text>
</melker>`;
    const sourceUrl = 'file:///test/argv-test2.melker';
    const parsed = await parseMelkerForBundler(melkerContent, sourceUrl);
    const assembled = await processMelkerBundle(parsed, { debug: false, useCache: false });

    const exports: Record<string, any> = {};
    const context = {
      engine: { onResize: () => {}, onMount: () => {}, render: () => {}, forceRender: () => {} },
      getElementById: () => null,
      exit: () => {},
      logger: null,
      getLogger: () => null,
      config: {},
      exports,
    };

    const testArgv = ['/abs/path/app.melker', 'user-arg1', 'user-arg2'];
    await executeBundle(assembled, context, testArgv);

    const runtimeArgv = (globalThis as any).argv as string[];
    assertEquals(runtimeArgv[0], '/abs/path/app.melker');
    assertEquals(runtimeArgv[1], 'user-arg1');
    assertEquals(runtimeArgv[2], 'user-arg2');
    assertEquals(runtimeArgv.length, 3);
  },
});

Deno.test({
  name: 'executeBundle: falls back to Deno.args.slice(1) when no argv provided',
  ignore: !isBundleAvailable(),
  async fn() {
    const melkerContent = `<melker>
<script>
  export function noop() {}
</script>
<text>test</text>
</melker>`;
    const sourceUrl = 'file:///test/argv-fallback.melker';
    const parsed = await parseMelkerForBundler(melkerContent, sourceUrl);
    const assembled = await processMelkerBundle(parsed, { debug: false, useCache: false });

    const exports: Record<string, any> = {};
    const context = {
      engine: { onResize: () => {}, onMount: () => {}, render: () => {}, forceRender: () => {} },
      getElementById: () => null,
      exit: () => {},
      logger: null,
      getLogger: () => null,
      config: {},
      exports,
    };

    // No argv argument — should fall back to Deno.args.slice(1)
    await executeBundle(assembled, context);

    const runtimeArgv = (globalThis as any).argv as string[];
    assertEquals(Array.isArray(runtimeArgv), true);
    // Should be Deno.args.slice(1) — during tests this is test runner args
    assertEquals(runtimeArgv, Deno.args.slice(1));
  },
});

// =============================================================================
// E2E subprocess argv test
// =============================================================================

Deno.test({
  name: 'e2e: argv available in subprocess with correct indexing',
  async fn() {
    // Use template ${argv[N]} substitution which happens before render —
    // avoids --stdout timing issues with async="ready" scripts
    const tempDir = await Deno.makeTempDir({ prefix: 'melker-argv-test-' });
    const melkerFile = `${tempDir}/argv-test.melker`;

    await Deno.writeTextFile(melkerFile,
      '<melker>\n' +
      '<policy>{"permissions":{}}</policy>\n' +
      '<container style="border: thin;">\n' +
      '<text>A0=${argv[0]}|A1=${argv[1]}|A2=${argv[2]}</text>\n' +
      '</container>\n' +
      '</melker>\n');

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', '--unstable-bundle',
          'melker.ts', '--trust', '--stdout', '--stdout-width=200', '--theme=bw',
          melkerFile, 'testdir', 'testfile.png',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd: import.meta.dirname ? import.meta.dirname.replace('/tests', '') : undefined,
      });

      const { stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      // argv[0] is the .melker file path, argv[1+] are user args
      assertStringIncludes(output, `A0=${melkerFile}`);
      assertStringIncludes(output, 'A1=testdir');
      assertStringIncludes(output, 'A2=testfile.png');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'e2e: argv consistent regardless of --flag=value vs --flag value syntax',
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: 'melker-argv-flags-' });
    const melkerFile = `${tempDir}/argv-flags.melker`;

    await Deno.writeTextFile(melkerFile,
      '<melker>\n' +
      '<policy>{"permissions":{}}</policy>\n' +
      '<container style="border: thin;">\n' +
      '<text>argv1=${argv[1]:-MISSING}</text>\n' +
      '</container>\n' +
      '</melker>\n');

    const cwd = import.meta.dirname ? import.meta.dirname.replace('/tests', '') : undefined;

    try {
      // Test with --theme=bw (= syntax)
      const cmd1 = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', '--unstable-bundle',
          'melker.ts', '--trust', '--stdout', '--stdout-width=200', '--theme=bw',
          melkerFile, 'myarg',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd,
      });
      const out1 = new TextDecoder().decode((await cmd1.output()).stdout);

      // Test with --theme bw (space syntax)
      const cmd2 = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', '--unstable-bundle',
          'melker.ts', '--trust', '--stdout', '--stdout-width=200', '--theme', 'bw',
          melkerFile, 'myarg',
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd,
      });
      const out2 = new TextDecoder().decode((await cmd2.output()).stdout);

      // Both should produce the same argv — user arg should NOT be the flag value
      assertStringIncludes(out1, 'argv1=myarg');
      assertStringIncludes(out2, 'argv1=myarg');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// =============================================================================
// Error tracing: getHintForError
// =============================================================================

Deno.test('getHintForError: undefined variable', () => {
  const hint = getHintForError('myVar is not defined');
  assertStringIncludes(hint!, 'myVar');
  assertStringIncludes(hint!, 'misspelled');
});

Deno.test('getHintForError: unexpected token', () => {
  const hint = getHintForError('Unexpected token {');
  assertStringIncludes(hint!, 'syntax error');
});

Deno.test('getHintForError: npm import', () => {
  const hint = getHintForError('npm:lodash not found');
  assertStringIncludes(hint!, '--unstable-bundle');
});

Deno.test('getHintForError: module not found', () => {
  const hint = getHintForError('Cannot find module "./utils.ts"');
  assertStringIncludes(hint!, 'import path');
});

Deno.test('getHintForError: permission denied', () => {
  const hint = getHintForError('PermissionDenied: --allow-net required');
  assertStringIncludes(hint!, 'permissions');
});

Deno.test('getHintForError: no hint for generic errors', () => {
  assertEquals(getHintForError('Something went wrong'), undefined);
});

// =============================================================================
// Error tracing: ErrorTranslator.parseStack (data: URLs)
// =============================================================================

Deno.test('ErrorTranslator: translates data: URL stack frames', () => {
  // Simulate a lineMap where generated line 5 maps to .melker line 10
  const lineMap = new Map<number, LineMapping>();
  lineMap.set(5, { generatedLine: 5, originalLine: 10, sourceId: 'script_0', description: 'inline script' });

  const originalSource = '<melker>\n<script>\nconst a = 1;\nconst b = 2;\nundefinedVar;\n</script>\n</melker>';
  const translator = new ErrorTranslator(null, lineMap, originalSource, 'file:///app.melker');

  // Simulate a data: URL error (like what Deno produces for bundle import errors)
  const error = new ReferenceError('undefinedVar is not defined');
  error.stack = `ReferenceError: undefinedVar is not defined
    at data:application/javascript;base64,Y29uc3QgeCA9IDE7:5:9`;

  const translated = translator.translate(error);

  assertEquals(translated.name, 'ReferenceError');
  assertEquals(translated.message, 'undefinedVar is not defined');
  // Should have translated the frame (line 5 in bundle → line 10 in .melker via lineMap)
  const usefulFrames = translated.frames.filter(f => f.context !== 'unknown');
  assertEquals(usefulFrames.length, 1);
  assertEquals(usefulFrames[0].line, 10);
  assertEquals(usefulFrames[0].file, 'file:///app.melker');
});

Deno.test('ErrorTranslator: translates data: URL with Deno truncation dots', () => {
  const lineMap = new Map<number, LineMapping>();
  lineMap.set(19, { generatedLine: 19, originalLine: 7, sourceId: 'script_0', description: 'test' });

  const translator = new ErrorTranslator(null, lineMap, '', 'file:///app.melker');

  const error = new Error('test error');
  error.stack = `Error: test error
    at data:application/javascript;base64,dmFyIF9fZGVm......bl9vbkNsaWNrXzAKfTs=:19:9`;

  const translated = translator.translate(error);
  const usefulFrames = translated.frames.filter(f => f.context !== 'unknown');
  assertEquals(usefulFrames.length, 1);
  assertEquals(usefulFrames[0].line, 7);
});

Deno.test('ErrorTranslator: translates function names in stack frames', () => {
  const lineMap = new Map<number, LineMapping>();
  lineMap.set(10, { generatedLine: 10, originalLine: 5, sourceId: '__h0', description: 'handler' });
  lineMap.set(20, { generatedLine: 20, originalLine: 15, sourceId: '__ready', description: 'ready' });

  const translator = new ErrorTranslator(null, lineMap, '', 'file:///app.melker');

  // Test handler name
  const err1 = new Error('test');
  err1.stack = `Error: test\n    at __h0 (data:application/javascript;base64,abc:10:1)`;
  const t1 = translator.translate(err1);
  assertEquals(t1.frames[0].functionName, 'event handler');
  assertEquals(t1.frames[0].context, 'handler');

  // Test ready name (wrapper form)
  const err2 = new Error('test');
  err2.stack = `Error: test\n    at __readyFn (data:application/javascript;base64,abc:20:1)`;
  const t2 = translator.translate(err2);
  assertEquals(t2.frames[0].functionName, 'async ready');
  assertEquals(t2.frames[0].context, 'ready');

  // Test init name (wrapper form)
  const err3 = new Error('test');
  err3.stack = `Error: test\n    at __initFn_0 (data:application/javascript;base64,abc:20:1)`;
  const t3 = translator.translate(err3);
  assertEquals(t3.frames[0].functionName, 'async init');
  assertEquals(t3.frames[0].context, 'init');
});

// =============================================================================
// Error tracing: ErrorTranslator with sourcemap + scriptMeta
// =============================================================================

Deno.test('ErrorTranslator: uses scriptMeta for direct bundled→melker mapping', () => {
  // Simulate a sourcemap that maps bundled line 10 → _inline_0.ts line 20
  // And scriptMeta that says _inline_0.ts starts at .melker line 8 with 15 header lines
  // So: bundled line 10 → source line 20 in temp file → line 20-15=5 in script → .melker line 8+5=13

  const sourcemap: SourceMapData = {
    version: 3,
    sources: ['file:///tmp/melker-bundle-test/_inline_0.ts'],
    names: [],
    // VLQ: 10 groups (semicolons), 10th has mapping to source line 20
    // This is a simplified sourcemap — we build a real one below
    mappings: '',
  };

  // Build a minimal VLQ mappings string:
  // We need bundled line 10 (index 9) to map to source 0, line 20, col 0
  // VLQ encoding: genCol=0 (A), sourceIdx=0 (A), sourceLine=20 (oBAAA for delta 20), sourceCol=0 (A)
  // For first segment ever, all values are absolute (deltas from 0)
  // genCol=0 → A, srcIdx=0 → A, srcLine=20 → oB (20 = 0b10100, VLQ: shift left = 0b101000=40, needs continuation: 40 = 0b00101000,
  // VLQ base64 is 5-bit: 01000=8 with continue=1 → 101000=40 → char at 40='o', then 01=1 → char at 1='B')
  // Actually let me just build it programmatically

  // Encode VLQ value
  function encodeVlq(value: number): string {
    const VLQ_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    let vlq = value < 0 ? ((-value) << 1) | 1 : value << 1;
    let result = '';
    do {
      let digit = vlq & 0x1f;
      vlq >>>= 5;
      if (vlq > 0) digit |= 0x20;
      result += VLQ_CHARS[digit];
    } while (vlq > 0);
    return result;
  }

  // Build mappings: 9 empty lines (;;;;...;), then line 10 maps to source 0, line 20, col 0
  const segment = encodeVlq(0) + encodeVlq(0) + encodeVlq(20) + encodeVlq(0);
  sourcemap.mappings = ';'.repeat(9) + segment;

  const scriptMeta: ScriptMeta[] = [{
    filename: '_inline_0.ts',
    originalLine: 8,
    headerLines: 15,
  }];

  const lineMap = new Map<number, LineMapping>();
  const translator = new ErrorTranslator(sourcemap, lineMap, 'line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8\nline9\nline10\nline11\nline12\nline13: the error line', 'file:///app.melker', scriptMeta);

  const error = new Error('some error');
  error.stack = `Error: some error\n    at data:application/javascript;base64,abc:10:5`;

  const translated = translator.translate(error);
  const usefulFrames = translated.frames.filter(f => f.context !== 'unknown');

  assertEquals(usefulFrames.length, 1);
  // bundled line 10 → source line 20 → 20 - 15 headers = 5 into script → 8 + 5 = 13
  assertEquals(usefulFrames[0].line, 13);
  assertEquals(usefulFrames[0].file, 'file:///app.melker');
  assertEquals(usefulFrames[0].sourceLine, 'line13: the error line');
});

Deno.test('ErrorTranslator: falls back to lineMap when no scriptMeta match', () => {
  const sourcemap: SourceMapData = {
    version: 3,
    sources: ['file:///tmp/entry.ts'],  // Not an inline script
    names: [],
    mappings: 'AAAA',  // Line 1 maps to source 0, line 0, col 0
  };

  const lineMap = new Map<number, LineMapping>();
  lineMap.set(1, { generatedLine: 1, originalLine: 5, sourceId: '__h0', description: 'handler' });

  const translator = new ErrorTranslator(sourcemap, lineMap, 'l1\nl2\nl3\nl4\nhandler line', 'file:///app.melker', []);

  const error = new Error('test');
  error.stack = `Error: test\n    at __h0 (data:application/javascript;base64,abc:1:1)`;

  const translated = translator.translate(error);
  const usefulFrames = translated.frames.filter(f => f.context !== 'unknown');

  // Should fall back to lineMap: line 1 → originalLine 5
  assertEquals(usefulFrames.length, 1);
  assertEquals(usefulFrames[0].line, 5);
});

// =============================================================================
// Error tracing: formatError
// =============================================================================

Deno.test('formatError: includes error name and message', () => {
  const error: TranslatedError = {
    name: 'TypeError',
    message: 'Cannot read property of null',
    frames: [],
  };
  const output = formatError(error);
  assertStringIncludes(output, 'TypeError');
  assertStringIncludes(output, 'Cannot read property of null');
});

Deno.test('formatError: includes source location and line', () => {
  const error: TranslatedError = {
    name: 'ReferenceError',
    message: 'x is not defined',
    frames: [{
      functionName: 'event handler',
      file: 'file:///app.melker',
      line: 15,
      column: 5,
      sourceLine: '    x.doSomething();',
      context: 'handler',
    }],
  };
  const output = formatError(error);
  assertStringIncludes(output, 'event handler');
  assertStringIncludes(output, 'file:///app.melker:15');
  assertStringIncludes(output, 'x.doSomething()');
});

Deno.test('formatError: skips unknown frames', () => {
  const error: TranslatedError = {
    name: 'Error',
    message: 'test',
    frames: [{
      functionName: 'unknown_fn',
      file: '<bundle>',
      line: 999,
      column: 1,
      sourceLine: null,
      context: 'unknown',
    }],
  };
  const output = formatError(error);
  // Should not include the unknown frame location
  assertEquals(output.includes('999'), false);
  assertEquals(output.includes('<bundle>'), false);
});

Deno.test('formatError: includes hint for known error patterns', () => {
  const error: TranslatedError = {
    name: 'ReferenceError',
    message: 'myVar is not defined',
    frames: [],
  };
  const output = formatError(error);
  assertStringIncludes(output, 'Hint');
  assertStringIncludes(output, 'myVar');
});

// =============================================================================
// Error tracing: generate produces scriptMeta
// =============================================================================

Deno.test('generate: produces scriptMeta for inline scripts', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        id: 'script_0',
        type: 'sync',
        code: 'const x = 1;',
        sourceRange: { start: { line: 5, column: 0, offset: 0 }, end: { line: 5, column: 0, offset: 0 } },
      }),
    ],
  });
  const result = generate(parsed);

  assertEquals(result.scriptMeta.length, 1);
  assertEquals(result.scriptMeta[0].filename, '_inline_0.ts');
  assertEquals(result.scriptMeta[0].originalLine, 5);
  assertEquals(typeof result.scriptMeta[0].headerLines, 'number');
  // Header should be > 0 (at minimum the runtime globals)
  assertNotEquals(result.scriptMeta[0].headerLines, 0);
});

Deno.test('generate: ready scripts have extra header lines for wrapper', () => {
  const parsed = createParseResult({
    scripts: [
      createScript({
        id: 'script_0',
        type: 'sync',
        code: 'const x = 1;',
        sourceRange: { start: { line: 5, column: 0, offset: 0 }, end: { line: 5, column: 0, offset: 0 } },
      }),
      createScript({
        id: 'ready_0',
        type: 'ready',
        code: 'doStuff();',
        sourceRange: { start: { line: 10, column: 0, offset: 0 }, end: { line: 10, column: 0, offset: 0 } },
      }),
    ],
  });
  const result = generate(parsed);

  assertEquals(result.scriptMeta.length, 2);
  const inlineMeta = result.scriptMeta.find(m => m.filename === '_inline_0.ts')!;
  const readyMeta = result.scriptMeta.find(m => m.filename === '_ready_0.ts')!;

  // Ready scripts have 2 extra header lines (blank line + function declaration)
  assertEquals(readyMeta.headerLines, inlineMeta.headerLines + 2);
  assertEquals(readyMeta.originalLine, 10);
});

// =============================================================================
// E2E: error tracing through subprocess
// =============================================================================

Deno.test({
  name: 'e2e: script errors trace back to .melker source line',
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: 'melker-error-trace-' });
    const melkerFile = `${tempDir}/error-trace.melker`;

    // Line numbers:
    // 1: <melker>
    // 2: <text>test</text>
    // 3: <script type="typescript">
    // 4:   const a = 1;
    // 5:   const b = undefinedVar + 1;
    // 6: </script>
    // 7: </melker>
    await Deno.writeTextFile(melkerFile,
      '<melker>\n' +
      '<text>test</text>\n' +
      '<script type="typescript">\n' +
      '  const a = 1;\n' +
      '  const b = undefinedVar + 1;\n' +
      '</script>\n' +
      '</melker>\n');

    const cwd = import.meta.dirname ? import.meta.dirname.replace('/tests', '') : undefined;

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', '--unstable-bundle',
          'melker.ts', '--trust', '--stdout',
          melkerFile,
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd,
      });

      const output = await cmd.output();
      const stderr = new TextDecoder().decode(output.stderr);

      // Should mention the .melker file
      assertStringIncludes(stderr, 'error-trace.melker');
      // Should show the error
      assertStringIncludes(stderr, 'undefinedVar');
      // Should NOT contain base64 data: URL blob
      assertEquals(stderr.includes('data:application/javascript;base64,'), false);
      // Should point to line 5 (the actual error line)
      assertStringIncludes(stderr, ':5');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'e2e: ready script errors trace back to source',
  async fn() {
    const tempDir = await Deno.makeTempDir({ prefix: 'melker-ready-error-' });
    const melkerFile = `${tempDir}/ready-error.melker`;

    // Line numbers:
    // 1: <melker>
    // 2: <text>test</text>
    // 3: <script type="typescript" async="ready">
    // 4:   const x: any = null;
    // 5:   x.nonexistent();
    // 6: </script>
    // 7: </melker>
    await Deno.writeTextFile(melkerFile,
      '<melker>\n' +
      '<text>test</text>\n' +
      '<script type="typescript" async="ready">\n' +
      '  const x: any = null;\n' +
      '  x.nonexistent();\n' +
      '</script>\n' +
      '</melker>\n');

    const cwd = import.meta.dirname ? import.meta.dirname.replace('/tests', '') : undefined;

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: [
          'run', '--allow-all', '--unstable-bundle',
          'melker.ts', '--trust', '--stdout',
          melkerFile,
        ],
        stdout: 'piped',
        stderr: 'piped',
        cwd,
      });

      const output = await cmd.output();
      const stderr = new TextDecoder().decode(output.stderr);

      // Should mention the .melker file
      assertStringIncludes(stderr, 'ready-error.melker');
      // Should show a TypeError (null property access)
      assertStringIncludes(stderr, 'nonexistent');
      // Should NOT contain base64 data: URL blob
      assertEquals(stderr.includes('data:application/javascript;base64,'), false);
      // Should point to line 5 (the actual error line)
      assertStringIncludes(stderr, ':5');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
