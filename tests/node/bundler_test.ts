import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import { bundle, isBundleAvailable } from '../../src/runtime/node/bundler.ts';

describe('node/bundler', () => {
  it('isBundleAvailable returns true', () => {
    assert.equal(isBundleAvailable(), true);
  });

  it('bundles simple TypeScript', async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'melker-bundler-test-'));
    const entryFile = path.join(dir, 'entry.ts');
    await fsp.writeFile(entryFile, `
      const greeting: string = 'hello';
      console.log(greeting);
    `);

    const result = await bundle({ entrypoints: [entryFile] });
    assert.equal(result.success, true);
    assert.ok(result.outputFiles);
    assert.ok(result.outputFiles.length > 0);
    const text = result.outputFiles[0].text();
    assert.ok(text.includes('hello'));

    await fsp.rm(dir, { recursive: true });
  });

  it('handles bundle errors gracefully', async () => {
    const result = await bundle({ entrypoints: ['/nonexistent-file-melker-test.ts'] });
    assert.equal(result.success, false);
    assert.ok(result.errors);
    assert.ok(result.errors.length > 0);
  });
});
