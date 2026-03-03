# Node.js Compatibility Architecture

Melker runs on both Deno and Node.js from a single codebase. This document
describes the architecture that makes that work.

## Design Decisions

| Decision                     | Choice                                                               | Rationale                                                        |
|------------------------------|----------------------------------------------------------------------|------------------------------------------------------------------|
| Package name                 | `@wistrand/melker` on JSR, `@melker/core` on npm                    | JSR uses Deno scope; npm uses melker org                         |
| Runtime selection            | Build-time via custom loader (not runtime detection)                 | No `if (isDeno)` branches in shared code                         |
| Node minimum version         | Node 25+                                                             | Native TS execution, stable permission model, ESM `data:` URLs   |
| Build output                 | Ship TypeScript source (no compile step)                             | Custom loader strips types at load time; same files as Deno      |
| stdin.read()                 | Worker thread with `fs.readSync(0)`                                  | Preserves pull-based semantics for graphics protocol detection   |
| Command streams              | Web streams (wrap Node streams)                                      | Node 25 has full web streams; keeps shared interface clean       |
| Dev server (`--server`)      | `ws` npm package                                                     | Bridges Deno's sync `upgradeWebSocket` with Node's event model   |
| jsr: imports in .melker apps | esbuild plugin (fetch from jsr.io + transpile TS + local cache)      | Feature parity with Deno                                         |
| JWT decode                   | Inline `decodeJwt()` in `src/jwt-util.ts`                           | Only decodes without verification; no JSR dependency needed      |
| Permission system            | Node 25 `--permission` + `process.permission.has()` for OS-level; Melker app permissions always allowed | No policy file on Node |
| LSP dependencies             | Inline `npm:` specifiers in `src/lsp/deps.ts`                       | Lazy resolution — not in Deno's dependency graph unless `--lsp`  |
| Embedded assets              | Kept as-is (PNG-encoded base64 in `assets-data.ts`)                  | Already runtime-agnostic, zero-IO                                |

## Architecture Overview

```
melker.ts              ─── Deno entry point (launcher + sandbox subprocess model)
melker-node.mjs        ─── Node entry point for npm installs (pure JS, registers loader)
melker-node.ts         ─── Node entry point for dev/git checkout (needs --experimental-transform-types)

src/
  cli-shared.ts        ─── Shared CLI logic (CliRuntime interface)
  node-main.ts         ─── Node CLI (implements CliRuntime for Node)
  melker-runner.ts     ─── Core runner (shared, runtime-agnostic)
  deps.ts              ─── External dependencies (npm: specifiers)
  jwt-util.ts          ─── encodeBase64 + decodeJwt (replaces jsr:@std/encoding + jsr:@zaubrik/djwt)

  runtime/
    mod.ts             ─── Re-exports ./deno/mod.ts (loader redirects to node/ on Node)
    types.ts           ─── Shared interfaces (FileInfo, DirEntry, FsEvent, etc.)
    deno/              ─── Deno implementations
    node/              ─── Node implementations + loader

  lsp/
    deps.ts            ─── LSP dependency pins (npm:vscode-languageserver, npm:vscode-languageserver-textdocument)
    server.ts          ─── LSP server (imports from ./deps.ts)
    *.ts               ─── LSP providers (all import from ./deps.ts)
```

## Runtime Abstraction Layer

All source files outside `src/runtime/` import from `src/runtime/mod.ts`. This
is the single seam between runtimes.

**`src/runtime/mod.ts`** re-exports `./deno/mod.ts` (the Deno default). On Node,
the custom loader redirects this import to `./node/mod.ts`.

### Module structure

```
src/runtime/
  types.ts              # Shared interfaces: FileInfo, DirEntry, FsEvent, CommandOptions, etc.
  mod.ts                # Re-exports ./deno/mod.ts (redirected by loader on Node)
  deno/
    mod.ts              # Barrel export for all Deno implementations
    process.ts          # cwd, args, exit, platform, arch, inspect, execPath, isMainModule, melkerVersion
    terminal.ts         # stdin/stdout/stderr, consoleSize, signals, onUncaughtError/onUnhandledRejection/onBeforeExit
    fs.ts               # File system operations, error predicates, watchFs
    command.ts          # Deno.Command wrapper
    env.ts              # Deno.env wrapper
    bundler.ts          # Deno.bundle() wrapper
    server.ts           # Deno.serve + Deno.upgradeWebSocket
  node/
    mod.ts              # Barrel export for all Node implementations
    process.ts          # process.cwd(), process.argv, process.exit(), util.inspect()
    terminal.ts         # process.stdin/stdout, signals via process.on(), stdin worker thread
    fs.ts               # node:fs/promises, error code mapping (ENOENT/EEXIST/EACCES)
    command.ts          # child_process.spawn with web stream adapters
    env.ts              # process.env wrapper
    bundler.ts          # esbuild with npm:/jsr: resolution plugin
    server.ts           # node:http + ws package, WebSocket adapter bridge
    loader.mjs          # Custom module loader hooks (pure JS — bootstraps before TS support)
```

