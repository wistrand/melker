import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRY = resolve(ROOT, 'melker-node.mjs');

let nextPort = 19100 + Math.floor(Math.random() * 900);

/**
 * Start melker-node with --headless (auto-enables --server) and wait for the
 * connection URL to appear on stderr, then return it for testing.
 */
function startServer(melkerArgs: string[]): Promise<{
  proc: ReturnType<typeof spawn>;
  url: string;
  kill: () => void;
}> {
  const port = nextPort++;
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(
      process.execPath,
      [
        '--no-warnings',
        ENTRY, '--trust', '--headless', ...melkerArgs,
      ],
      {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, MELKER_SERVER_PORT: String(port) },
      },
    );

    let output = '';
    const timeout = setTimeout(() => {
      proc.kill();
      reject(new Error(`Server did not start within 10s. Output:\n${output}`));
    }, 10000);

    const onData = (chunk: Buffer) => {
      output += chunk.toString();
      // Engine prints: Server: http://localhost:PORT/?token=...
      const match = output.match(/Server:\s+(http:\/\/\S+)/);
      if (match) {
        clearTimeout(timeout);
        resolvePromise({
          proc,
          url: match[1],
          kill: () => proc.kill(),
        });
      }
    };

    proc.stdout!.on('data', onData);
    proc.stderr!.on('data', onData);

    proc.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    proc.on('exit', (code) => {
      clearTimeout(timeout);
      reject(new Error(`Server exited with code ${code} before starting. Output:\n${output}`));
    });
  });
}

describe('e2e: --server mode', () => {
  it('starts server and serves HTML UI', async () => {
    const { url, kill } = await startServer(['examples/basics/hello.melker']);
    try {
      const response = await fetch(url);
      assert.equal(response.status, 200);
      const html = await response.text();
      assert.ok(html.includes('<html'), 'Expected HTML page from server');
      assert.ok(html.includes('Melker'), 'Expected Melker in page title/content');
    } finally {
      kill();
    }
  });

  it('rejects requests without valid token', async () => {
    const { url, kill } = await startServer(['examples/basics/hello.melker']);
    try {
      const baseUrl = new URL(url);
      baseUrl.searchParams.delete('token');
      const response = await fetch(baseUrl.toString());
      assert.equal(response.status, 401);
    } finally {
      kill();
    }
  });

  it('accepts WebSocket upgrade and sends welcome', async () => {
    const { url, kill } = await startServer(['examples/basics/hello.melker']);
    try {
      const wsUrl = url.replace('http://', 'ws://');
      const ws = new WebSocket(wsUrl);

      const welcomeMsg = await new Promise<string>((resolveMsg, reject) => {
        const msgTimeout = setTimeout(() => {
          ws.close();
          reject(new Error('WebSocket did not receive welcome message within 5s'));
        }, 5000);

        ws.onmessage = (event) => {
          clearTimeout(msgTimeout);
          resolveMsg(typeof event.data === 'string' ? event.data : event.data.toString());
        };
        ws.onerror = () => {
          clearTimeout(msgTimeout);
          reject(new Error('WebSocket error'));
        };
      });

      const msg = JSON.parse(welcomeMsg);
      assert.equal(msg.type, 'welcome', 'Expected welcome message');
      assert.ok(msg.data.capabilities, 'Expected capabilities in welcome');

      ws.close();
    } finally {
      kill();
    }
  });
});
