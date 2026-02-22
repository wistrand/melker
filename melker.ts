#!/usr/bin/env -S deno run --allow-all
/**
 * # Melker
 *
 * *Run text with meaning*
 *
 * **Website:** [melker.sh](https://melker.sh) |
 * **GitHub:** [wistrand/melker](https://github.com/wistrand/melker)
 *
 * A terminal UI framework for building document-first TUI applications. Melker
 * apps are readable markup files with declared permissions, shareable via URL,
 * and inspectable with built-in Dev Tools. Each app runs in a sandboxed Deno
 * subprocess with only the permissions it declares.
 *
 * ## Installation
 *
 * ```bash
 * deno install -g -A jsr:@wistrand/melker
 * ```
 *
 * `-A` grants all permissions to the launcher — your apps run sandboxed in a
 * subprocess with only the permissions declared in their `<policy>`.
 *
 * Requires **Deno 2.5+** and an ANSI-compatible terminal.
 * [Nerd Fonts](https://www.nerdfonts.com/) recommended for graphics.
 *
 * ## Try Without Installing
 *
 * ```bash
 * deno x jsr:@wistrand/melker app.melker
 * ```
 *
 * ## Usage
 *
 * Run a `.melker` file from anywhere:
 *
 * ```bash
 * melker app.melker
 * melker https://melker.sh/examples/demo.melker
 * ```
 *
 * Or run directly from a URL without installing:
 *
 * ```bash
 * deno run -A https://melker.sh/melker.ts app.melker
 * ```
 *
 * ## Creating Apps
 *
 * A `.melker` file is HTML-like markup with an embedded permission policy:
 *
 * ```html
 * <melker>
 *   <policy>
 *   {
 *     "name": "Hello App",
 *     "permissions": { "env": ["TERM"] }
 *   }
 *   </policy>
 *
 *   <style>
 *     container { border: thin; padding: 1; }
 *     text { font-weight: bold; color: cyan; }
 *   </style>
 *
 *   <container>
 *     <text>Hello, Terminal!</text>
 *     <button label="Exit" onClick="$melker.exit()" />
 *   </container>
 * </melker>
 * ```
 *
 * Press **F12** at runtime to open Dev Tools (source, policy, document tree,
 * system info).
 *
 * ## TypeScript API
 *
 * For programmatic use, import from
 * [`@wistrand/melker/lib`](./lib/index.html):
 *
 * ```typescript
 * import { createElement, createApp } from "@wistrand/melker/lib";
 *
 * const ui = createElement(
 *   "container",
 *   { style: { border: "thin", padding: 2 } },
 *   createElement("text", { text: "Hello!" }),
 *   createElement("button", { label: "OK", onClick: () => app.exit() }),
 * );
 *
 * const app = await createApp(ui);
 * ```
 *
 * ## Components
 *
 * | Category   | Elements                                        |
 * |------------|-------------------------------------------------|
 * | Layout     | container, tabs, split-pane                     |
 * | Text       | text, markdown                                  |
 * | Input      | input, textarea, checkbox, radio, slider        |
 * | Navigation | button, command-palette                         |
 * | Data       | data-table, data-tree, data-bars, data-heatmap  |
 * | Dropdowns  | combobox, select, autocomplete                  |
 * | Dialogs    | dialog, alert, confirm, prompt                  |
 * | Files      | file-browser                                    |
 * | Graphics   | canvas, img, video                              |
 *
 * ## Permission Sandboxing
 *
 * Apps declare permissions in a `<policy>` tag. The launcher parses the policy,
 * shows an approval prompt on first run, then spawns the app in a restricted
 * Deno subprocess with only the approved permissions:
 *
 * ```html
 * <policy>
 * {
 *   "permissions": {
 *     "read": ["."],
 *     "net": ["api.example.com"],
 *     "run": ["ffmpeg"]
 *   }
 * }
 * </policy>
 * ```
 *
 * Override permissions at runtime:
 *
 * ```bash
 * melker --allow-net=cdn.example.com app.melker
 * melker --deny-read=/etc app.melker
 * ```
 *
 * ## Upgrade
 *
 * ```bash
 * melker upgrade
 * ```
 *
 * ## Examples
 *
 * ```bash
 * melker examples
 * ```
 *
 * Or run a showcase example directly:
 *
 * ```bash
 * melker https://melker.sh/examples/showcase/demo.melker
 * melker https://melker.sh/examples/showcase/breakout.melker
 * ```
 *
 * More examples: [examples/](https://github.com/wistrand/melker/tree/main/examples)
 *
 * ## Documentation
 *
 * - [Getting Started](https://github.com/wistrand/melker/blob/main/agent_docs/getting-started.md)
 * - [Step-by-step Tutorial](https://melker.sh/tutorial.html)
 * - [Examples](https://github.com/wistrand/melker/tree/main/examples)
 * - [Manifesto](https://github.com/wistrand/melker/blob/main/MANIFESTO.md)
 * - [FAQ](https://github.com/wistrand/melker/blob/main/FAQ.md)
 *
 * @module
 */

if (import.meta.main) {
  const selfUrl = new URL(import.meta.url);
  let launcherUrl: string;

  if (selfUrl.protocol === 'file:') {
    // Local file: resolve symlinks, with fallback for JSR cache
    try {
      const realPath = await Deno.realPath(selfUrl.pathname);
      const realDir = realPath.replace(/\/[^/]+$/, '');
      launcherUrl = `file://${realDir}/melker-launcher.ts`;
    } catch {
      launcherUrl = new URL('./melker-launcher.ts', selfUrl).href;
    }
  } else {
    // Remote URL: use URL directly
    launcherUrl = new URL('./melker-launcher.ts', selfUrl).href;
  }

  const mod = await import(launcherUrl);
  await mod.main();
}