### Runtime API surface

| Function group            | Deno implementation            | Node implementation                     |
|---------------------------|--------------------------------|-----------------------------------------|
| `cwd`, `args`, `exit`    | `Deno.cwd()`, `Deno.args`     | `process.cwd()`, `process.argv.slice(2)` |
| `platform`, `arch`       | `Deno.build.os/arch`          | `process.platform/arch` with mapping    |
| `inspect(value)`          | `Deno.inspect()`              | `util.inspect()`                        |
| `isMainModule()`          | `import.meta.main`            | Compare `import.meta.url` vs `process.argv[1]` |
| `stdin.read(buf)`         | `Deno.stdin.read(buf)`        | Worker thread: `fs.readSync(0)` in worker, promise-based read in main thread |
| `stdin.setRaw(mode)`      | `Deno.stdin.setRaw(mode)`     | `process.stdin.setRawMode(mode)`        |
| `stdout.write(data)`      | `Deno.stdout.write(data)`     | `process.stdout.write(Buffer.from(data))` |
| `consoleSize()`           | `Deno.consoleSize()`          | `process.stdout.columns/rows`           |
| `addSignalListener`       | `Deno.addSignalListener()`    | `process.on(signal, fn)`               |
| `onUncaughtError`         | `globalThis.addEventListener('error')` | `process.on('uncaughtException')`  |
| `onBeforeExit`            | `globalThis.addEventListener('beforeunload')` | `process.on('exit')`         |
| `readTextFile`, `stat`, etc. | `Deno.readTextFile()`, etc. | `fs.promises.readFile()`, etc.         |
| `Command`                 | `new Deno.Command()`          | `child_process.spawn()` with web stream wrappers |
| `envGet/Set/Delete`       | `Deno.env.get/set/delete()`   | `process.env[key]`                     |
| `bundle()`                | `Deno.bundle()`               | esbuild + jsr/npm resolution plugin    |
| `serve()`, `upgradeWebSocket()` | `Deno.serve()`, `Deno.upgradeWebSocket()` | `http.createServer()` + `ws.WebSocketServer` with adapter |
| `hasWritePermission()`    | `Deno.permissions.querySync()` | `process.permission.has('fs.write')` (when `--permission` active) |

## Node.js Custom Loader

**File:** `src/runtime/node/loader.mjs`

Pure JavaScript (`.mjs`) — must be JS because it bootstraps TypeScript support
before any `.ts` file can be loaded. Registered in both `melker-node.mjs` and
`melker-node.ts` via `module.register()`. Exports two hooks: `resolve()` and
`load()`.

### `resolve` hook

#### 1. Strip `npm:` specifiers

Converts Deno-style `npm:` imports to bare specifiers for `node_modules/`
resolution, preserving subpaths:

| Input                                        | Output                           |
|----------------------------------------------|----------------------------------|
| `npm:html5parser@2.0.2`                     | `html5parser`                    |
| `npm:@jsquash/webp@1.5.0`                   | `@jsquash/webp`                  |
| `npm:vscode-languageserver@9.0.1/node.js`   | `vscode-languageserver/node.js`  |

#### 2. Redirect `runtime/deno/server.ts` (pre-resolve)

Rewrites the **specifier** before calling `nextResolve()`, so the original
`deno/server.ts` file need not exist on disk. This is critical for npm installs
where `src/runtime/deno/` is excluded from the package:

| Specifier pattern                            | Rewritten to                          |
|----------------------------------------------|---------------------------------------|
| `./runtime/deno/server.ts`                   | `./runtime/node/server.ts`            |
| `../runtime/deno/server.ts`                  | `../runtime/node/server.ts`           |
| `*/runtime/deno/server.ts`                   | `*/runtime/node/server.ts`            |

The redirect exists because `src/server.ts` and `src/oauth/callback-server.ts`
import directly from `runtime/deno/server.ts`, bypassing `runtime/mod.ts`.

#### 3. Redirect `runtime/mod.ts` (post-resolve)

After normal resolution, rewrites the resolved URL:

| Resolved URL ending in           | Redirected to                       |
|----------------------------------|-------------------------------------|
| `/src/runtime/mod.ts`            | `/src/runtime/node/mod.ts`          |

This can remain post-resolve because `runtime/mod.ts` exists in the npm package.

### `load` hook

