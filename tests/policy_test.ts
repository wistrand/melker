// Policy system tests

import { assertEquals, assertExists, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  loadPolicy,
  loadPolicyFromContent,
  hasPolicyTag,
  validatePolicy,
  formatPolicy,
  policyToDenoFlags,
  formatDenoFlags,
  type MelkerPolicy,
} from '../src/policy/mod.ts';

// =============================================================================
// Policy Loading Tests
// =============================================================================

Deno.test('hasPolicyTag detects embedded policy tag', () => {
  const content = `
<melker>
  <policy>
  { "name": "Test App" }
  </policy>
  <container><text>Hello</text></container>
</melker>`;

  assertEquals(hasPolicyTag(content), true);
});

Deno.test('hasPolicyTag detects policy with src attribute', () => {
  const content = `
<melker>
  <policy src="app.policy.json"></policy>
  <container><text>Hello</text></container>
</melker>`;

  assertEquals(hasPolicyTag(content), true);
});

Deno.test('hasPolicyTag detects markdown policy block', () => {
  const content = `
# My App

\`\`\`json
{
  "@melker": "policy",
  "name": "Test App"
}
\`\`\`

Some content here.
`;

  assertEquals(hasPolicyTag(content), true);
});

Deno.test('hasPolicyTag returns false when no policy', () => {
  const content = `
<melker>
  <container><text>Hello</text></container>
</melker>`;

  assertEquals(hasPolicyTag(content), false);
});

Deno.test('loadPolicyFromContent parses embedded JSON policy', async () => {
  const content = `
<melker>
  <policy>
  {
    "name": "Test App",
    "description": "A test application",
    "permissions": {
      "read": ["."],
      "net": ["api.example.com"]
    }
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`;

  const result = await loadPolicyFromContent(content);

  assertEquals(result.source, 'embedded');
  assertExists(result.policy);
  assertEquals(result.policy.name, 'Test App');
  assertEquals(result.policy.description, 'A test application');
  assertEquals(result.policy.permissions?.read, ['.']);
  assertEquals(result.policy.permissions?.net, ['api.example.com']);
});

Deno.test('loadPolicyFromContent returns null for no policy', async () => {
  const content = `
<melker>
  <container><text>Hello</text></container>
</melker>`;

  const result = await loadPolicyFromContent(content);

  assertEquals(result.source, 'none');
  assertEquals(result.policy, null);
});

Deno.test('loadPolicyFromContent throws on invalid JSON', async () => {
  const content = `
<melker>
  <policy>
  { invalid json here }
  </policy>
  <container><text>Hello</text></container>
</melker>`;

  let error: Error | null = null;
  try {
    await loadPolicyFromContent(content);
  } catch (e) {
    error = e as Error;
  }

  assertExists(error);
  assertStringIncludes(error.message, 'Invalid JSON');
});

Deno.test('loadPolicyFromContent throws on external src for remote content', async () => {
  const content = `
<melker>
  <policy src="external.policy.json"></policy>
  <container><text>Hello</text></container>
</melker>`;

  let error: Error | null = null;
  try {
    await loadPolicyFromContent(content);
  } catch (e) {
    error = e as Error;
  }

  assertExists(error);
  assertStringIncludes(error.message, 'External policy files');
});

Deno.test({
  name: 'loadPolicyFromContent adds OAuth permissions automatically',
  // Disable sanitizers since the loader may make network requests that we can't control
  sanitizeResources: false,
  sanitizeOps: false,
  fn: async () => {
    const content = `
<melker>
  <policy>
  {
    "name": "OAuth App",
    "permissions": {}
  }
  </policy>
  <oauth wellknown="https://invalid.example.test/.well-known/openid-configuration" />
  <container><text>Hello</text></container>
</melker>`;

    const result = await loadPolicyFromContent(content);

    assertExists(result.policy);
    // Should have localhost for callback server
    assertEquals(result.policy.permissions?.net?.includes('localhost'), true);
    // Should have browser permission for authorization URL
    assertEquals(result.policy.permissions?.browser, true);
  },
});

Deno.test('loadPolicyFromContent parses markdown policy', async () => {
  const content = `
# My App

\`\`\`json
{
  "@melker": "policy",
  "name": "Markdown App",
  "permissions": {
    "read": ["."]
  }
}
\`\`\`

<container><text>Hello</text></container>
`;

  const result = await loadPolicyFromContent(content, 'app.md');

  assertEquals(result.source, 'embedded');
  assertExists(result.policy);
  assertEquals(result.policy.name, 'Markdown App');
});

