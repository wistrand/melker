import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Command } from '../../src/runtime/node/command.ts';

describe('node/command', () => {
  it('Command.output() runs echo', async () => {
    const cmd = new Command('echo', { args: ['hello', 'world'], stdout: 'piped', stderr: 'piped' });
    const output = await cmd.output();
    assert.equal(output.success, true);
    assert.equal(output.code, 0);
    const text = new TextDecoder().decode(output.stdout).trim();
    assert.equal(text, 'hello world');
  });

  it('Command.output() captures exit code', async () => {
    const cmd = new Command('node', {
      args: ['-e', 'process.exit(42)'],
      stdout: 'piped',
      stderr: 'piped',
    });
    const output = await cmd.output();
    assert.equal(output.success, false);
    assert.equal(output.code, 42);
  });

  it('Command.spawn() returns a ChildProcess', async () => {
    const cmd = new Command('echo', { args: ['spawn-test'], stdout: 'piped', stderr: 'piped' });
    const child = cmd.spawn();
    assert.equal(typeof child.pid, 'number');
    const status = await child.status;
    assert.equal(status.success, true);
    assert.equal(status.code, 0);
  });

  it('Command.spawn() with piped stdin', async () => {
    const cmd = new Command('cat', { stdin: 'piped', stdout: 'piped', stderr: 'piped' });
    const child = cmd.spawn();

    const writer = child.stdin.getWriter();
    await writer.write(new TextEncoder().encode('piped input'));
    await writer.close();

    const output = await child.output();
    const text = new TextDecoder().decode(output.stdout);
    assert.equal(text, 'piped input');
  });

  it('Command with null stdio', async () => {
    const cmd = new Command('echo', {
      args: ['null-test'],
      stdout: 'null',
      stderr: 'null',
    });
    const output = await cmd.output();
    assert.equal(output.success, true);
    assert.equal(output.stdout.length, 0);
    assert.equal(output.stderr.length, 0);
  });
});