Intercepts `.ts` file loading and strips TypeScript types using Node 25's
`module.stripTypeScriptTypes(source, { mode: 'transform' })`. This handles
`.ts` files **including inside `node_modules/`** — Node's built-in type
stripping refuses to process files in `node_modules/`, but a custom loader's
`load` hook has no such restriction.

Non-`.ts` files are delegated to `nextLoad()`.

## Entry Points

### Deno: `melker.ts` → `melker-launcher.ts`

The Deno entry spawns a sandboxed subprocess with permission flags derived from
the app's policy file. The subprocess runs `src/melker-runner.ts`.

### Node (npm install): `melker-node.mjs` → `src/node-main.ts`

Pure JS entry point — the npm `bin` target. No `--experimental-transform-types`
flag needed. Single-process model (no subprocess sandbox):

1. Registers the custom loader via `module.register()` — the loader's `load`
   hook strips TypeScript types from all `.ts` files (including `node_modules/`)
2. Dynamically imports `src/node-main.ts`
3. `node-main.ts` implements `CliRuntime` and calls `runCli()` from `cli-shared.ts`

### Node (dev/git checkout): `melker-node.ts` → `src/node-main.ts`

TypeScript entry point for development. Uses `--experimental-transform-types`
shebang. Single-process model:

1. Re-execs with `--experimental-transform-types` if not already active
2. Registers the custom loader via `module.register()`
3. Dynamically imports `src/node-main.ts`
4. `node-main.ts` implements `CliRuntime` and calls `runCli()` from `cli-shared.ts`

### Shared CLI: `src/cli-shared.ts`

Defines the `CliRuntime` interface — a set of callbacks for platform-specific
operations (resolve paths, run app, print usage, etc.). Both `melker-launcher.ts`
and `node-main.ts` implement this interface and call the shared `runCli()` function.

## Dependency Strategy

### External dependencies (`src/deps.ts`)

All npm packages use `npm:` prefixed specifiers with pinned versions. Deno resolves
these natively. The Node loader strips the prefix for `node_modules/` resolution.

```typescript
export { parse as parseHtml } from 'npm:html5parser@2.0.2';
export { decode as decodePng } from 'npm:fast-png@8.0.0';
```

Path and URL utilities use `node:` builtins (work in both runtimes):

```typescript
export { dirname, join, resolve } from 'node:path';
export { fileURLToPath as fromFileUrl } from 'node:url';
```

### LSP dependencies (`src/lsp/deps.ts`)

Isolated in their own deps file with `npm:` specifiers. These are NOT in
`deno.json`'s imports map — Deno only resolves them lazily when the LSP code
path is entered (via `--lsp`). Version pins live in this single file; all 12
LSP provider files import from `./deps.ts`.

### JSR replacements

All `jsr:` imports in shared code have been replaced:

| Was (JSR)                  | Replaced by                                           |
|----------------------------|-------------------------------------------------------|
| `jsr:@std/path`            | `node:path` + `node:url` (builtins, both runtimes)   |
| `jsr:@std/encoding/base64` | `encodeBase64()` in `src/jwt-util.ts` (uses `btoa`)  |
| `jsr:@zaubrik/djwt`        | `decodeJwt()` in `src/jwt-util.ts`                   |

`jsr:@std/assert` remains in tests (Deno-only).

### `deno.json` isolation

`package.json` is listed in `deno.json` `exclude` so Deno does not read it as
a workspace member. This prevents Node npm dependencies from appearing in
`deno.lock`. The `deno.json` has no `imports` map.

## Node-only Dependencies

| Package    | Purpose                                       | Size         |
|------------|-----------------------------------------------|--------------|
| `esbuild`  | Runtime TS bundling (replaces `Deno.bundle()`) | ~9 MB binary |
| `ws`       | WebSocket server for `--server` dev mode      | ~50 KB       |

All other dependencies (`html5parser`, `fast-png`, `jpeg-js`, etc.) are shared —
Deno fetches them via `npm:` specifiers, Node resolves them from `node_modules/`.

## WebSocket Dev Server Bridge

The `--server` mode requires bridging two different upgrade models:

- **Deno:** `upgradeWebSocket(req)` is synchronous-inline — called inside the
  request handler, returns `{ socket, response }` immediately
- **Node (`ws`):** event-based — `'upgrade'` event fires outside the request handler,
  `wss.handleUpgrade()` completes the handshake via callback

**Solution (`src/runtime/node/server.ts`):**

1. `upgradeWebSocket()` stores a deferred promise in a `_pendingUpgrades` map
   keyed by request URL, returns a `WebSocket` adapter and a sentinel response
2. The `'upgrade'` event handler builds a `Request`, calls the shared handler
   (which calls `upgradeWebSocket()`), then resolves the pending promise via
   `wss.handleUpgrade()`
