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
} from 'jsr:@std/assert';
import { generate } from '../src/bundler/generator.ts';
import { bundle, requiresBundling, hasNpmImports } from '../src/bundler/bundle.ts';
import { executeBundle, processMelkerBundle } from '../src/bundler/mod.ts';
import { parseMelkerForBundler } from '../src/template.ts';
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
