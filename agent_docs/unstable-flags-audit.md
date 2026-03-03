# Unstable & Experimental Flags Audit

This document inventories every unstable/experimental runtime flag used by Melker and describes how to monitor whether each flag has been stabilised, changed, or removed.

## Flag Inventory

### 1. `--unstable-bundle` (Deno)

**What it enables:** Access to the `Deno.bundle()` API for bundling TypeScript/JavaScript with full npm/jsr import support.

**Where it's used:**

| Location                                                   | Context                                       |
|-------------------------------------------------------------|-----------------------------------------------|
| `deno.json` tasks: `test`, `test:watch`, `test:coverage`   | Test runner needs bundler for bundler tests    |
| `melker-launcher.ts:225`                                    | Subprocess spawn — running `.melker` apps      |
| `melker-launcher.ts:333`                                    | Auto-added when bundling is needed             |
| `tests/bundler_test.ts` (multiple lines)                    | `Deno.Command` args in bundler integration tests |
| `tests/server_cli_test.ts:59`                               | Server CLI test subprocess                     |
| `src/bundler/mod.ts:8,137`                                  | Documentation and error message                |
| `src/bundler/errors.ts:146,547`                             | Error hint and `getBundleUnavailableHint()`    |

**Impact if removed/changed:** Core bundler functionality breaks. The `isBundleAvailable()` guard in `src/bundler/mod.ts` provides a runtime check (`typeof (Deno as any).bundle === 'function'`), so the app degrades gracefully with an error message rather than crashing.

---

### 2. `--v8-flags=--expose-gc` (V8)

**What it enables:** Exposes the `gc()` function to JavaScript, allowing explicit garbage collection calls for memory benchmarking.

**Where it's used:**

| Location                                        | Context                |
|-------------------------------------------------|------------------------|
| `deno.json` tasks: `bench:memory`, `bench:all`  | Memory benchmark tasks |
| `benchmarks/memory/memory_bench.ts:1`            | Shebang line           |
| `benchmarks/memory/memory-harness.ts:8,27,53`    | Runtime check and docs |
| `benchmarks/run-all.ts:42`                       | Subprocess spawn       |

**Impact if removed/changed:** Only affects benchmarking, not runtime. The harness already checks `typeof globalThis.gc === 'function'` and throws a clear error if unavailable.

---

### 3. `--experimental-transform-types` (Node.js)

**What it enables:** TypeScript type stripping/transformation at runtime, allowing Node.js to execute `.ts` files directly without a separate compilation step.

**Where it's used:**

| Location              | Context                                          |
|-----------------------|--------------------------------------------------|
| `src/node-main.ts:172` | Subprocess args when spawning the Node.js runner |

**Impact if removed/changed:** Node.js runtime support breaks entirely — the runner cannot execute TypeScript entry points.

---

## How to Check Flag Status

### Deno: `--unstable-bundle`

#### Automated check

Run against the installed Deno version:

```bash
deno --help 2>&1 | grep -i 'unstable-bundle'
```

If the flag no longer appears in `--help` output, it has either been stabilised (check if `Deno.bundle` works without the flag) or removed.

#### Sources to monitor

| Source                         | URL                                                              | What to look for                                                     |
|--------------------------------|------------------------------------------------------------------|----------------------------------------------------------------------|
| Deno release notes             | https://github.com/denoland/deno/releases                        | Search each release for "bundle", "unstable-bundle", or "stabilize"  |
| Deno blog                      | https://deno.com/blog                                            | Stabilisation announcements                                          |
| `Deno.bundle` tracking issue   | Search https://github.com/denoland/deno/issues for "Deno.bundle" | Status changes, closing, or migration to a new API                   |
| Deno unstable features docs    | https://docs.deno.com/runtime/fundamentals/stability/            | List of current unstable features and their status                   |
| Deno source `cli/args/flags.rs` | https://github.com/denoland/deno/blob/main/cli/args/flags.rs    | Search for `unstable-bundle` to see if it's still parsed             |

#### Decision matrix

| Scenario                                   | Action                                                                                          |
|--------------------------------------------|-------------------------------------------------------------------------------------------------|
| Flag still listed as unstable              | No change needed                                                                                |
| Flag stabilised (API works without flag)   | Remove `--unstable-bundle` from all locations listed above                                      |
| Flag removed and API deleted               | Major change — must replace `Deno.bundle()` with an alternative bundler (esbuild, rollup, etc.) |
| Flag renamed                               | Update all occurrences to the new name                                                          |

---

### V8: `--v8-flags=--expose-gc`

#### Automated check

```bash
deno eval --v8-flags=--expose-gc 'gc(); console.log("ok")'
```

