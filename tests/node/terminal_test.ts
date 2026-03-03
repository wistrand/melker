import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { consoleSize, stdin, stdout } from '../../src/runtime/node/terminal.ts';

describe('node/terminal', () => {
  it('consoleSize returns object or null', () => {
    const size = consoleSize();
    if (size !== null) {
      assert.equal(typeof size.columns, 'number');
      assert.equal(typeof size.rows, 'number');
      assert.ok(size.columns > 0);
      assert.ok(size.rows > 0);
    }
  });

  it('stdin.isTerminal returns a boolean', () => {
    const result = stdin.isTerminal();
    assert.equal(typeof result, 'boolean');
  });

  it('stdout.isTerminal returns a boolean', () => {
    const result = stdout.isTerminal();
    assert.equal(typeof result, 'boolean');
  });
});
