import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  cwd, args, platform, arch, runtimeVersion, runtimeName, inspect, execPath,
} from '../../src/runtime/node/process.ts';

describe('node/process', () => {
  it('cwd() returns a string', () => {
    const dir = cwd();
    assert.equal(typeof dir, 'string');
    assert.ok(dir.length > 0);
  });

  it('args() returns an array', () => {
    const a = args();
    assert.ok(Array.isArray(a));
  });

  it('platform() returns a valid platform', () => {
    const p = platform();
    assert.ok(['darwin', 'linux', 'windows'].includes(p), `unexpected platform: ${p}`);
  });

  it('arch() returns a valid arch', () => {
    const a = arch();
    assert.ok(['x86_64', 'aarch64'].includes(a), `unexpected arch: ${a}`);
  });

  it('runtimeVersion() returns node version', () => {
    const v = runtimeVersion();
    assert.equal(v, process.versions.node);
  });

  it('runtimeName() returns "node"', () => {
    assert.equal(runtimeName(), 'node');
  });

  it('inspect() formats a value', () => {
    const result = inspect({ a: 1 });
    assert.ok(result.includes('a'));
    assert.ok(result.includes('1'));
  });

  it('inspect() supports colors option', () => {
    const result = inspect('hello', { colors: true });
    assert.ok(typeof result === 'string');
  });

  it('execPath() returns the node binary path', () => {
    const ep = execPath();
    assert.equal(typeof ep, 'string');
    assert.ok(ep.length > 0);
    assert.equal(ep, process.execPath);
  });
});
