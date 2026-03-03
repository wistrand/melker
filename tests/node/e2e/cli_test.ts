import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRY = resolve(ROOT, 'melker-node.ts');

describe('e2e: CLI flags', () => {
  it('--help exits 0 and shows usage', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--experimental-transform-types', '--no-warnings',
        ENTRY, '--help',
      ],
      { cwd: ROOT, timeout: 10000 },
    );
    assert.ok(stdout.includes('Usage'), 'Expected usage text');
    assert.ok(stdout.includes('melker-node'), 'Expected melker-node in help');
  });

  it('--version prints version string', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--experimental-transform-types', '--no-warnings',
        ENTRY, '--version',
      ],
      { cwd: ROOT, timeout: 10000 },
    );
    assert.match(stdout.trim(), /^Melker \d{4}\.\d+\.\d+/);
  });

  it('info subcommand prints runtime info', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--experimental-transform-types', '--no-warnings',
        ENTRY, 'info',
      ],
      { cwd: ROOT, timeout: 10000 },
    );
    assert.ok(stdout.includes('Melker'), 'Expected Melker in info output');
    assert.ok(stdout.includes('Node'), 'Expected Node in info output');
  });

  it('missing file exits with error', async () => {
    try {
      await execFile(
        process.execPath,
        [
          '--experimental-transform-types', '--no-warnings',
          ENTRY, 'nonexistent.melker',
        ],
        { cwd: ROOT, timeout: 10000 },
      );
      assert.fail('Should have thrown');
    } catch (err: any) {
      assert.ok(err.stderr.includes('not found') || err.stderr.includes('Error'),
        `Expected error message, got: ${err.stderr}`);
    }
  });
});
