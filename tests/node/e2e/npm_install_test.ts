import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, cp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

const execFile = promisify(execFileCb);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

describe('e2e: npm-installed melker-node', () => {
  let tmpDir: string;
  let binPath: string;

  before(async () => {
    // Pack the project into a tarball
    const { stdout: packOut } = await execFile('npm', ['pack', '--json'], { cwd: ROOT, timeout: 30000 });
    const tarball = resolve(ROOT, JSON.parse(packOut)[0].filename);

    // Create a temp directory and install the tarball locally
    tmpDir = await mkdtemp(join(tmpdir(), 'melker-npm-test-'));
    await execFile('npm', ['init', '-y'], { cwd: tmpDir, timeout: 10000 });
    await execFile('npm', ['install', tarball], { cwd: tmpDir, timeout: 60000 });

    binPath = resolve(tmpDir, 'node_modules/.bin/melker-node');

    // Copy hello.melker into the temp dir so the path doesn't reach back to ROOT
    await cp(resolve(ROOT, 'examples/basics/hello.melker'), join(tmpDir, 'hello.melker'));

    // Clean up tarball
    await rm(tarball);
  });

  after(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  it('--version prints version string', async () => {
    const { stdout } = await execFile(binPath, ['--version'], {
      cwd: tmpDir,
      timeout: 15000,
    });
    assert.match(stdout.trim(), /^Melker \d{4}\.\d+\.\d+/);
  });

  it('renders hello.melker in stdout mode', async () => {
    const { stdout } = await execFile(binPath, ['--trust', 'hello.melker'], {
      cwd: tmpDir,
      timeout: 15000,
    });
    assert.ok(stdout.includes('Hello'), `Expected "Hello" in output, got: ${stdout.slice(0, 200)}`);
  });
});
