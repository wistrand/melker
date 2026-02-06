/**
 * Launcher benchmarks - subprocess spawning and policy enforcement
 *
 * These benchmarks measure the actual subprocess launch overhead including:
 * - Policy parsing and validation
 * - Permission flag generation
 * - Deno subprocess spawning
 * - App initialization and exit
 */

import { BenchmarkSuite, benchmarkTimestamp } from '../harness.ts';
import {
  loadPolicyFromContent,
  hasPolicyTag,
  validatePolicy,
  formatPolicy,
  policyToDenoFlags,
  type MelkerPolicy,
} from '../../src/policy/mod.ts';
import {
  getPermissionOverrides,
  applyPermissionOverrides,
} from '../../src/policy/permission-overrides.ts';
import { MelkerConfig } from '../../src/config/config.ts';

const suite = new BenchmarkSuite('launcher');

// =============================================================================
// Test data for policy benchmarks
// =============================================================================

const simplePolicy: MelkerPolicy = {
  name: 'Simple App',
  permissions: {
    read: ['.'],
  },
};

const mediumPolicy: MelkerPolicy = {
  name: 'Medium App',
  permissions: {
    read: ['.', '/tmp'],
    write: ['./data'],
    net: ['api.example.com'],
    env: ['HOME', 'PATH'],
  },
};

const complexPolicy: MelkerPolicy = {
  name: 'Complex App',
  permissions: {
    read: ['.', '/tmp', '/var/log'],
    write: ['./data', './cache', './logs'],
    net: ['api.example.com', 'cdn.example.com', 'auth.example.com'],
    run: ['git', 'node', 'npm'],
    env: ['HOME', 'PATH', 'USER', 'SHELL', 'TERM'],
    ai: true,
    clipboard: true,
  },
};

// =============================================================================
// Test .melker content
// =============================================================================

const minimalMelker = `<melker>
  <container><text>OK</text></container>
</melker>`;

const minimalMelkerWithPolicy = `<melker>
  <policy>{"permissions": {"read": ["."]}}</policy>
  <container><text>OK</text></container>
</melker>`;

const mediumMelkerWithPolicy = `<melker>
  <policy>{
    "permissions": {
      "read": [".", "/tmp"],
      "write": ["./data"],
      "net": ["api.example.com"],
      "env": ["HOME", "PATH"]
    }
  }</policy>
  <script>
    export function init() { return 'ready'; }
  </script>
  <container>
    <text>Medium App</text>
    <button onClick="$app.init()">Init</button>
  </container>
</melker>`;

// =============================================================================
// Policy parsing benchmarks (fast, no subprocess)
// =============================================================================

suite.add('hasPolicyTag-present', () => {
  hasPolicyTag(minimalMelkerWithPolicy);
}, { iterations: 5000, target: 0.01 });

suite.add('hasPolicyTag-absent', () => {
  hasPolicyTag(minimalMelker);
}, { iterations: 5000, target: 0.01 });

suite.add('loadPolicy-simple', async () => {
  await loadPolicyFromContent(minimalMelkerWithPolicy);
}, { iterations: 1000, target: 0.02 });

suite.add('loadPolicy-medium', async () => {
  await loadPolicyFromContent(mediumMelkerWithPolicy);
}, { iterations: 500, target: 0.02 });

suite.add('validatePolicy-simple', () => {
  validatePolicy(simplePolicy);
}, { iterations: 5000, target: 0.01 });

suite.add('validatePolicy-complex', () => {
  validatePolicy(complexPolicy);
}, { iterations: 2000, target: 0.01 });

suite.add('formatPolicy-simple', () => {
  formatPolicy(simplePolicy);
}, { iterations: 2000, target: 0.01 });

suite.add('formatPolicy-complex', () => {
  formatPolicy(complexPolicy);
}, { iterations: 1000, target: 0.02 });

// =============================================================================
// Permission flag generation benchmarks
// =============================================================================

const appDir = '/home/user/projects/myapp';
const urlHash = 'abc123def456';

suite.add('policyToDenoFlags-simple', () => {
  policyToDenoFlags(simplePolicy, appDir, urlHash);
}, { iterations: 2000, target: 0.1 });

suite.add('policyToDenoFlags-medium', () => {
  policyToDenoFlags(mediumPolicy, appDir, urlHash);
}, { iterations: 1000, target: 0.1 });

suite.add('policyToDenoFlags-complex', () => {
  policyToDenoFlags(complexPolicy, appDir, urlHash);
}, { iterations: 500, target: 0.15 });

