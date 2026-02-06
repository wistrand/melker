// E2E tests for headless mode and debug server token authentication

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { MelkerDebugServer } from '../src/debug-server.ts';

/** Get a random port in the ephemeral range to avoid clashes */
function randomPort(): number {
  return 49152 + Math.floor(Math.random() * 16383);
}

Deno.test('Headless debug server rejects invalid token (HTTP)', async () => {
  const port = randomPort();
  const server = new MelkerDebugServer({ port, token: 'valid-test-token' });

  await server.start();
  try {
    const res = await fetch(`http://localhost:${port}/?token=wrong-token`);
    assertEquals(res.status, 401);
    const body = await res.text();
    assertEquals(body.includes('Unauthorized'), true);
  } finally {
    await server.stop();
  }
});

Deno.test('Headless debug server rejects missing token (HTTP)', async () => {
  const port = randomPort();
  const server = new MelkerDebugServer({ port, token: 'valid-test-token' });

  await server.start();
  try {
    const res = await fetch(`http://localhost:${port}/`);
    assertEquals(res.status, 401);
    const body = await res.text();
    assertEquals(body.includes('Unauthorized'), true);
  } finally {
    await server.stop();
  }
});

Deno.test('Headless debug server accepts valid token (HTTP)', async () => {
  const port = randomPort();
  const token = 'valid-test-token';
  const server = new MelkerDebugServer({ port, token });

  await server.start();
  try {
    const res = await fetch(`http://localhost:${port}/?token=${token}`);
    assertEquals(res.status, 200);
    const body = await res.text();
    assertEquals(body.includes('html'), true);
  } finally {
    await server.stop();
  }
});

Deno.test({
  name: 'Headless debug server rejects invalid token (WebSocket)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = randomPort();
    const server = new MelkerDebugServer({ port, token: 'valid-test-token' });

    await server.start();
    try {
      const ws = new WebSocket(`ws://localhost:${port}/?token=wrong-token`);
      const result = await new Promise<string>((resolve) => {
        ws.onopen = () => resolve('connected');
        ws.onerror = () => resolve('error');
        ws.onclose = (e) => resolve(e.wasClean ? 'closed-clean' : 'closed-error');
      });
      // WebSocket upgrade should fail — server returns 401 which causes error/close
      assertEquals(result !== 'connected', true);
      try { ws.close(); } catch { /* already closed */ }
    } finally {
      await server.stop();
    }
  },
});

Deno.test({
  name: 'Headless debug server accepts valid token (WebSocket)',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = randomPort();
    const token = 'valid-test-token';
    const server = new MelkerDebugServer({ port, token });

    await server.start();
    try {
      const ws = new WebSocket(`ws://localhost:${port}/?token=${token}`);

      const connected = await new Promise<boolean>((resolve) => {
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
        ws.onclose = () => resolve(false);
      });
      assertEquals(connected, true);

      // Verify we get a welcome message
      const message = await new Promise<string>((resolve) => {
        ws.onmessage = (e) => resolve(e.data);
      });
      const parsed = JSON.parse(message);
      assertEquals(parsed.type, 'welcome');

      ws.close();
      // Wait for close to complete
      await new Promise<void>((resolve) => {
        ws.onclose = () => resolve();
        if (ws.readyState === WebSocket.CLOSED) resolve();
      });
    } finally {
      await server.stop();
    }
  },
});

Deno.test('Headless debug server connectionUrl contains token', () => {
  const port = randomPort();
  const token = 'my-test-token';
  const server = new MelkerDebugServer({ port, token });

  assertEquals(server.connectionUrl.includes(`${port}`), true);
  assertEquals(server.connectionUrl.includes(`token=${token}`), true);
  assertEquals(server.token, token);
});
