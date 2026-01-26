# Melker Examples

*Run text with meaning*

Examples demonstrating the Melker terminal UI library.

## Quick Start

```bash
# Run a .melker file
./melker.ts examples/basics/hello.melker

# Run a TypeScript example
deno run --allow-all examples/typescript/create-element/minimal-example.ts
```

## Directory Structure

```
examples/
├── showcase/        # Polished apps
├── basics/          # Learning progression
├── components/      # Component demos
├── layout/          # Flexbox, borders, scrolling
├── canvas/          # Graphics, shaders, video
├── melker/          # Scripts, advanced patterns
├── melker-md/       # Markdown format
├── typescript/      # TypeScript API examples
└── _internal/       # Test files
```

## Showcase

Polished applications demonstrating Melker's capabilities.

| App                                                       | Description                           |
|-----------------------------------------------------------|---------------------------------------|
| [htop.melker](showcase/htop.melker)                       | System monitor with CPU/memory graphs |
| [map.melker](showcase/map.melker)                         | Interactive map with OpenStreetMap tiles |
| [breakout.melker](showcase/breakout.melker)               | Classic breakout game                 |
| [markdown-viewer.melker](showcase/markdown-viewer.melker) | Markdown file viewer                  |

```bash
./melker.ts examples/showcase/htop.melker
```

## Basics

Learning progression for beginners. Start here.

| File                                            | Concepts                        |
|-------------------------------------------------|---------------------------------|
| [hello.melker](basics/hello.melker)             | Minimal app, text, button       |
| [counter.melker](basics/counter.melker)         | State, getElementById, setValue |
| [form-demo.melker](basics/form-demo.melker)     | Input fields, form layout       |
| [dialog-demo.melker](basics/dialog-demo.melker) | Modal dialogs                   |
| [tabs-demo.melker](basics/tabs-demo.melker)     | Tabbed interface                |

```bash
./melker.ts examples/basics/counter.melker
```

## Components

One canonical demo per component type.

| Component       | File                                                        |
|-----------------|-------------------------------------------------------------|
| Input           | [input.melker](components/input.melker)                     |
| Textarea        | [textarea.melker](components/textarea.melker)               |
| Select          | [select.melker](components/select.melker)                   |
| Combobox        | [combobox.melker](components/combobox.melker)               |
| Autocomplete    | [autocomplete.melker](components/autocomplete.melker)       |
| Command Palette | [command-palette.melker](components/command-palette.melker) |
| Table           | [table.melker](components/table.melker)                     |
| Data Table      | [data-table.melker](components/data-table.melker)           |
| Data Bars       | [data-bars.melker](components/data-bars.melker)             |
| Slider          | [slider.melker](components/slider.melker)                   |
| Progress        | [progress.melker](components/progress.melker)               |
| File Browser    | [file-browser.melker](components/file-browser.melker)       |
| Segment Display | [segment-display.melker](components/segment-display.melker) |

```bash
./melker.ts examples/components/slider.melker
```

## Layout

Flexbox layout, borders, and scrolling.

| File                                                        | Description                       |
|-------------------------------------------------------------|-----------------------------------|
| [flex-demo.melker](layout/flex-demo.melker)                 | Comprehensive flexbox examples    |
| [flexbox-visualizer.melker](layout/flexbox-visualizer.melker) | Interactive flexbox explorer    |
| [borders.melker](layout/borders.melker)                     | Border styles and box model       |
| [border-title.melker](layout/border-title.melker)           | Borders with title text           |
| [one-column-scroll.melker](layout/one-column-scroll.melker) | Single column scrolling           |
| [three-column-scroll.melker](layout/three-column-scroll.melker) | Multi-column scrolling        |

```bash
./melker.ts examples/layout/flex-demo.melker
```

## Canvas & Graphics

Pixel graphics, shaders, images, and video.

| Category | Examples                                                                                                                                                                         |
|----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| Basics   | [basics.melker](canvas/basics.melker), [dithering.melker](canvas/dithering.melker), [gfx-modes.melker](canvas/gfx-modes.melker)                                                  |
| Clocks   | [analog-clock.melker](canvas/analog-clock.melker), [text-analog-clock.melker](canvas/text-analog-clock.melker)                                                                   |
| Shaders  | [plasma-shader.melker](canvas/shaders/plasma-shader.melker), [metaballs.melker](canvas/shaders/metaballs.melker), [synthwave-shader.melker](canvas/shaders/synthwave-shader.melker) |
| Images   | [image-demo.melker](canvas/images/image-demo.melker), [data-url-image.melker](canvas/images/data-url-image.melker)                                                               |
| Video    | [video-demo.melker](canvas/video/video-demo.melker)                                                                                                                              |

```bash
./melker.ts examples/canvas/shaders/plasma-shader.melker
```

## TypeScript API

Programmatic usage with two API styles.

| Style         | Description                  | Example                                                            |
|---------------|------------------------------|--------------------------------------------------------------------|
| createElement | Low-level imperative API     | [minimal-example.ts](typescript/create-element/minimal-example.ts) |
| Template      | Declarative tagged templates | [template-demo.ts](typescript/template/template-demo.ts)           |

```bash
deno run --allow-all examples/typescript/create-element/minimal-example.ts
```

## Scripts & Advanced

Script integration and advanced patterns in `melker/`:

| Category | Files                                            |
|----------|--------------------------------------------------|
| Scripts  | script-demo, external-script-demo, npm-import-demo |
| Advanced | persistence-demo, oauth-login, ai-tools-demo     |

## Markdown Format

Markdown files with embedded UI in `melker-md/`:

```bash
./melker.ts examples/melker-md/counter.md
```

## Running Examples

```bash
# .melker files (direct execution)
./melker.ts examples/basics/hello.melker

# .melker files (via deno)
deno run --allow-all melker.ts examples/basics/hello.melker

# TypeScript files
deno run --allow-all examples/typescript/create-element/minimal-example.ts

# From URL
./melker.ts https://example.com/app.melker
```
