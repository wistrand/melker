# Manifesto

**A terminal app can be inspected before it is trusted.**

Terminal apps lack a standard way to declare and enforce permissions. You download a CLI tool, run it, and hope for the best. Shell scripts are technically readable, but there's no structured metadata telling you what a script needs — you have to read the whole thing and understand it. Compiled binaries are truly opaque. Neither declares permissions upfront or enforces them at runtime.

With Melker, a terminal app is a document you can read before you run it.

---

## The Trust Problem

Consider how you use terminal tools today:

1. You find a CLI tool someone recommends
2. You install it (or run it directly)
3. You grant it whatever permissions it asks for
4. You hope it does what it claims

That's the wrong order. Trust should come after inspection. But terminal apps don't offer structured inspection — even readable scripts lack standardized permission declarations, and there's no runtime enforcement.

The web solved this decades ago. Browsers show you the URL, enforce permissions, and let you view source. Terminal apps have no equivalent: no permission manifest, no sandbox, no "view policy before run."

---

## Document-First as the Solution

Melker treats terminal apps as **documents**, not programs.

A `.melker` file is:
- **Readable** — HTML-like markup you can open in any editor
- **Inspectable** — Policy tag declares what permissions it needs
- **Verifiable** — Handlers are visible strings, not hidden closures
- **Shareable** — Run directly from a URL, no installation required

```html
<melker>
  <policy>
  {
    "name": "My App",
    "permissions": {
      "read": ["./data"],
      "net": ["api.example.com"]
    }
  }
  </policy>

  <container style="border: thin; padding: 1;">
    <text>Click to fetch data</text>
    <button title="Fetch" onClick="fetchData()" />
  </container>
</melker>
```

Before running this, you know:
- It reads from `./data`
- It connects to `api.example.com`
- It has one button that calls `fetchData()`
- Nothing else

Press F12 at runtime to see the same information.

---

## What Melker Is

Melker is a **terminal browser engine**.

Like a web browser, it:
- Runs documents (`.melker` files)
- Enforces declared permissions
- Provides dev tools (F12)
- Supports remote loading (URLs)

Unlike a web browser, it:
- Targets terminals, not screens
- Uses Deno's permission system
- Focuses on tools, not content

Basically: what if terminals worked like browsers?

---

## What Melker Is NOT

**Not a general scripting host.** Melker runs `.melker` artifacts, not arbitrary TypeScript. The document is the boundary.

**Not a platform-of-everything.** Features serve inspectability and trust. Canvas exists for dashboards; video exists for previews. They're tools, not goals.

**Not trying to replace the terminal.** Melker apps run *in* terminals. They're better terminal apps, not alternatives to terminals.

---

## Three Abstraction Levels

Most TUI frameworks offer one way to build UIs: programmatic APIs. Melker offers three:

**1. Declarative (preferred)** — `.melker` HTML-like files
```html
<button title="Click" onClick="count++" />
```
This is the primary way to build Melker apps. Declarative files enable the full trust model: visible structure, inspectable handlers, declared policy, and sandboxed execution.

**2. Literate** — `.melker.md` Markdown with embedded UI
```markdown
# Counter

This button increments a counter:

<button title="Click" onClick="count++" />
```
Documentation and UI in the same file. The help text is the app.

**3. Programmatic** — TypeScript `createElement` API
```typescript
const btn = createElement('button', { title: 'Click', onClick: () => count++ });
```
For embedding Melker in larger applications or when you need full programmatic control. Loses some inspectability benefits.

---

## The Vision

Terminal tools deserve better:

- Declared permissions, not implicit access
- Source you can read before running
- Apps you can share without installation

Melker doesn't replace terminals. It makes terminal apps easier to trust.

---

## Who This Is For

Melker is for people who:
- Build internal tools and need to share them safely
- Work in regulated environments where permissions matter
- Want to distribute terminal apps without requiring installation
- Believe tools should be inspectable before they're trusted

If you just want to build a quick CLI for yourself, simpler frameworks exist. But if you're building something others will run, Melker gives them — and you — a way to verify what it does.