// =============================================================================
// Policy Validation Tests
// =============================================================================

Deno.test('validatePolicy accepts valid policy', () => {
  const policy: MelkerPolicy = {
    name: 'Test App',
    permissions: {
      read: ['.', '/tmp'],
      write: ['/tmp'],
      net: ['api.example.com'],
      run: ['git'],
      env: ['HOME'],
    },
  };

  const errors = validatePolicy(policy);
  assertEquals(errors.length, 0);
});

Deno.test('validatePolicy rejects non-array read permission', () => {
  const policy = {
    permissions: {
      read: '.' as unknown as string[],
    },
  };

  const errors = validatePolicy(policy);
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0], 'permissions.read must be an array');
});

Deno.test('validatePolicy rejects non-string array elements', () => {
  const policy = {
    permissions: {
      net: ['api.example.com', 123 as unknown as string],
    },
  };

  const errors = validatePolicy(policy);
  assertEquals(errors.length, 1);
  assertStringIncludes(errors[0], 'permissions.net must contain only strings');
});

// =============================================================================
// Policy Formatting Tests
// =============================================================================

Deno.test('formatPolicy formats basic policy', () => {
  const policy: MelkerPolicy = {
    name: 'Test App',
    description: 'A test application',
    permissions: {
      read: ['.'],
      net: ['api.example.com'],
    },
  };

  const output = formatPolicy(policy);

  assertStringIncludes(output, 'Test App');
  assertStringIncludes(output, 'A test application');
  assertStringIncludes(output, 'Filesystem (read)');
  assertStringIncludes(output, 'Network');
  assertStringIncludes(output, 'api.example.com');
});

Deno.test('formatPolicy formats all permissions shortcut', () => {
  const policy: MelkerPolicy = {
    name: 'Full Access App',
    permissions: {
      all: true,
    },
  };

  const output = formatPolicy(policy);

  assertStringIncludes(output, 'All Permissions');
  assertStringIncludes(output, '--allow-all');
});

Deno.test('formatPolicy formats shortcut permissions', () => {
  const policy: MelkerPolicy = {
    name: 'Full Featured App',
    permissions: {
      ai: true,
      clipboard: true,
      keyring: true,
      browser: true,
      shader: true,
    },
  };

  const output = formatPolicy(policy);

  assertStringIncludes(output, 'AI Assistant');
  assertStringIncludes(output, 'Clipboard');
  assertStringIncludes(output, 'Keyring');
  assertStringIncludes(output, 'Browser');
  assertStringIncludes(output, 'Shader');
});

Deno.test('formatPolicy shows comment', () => {
  const policy: MelkerPolicy = {
    name: 'Test App',
    comment: 'This app needs network access to fetch data.',
    permissions: {
      net: ['api.example.com'],
    },
  };

  const output = formatPolicy(policy);

  assertStringIncludes(output, 'This app needs network access');
});

Deno.test('formatPolicy shows no permissions message', () => {
  const policy: MelkerPolicy = {
    name: 'Minimal App',
    permissions: {},
  };

  const output = formatPolicy(policy);

  assertStringIncludes(output, '(no permissions declared)');
});

// =============================================================================
// Policy to Deno Flags Tests
// =============================================================================

Deno.test('policyToDenoFlags generates all flag', () => {
  const policy: MelkerPolicy = {
    permissions: {
      all: true,
    },
  };

  const flags = policyToDenoFlags(policy, '/tmp');

  assertEquals(flags, ['--allow-all']);
});

