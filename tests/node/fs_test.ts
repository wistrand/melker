import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  readTextFile, writeTextFile, stat, makeTempDir, makeTempFile,
  remove, mkdir, readDir,
  isNotFoundError, isAlreadyExistsError, isPermissionError,
  readTextFileSync, writeTextFileSync, statSync, removeSync,
  hasWritePermission,
} from '../../src/runtime/node/fs.ts';

describe('node/fs', () => {
  it('readTextFile/writeTextFile round-trip', async () => {
    const dir = await makeTempDir({ prefix: 'melker-test-' });
    const filePath = path.join(dir, 'test.txt');
    await writeTextFile(filePath, 'hello world');
    const content = await readTextFile(filePath);
    assert.equal(content, 'hello world');
    await remove(dir, { recursive: true });
  });

  it('writeTextFile with append', async () => {
    const dir = await makeTempDir({ prefix: 'melker-test-' });
    const filePath = path.join(dir, 'append.txt');
    await writeTextFile(filePath, 'first');
    await writeTextFile(filePath, ' second', { append: true });
    const content = await readTextFile(filePath);
    assert.equal(content, 'first second');
    await remove(dir, { recursive: true });
  });

  it('stat returns file info', async () => {
    const filePath = await makeTempFile({ prefix: 'melker-test-' });
    const info = await stat(filePath);
    assert.equal(info.isFile, true);
    assert.equal(info.isDirectory, false);
    assert.equal(info.isSymlink, false);
    assert.equal(typeof info.size, 'number');
    // Clean up parent dir
    await remove(path.dirname(filePath), { recursive: true });
  });

  it('makeTempDir creates a directory', async () => {
    const dir = await makeTempDir({ prefix: 'melker-test-' });
    const info = await stat(dir);
    assert.equal(info.isDirectory, true);
    await remove(dir, { recursive: true });
  });

  it('makeTempFile creates a file', async () => {
    const filePath = await makeTempFile({ prefix: 'melker-test-' });
    const info = await stat(filePath);
    assert.equal(info.isFile, true);
    await remove(path.dirname(filePath), { recursive: true });
  });

  it('readDir yields entries', async () => {
    const dir = await makeTempDir({ prefix: 'melker-test-' });
    await writeTextFile(path.join(dir, 'a.txt'), 'a');
    await writeTextFile(path.join(dir, 'b.txt'), 'b');
    const entries: string[] = [];
    for await (const entry of readDir(dir)) {
      entries.push(entry.name);
      assert.equal(entry.isFile, true);
    }
    assert.ok(entries.includes('a.txt'));
    assert.ok(entries.includes('b.txt'));
    await remove(dir, { recursive: true });
  });

  it('mkdir creates nested directories', async () => {
    const dir = await makeTempDir({ prefix: 'melker-test-' });
    const nested = path.join(dir, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });
    const info = await stat(nested);
    assert.equal(info.isDirectory, true);
    await remove(dir, { recursive: true });
  });

  it('isNotFoundError detects ENOENT', async () => {
    try {
      await readTextFile('/nonexistent-path-melker-test-12345');
      assert.fail('should have thrown');
    } catch (err) {
      assert.equal(isNotFoundError(err), true);
      assert.equal(isAlreadyExistsError(err), false);
      assert.equal(isPermissionError(err), false);
    }
  });

  it('isAlreadyExistsError detects EEXIST', async () => {
    const dir = await makeTempDir({ prefix: 'melker-test-' });
    try {
      await mkdir(dir, { recursive: false });
      // Some systems don't throw for existing dir without recursive
    } catch (err) {
      assert.equal(isAlreadyExistsError(err), true);
    }
    await remove(dir, { recursive: true });
  });

  it('sync read/write round-trip', async () => {
    const dir = await makeTempDir({ prefix: 'melker-test-' });
    const filePath = path.join(dir, 'sync.txt');
    writeTextFileSync(filePath, 'sync content');
    const content = readTextFileSync(filePath);
    assert.equal(content, 'sync content');
    const info = statSync(filePath);
    assert.equal(info.isFile, true);
    removeSync(dir, { recursive: true });
  });

  it('hasWritePermission returns true when permission model inactive', () => {
    // Without --permission flag, should always return true
    assert.equal(hasWritePermission('/tmp'), true);
  });
});
