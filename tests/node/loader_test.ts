import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, load } from '../../src/runtime/node/loader.mjs';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Stub context for resolve hook
const ctx = { conditions: [], importAttributes: {} };

// Helper: creates a nextResolve that records the specifier it received and
// returns a fake result with that specifier as the resolved URL.
function mockNextResolve(urlOverride?: string) {
  const calls: string[] = [];
  const fn = async (spec: string) => {
    calls.push(spec);
    return { url: urlOverride ?? `file:///project/${spec}`, shortCircuit: true };
  };
  return { fn, calls };
}

// ---------- resolve hook ----------

describe('loader/resolve', () => {
  describe('npm: prefix stripping', () => {
    it('unscoped package', async () => {
      const { fn, calls } = mockNextResolve();
      await resolve('npm:html5parser@2.0.2', ctx, fn);
      assert.equal(calls[0], 'html5parser');
    });

    it('scoped package', async () => {
      const { fn, calls } = mockNextResolve();
      await resolve('npm:@jsquash/webp@1.5.0', ctx, fn);
      assert.equal(calls[0], '@jsquash/webp');
    });

    it('unscoped package with subpath', async () => {
      const { fn, calls } = mockNextResolve();
      await resolve('npm:vscode-languageserver@9.0.1/node.js', ctx, fn);
      assert.equal(calls[0], 'vscode-languageserver/node.js');
    });

    it('scoped package with subpath', async () => {
      const { fn, calls } = mockNextResolve();
      await resolve('npm:@scope/pkg@3.0.0/sub/path.js', ctx, fn);
      assert.equal(calls[0], '@scope/pkg/sub/path.js');
    });
  });

  describe('deno/server.ts → node/server.ts redirect', () => {
    it('relative ./runtime/deno/server.ts', async () => {
      const { fn, calls } = mockNextResolve();
      await resolve('./runtime/deno/server.ts', ctx, fn);
      assert.equal(calls[0], './runtime/node/server.ts');
    });

    it('relative ../runtime/deno/server.ts', async () => {
      const { fn, calls } = mockNextResolve();
      await resolve('../runtime/deno/server.ts', ctx, fn);
      assert.equal(calls[0], '../runtime/node/server.ts');
    });

    it('absolute-style path ending in /runtime/deno/server.ts', async () => {
      const { fn, calls } = mockNextResolve();
      await resolve('/some/deep/path/runtime/deno/server.ts', ctx, fn);
      assert.equal(calls[0], '/some/deep/path/runtime/node/server.ts');
    });
  });

  describe('runtime/mod.ts → runtime/node/mod.ts redirect', () => {
    it('rewrites resolved URL', async () => {
      const { fn } = mockNextResolve('file:///project/src/runtime/mod.ts');
      const result = await resolve('./runtime/mod.ts', ctx, fn);
      assert.equal(result.url, 'file:///project/src/runtime/node/mod.ts');
    });

    it('does not rewrite unrelated URLs', async () => {
      const { fn } = mockNextResolve('file:///project/src/other/mod.ts');
      const result = await resolve('./other/mod.ts', ctx, fn);
      assert.equal(result.url, 'file:///project/src/other/mod.ts');
    });
  });

  it('passes through normal specifiers unchanged', async () => {
    const { fn, calls } = mockNextResolve('file:///project/src/foo.ts');
    const result = await resolve('./foo.ts', ctx, fn);
    assert.equal(calls[0], './foo.ts');
    assert.equal(result.url, 'file:///project/src/foo.ts');
  });
});

// ---------- load hook ----------

describe('loader/load', () => {
  const tmpFile = join(tmpdir(), `melker-loader-test-${Date.now()}.ts`);
  const tmpUrl = pathToFileURL(tmpFile).href;

  it('strips TypeScript types from .ts files', async () => {
    await writeFile(tmpFile, 'export const x: number = 42;\n', 'utf-8');
    try {
      const result = await load(tmpUrl, {}, async () => { throw new Error('should not call nextLoad'); });
      assert.equal(result.format, 'module');
      assert.equal(result.shortCircuit, true);
      // Type annotation should be stripped
      assert.ok(!result.source.includes(': number'), 'type annotation should be stripped');
      // Value should remain
      assert.ok(result.source.includes('42'), 'value should remain');
    } finally {
      await unlink(tmpFile);
    }
  });

  it('delegates non-.ts files to nextLoad', async () => {
    let called = false;
    const sentinel = { format: 'module', source: 'ok' };
    const result = await load('file:///project/lib.js', {}, async () => {
      called = true;
      return sentinel;
    });
    assert.equal(called, true);
    assert.equal(result, sentinel);
  });
});