This flag has been stable in V8 for many years and is unlikely to change. It is a standard V8 debugging flag, not a Deno-specific feature.

#### Sources to monitor

| Source      | URL                              | What to look for                                 |
|-------------|----------------------------------|--------------------------------------------------|
| V8 blog     | https://v8.dev/blog              | Rarely relevant; this flag is deeply established |
| Node.js docs | https://nodejs.org/api/cli.html | `--expose-gc` documentation                      |

#### Decision matrix

| Scenario             | Action                                                                                               |
|----------------------|------------------------------------------------------------------------------------------------------|
| Flag works           | No change needed                                                                                     |
| Flag removed from V8 | Replace `gc()` calls in benchmarks with `performance.measureUserAgentSpecificMemory()` or equivalent |

---

### Node.js: `--experimental-transform-types`

#### Automated check

```bash
node --experimental-transform-types -e 'const x: number = 1; console.log(x)'
```

If the flag is no longer recognised, Node will print a warning or error. If the feature has been stabilised, TypeScript execution works without the flag.

#### Sources to monitor

| Source                         | URL                                                               | What to look for                                          |
|--------------------------------|-------------------------------------------------------------------|-----------------------------------------------------------|
| Node.js release notes          | https://nodejs.org/en/blog                                        | "transform-types", "type stripping", "TypeScript"         |
| Node.js CLI docs               | https://nodejs.org/api/cli.html#--experimental-transform-types    | Flag status, deprecation notices                          |
| Node.js changelog              | https://github.com/nodejs/node/blob/main/CHANGELOG.md             | Stability changes                                         |
| TC39 type annotations proposal | https://github.com/nicolo-ribaudo/tc39-proposal-type-annotations  | If types become native JS, the flag may become unnecessary |

**Note:** This flag was introduced in Node.js 22.7.0 and became `--experimental-strip-types` first, then was supplemented by `--experimental-transform-types` (which handles enums and other non-erasable syntax). In Node.js 23.6.0+, basic type stripping (`--experimental-strip-types`) is enabled by default, but `--experimental-transform-types` is still needed for enum/namespace transforms. Track when full transform support is unflagged.

#### Decision matrix

| Scenario                                                  | Action                                                         |
|-----------------------------------------------------------|----------------------------------------------------------------|
| Flag still experimental                                   | No change needed                                               |
| Flag stabilised (TypeScript transform works without flag) | Remove from `src/node-main.ts:172`                             |
| Flag renamed or split                                     | Update to the new flag name(s)                                 |
| Flag removed, feature dropped                             | Must pre-compile TypeScript before spawning Node.js subprocess |

---

## Periodic Audit Process

### When to audit

1. **Before each Melker release** — check that all flags still work on the minimum supported runtime versions (`deno >= 2.5.0`, target Node.js version)
2. **When bumping runtime version requirements** — a new minimum Deno/Node version may have stabilised a flag
3. **When a Deno or Node.js major version drops** — review release notes for stabilisations and removals

### Quick audit script

```bash
#!/bin/bash
# Run from project root to check all unstable flags

echo "=== Deno --unstable-bundle ==="
if deno eval --unstable-bundle 'console.log("ok")' 2>/dev/null; then
  echo "PASS: --unstable-bundle accepted"
else
  echo "FAIL: --unstable-bundle not accepted"
fi

# Check if Deno.bundle exists WITHOUT the flag (i.e. stabilised)
if deno eval 'console.log(typeof Deno.bundle)' 2>/dev/null | grep -q function; then
  echo "INFO: Deno.bundle available WITHOUT --unstable-bundle (stabilised?)"
fi

echo ""
echo "=== V8 --expose-gc ==="
if deno eval --v8-flags=--expose-gc 'gc(); console.log("ok")' 2>/dev/null; then
  echo "PASS: --expose-gc accepted"
else
  echo "FAIL: --expose-gc not accepted"
fi

echo ""
echo "=== Node.js --experimental-transform-types ==="
if command -v node &>/dev/null; then
  if node --experimental-transform-types -e 'console.log("ok")' 2>/dev/null; then
    echo "PASS: --experimental-transform-types accepted"
  else
    echo "FAIL: --experimental-transform-types not accepted"
  fi
  # Check if TypeScript works WITHOUT the flag (stabilised)
  if node -e 'const x: number = 1; console.log(x)' 2>/dev/null; then
    echo "INFO: TypeScript transform works WITHOUT flag (stabilised?)"
  fi
else
  echo "SKIP: node not found"
fi
```

### Grep for all flag references

To find every file that references these flags:

```bash
grep -rn '--unstable-bundle\|--expose-gc\|--experimental-transform-types' --include='*.ts' --include='*.json' --include='*.md' .
```

This catches documentation, configs, source code, and tests in one pass.
