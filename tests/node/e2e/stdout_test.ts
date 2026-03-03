import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRY = resolve(ROOT, 'melker-node.mjs');

describe('e2e: stdout mode', () => {
  it('auto-enables stdout mode when piped (non-TTY)', async () => {
    // execFile captures stdout via pipe, so stdout.isTerminal() = false
    // which triggers auto stdout mode in the runner
    const { stdout } = await execFile(
      process.execPath,
      [
        '--no-warnings',
        ENTRY, '--trust', 'examples/basics/hello.melker',
      ],
      { cwd: ROOT, timeout: 15000 },
    );
    // In stdout mode, the buffer is rendered as text to stdout
    assert.ok(stdout.length > 0, 'Expected non-empty stdout output');
    // Should contain actual content, not raw ANSI escape sequences only
    assert.ok(stdout.includes('Hello') || stdout.includes('Melker'),
      `Expected rendered content in stdout, got: ${stdout.slice(0, 200)}`);
  });

  it('--print-tree outputs element tree', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--no-warnings',
        ENTRY, '--trust', '--print-tree', 'examples/basics/hello.melker',
      ],
      { cwd: ROOT, timeout: 15000 },
    );
    // --print-tree outputs the document tree structure
    assert.ok(stdout.length > 0, 'Expected tree output');
  });

  it('--print-json outputs JSON', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--no-warnings',
        ENTRY, '--trust', '--print-json', 'examples/basics/hello.melker',
      ],
      { cwd: ROOT, timeout: 15000 },
    );
    assert.ok(stdout.length > 0, 'Expected JSON output');
    // Should be valid-ish JSON (may have ANSI codes around it)
    assert.ok(stdout.includes('{'), 'Expected JSON object in output');
  });
});
