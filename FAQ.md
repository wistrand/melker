# Frequently Asked Questions

Common questions and concerns about Melker, addressing architecture decisions, limitations, and tradeoffs.

## When to Use (and Not Use) Melker

### When should I NOT use Melker?

Melker isn't the right choice for:

- **Simple CLI tools** - If you just need flags and text output, use a CLI parser (yargs, commander, clap). TUI is overkill.
- **Node.js/Bun shops** - If your organization won't add Deno to the stack, don't fight that battle for a TUI library.
- **Maximum performance** - If you need nanosecond latency or minimal memory, use C/Rust with ncurses/ratatui.
- **Public distribution** - Requiring end users to install Deno is friction. Consider Textual (Python) or Go alternatives for wider reach.
- **Pixel-perfect layouts** - Terminal rendering varies by font/terminal. If you need exact alignment, you'll be frustrated.

### When IS Melker a good fit?

- **Internal tools** - You control the environment, can require Deno
- **SSH-accessible apps** - Need rich UI over remote connections where X11/browser isn't available
- **Sandboxed execution matters** - Running third-party .melker apps with least-privilege
- **TypeScript teams** - Familiar language, type safety, component model
- **AI-assisted accessibility** - Users who benefit from voice/conversational UI navigation

---

## Runtime & Dependencies

### Why Deno? This limits adoption.

Melker's permission sandboxing is built on Deno's `--allow-read`, `--allow-net`, etc. flags. This isn't possible in Node.js without reimplementing OS-level sandboxing. We chose security and clean architecture over ecosystem size.

If your organization already uses Node.js, Melker may not be the right fit. We're not trying to win market share - we're building for use cases where sandboxed execution matters.

### Deno.bundle() is unstable. What's the migration path?

Yes, this is a real risk. If Deno removes `Deno.bundle()`, we have options:

1. Vendor a bundler (esbuild, rollup) as a fallback
2. Pre-bundle .melker files at publish time
3. Move to an interpreter model

We're tracking Deno's deprecation timeline and will migrate before removal. For production apps, consider pre-bundling your .melker files rather than relying on runtime bundling.

### How do I distribute apps to users without Deno?

Three options:

1. **Require Deno** - Users install Deno (single binary, no npm)
2. **Pre-bundle** - Bundle your .melker file and distribute the JS with a Deno dependency
3. **Wait for deno compile support** - We're exploring this but the unstable bundle API complicates it

For internal tools where you control the environment, option 1 is fine. For public distribution, this is a current limitation.

### Does this work on Windows?

We test primarily on macOS and Linux. Windows support exists (ffmpeg audio, Windows Terminal ANSI support) but is less tested. If you find Windows-specific bugs, please report them.
 
---

## Security & Sandboxing

### Is this a real security sandbox?

**No.** Deno permissions are a least-privilege mechanism, not a security boundary. They prevent accidental access (your npm dependency reading `~/.ssh`), not determined attackers exploiting kernel bugs.

For untrusted code from the internet, use a VM or container. The policy system is defense-in-depth, not isolation. We don't claim otherwise.

### What about the bundling phase? Code runs before the sandbox.

The launcher (`melker-launcher.ts`) runs with full permissions, but only parses the policy and spawns a subprocess. The actual app execution happens in the restricted subprocess. The attack surface is the launcher code itself, which is ~500 lines and auditable.

### What prevents apps from requesting all permissions?

Nothing technical. An app can request `{ "read": ["*"], "write": ["*"], "net": ["*"] }` and users can approve it.

The protections are:

1. **Approval prompt shows exact permissions** - Users who read it can make informed decisions
2. **Remote apps use content hashing** - If permissions change, re-approval is required
3. **`--show-policy` flag** - Audit permissions before running

This is better than most CLI tools which run with full user permissions by default. But ultimately, users must exercise judgment.
 
---

## Architecture Decisions

### Why reinvent ncurses?

ncurses is a C library with:

- Terrible FFI ergonomics from JavaScript/TypeScript
- Unicode support bolted on as an afterthought
- terminfo database issues across platforms
- No component model or layout engine

We're not wrapping ncurses because we'd inherit its problems. The dual-buffer system isn't novel - it's the same approach ncurses uses, implemented in TypeScript with proper Unicode handling.

### Why flexbox instead of CSS Grid?

Flexbox is one-dimensional (row OR column). Most UI layouts are hierarchical stacks with occasional horizontal sections - flexbox handles this naturally. CSS Grid is two-dimensional and better for tabular layouts, but adds complexity.

We may add Grid support later if there's demand, but flexbox covers 90% of use cases with a simpler mental model.

