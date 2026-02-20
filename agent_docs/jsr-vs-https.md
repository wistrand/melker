# JSR Install vs HTTPS Run

Objective comparison of the two distribution paths for running Melker. They serve different roles and are complementary — neither is secondary.

## How Each Path Works

### JSR install (`deno install -g -A jsr:@wistrand/melker`)

1. Downloads the package from JSR, creates a shim script in `~/.deno/bin/melker`
2. The shim runs `melker.ts` → resolves via `Deno.realPath()` (with JSR cache fallback) → imports `melker-launcher.ts` from the same directory
3. All code is colocated: policy system, config system, content loader, assets — all resolved as relative `./src/...` imports against the local JSR cache
4. The runner subprocess (`src/melker-runner.ts`) is spawned from the same local tree
5. All 17 embedded assets (themes, fonts, server-ui, blue noise, logo, Swift script) are available locally in `src/assets-data.ts`

### HTTPS run (`deno run --allow-all https://melker.sh/melker.ts`)

1. Hits a Netlify edge function at `docs/netlify/edge-functions/melker.ts`
2. The edge function generates a thin wrapper that `import()`s `melker-launcher.ts` from `raw.githubusercontent.com` — it does **not** serve the real `melker.ts`
3. `melker-launcher.ts` imports its dependencies (`./src/policy/mod.ts`, `./src/utils/content-loader.ts`, etc.) — all resolved as relative URLs against the GitHub raw content URL
4. The runner subprocess is spawned using the remote URL for `src/melker-runner.ts`
5. The runner then imports `../mod.ts`, `./bundler/mod.ts`, etc. — each a separate HTTP fetch from GitHub on first run

## Comparison

| Dimension                        | JSR install                                                                                          | HTTPS run                                                                                                                     |
|----------------------------------|------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------|
| **Module resolution**            | Local filesystem, deterministic                                                                      | HTTP fetch chain through GitHub raw URLs, each import = a network round-trip on first run                                     |
| **Startup latency**              | Near-instant (local files)                                                                           | Cold start: dozens of HTTP fetches as Deno walks the import graph. Warm (cached): fast, but depends on Deno's module cache    |
| **Offline support**              | Fully works offline after install                                                                    | Fails unless everything is in Deno's cache (`--cached-only` after first run)                                                  |
| **Lockfile integrity**           | `deno.lock` published with package, pins dependency hashes                                           | No lockfile — Deno fetches whatever is at HEAD (or pinned tag)                                                                |
| **Version pinning**              | `jsr:@wistrand/melker@2026.2.6` — immutable, auditable via JSR registry                             | `melker.sh/melker-v2026.01.1.ts` pins the launcher, but transitive deps resolve to that tag's tree. No lockfile verification |
| **`--reload` detection**         | N/A — `wasLauncherReloaded()` returns `false` immediately (`url.protocol === 'file:'`)               | Mtime forensic detection: checks `<DENO_DIR>/remote/https/<host>/<SHA256>` modified within 5s. Auto-forwards to subprocess   |
| **Subprocess spawn**             | Spawns `deno run ... /path/to/src/melker-runner.ts` — clean local path                               | Spawns `deno run ... https://raw.githubusercontent.com/.../src/melker-runner.ts` — triggers another remote import chain       |
| **Embedded assets**              | Available locally, synchronous decode, zero network I/O at runtime                                   | Same assets in fetched source, but initial fetch must traverse the full import graph remotely                                  |
| **Permission sandbox**           | `--allow-read` needs temp dir, app dir, cwd, XDG state, Deno cache. No `--allow-net` for melker host | Same — Deno's module loading bypasses `--allow-net` restrictions (see below), and all runtime assets are embedded             |
| **Upgrade**                      | `melker upgrade` → fetches `jsr.io/@wistrand/melker/meta.json`, runs `deno install -g -f`            | `deno run --reload https://melker.sh/melker.ts` re-fetches everything. No upgrade concept; just cache invalidation            |
| **Edge function indirection**    | None — runs the actual code directly                                                                 | `melker.sh/melker.ts` returns a generated wrapper, not the real `melker.ts`. Extra indirection, extra failure point           |
| **`import.meta.url` semantics**  | `file:///.../.deno/.../melker-launcher.ts` — stable filesystem URL                                   | `https://raw.githubusercontent.com/.../melker-launcher.ts` — all relative URL resolutions go back to GitHub                   |
| **Error diagnostics**            | Stack traces point to local paths                                                                    | Stack traces point to `raw.githubusercontent.com` URLs — harder to debug                                                      |
| **`deno.json` tasks**            | Available (test, check, etc.)                                                                        | Not applicable — no local project                                                                                             |