Deno.test('policyToDenoFlags generates read flags', () => {
  const policy: MelkerPolicy = {
    permissions: {
      read: ['/data'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  const readFlag = flags.find(f => f.startsWith('--allow-read='));
  assertExists(readFlag);
  assertStringIncludes(readFlag, '/data');
  // Should also include implicit paths
  assertStringIncludes(readFlag, '/app');
});

Deno.test('policyToDenoFlags generates wildcard read flag', () => {
  const policy: MelkerPolicy = {
    permissions: {
      read: ['*'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  assertEquals(flags.includes('--allow-read'), true);
});

Deno.test('policyToDenoFlags generates net flags', () => {
  const policy: MelkerPolicy = {
    permissions: {
      net: ['api.example.com', 'cdn.example.com:443'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  const netFlag = flags.find(f => f.startsWith('--allow-net='));
  assertExists(netFlag);
  assertStringIncludes(netFlag, 'api.example.com');
  assertStringIncludes(netFlag, 'cdn.example.com:443');
});

Deno.test('policyToDenoFlags extracts host from URL in net permissions', () => {
  const policy: MelkerPolicy = {
    permissions: {
      net: ['https://api.example.com/v1/data'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  const netFlag = flags.find(f => f.startsWith('--allow-net='));
  assertExists(netFlag);
  // Should extract just the host, not the full URL
  assertStringIncludes(netFlag, 'api.example.com');
  assertEquals(netFlag.includes('/v1/data'), false);
});

Deno.test('policyToDenoFlags generates run flags', () => {
  const policy: MelkerPolicy = {
    permissions: {
      run: ['git', 'npm'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  const runFlag = flags.find(f => f.startsWith('--allow-run='));
  assertExists(runFlag);
  assertStringIncludes(runFlag, 'git');
  assertStringIncludes(runFlag, 'npm');
});

Deno.test('policyToDenoFlags generates env flags with implicit vars', () => {
  const policy: MelkerPolicy = {
    permissions: {
      env: ['MY_VAR'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  const envFlag = flags.find(f => f.startsWith('--allow-env='));
  assertExists(envFlag);
  assertStringIncludes(envFlag, 'MY_VAR');
  // Should include implicit MELKER_ vars
  assertStringIncludes(envFlag, 'HOME');
});

Deno.test('policyToDenoFlags expands browser shortcut', () => {
  const policy: MelkerPolicy = {
    permissions: {
      browser: true,
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  const runFlag = flags.find(f => f.startsWith('--allow-run='));
  assertExists(runFlag);
  // Should include platform browser command
  const os = Deno.build.os;
  if (os === 'darwin') {
    assertStringIncludes(runFlag, 'open');
  } else if (os === 'windows') {
    assertStringIncludes(runFlag, 'cmd');
  } else {
    assertStringIncludes(runFlag, 'xdg-open');
  }
});

Deno.test('policyToDenoFlags includes configSchema env vars', () => {
  const policy: MelkerPolicy = {
    permissions: {},
    configSchema: {
      'app.debug': {
        type: 'boolean',
        env: 'APP_DEBUG',
      },
      'app.port': {
        type: 'integer',
        env: 'APP_PORT',
      },
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  const envFlag = flags.find(f => f.startsWith('--allow-env='));
  assertExists(envFlag);
  assertStringIncludes(envFlag, 'APP_DEBUG');
  assertStringIncludes(envFlag, 'APP_PORT');
});

Deno.test('formatDenoFlags formats flags for display', () => {
  const flags = ['--allow-read=/tmp', '--allow-net=api.example.com'];

  const output = formatDenoFlags(flags);

  assertStringIncludes(output, '--allow-read=/tmp');
  assertStringIncludes(output, '--allow-net=api.example.com');
});

Deno.test('formatDenoFlags shows message for no permissions', () => {
  const flags: string[] = [];

  const output = formatDenoFlags(flags);

  assertStringIncludes(output, '(no permissions)');
});

// =============================================================================
// Integration Tests - Loading from Files
// =============================================================================

Deno.test('loadPolicy loads embedded policy from file', async () => {
  // Create a temp file with policy
  const tempDir = await Deno.makeTempDir();
  const appPath = `${tempDir}/test.melker`;

  await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "File Test App",
    "permissions": {
      "read": ["."]
    }
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

  try {
    const result = await loadPolicy(appPath);

    assertEquals(result.source, 'embedded');
    assertExists(result.policy);
    assertEquals(result.policy.name, 'File Test App');
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('loadPolicy loads external policy file', async () => {
  const tempDir = await Deno.makeTempDir();
  const appPath = `${tempDir}/test.melker`;
  const policyPath = `${tempDir}/app.policy.json`;

  // Write policy file
  await Deno.writeTextFile(policyPath, JSON.stringify({
    name: 'External Policy App',
    permissions: {
      net: ['api.example.com'],
    },
  }));

  // Write app file
  await Deno.writeTextFile(appPath, `
<melker>
  <policy src="app.policy.json"></policy>
  <container><text>Hello</text></container>
</melker>`);

  try {
    const result = await loadPolicy(appPath);

    assertEquals(result.source, 'file');
    assertEquals(result.path, policyPath);
    assertExists(result.policy);
    assertEquals(result.policy.name, 'External Policy App');
    assertEquals(result.policy.permissions?.net, ['api.example.com']);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

Deno.test('loadPolicy returns none for file without policy', async () => {
  const tempDir = await Deno.makeTempDir();
  const appPath = `${tempDir}/test.melker`;

  await Deno.writeTextFile(appPath, `
<melker>
  <container><text>Hello</text></container>
</melker>`);

  try {
    const result = await loadPolicy(appPath);

    assertEquals(result.source, 'none');
    assertEquals(result.policy, null);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
});

// =============================================================================
// Integration Tests - CLI Execution
// =============================================================================

// Helper to check if we have run permission (needed for Deno.Command)
async function hasRunPermission(): Promise<boolean> {
  try {
    const status = await Deno.permissions.query({ name: 'run' });
    return status.state === 'granted';
  } catch {
    return false;
  }
}

Deno.test({
  name: 'melker.ts --show-policy displays policy and exits',
  ignore: !(await hasRunPermission()),
  fn: async () => {
  const tempDir = await Deno.makeTempDir();
  const appPath = `${tempDir}/test.melker`;

  await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Show Policy Test",
    "description": "Testing --show-policy flag",
    "permissions": {
      "read": ["."],
      "net": ["api.example.com"]
    }
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-all', 'melker.ts', '--show-policy', appPath],
      cwd: Deno.cwd(),
      stdout: 'piped',
      stderr: 'piped',
    });

    const { code, stdout } = await cmd.output();
    const output = new TextDecoder().decode(stdout);

    assertEquals(code, 0);
    assertStringIncludes(output, 'Show Policy Test');
    assertStringIncludes(output, 'api.example.com');
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
  },
});

Deno.test({
  name: 'melker.ts --trust runs app without approval prompt',
  ignore: !(await hasRunPermission()),
  fn: async () => {
  const tempDir = await Deno.makeTempDir();
  const appPath = `${tempDir}/test.melker`;

  // Create a simple app that exits immediately
  await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Trust Test",
    "permissions": {}
  }
  </policy>
  <script type="typescript">
    $melker.exit();
  </script>
  <container><text>Hello</text></container>
</melker>`);

  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-all', 'melker.ts', '--trust', appPath],
      cwd: Deno.cwd(),
      stdout: 'piped',
      stderr: 'piped',
      env: {
        ...Deno.env.toObject(),
        MELKER_HEADLESS: 'true',
      },
    });

    const { code } = await cmd.output();

    // Should exit cleanly (exit code 0)
    assertEquals(code, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
  },
});

Deno.test({
  name: 'melker.ts with policy runs in sandbox with correct permissions',
  ignore: !(await hasRunPermission()),
  fn: async () => {
  const tempDir = await Deno.makeTempDir();
  const appPath = `${tempDir}/test.melker`;
  const outputFile = `${tempDir}/output.txt`;

  // Create an app that writes to a file (testing write permission)
  await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Permission Test",
    "permissions": {
      "write": ["${tempDir}"]
    }
  }
  </policy>
  <script type="typescript">
    Deno.writeTextFileSync("${outputFile}", "success");
    $melker.exit();
  </script>
  <container><text>Hello</text></container>
</melker>`);

  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-all', 'melker.ts', '--trust', appPath],
      cwd: Deno.cwd(),
      stdout: 'piped',
      stderr: 'piped',
      env: {
        ...Deno.env.toObject(),
        MELKER_HEADLESS: 'true',
      },
    });

    const { code } = await cmd.output();
    assertEquals(code, 0);

    // Verify the file was written
    const content = await Deno.readTextFile(outputFile);
    assertEquals(content, 'success');
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
  },
});

Deno.test({
  name: 'melker.ts without policy on local file uses auto-policy',
  ignore: !(await hasRunPermission()),
  fn: async () => {
  const tempDir = await Deno.makeTempDir();
  const appPath = `${tempDir}/test.melker`;

  // Create a simple app without policy
  await Deno.writeTextFile(appPath, `
<melker>
  <script type="typescript">
    $melker.exit();
  </script>
  <container><text>Hello</text></container>
</melker>`);

  try {
    const cmd = new Deno.Command(Deno.execPath(), {
      args: ['run', '--allow-all', 'melker.ts', '--trust', appPath],
      cwd: Deno.cwd(),
      stdout: 'piped',
      stderr: 'piped',
      env: {
        ...Deno.env.toObject(),
        MELKER_HEADLESS: 'true',
      },
    });

    const { code } = await cmd.output();

    // Should run successfully with auto-generated policy
    assertEquals(code, 0);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
  },
});
