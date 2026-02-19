// Policy system tests

import { assert, assertEquals, assertExists, assertStringIncludes } from 'jsr:@std/assert';
import {
  loadPolicy,
  loadPolicyFromContent,
  hasPolicyTag,
  validatePolicy,
  formatPolicy,
  policyToDenoFlags,
  formatDenoFlags,
  type MelkerPolicy,
  type PolicyPermissions,
} from '../src/policy/mod.ts';
import {
  applyPermissionOverrides,
  hasOverrides,
  type PermissionOverrides,
} from '../src/policy/permission-overrides.ts';

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
  assertStringIncludes(errors[0], 'permissions.read must be a string array');
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

Deno.test('formatPolicy displays cwd with actual path', () => {
  const policy: MelkerPolicy = {
    name: 'CWD App',
    permissions: {
      read: ['cwd'],
      write: ['cwd'],
    },
  };

  const output = formatPolicy(policy);
  const cwd = Deno.cwd();

  // Should show "cwd" with the actual path in parentheses
  assertStringIncludes(output, 'cwd');
  assertStringIncludes(output, cwd);
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

Deno.test('policyToDenoFlags expands cwd in read permissions', () => {
  const policy: MelkerPolicy = {
    permissions: {
      read: ['cwd'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');
  const cwd = Deno.cwd();

  const readFlag = flags.find(f => f.startsWith('--allow-read='));
  assertExists(readFlag);
  // Should include the actual cwd path, not the literal "cwd"
  assertStringIncludes(readFlag, cwd);
  assertEquals(readFlag.includes(',cwd'), false); // "cwd" should be expanded
});

Deno.test('policyToDenoFlags expands cwd in write permissions', () => {
  const policy: MelkerPolicy = {
    permissions: {
      write: ['cwd'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');
  const cwd = Deno.cwd();

  const writeFlag = flags.find(f => f.startsWith('--allow-write='));
  assertExists(writeFlag);
  // Should include the actual cwd path, not the literal "cwd"
  assertStringIncludes(writeFlag, cwd);
});

Deno.test('policyToDenoFlags allows cwd mixed with other paths', () => {
  const policy: MelkerPolicy = {
    permissions: {
      read: ['cwd', '/custom/path'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');
  const cwd = Deno.cwd();

  const readFlag = flags.find(f => f.startsWith('--allow-read='));
  assertExists(readFlag);
  assertStringIncludes(readFlag, cwd);
  assertStringIncludes(readFlag, '/custom/path');
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

// =============================================================================
// Permission Override Tests
// =============================================================================

Deno.test('hasOverrides returns false for empty overrides', () => {
  const overrides: PermissionOverrides = { allow: {}, deny: {} };
  assertEquals(hasOverrides(overrides), false);
});

Deno.test('hasOverrides returns true for allow overrides', () => {
  const overrides: PermissionOverrides = {
    allow: { read: ['/tmp'] },
    deny: {},
  };
  assertEquals(hasOverrides(overrides), true);
});

Deno.test('hasOverrides returns true for deny overrides', () => {
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { net: ['evil.com'] },
  };
  assertEquals(hasOverrides(overrides), true);
});

Deno.test('applyPermissionOverrides merges allow arrays', () => {
  const base = { read: ['/app'] };
  const overrides: PermissionOverrides = {
    allow: { read: ['/tmp', '/data'] },
    deny: {},
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  assertEquals(permissions.read?.includes('/app'), true);
  assertEquals(permissions.read?.includes('/tmp'), true);
  assertEquals(permissions.read?.includes('/data'), true);
});

Deno.test('applyPermissionOverrides deduplicates merged arrays', () => {
  const base = { net: ['api.example.com'] };
  const overrides: PermissionOverrides = {
    allow: { net: ['api.example.com', 'cdn.example.com'] },
    deny: {},
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // Should not have duplicates
  const count = permissions.net?.filter(h => h === 'api.example.com').length;
  assertEquals(count, 1);
});

Deno.test('applyPermissionOverrides skips allow when base has wildcard', () => {
  const base = { read: ['*'] };
  const overrides: PermissionOverrides = {
    allow: { read: ['/tmp'] },
    deny: {},
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // Should still just have wildcard, not the additional path
  assertEquals(permissions.read, ['*']);
});

Deno.test('applyPermissionOverrides filters out denied values', () => {
  const base = { net: ['api.example.com', 'evil.com', 'cdn.example.com'] };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { net: ['evil.com'] },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  assertEquals(permissions.net?.includes('api.example.com'), true);
  assertEquals(permissions.net?.includes('cdn.example.com'), true);
  assertEquals(permissions.net?.includes('evil.com'), false);
});

Deno.test('applyPermissionOverrides removes empty arrays after deny', () => {
  const base = { run: ['rm'] };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { run: ['rm'] },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  assertEquals(permissions.run, undefined);
});

Deno.test('applyPermissionOverrides tracks active denies for wildcard', () => {
  const base = { read: ['*'] };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { read: ['/etc/passwd', '/etc/shadow'] },
  };

  const { permissions, activeDenies } = applyPermissionOverrides(base, overrides);

  // Wildcard should remain
  assertEquals(permissions.read, ['*']);
  // Denies should be tracked as active denies
  assertEquals(activeDenies.read?.includes('/etc/passwd'), true);
  assertEquals(activeDenies.read?.includes('/etc/shadow'), true);
});

Deno.test('applyPermissionOverrides handles deny.all', () => {
  const base = { read: ['.'], net: ['*'], run: ['git'] };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { all: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  assertEquals(permissions, {});
});

Deno.test('applyPermissionOverrides handles allow.all', () => {
  const base = {};
  const overrides: PermissionOverrides = {
    allow: { all: true },
    deny: {},
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  assertEquals(permissions.all, true);
});

Deno.test('applyPermissionOverrides applies boolean allows', () => {
  const base = {};
  const overrides: PermissionOverrides = {
    allow: { ai: true, clipboard: true },
    deny: {},
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // Shortcuts are expanded and then cleared, so check the expanded values
  // AI expands to run commands and net hosts
  assertEquals(permissions.net?.includes('openrouter.ai'), true);
});

Deno.test('applyPermissionOverrides applies boolean denies', () => {
  const base = { ai: true, clipboard: true };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { ai: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // AI shortcut should be removed (but clipboard remains and expands)
  // Note: shortcuts are expanded before boolean denies, so ai's values are added then ai flag is cleared
  assertEquals(permissions.ai, undefined);
});

Deno.test('applyPermissionOverrides expands shortcuts before denies', () => {
  const base = {};
  const overrides: PermissionOverrides = {
    allow: { ai: true },
    deny: { net: ['openrouter.ai'] },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // AI shortcut adds openrouter.ai, but deny should remove it
  // net array becomes empty and is deleted, so it's undefined or doesn't include the denied host
  assertEquals(permissions.net === undefined || !permissions.net.includes('openrouter.ai'), true);
});

Deno.test('applyPermissionOverrides deny removes specific shortcut command', () => {
  const base = {};
  const overrides: PermissionOverrides = {
    allow: { ai: true },
    deny: { run: ['ffmpeg'] },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // AI shortcut adds ffmpeg (if available), but deny should remove it
  // If run array is undefined (no commands available) or doesn't include ffmpeg, that's correct
  assert(!permissions.run?.includes('ffmpeg'), 'ffmpeg should not be in run permissions after deny');
  // Other AI commands should remain (if available on system)
  // Note: ffprobe, pactl, ffplay may or may not be available depending on system
});

Deno.test('policyToDenoFlags includes active deny flags', () => {
  const policy: MelkerPolicy = {
    permissions: {
      read: ['*'],
    },
  };
  const activeDenies = { read: ['/etc/passwd'] };

  const flags = policyToDenoFlags(policy, '/app', undefined, undefined, activeDenies);

  assertEquals(flags.includes('--allow-read'), true);
  const denyFlag = flags.find(f => f.startsWith('--deny-read='));
  assertExists(denyFlag);
  assertStringIncludes(denyFlag, '/etc/passwd');
});

Deno.test('policyToDenoFlags includes multiple deny flag types', () => {
  const policy: MelkerPolicy = {
    permissions: {
      read: ['*'],
      net: ['*'],
      run: ['*'],
    },
  };
  const activeDenies = {
    read: ['/etc/passwd'],
    net: ['evil.com'],
    run: ['rm'],
  };

  const flags = policyToDenoFlags(policy, '/app', undefined, undefined, activeDenies);

  const denyRead = flags.find(f => f.startsWith('--deny-read='));
  const denyNet = flags.find(f => f.startsWith('--deny-net='));
  const denyRun = flags.find(f => f.startsWith('--deny-run='));

  assertExists(denyRead);
  assertExists(denyNet);
  assertExists(denyRun);
  assertStringIncludes(denyRead, '/etc/passwd');
  assertStringIncludes(denyNet, 'evil.com');
  assertStringIncludes(denyRun, 'rm');
});

Deno.test('policyToDenoFlags omits deny flags when no active denies', () => {
  const policy: MelkerPolicy = {
    permissions: {
      read: ['*'],
    },
  };

  const flags = policyToDenoFlags(policy, '/app');

  const denyFlag = flags.find(f => f.startsWith('--deny-'));
  assertEquals(denyFlag, undefined);
});

Deno.test('applyPermissionOverrides deny-shader with all:true expands to explicit permissions', () => {
  // When base has 'all: true' and we deny a boolean permission like 'shader',
  // we need to expand 'all' into explicit permissions (except the denied one)
  const base: PolicyPermissions = { all: true };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { shader: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // 'all' should be cleared since we're denying a specific permission
  assertEquals(permissions.all, undefined);
  // shader should NOT be granted (it was denied)
  assertEquals(permissions.shader, undefined);
  // Other boolean permissions should be explicitly granted
  assertEquals(permissions.clipboard, true);
  assertEquals(permissions.keyring, true);
  assertEquals(permissions.browser, true);
  assertEquals(permissions.ai, true);
  // Array permissions should be expanded to wildcard
  assertEquals(permissions.read?.includes('*'), true);
  assertEquals(permissions.write?.includes('*'), true);
  assertEquals(permissions.net?.includes('*'), true);
  assertEquals(permissions.run?.includes('*'), true);
});

Deno.test('applyPermissionOverrides deny-shader without all:true just removes shader', () => {
  // When base doesn't have 'all: true', denying shader just removes it
  // Note: shortcut permissions (clipboard, ai, etc.) are expanded and cleared
  const base: PolicyPermissions = { shader: true, read: ['/data'] };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { shader: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // shader should be removed
  assertEquals(permissions.shader, undefined);
  // read should remain unchanged
  assertEquals(permissions.read?.includes('/data'), true);
  // all should still be undefined
  assertEquals(permissions.all, undefined);
});

// =============================================================================
// CLI Permission Override Integration Tests
// =============================================================================

Deno.test({
  name: 'melker.ts --allow-read adds read permission',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Override Test",
    "permissions": {}
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--allow-read=/custom/path', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, '/custom/path');
      assertStringIncludes(output, 'CLI overrides');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts --deny-net removes network permission',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Deny Test",
    "permissions": {
      "net": ["api.example.com", "evil.com"]
    }
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--deny-net=evil.com', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'api.example.com');
      // evil.com should be removed from the policy
      assertEquals(output.includes('--allow-net=evil.com'), false);
      assertEquals(output.includes('--allow-net=api.example.com'), true);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts --allow-ai expands AI permissions',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "AI Test",
    "permissions": {}
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--allow-ai', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // AI shortcut should add openrouter.ai
      assertStringIncludes(output, 'openrouter.ai');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts --allow-ai --deny-net removes AI network permission',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "AI Deny Test",
    "permissions": {}
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--allow-ai', '--deny-net=openrouter.ai', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // openrouter.ai should be denied/removed
      assertEquals(output.includes('--allow-net=openrouter.ai'), false);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts --deny-read with wildcard generates --deny-read flag',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Wildcard Deny Test",
    "permissions": {
      "read": ["*"]
    }
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--deny-read=/etc/passwd', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // Should have both allow-read (wildcard) and deny-read
      assertStringIncludes(output, '--allow-read');
      assertStringIncludes(output, '--deny-read=/etc/passwd');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts comma-separated values are parsed correctly',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Comma Test",
    "permissions": {}
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--allow-net=api.example.com,cdn.example.com', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // Both hosts should be present (as separate items, not one combined string)
      assertStringIncludes(output, 'api.example.com');
      assertStringIncludes(output, 'cdn.example.com');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// =============================================================================
// Auto-Policy Permission Override Tests
// =============================================================================

Deno.test({
  name: 'melker.ts auto-policy shows read: cwd by default',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    // Create app WITHOUT policy tag - will get auto-policy with read: ["cwd"]
    await Deno.writeTextFile(appPath, `
<melker>
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
      assertStringIncludes(output, 'Policy source: auto');
      // Auto-policy now uses read: ["cwd"] instead of all: true
      assertStringIncludes(output, '--allow-read=');
      // Should NOT have --allow-all
      assertEquals(output.includes('--allow-all'), false);
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts auto-policy with --deny-all removes all permissions',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    // Create app WITHOUT policy tag - will get auto-policy
    await Deno.writeTextFile(appPath, `
<melker>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--deny-all', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      assertStringIncludes(output, 'CLI overrides');
      // Should NOT have --allow-all anymore
      assertEquals(output.includes('--allow-all'), false);
      // Should show no permissions
      assertStringIncludes(output, '(no permissions');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts auto-policy --allow-read adds to existing cwd permission',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    // Create app WITHOUT policy tag - will get auto-policy with read: ["cwd"]
    await Deno.writeTextFile(appPath, `
<melker>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--allow-read=/tmp', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // Should have --allow-read with both cwd and /tmp merged
      assertStringIncludes(output, '--allow-read=');
      assertStringIncludes(output, '/tmp');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'applyPermissionOverrides handles all: true base with specific allow',
  fn: () => {
    const base = { all: true };
    const overrides: PermissionOverrides = {
      allow: { read: ['/tmp'] },
      deny: {},
    };

    const { permissions } = applyPermissionOverrides(base, overrides);

    // all: true should remain, specific allows are redundant
    assertEquals(permissions.all, true);
  },
});

Deno.test({
  name: 'applyPermissionOverrides deny.all overrides allow.all',
  fn: () => {
    const base = { all: true };
    const overrides: PermissionOverrides = {
      allow: { all: true },
      deny: { all: true },
    };

    const { permissions } = applyPermissionOverrides(base, overrides);

    // deny.all is checked first and clears everything
    assertEquals(permissions, {});
  },
});

// =============================================================================
// Implicit Path Filtering Tests
// =============================================================================

Deno.test({
  name: 'melker.ts --deny-write filters implicit /tmp from write paths',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Deny Implicit Test",
    "permissions": {}
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--deny-write=/tmp', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout, stderr } = await cmd.output();
      const output = new TextDecoder().decode(stdout);
      const errOutput = new TextDecoder().decode(stderr);

      assertEquals(code, 0);
      // /tmp should NOT be in the --allow-write list
      const writeMatch = output.match(/--allow-write=([^\s]+)/);
      if (writeMatch) {
        assertEquals(writeMatch[1].includes('/tmp'), false, 'implicit /tmp should be filtered from write paths');
      }
      // Should see a warning about denying implicit path
      assertStringIncludes(errOutput, 'Warning');
      assertStringIncludes(errOutput, '/tmp');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts --deny-read filters implicit /tmp from read paths',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Deny Implicit Read Test",
    "permissions": {}
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--deny-read=/tmp', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout, stderr } = await cmd.output();
      const output = new TextDecoder().decode(stdout);
      const errOutput = new TextDecoder().decode(stderr);

      assertEquals(code, 0);
      // /tmp should NOT be in the --allow-read list
      const readMatch = output.match(/--allow-read=([^\s]+)/);
      if (readMatch) {
        assertEquals(readMatch[1].includes('/tmp'), false, 'implicit /tmp should be filtered from read paths');
      }
      // Should see a warning about denying implicit path
      assertStringIncludes(errOutput, 'Warning');
      assertStringIncludes(errOutput, '/tmp');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts --deny-write and --deny-read can both filter /tmp',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Deny Both Test",
    "permissions": {}
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--deny-read=/tmp', '--deny-write=/tmp', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout, stderr } = await cmd.output();
      const output = new TextDecoder().decode(stdout);
      const errOutput = new TextDecoder().decode(stderr);

      assertEquals(code, 0);

      // /tmp should NOT be in either allow list
      const readMatch = output.match(/--allow-read=([^\s]+)/);
      const writeMatch = output.match(/--allow-write=([^\s]+)/);

      if (readMatch) {
        assertEquals(readMatch[1].includes('/tmp'), false, '/tmp should be filtered from read paths');
      }
      if (writeMatch) {
        assertEquals(writeMatch[1].includes('/tmp'), false, '/tmp should be filtered from write paths');
      }

      // Should see warnings for both read and write
      assertStringIncludes(errOutput, 'read access');
      assertStringIncludes(errOutput, 'write access');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

// =============================================================================
// Shortcut Deny Tests
// =============================================================================

Deno.test('applyPermissionOverrides --deny-clipboard removes clipboard from auto-policy', () => {
  // Auto-policy has clipboard: true, --deny-clipboard should remove it
  const base: PolicyPermissions = { read: ['cwd'], clipboard: true };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { clipboard: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // clipboard shortcut should not be expanded (no run commands for clipboard)
  assertEquals(permissions.clipboard, undefined);
  // There should be no run permissions from clipboard expansion
  assertEquals(permissions.run, undefined);
});

Deno.test('applyPermissionOverrides --deny-clipboard with --allow-clipboard deny wins', () => {
  // If both allow and deny clipboard, deny should win
  const base: PolicyPermissions = {};
  const overrides: PermissionOverrides = {
    allow: { clipboard: true },
    deny: { clipboard: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // Deny takes precedence - no clipboard commands should be added
  assertEquals(permissions.clipboard, undefined);
  assertEquals(permissions.run, undefined);
});

Deno.test('applyPermissionOverrides --deny-ai removes AI permissions', () => {
  const base: PolicyPermissions = { ai: true };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { ai: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // AI shortcut should not be expanded
  assertEquals(permissions.ai, undefined);
  // No AI run commands should be added
  assertEquals(permissions.run, undefined);
  // No AI net hosts should be added
  assertEquals(permissions.net, undefined);
});

Deno.test('applyPermissionOverrides --deny-browser removes browser permission', () => {
  const base: PolicyPermissions = { browser: true };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { browser: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // Browser shortcut should not be expanded
  assertEquals(permissions.browser, undefined);
  // No browser run command should be added
  assertEquals(permissions.run, undefined);
});

Deno.test('applyPermissionOverrides --deny-keyring removes keyring permission', () => {
  const base: PolicyPermissions = { keyring: true };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { keyring: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // Keyring shortcut should not be expanded
  assertEquals(permissions.keyring, undefined);
  // No keyring run commands should be added
  assertEquals(permissions.run, undefined);
});

Deno.test('applyPermissionOverrides denying one shortcut does not affect others', () => {
  // Base has multiple shortcuts, deny only clipboard
  const base: PolicyPermissions = { clipboard: true, browser: true };
  const overrides: PermissionOverrides = {
    allow: {},
    deny: { clipboard: true },
  };

  const { permissions } = applyPermissionOverrides(base, overrides);

  // Clipboard should not be expanded
  assertEquals(permissions.clipboard, undefined);
  // Browser SHOULD be expanded (it wasn't denied)
  // Browser adds a run command (open, xdg-open, or cmd depending on OS)
  assert(permissions.run !== undefined, 'browser should expand to run permission');
  assert(permissions.run.length > 0, 'browser should add at least one run command');
});

// =============================================================================
// policyToDenoFlags Mutation Tests
// =============================================================================

Deno.test('policyToDenoFlags does not mutate original policy', () => {
  const policy: MelkerPolicy = {
    permissions: {
      clipboard: true,
      read: ['/data'],
    },
  };

  // Deep copy to compare later
  const originalPermissions = JSON.parse(JSON.stringify(policy.permissions));

  // Call policyToDenoFlags which used to mutate the policy
  policyToDenoFlags(policy, '/app');

  // Policy should not be mutated
  assertEquals(policy.permissions!.clipboard, originalPermissions.clipboard);
  assertEquals(policy.permissions!.read, originalPermissions.read);
  // run should NOT have been added to the original policy
  assertEquals(policy.permissions!.run, undefined);
});

Deno.test('policyToDenoFlags does not mutate policy with ai shortcut', () => {
  const policy: MelkerPolicy = {
    permissions: {
      ai: true,
    },
  };

  // Call policyToDenoFlags
  policyToDenoFlags(policy, '/app');

  // Policy should not be mutated - run and net should not be added
  assertEquals(policy.permissions!.run, undefined);
  assertEquals(policy.permissions!.net, undefined);
});

Deno.test('policyToDenoFlags can be called multiple times without accumulating changes', () => {
  const policy: MelkerPolicy = {
    permissions: {
      browser: true,
    },
  };

  // Call multiple times
  const flags1 = policyToDenoFlags(policy, '/app');
  const flags2 = policyToDenoFlags(policy, '/app');
  const flags3 = policyToDenoFlags(policy, '/app');

  // All calls should produce the same result
  assertEquals(flags1, flags2);
  assertEquals(flags2, flags3);

  // Policy should not have accumulated run commands
  assertEquals(policy.permissions!.run, undefined);
});

// =============================================================================
// CLI --deny-clipboard Integration Test
// =============================================================================

Deno.test({
  name: 'melker.ts --deny-clipboard removes clipboard from auto-policy',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    // Create app WITHOUT policy tag - will get auto-policy with clipboard: true
    await Deno.writeTextFile(appPath, `
<melker>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--deny-clipboard', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // Should NOT have --allow-run with clipboard commands
      assertEquals(output.includes('--allow-run='), false, 'should not have --allow-run when clipboard is denied');
      // Should show CLI overrides section
      assertStringIncludes(output, 'CLI overrides');
      assertStringIncludes(output, '--deny-clipboard');
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});

Deno.test({
  name: 'melker.ts --deny-clipboard with explicit clipboard policy removes it',
  ignore: !(await hasRunPermission()),
  fn: async () => {
    const tempDir = await Deno.makeTempDir();
    const appPath = `${tempDir}/test.melker`;

    // Create app WITH explicit clipboard permission
    await Deno.writeTextFile(appPath, `
<melker>
  <policy>
  {
    "name": "Clipboard App",
    "permissions": {
      "clipboard": true,
      "read": ["."]
    }
  }
  </policy>
  <container><text>Hello</text></container>
</melker>`);

    try {
      const cmd = new Deno.Command(Deno.execPath(), {
        args: ['run', '--allow-all', 'melker.ts', '--deny-clipboard', '--show-policy', appPath],
        cwd: Deno.cwd(),
        stdout: 'piped',
        stderr: 'piped',
      });

      const { code, stdout } = await cmd.output();
      const output = new TextDecoder().decode(stdout);

      assertEquals(code, 0);
      // Should NOT have clipboard run commands in --allow-run
      // Check that xclip, pbcopy, etc. are not in the output flags
      const allowRunMatch = output.match(/--allow-run=([^\s\n]+)/);
      if (allowRunMatch) {
        const runValue = allowRunMatch[1];
        assertEquals(runValue.includes('xclip'), false, 'xclip should not be in --allow-run');
        assertEquals(runValue.includes('pbcopy'), false, 'pbcopy should not be in --allow-run');
        assertEquals(runValue.includes('xsel'), false, 'xsel should not be in --allow-run');
        assertEquals(runValue.includes('wl-copy'), false, 'wl-copy should not be in --allow-run');
      }
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  },
});
