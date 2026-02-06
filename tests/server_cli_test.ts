// E2E tests for server CLI flags, env vars, and renamed options
// Tests launch melker.ts as a subprocess to verify external behavior

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';

const decoder = new TextDecoder();

/** Get a random port in the ephemeral range to avoid clashes */
function randomPort(): number {
  return 49152 + Math.floor(Math.random() * 16383);
}

/** Check if we have run permission (needed for Deno.Command) */
async function hasRunPermission(): Promise<boolean> {
  try {
    const status = await Deno.permissions.query({ name: 'run' });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

/** Simple .melker app that exits immediately */
const SIMPLE_APP = `
<melker>
  <policy>
  {
    "name": "CLI Test",
    "permissions": {}
  }
  </policy>
  <script type="typescript">
    $melker.exit();
  </script>
  <container><text>Hello</text></container>
</melker>`;

/** Create a temp .melker app file, returns path and cleanup function */
async function createTempApp(): Promise<{ appPath: string; cleanup: () => Promise<void> }> {
  const tempDir = await Deno.makeTempDir();
  const appPath = `${tempDir}/test.melker`;
  await Deno.writeTextFile(appPath, SIMPLE_APP);
  return {
    appPath,
    cleanup: async () => {
      try { await Deno.remove(tempDir, { recursive: true }); } catch { /* ignore */ }
    },
  };
}

/** Launch melker and collect output via .output() with timeout */
async function runMelker(
  args: string[],
  env?: Record<string, string>,
  timeoutMs = 15000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-all', '--unstable-bundle', 'melker.ts', ...args],
    cwd: Deno.cwd(),
    stdout: 'piped',
    stderr: 'piped',
    env: env ? { ...Deno.env.toObject(), ...env } : undefined,
  });

  const child = cmd.spawn();
  const timer = setTimeout(() => {
    try { child.kill(); } catch { /* ignore */ }
  }, timeoutMs);

  const status = await child.status;
  clearTimeout(timer);

  // Read remaining output
  const stdoutReader = child.stdout.getReader();
  const stderrReader = child.stderr.getReader();
  const stdoutChunks: Uint8Array[] = [];
  const stderrChunks: Uint8Array[] = [];

  try {
    while (true) {
      const { done, value } = await stdoutReader.read();
      if (done) break;
      stdoutChunks.push(value);
    }
  } catch { /* stream closed */ }

  try {
    while (true) {
      const { done, value } = await stderrReader.read();
      if (done) break;
      stderrChunks.push(value);
    }
  } catch { /* stream closed */ }

  const stdout = decoder.decode(concat(stdoutChunks));
  const stderr = decoder.decode(concat(stderrChunks));

  return { code: status.code, stdout, stderr };
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

// Test 1: --server starts server (with headless mode)
Deno.test({
  name: 'CLI: --server --headless starts server',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { appPath, cleanup } = await createTempApp();
    try {
      const result = await runMelker(
        ['--server', '--headless', '--trust', appPath],
      );
      // Server prints URL to stderr
      assertStringIncludes(result.stderr, 'Server: http://localhost:');
    } finally {
      await cleanup();
    }
  },
});

// Test 2: --server-port N starts server on specified port
Deno.test({
  name: 'CLI: --server-port starts server on specified port',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = randomPort();
    const { appPath, cleanup } = await createTempApp();
    try {
      const result = await runMelker(
        ['--server-port', String(port), '--headless', '--trust', appPath],
      );
      assertStringIncludes(result.stderr, `localhost:${port}`);
    } finally {
      await cleanup();
    }
  },
});

// Test 3: --headless implies --server
Deno.test({
  name: 'CLI: --headless implies --server',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { appPath, cleanup } = await createTempApp();
    try {
      const result = await runMelker(
        ['--headless', '--trust', appPath],
      );
      // Even without explicit --server, headless mode starts the server
      assertStringIncludes(result.stderr, 'Server: http://localhost:');
    } finally {
      await cleanup();
    }
  },
});

// Test 4: --server-port without --server still enables server
Deno.test({
  name: 'CLI: --server-port without --server enables server',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = randomPort();
    const { appPath, cleanup } = await createTempApp();
    try {
      const result = await runMelker(
        ['--server-port', String(port), '--headless', '--trust', appPath],
      );
      assertStringIncludes(result.stderr, `localhost:${port}`);
    } finally {
      await cleanup();
    }
  },
});

// Test 5: --verbose flag accepted
Deno.test({
  name: 'CLI: --verbose flag is accepted',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { appPath, cleanup } = await createTempApp();
    try {
      const result = await runMelker(
        ['--verbose', '--headless', '--trust', appPath],
      );
      assertEquals(result.code, 0);
    } finally {
      await cleanup();
    }
  },
});

// Test 6: --test-sextant prints pattern and exits
Deno.test({
  name: 'CLI: --test-sextant prints pattern and exits',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const result = await runMelker(['--test-sextant']);
    assertEquals(result.code, 0);
    assertStringIncludes(result.stdout, 'Sextant Character Test');
  },
});

// Test 7: --print-config shows new key names
Deno.test({
  name: 'CLI: --print-config shows new config key names',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const result = await runMelker(['--print-config']);
    assertEquals(result.code, 0);

    // New key names should be present
    assertStringIncludes(result.stdout, 'server.enabled');
    assertStringIncludes(result.stdout, 'server.port');
    assertStringIncludes(result.stdout, 'bundler.retainBundle');
    assertStringIncludes(result.stdout, 'performance.showStats');

    // Old key names should NOT be present
    assertEquals(result.stdout.includes('debug.port'), false, 'Should not contain debug.port');
    assertEquals(result.stdout.includes('debug.retainBundle'), false, 'Should not contain debug.retainBundle');
    assertEquals(result.stdout.includes('debug.showStats'), false, 'Should not contain debug.showStats');
  },
});

// Test 8: MELKER_SERVER_PORT env var works
Deno.test({
  name: 'CLI: MELKER_SERVER_PORT env var works',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const port = randomPort();
    const { appPath, cleanup } = await createTempApp();
    try {
      const result = await runMelker(
        ['--trust', appPath],
        { MELKER_SERVER_PORT: String(port), MELKER_HEADLESS: 'true' },
      );
      assertStringIncludes(result.stderr, `localhost:${port}`);
    } finally {
      await cleanup();
    }
  },
});

// Test 9: MELKER_SERVER=true enables server
Deno.test({
  name: 'CLI: MELKER_SERVER=true enables server',
  ignore: !(await hasRunPermission()),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { appPath, cleanup } = await createTempApp();
    try {
      const result = await runMelker(
        ['--trust', appPath],
        { MELKER_SERVER: 'true', MELKER_HEADLESS: 'true' },
      );
      assertStringIncludes(result.stderr, 'Server: http://localhost:');
    } finally {
      await cleanup();
    }
  },
});