### Why the .melker file format? Mixing code and markup is bad.

Maybe so. We like it for reasonably-sized tools.

If you prefer separation of concerns, use the library directly with `createElement()`:

```typescript
import { createElement, createApp } from './mod.ts';
 
const ui = createElement('container', {},
  createElement('text', {}, 'Hello')
);
 
await createApp(ui);
```

The .melker format is convenience, not requirement.

### Why TypeScript generation + bundling instead of interpretation?

Two reasons:

1. **TypeScript type checking** catches errors at bundle time instead of runtime
2. **Bundled output runs faster** than interpretation would

The cache (`--cache` flag) makes subsequent runs instant. The default is no-cache because during development you want to see changes immediately. Watch mode (`--watch`) rebundles automatically on file changes (under half a second).
 
---

## Accessibility

### What about screen reader accessibility?

The AI assistant is **not** a replacement for screen readers. It's a supplement for cases where traditional screen readers struggle (complex context-dependent UIs).

Terminal screen readers work by scraping the character buffer - there's no ARIA equivalent for terminals. We'd love to improve this but don't have a solution yet. If you have expertise in terminal accessibility, we welcome discussion.

The AI approach has real limitations:

- Requires internet connection
- Costs money (API usage)
- Adds latency to every interaction

It's an option, not the answer.

### What data does the AI assistant send?

When you press F7/F8, Melker sends to OpenRouter (or your configured endpoint):

1. **Serialized UI tree** - Element types, labels, current values of visible text/inputs
2. **Focus state** - Which element is currently focused
3. **Your query** - What you typed or spoke

**What it does NOT send:**
- System information beyond what's visible in the UI
- Files on disk (unless displayed in the UI)
- Environment variables or other system credentials
- Password input values (inputs with `format="password"` are masked as `****`)

**Privacy considerations:**
- If your app displays sensitive data (API keys in plain text fields, etc.), that data is sent to the AI
- For sensitive apps, disable AI features or use a self-hosted model endpoint via `MELKER_AI_ENDPOINT`

The AI feature is opt-in (requires pressing F7/F8 and configuring AI endpoint and key). 
It doesn't run in the background or send data without user action.
 
---

## Development Experience

### Console logging

`console.log()` is automatically redirected to `$melker.logger.info()`, so it won't corrupt the TUI display. Objects are formatted using `Deno.inspect()` for readable output.

```javascript
console.log("debug info");           // → $melker.logger.info()
console.warn("warning");             // → $melker.logger.warn()
console.error("error");              // → $melker.logger.error()
```

For more control, use the logger directly: `$melker.logger.debug()`, etc.

**Tip:** F12 opens Dev Tools which shows the log file location. Use `tail -f` in another terminal for printf-style debugging.

**Disable redirect** (for debugging, outputs to terminal):
```bash
./melker.ts --no-console-override app.melker
```

### Why avoid emojis?

Emoji width calculation is fundamentally broken across terminals:

- iTerm2 says 2 cells, Terminal.app says 1, Linux VTE says "depends on the font"
- Zero-width joiners, skin tone modifiers, and flag sequences behave unpredictably
- The same emoji renders as 1, 2, or 7 cells depending on font support for ZWJ sequences

There's no programmatic way to know how wide an emoji will render. The only winning move is not to play.

### Cross-terminal rendering looks inconsistent

This is unsolvable. Terminal rendering depends on:

- Font metrics (character width varies by font)
- Color profiles (256-color vs truecolor)
- Unicode support (emoji, CJK, box-drawing)
- Line height and spacing

We mitigate with:

- Theme auto-detection (graceful degradation to basic terminals)
- Avoiding emoji by default
- Using standard box-drawing characters
- Not relying on pixel-perfect alignment

Test on multiple terminals. Accept imperfection.

### What are the minimum terminal requirements?

**Required:**
- ANSI escape code support (colors, cursor movement)
- UTF-8 encoding
- At least 80x24 dimensions (smaller works but may truncate)

**Recommended:**
- 256-color or truecolor support
- Unicode box-drawing characters (U+2500 block)
- Mouse reporting (optional but enables click interactions)

**Compatibility notes:**

| Terminal | Status |
|----------|--------|
| iTerm2, Terminal.app (macOS) | ✓ Full support |
| GNOME Terminal, Konsole, Alacritty | ✓ Full support |
| Windows Terminal | ✓ Works (less tested) |
| VS Code integrated terminal | ✓ Works |
| tmux/screen | ✓ Works (set TERM correctly) |
| Mosh | ⚠ Works but may have visual glitches due to predictive echo |
| cmd.exe (legacy) | ✗ No ANSI support |
| Real VT100/serial terminals | ⚠ Basic support with `MELKER_THEME=bw-std`, no mouse |