// =============================================================================
// Permission override benchmarks
// =============================================================================

const actualConfig = MelkerConfig.get();

suite.add('getPermissionOverrides', () => {
  getPermissionOverrides(actualConfig);
}, { iterations: 5000, target: 0.02 });

suite.add('applyPermissionOverrides-simple', () => {
  const overrides = { allow: { read: ['/extra'] }, deny: {} };
  applyPermissionOverrides(simplePolicy.permissions || {}, overrides);
}, { iterations: 2000, target: 0.02 });

suite.add('applyPermissionOverrides-complex', () => {
  const overrides = {
    allow: { read: ['/extra1', '/extra2'], net: ['extra.com'] },
    deny: { write: ['/sensitive'], run: ['rm'] },
  };
  applyPermissionOverrides(complexPolicy.permissions || {}, overrides);
}, { iterations: 1000, target: 0.03 });

// =============================================================================
// Subprocess launch benchmarks (slow, actual process spawning)
// =============================================================================

// Get paths relative to this benchmark file
const benchmarkDir = new URL('.', import.meta.url).pathname;
const melkerPath = new URL('../../melker.ts', import.meta.url).pathname;

// Use the benchmark's directory for test files (more reliable than temp)
const minimalAppPath = `${benchmarkDir}test-minimal.melker`;
const withPolicyAppPath = `${benchmarkDir}test-with-policy.melker`;
const mediumAppPath = `${benchmarkDir}test-medium.melker`;

// Write test .melker files
await Deno.writeTextFile(minimalAppPath, minimalMelker);
await Deno.writeTextFile(withPolicyAppPath, minimalMelkerWithPolicy);
await Deno.writeTextFile(mediumAppPath, mediumMelkerWithPolicy);

// Track temp dir for full-launch tests
const tempDir = benchmarkDir;

/**
 * Launch a .melker app via subprocess and measure time to exit
 */
async function launchApp(appPath: string): Promise<void> {
  const cmd = new Deno.Command(Deno.execPath(), {
    args: ['run', '--allow-all', melkerPath, '--stdout', '--trust', appPath],
    stdout: 'piped',
    stderr: 'piped',
  });
  const child = cmd.spawn();
  const status = await child.status;
  // Consume output to avoid blocking
  await child.stdout.cancel();
  await child.stderr.cancel();

  if (!status.success) {
    // Don't throw during benchmark - just log
    console.error(`Warning: subprocess exited with code ${status.code}`);
  }
}

// Subprocess benchmarks have fewer iterations due to high overhead (~500ms each)
suite.add('subprocess-minimal', async () => {
  await launchApp(minimalAppPath);
}, { iterations: 5, warmup: 1, target: 800 });

suite.add('subprocess-with-policy', async () => {
  await launchApp(withPolicyAppPath);
}, { iterations: 5, warmup: 1, target: 800 });

suite.add('subprocess-medium', async () => {
  await launchApp(mediumAppPath);
}, { iterations: 3, warmup: 1, target: 800 });

// =============================================================================
// Full launch cycle benchmark (policy + subprocess)
// =============================================================================

/**
 * Measure full launch cycle: policy load + validation + flags + subprocess
 */
async function fullLaunchCycle(content: string, appPath: string): Promise<void> {
  // Policy processing (what launcher does)
  const result = await loadPolicyFromContent(content);
  if (result.policy) {
    validatePolicy(result.policy);
    policyToDenoFlags(result.policy, tempDir, 'bench-hash');
  }

  // Subprocess launch
  await launchApp(appPath);
}

suite.add('full-launch-minimal', async () => {
  await fullLaunchCycle(minimalMelkerWithPolicy, withPolicyAppPath);
}, { iterations: 3, warmup: 1, target: 800 });

suite.add('full-launch-medium', async () => {
  await fullLaunchCycle(mediumMelkerWithPolicy, mediumAppPath);
}, { iterations: 3, warmup: 1, target: 800 });

// Run benchmarks
const results = await suite.run();

// Cleanup test files
try {
  await Deno.remove(minimalAppPath);
  await Deno.remove(withPolicyAppPath);
  await Deno.remove(mediumAppPath);
} catch {
  // Ignore cleanup errors
}

// Save results
const outputPath = new URL('../results/launcher-' + benchmarkTimestamp() + '.json', import.meta.url).pathname;
await suite.saveResults(outputPath);
console.log(`\nResults saved to: ${outputPath}`);
