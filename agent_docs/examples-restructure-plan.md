# Examples Directory Restructure Plan

Analysis and plan for reorganizing the examples/ directory.

## Current State

**File counts:**
- `examples/melker/` — 80+ .melker files (main examples)
- `examples/ts/` — 12 TypeScript files (createElement API)
- `examples/melker-md/` — 13 files (markdown format)
- `examples/` root — 16 files (mixed ts/md, scattered)

**Issues:**

1. **Naming inconsistency**: Mix of `snake_case` and `kebab-case`
   - `canvas_test.melker` vs `data-bars-demo.melker`
   - `dialog_demo.melker` vs `border-title.melker`

2. **Test files mixed with demos**: `literal-test.melker`, `image_test.melker`, `canvas_test.melker` alongside showcases

3. **Duplicate/redundant files**:
   - `dialog_demo.melker` + `dialogs_demo.melker`
   - `*_demo.melker` + `*_simple.melker` pairs (combobox, select, file_browser, persistence)
   - Three analog clock variants

4. **Root-level clutter**: 16 files at root that should be organized

5. **No showcase separation**: htop, map, breakout (polished apps) mixed with basic tests

6. **Flat structure in melker/**: 80+ files with no categorization

---

## Proposed Structure

```
examples/
├── README.md
│
├── showcase/                    # Polished apps (website-featured)
│   ├── htop.melker
│   ├── map.melker
│   ├── breakout.melker
│   ├── markdown-viewer.melker
│   ├── procrastinate.melker
│   └── color-selector.melker
│
├── basics/                      # Learning progression
│   ├── hello.melker
│   ├── counter.melker
│   ├── form.melker
│   ├── dialog.melker
│   └── tabs.melker
│
├── components/                  # Component demos (one per component)
│   ├── input.melker
│   ├── textarea.melker
│   ├── combobox.melker
│   ├── select.melker
│   ├── autocomplete.melker
│   ├── command-palette.melker
│   ├── table.melker
│   ├── data-table.melker
│   ├── data-bars.melker
│   ├── slider.melker
│   ├── progress.melker
│   ├── file-browser.melker
│   ├── segment-display.melker
│   └── checkbox-radio.melker
│
├── canvas/                      # Graphics examples
│   ├── basics.melker
│   ├── analog-clock.melker
│   ├── dithering.melker
│   ├── gfx-modes.melker
│   ├── shaders/
│   │   ├── plasma.melker
│   │   ├── metaballs.melker
│   │   ├── synthwave.melker
│   │   ├── noise.melker
│   │   └── seascape.melker
│   ├── images/
│   │   └── image-demo.melker
│   └── video/
│       └── video-demo.melker
│
├── layout/                      # Flexbox and scrolling
│   ├── flex-demo.melker
│   ├── flexbox-visualizer.melker
│   ├── borders.melker
│   └── scrolling/
│
├── advanced/                    # Advanced patterns
│   ├── persistence.melker
│   ├── external-scripts.melker
│   ├── npm-imports.melker
│   ├── oauth/
│   └── bundler/
│
├── typescript/                  # TypeScript API (merge ts/ + root .ts)
│   ├── create-element/          # Low-level API
│   └── template/                # Template literal API
│
├── markdown/                    # Markdown format (rename melker-md/)
│
└── _internal/                   # Test files (hidden, sorted last)
    ├── literal-test.melker
    ├── image-test.melker
    └── ...
```

---

## Actions

### Phase 1: Standardize naming
- Rename all `snake_case` to `kebab-case`
- Remove `_demo` suffix where redundant

### Phase 2: Create showcase/
- Move: htop, map, breakout, markdown-viewer, procrastinate, color-selector
- These are the "hero" examples for the website

### Phase 3: Create basics/
- Move: hello, counter, form, dialog, tabs
- These form a learning progression

### Phase 4: Create components/
- Consolidate component demos (pick best from demo/simple pairs)
- One canonical example per component

### Phase 5: Create canvas/
- Separate shaders into subdirectory
- Group image and video examples

### Phase 6: Consolidate TypeScript
- Merge root .ts files into typescript/
- Organize by API style (createElement vs template)

### Phase 7: Create _internal/
- Move test files (files with "test" in name, minimal examples for CI)

### Phase 8: Update READMEs
- Main README with categorized index
- Each subdirectory gets a brief README

### Phase 9: Fix relative paths
- Update `src="..."` paths in moved files that reference media/ directory
- Current path from `examples/melker/`: `../../media/` (correct)
- New path from `examples/showcase/`: `../../media/` (same depth, no change needed)
- New path from `examples/canvas/shaders/`: `../../../media/` (one level deeper)
- Check: image src, video src, markdown src, external script src

**Files with media references (50+):**
- Shaders: plasma, metaballs, synthwave, seascape, fractal_tunnel, perspex_lattice
- Graphics: gfx_modes_demo, image_demo, image_demo2, checkerboard, image_shader
- Tests: sixel-test, kitty-test, hires-test
- Games: breakout
- Root: melker_demo.md, melker_video_demo.md, test_markdown.md

---

## Files to Delete (candidates)

- `dialogs_demo.melker` (duplicate of dialog_demo)
- `enterprise-analog-clock.melker` (578 lines, over-engineered joke)
- `*_simple.melker` variants if `*_demo.melker` is sufficient
- Root-level test markdown files (`test_markdown.md`, `test_markdown2.md`)

---

## Benefits

1. **Discoverability**: Clear categories help users find relevant examples
2. **Learning path**: basics/ provides ordered progression
3. **Showcase separation**: Website can link directly to showcase/
4. **Cleaner diffs**: Test files isolated in _internal/
5. **Consistent naming**: All kebab-case

---

## Status

**Completed**

- [x] Phase 1: Standardize naming (kebab-case)
- [x] Phase 2: Create showcase/
- [x] Phase 3: Create basics/
- [x] Phase 4: Create components/
- [x] Phase 5: Create canvas/
- [x] Phase 6: Consolidate TypeScript
- [x] Phase 7: Create _internal/
- [x] Phase 8: Update READMEs
- [x] Phase 9: Fix relative paths