**Mosh users:** Mosh's predictive local echo can conflict with Melker's differential updates. You may see brief rendering glitches during fast typing. SSH works better for latency-sensitive TUI apps.

---

## Performance

### Where are the benchmarks?

| Metric | Typical Value |
|--------|---------------|
| Keystroke-to-display latency | < 5ms (fast path) |
| Full render cycle | < 20ms (debounced) |
| Bundle time | < 500ms (first run, cacheable) |
| Memory usage | 30-50MB (Deno baseline + app) |

We haven't done rigorous benchmarking against Textual/bubbletea/ratatui. Contributions welcome.
 
---

## Comparisons

### How does this compare to Textual?

| Aspect | Melker | Textual |
|--------|--------|---------|
| Language | TypeScript/Deno | Python |
| Styling | Inline + stylesheet | CSS subset |
| Sandboxing | Built-in policy system | None |
| Maturity | Newer | More mature |
| AI features | Built-in | None |
| Startup time | < 500ms (bundle) | < 1s (Python) |

Choose Textual if you're in a Python shop and want a mature ecosystem. Choose Melker if you want TypeScript, sandboxing, or AI accessibility features.

### How does this compare to other TUI frameworks?

See [TUI comparison](agent_docs/tui-comparison.md) for a detailed breakdown.
 
---

## Features

### Why does a TUI framework need video playback?

Because we wanted it. Specific use cases:

- Security camera monitoring over SSH
- Media file preview in file managers
- ASCII art visualization in music players

You don't have to use it. The feature exists for those who need it.
 
---

Q&A - Stuck on something? Ask here. Include your Melker version, terminal, and a minimal example if possible.
Ideas - Feature requests and suggestions. Describe the problem you're trying to solve, not just the solution you want.
Show and Tell - Built something with Melker? Share it. Screenshots, code snippets, or links welcome.
General

## Project

### Who maintains this? What's the bus factor?

Melker is maintained by a small team with heavy AI assistance. Most of the code, documentation, and architecture decisions were developed collaboratively with Claude (Anthropic's AI). This isn't a secret - it's core to how the project works.

**What this means:**
- The `agent_docs/` folder exists because AI agents need context to contribute effectively
- The `CLAUDE.md` file contains instructions for AI assistants working on the codebase
- Documentation is unusually thorough because it serves both humans and AI
- The AI agent skill (`skills/creating-melker-apps/`) enables AI to build .melker apps

**Is this a problem?**

We don't think so. The code is reviewed, tested, and works. AI assistance lets a small team build and maintain something that would otherwise require more people. The codebase is readable and well-documented precisely because AI needs clarity to be useful.

If you're evaluating for production use, consider:

- Can you fork and maintain it if needed? (Yes - the docs are comprehensive)
- Is the codebase understandable? (We think yes, by design)
- Are there commercial alternatives that fit better?

### What's the testing story?

- **Unit tests** for layout, parsing, components (`deno task test`)
- **Headless mode** for CI (`MELKER_HEADLESS=true`)
- **Snapshot testing** of rendered output (planned, not implemented)

The headless mode disables terminal raw mode and alternate screen, allowing programmatic testing without a real terminal.

### Where do I report bugs or get help?

**GitHub Discussions** is the place for everything:
- Bug reports
- Feature requests
- Questions and help
- Showing off what you've built

Issues and Pull Requests are disabled. We're a small team and prefer the conversational format of Discussions.

**When reporting bugs, include:**
- Melker version (`./melker.ts --version`)
- Deno version (`deno --version`)
- Terminal emulator and OS
- Minimal reproduction case (ideally a small .melker file)

**Not a bug:**
- Emoji rendering issues (see "Why avoid emojis?")
- Cross-terminal visual differences (see "Cross-terminal rendering")
- Apps requesting broad permissions (see "What prevents apps from requesting all permissions?")

---

## Quick Answers

| Question | Answer |
|----------|--------|
| Node.js support? | No, Deno only (permission system requirement) |
| Minimum Deno version? | 2.5+ (for `Deno.bundle()`) |
| TypeScript required? | Yes for library use, optional for .melker files |
| Mouse support? | Yes, configurable |
| Color support? | Auto-detected, 256-color and truecolor |
| CJK support? | Yes, proper wide character handling |
| License? | Check repository |
| Commercial use? | Check license |
 
---

*Have a question not covered here? Check the docs in `agent_docs/` or start a Discussion.*