## Module Loading vs `--allow-net`

Deno's module loading is **not** subject to `--allow-net` restrictions. The permission system controls runtime APIs (`fetch()`, `Deno.connect()`, `WebSocket`, etc.), not the module graph resolution phase.

When the launcher spawns a subprocess with a remote runner URL, Deno resolves the entire import graph (runner → `../mod.ts` → `./bundler/mod.ts` → all transitive imports) **before** the permission sandbox takes effect. Module fetching is a privileged operation performed by the runtime, not by user code.

This means the removed `--allow-net` for melker's own origin in `src/policy/flags.ts` is correct for **both** paths — it was about runtime `fetch()` calls (themes, server-ui, Swift script), which are all embedded now.

## Edge Function Wrapper Design

The Netlify edge function (`docs/netlify/edge-functions/melker.ts`) generates a wrapper instead of serving the real `melker.ts`. The real `melker.ts` already handles the remote case (line 19-20: `new URL('./melker-launcher.ts', selfUrl).href`), so the wrapper technically bypasses working code.

This is an aesthetic issue, not a functional one. The launcher's `import.meta.url` is the GitHub URL regardless, so all its `new URL('./src/...', import.meta.url)` resolutions work correctly. The bypassed code in `melker.ts` would produce the same result as the wrapper.

Alternatives considered:
- **Full proxy**: Serve all `*.ts` from `melker.sh` by proxying GitHub — `import.meta.url` stays on `melker.sh`. Clean but adds latency to every import.
- **Export `run()` from `melker.ts`**: The wrapper becomes `import('...melker.ts').then(m => m.run())` — delegates to real resolution logic instead of reimplementing it. Smallest change with most payoff.
- **HTTP redirect**: Redirect `melker.sh/melker.ts` → `raw.githubusercontent.com/.../melker.ts`. Clean but loses version-not-found error handling and cache control.
- **Keep as-is**: Current design works correctly. The wrapper is a pragmatic solution.

Current choice: **keep as-is**.

## Roles

The two paths serve fundamentally different purposes. "Run from URL" is the #1 differentiator in the README's "Why Melker?" table — it's the core value proposition, not a fallback.

| Path            | Role                                                                                                                          |
|-----------------|-------------------------------------------------------------------------------------------------------------------------------|
| **HTTPS run**   | **Distribution** — share, discover, try, automate. Enables the project's central promise: share a URL, inspect the policy, approve it, run it. |
| **JSR install** | **Installation** — daily use, offline, deterministic. Better runtime characteristics for repeated use.                        |

### HTTPS run is the distribution path

- Enables sharing apps by URL — the whole point of "apps you want to share safely"
- Zero-friction discovery (first thing someone tries)
- CI/automation without global install
- Version pinning via URL (`melker-v2026.01.1.ts`, `melker-abc123f.ts`)
- The README and landing page both feature this prominently

### JSR install is the installation path

- Near-instant startup (local files)
- Fully offline after install
- Lockfile integrity (`deno.lock` published with the package)
- `melker upgrade` for clean atomic updates
- `melker info` shows install type and version

For repeated use, `deno install -g -A jsr:@wistrand/melker` is the better path. For sharing and discovery, the HTTPS URL is the right tool.

See [jsr-publishing.md](jsr-publishing.md) for the full JSR publishing workflow.
