import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCb);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRY = resolve(ROOT, 'melker-node.ts');

describe('e2e: hello.melker', () => {
  it('renders in stdout mode (piped)', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--experimental-transform-types', '--no-warnings',
        ENTRY, '--trust', 'examples/basics/hello.melker',
      ],
      { cwd: ROOT, timeout: 15000 },
    );
    assert.ok(stdout.includes('Hello'), `Expected "Hello" in output, got: ${stdout.slice(0, 200)}`);
  });

  it('renders text-styles example', async () => {
    const { stdout } = await execFile(
      process.execPath,
      [
        '--experimental-transform-types', '--no-warnings',
        ENTRY, '--trust', 'examples/basics/text-styles.melker',
      ],
      { cwd: ROOT, timeout: 15000 },
    );
    assert.ok(stdout.length > 0, 'Expected non-empty output');
  });
});
