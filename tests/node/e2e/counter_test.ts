import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRY = resolve(ROOT, 'melker-node.mjs');

describe('e2e: counter.melker', () => {
  it('renders initial state with counter at 0', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--no-warnings',
        ENTRY, '--trust', 'examples/basics/counter.melker',
      ],
      { cwd: ROOT, timeout: 15000 },
    );
    assert.ok(stdout.includes('0'), `Expected "0" in output, got: ${stdout.slice(0, 200)}`);
  });
});