3. The WebSocket adapter wraps `Promise<ws.WebSocket>` in the browser `WebSocket`
   interface, queuing `send()` calls until the real socket resolves

**Platform differences handled:**

- `Response(null, { status: 101 })` throws on Node (only 200-599 allowed) →
  uses status 200 with sentinel header `X-Melker-WS-Upgrade: 1`
- Port binding race → `NodeHttpServer` has a `ready` promise awaited by
  `MelkerServer.start()`

## Permission System

Two layers:

**OS-level permissions (fs, net, child_process):**

| Deno                    | Node 25                      |
|-------------------------|------------------------------|
| `--allow-read=<path>`   | `--allow-fs-read=<path>`     |
| `--allow-write=<path>`  | `--allow-fs-write=<path>`    |
| `--allow-run`           | `--allow-child-process`      |
| `--allow-net`           | `--allow-net`                |

On Node, these are enforced by passing `--permission` to the Node process.
`hasWritePermission()` in `src/runtime/node/fs.ts` queries
`process.permission.has('fs.write', path)` when the permission model is active.

**Melker app permissions (shader, clipboard, keyring, browser, ai):**

On Deno, these are checked against `.melker-policy.json`. On Node, all Melker app
permissions return `true` — no policy file, no approve/revoke CLI.

## Testing

### Deno tests (`tests/*_test.ts`)

Use `Deno.test` + `jsr:@std/assert`. Validate the Deno runtime path. Unchanged.

### Node tests (`tests/node/`)

Use `node:test` + `node:assert/strict`. Run with `node --test`.

```
tests/node/
  process_test.ts         # cwd, platform, arch, runtimeName
  terminal_test.ts        # consoleSize, isTerminal, signals
  fs_test.ts              # read/write round-trip, error predicates, permissions
  command_test.ts         # echo output, exit codes, web stream wrappers
  env_test.ts             # get/set/remove round-trip
  bundler_test.ts         # TS bundling, npm: resolution, jsr: fetch/transpile
  loader_test.ts          # resolve hook (npm: stripping, redirects), load hook (TS type stripping)
  e2e/
    cli_test.ts           # --version, --help, --info
    hello_test.ts         # hello.melker in --stdout mode
    counter_test.ts       # counter.melker initial state
    stdout_test.ts        # --stdout rendering
    server_test.ts        # HTML serving, auth, WebSocket welcome
    npm_install_test.ts   # npm pack + local install + run hello.melker via installed bin
```

### CI (`.github/workflows/test.yml`)

Matrix build with two jobs:

| Job  | OS                       | Runtime    | Steps                                           |
|------|--------------------------|------------|--------------------------------------------------|
| deno | ubuntu-latest, macos-latest | Deno 2.5.x | `check`, `check:leaks`, `test`                  |
| node | ubuntu-latest, macos-latest | Node 25    | `npm install`, `test:node` (unit + e2e), version checks (both `.ts` and `.mjs` entry) |

### Tasks

```
deno task check              # Deno type check (src/ + benchmarks/)
deno task check:leaks        # Verify no Deno.* usage outside runtime/deno/
deno task check:node-runtime # tsc type check of src/runtime/node/
deno task test               # Deno test suite
deno task test:node          # Node unit + e2e tests (all tests/node/)
deno task test:node:e2e      # Node end-to-end tests only
```

## Distribution

| Registry | Install command                              | Entry point       |
|----------|----------------------------------------------|--------------------|
| JSR      | `deno install -g -A jsr:@wistrand/melker`    | `melker.ts`        |
| npm      | `npm install -g @melker/core`                | `melker-node.mjs`  |

Version source of truth
is git tags via `scripts/sync-version.ts` (updates both `deno.json` and `package.json`).

The npm package ships TypeScript source directly — no compile step. The bin entry
(`melker-node.mjs`) and loader (`loader.mjs`) are pure JS since they bootstrap
TS support. `package.json` `files` field whitelists what ships: `melker-node.mjs`,
`mod.ts`, `src/` (excluding `src/runtime/deno/`), and `LICENSE.txt`.

## Known Limitations

- **Node 25+ required** — native TS execution, stable permission model, ESM data: URLs
- **No enums/namespaces** — codebase uses only erasable TS syntax (`stripTypeScriptTypes` mode: `'transform'`)
- **Windows** — signals limited, SIGWINCH unavailable (needs polling fallback)
- **`--permission` optional on Node** — without it, `process.permission` is undefined, all ops allowed
- **Melker app permissions always allowed on Node** — no policy file enforcement
- **jsr: cold cache** — first run with jsr imports fetches from jsr.io
- **stdin worker needs `--allow-worker`** — when running with `--permission`
