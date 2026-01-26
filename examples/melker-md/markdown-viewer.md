# Markdown Viewer

A markdown file viewer with navigation history (back/forward).

Show README.md: `deno run --allow-all melker.ts examples/melker-md/markdown-viewer.md README.md`

To view .melker output: `deno run --allow-all melker.ts --convert examples/melker-md/markdown-viewer.md`


## Policy

The markdown viewer needs permission to read any file or url to access .md files.

```json
{
  "@melker": "policy",
  "name": "Markdown viewer",
  "permissions": {
    "read": ["*"],
    "net": ["*"]
  }
}
```

## Styles

CSS styles using standard `css` block with `/* @melker style */` directive.
Selectors target element IDs (`#header`, `#root`).

```css
/* @melker style */
#header {
    display: flex;
    flex-direction: row;
    padding-right: 1;
    border: thin;
}
#root {
    display: flex;
    flex-direction: column;
    width: fill;
    height: fill;
    border: none;
}
```

## Main Layout

The first `melker-block` is the root layout. Box name syntax: `+--id Display Name--+`
- First word = element ID (for CSS `#id` targeting)
- Rest = display name (used as document title)

Layout hints line `| : c f |` means:
- `c` = column direction (`flex-direction: column`)
- `f` = fill (`width: 100%; height: 100%`)

Child boxes `header` and `content-area` are defined as separate components below.

```melker-block
+--root Markdown Viewer - ${argv[1]}--+
| : c f                               |
| +--header-------------------------+ |
| +--content-area-------------------+ |
+-------------------------------------+
```

## Components

Components are defined with subsequent `melker-block` blocks. They're referenced
by matching the ID (first word) in the root layout.

### Header

A horizontal row (`| : r |`) containing navigation buttons and title text.
Multi-line properties are supported (e.g., `type:` on one line, `button` on next).

```melker-block
+--header------------------------------------------------------+
| : r                                                          |
| +--BackBtn-+ +--FwdBtn-+ +--Title--------+ +--ExitBtn-+      |
| | type:    | | type:   | | type: text    | | type:    |      |
| | button   | | button  | | id: title-txt | | button   |      |
| | id: back | | id: fwd | +---------------+ | id: exit |      |
| | title:   | | title:  |                   | title:   |      |
| | Back     | | Fwd     |                   | Exit     |      |
| +----------+ +---------+                   +----------+      |
+--------------------------------------------------------------+
```

### Content Area

The scrollable content area with `| : *1 |` meaning `flex: 1` (fills remaining space).
Contains a `markdown` element for rendering markdown files.

```melker-block
+--content-area------------------------------+
| : *1                                       |
| +--markdown-content----------------------+ |
| | type: markdown                         | |
| +----------------------------------------+ |
+--------------------------------------------+
```

## Properties

JSON blocks with `@target` apply properties to specific elements.
Use this for attributes that are hard to express in ASCII boxes.

Back button gets the "big" class for larger styling:

```json
{
  "@target": "#back",
  "class": "big"
}
```

Title text shows the current file with template variable and default value:

```json
{
  "@target": "#title-txt",
  "style": "font-weight: bold; flex: 1; padding-left: 1",
  "text": "${argv[1]:-README.md}"
}
```

Content area is scrollable with flex sizing:

```json
{
  "@target": "#content-area",
  "scrollable": true,
  "style": "flex: 1 1 0; padding: 1"
}
```

Markdown element loads the file and handles link clicks:

```json
{
  "@target": "#markdown-content",
  "src": "${argv[1]:-README.md}",
  "onLink": "$app.handleLink(event)",
  "style": "text-wrap: wrap"
}
```

## Event Handlers

TypeScript blocks with `// @melker handler #id.event` attach handlers to elements.
These call functions defined in the script section.

```typescript
// @melker handler #back.onClick
$app.goBack();
```

```typescript
// @melker handler #fwd.onClick
$app.goForward();
```

```typescript
// @melker handler #exit.onClick
$melker.exit();
```

## Script

Global application logic using `// @melker script` directive.
Functions are exported via `export { ... }` to be accessible from handlers via `$app`.

```typescript
// @melker script
// Navigation history
const backStack: string[] = [];
const forwardStack: string[] = [];

function updateTitle(src: string) {
  $melker.setTitle('Melker - ' + src);
}

// Navigate to a new page (called from link clicks)
function handleLink(event: { url: string }) {
  const url = event.url;
  if (url.endsWith('.md')) {
    const markdown = $melker.getElementById('markdown-content');
    if (markdown) {
      const currentSrc = markdown.props.src || '';
      // Push current page to back stack
      if (currentSrc) {
        backStack.push(currentSrc);
        // Clear forward stack on new navigation
        forwardStack.length = 0;
      }
      const currentDir = currentSrc.substring(0, currentSrc.lastIndexOf('/') + 1);
      const newSrc = url.startsWith('/') ? url : currentDir + url;
      markdown.props.src = newSrc;
      $melker.setTitle('Melker - ' + newSrc);
      $melker.render();
    }
  }
}

// Go back in history
function goBack() {
  if (backStack.length === 0) return;
  const markdown = $melker.getElementById('markdown-content');
  if (markdown) {
    const currentSrc = markdown.props.src || '';
    // Push current to forward stack
    if (currentSrc) {
      forwardStack.push(currentSrc);
    }
    // Pop from back stack
    const prevSrc = backStack.pop();
    if (prevSrc) {
      markdown.props.src = prevSrc;
      updateTitle(prevSrc);
      $melker.render();
    }
  }
}

// Go forward in history
function goForward() {
  if (forwardStack.length === 0) return;
  const markdown = $melker.getElementById('markdown-content');
  if (markdown) {
    const currentSrc = markdown.props.src || '';
    // Push current to back stack
    if (currentSrc) {
      backStack.push(currentSrc);
    }
    // Pop from forward stack
    const nextSrc = forwardStack.pop();
    if (nextSrc) {
      markdown.props.src = nextSrc;
      updateTitle(nextSrc);
      $melker.render();
    }
  }
}

export { handleLink, goBack, goForward };
```

## Syntax Reference

| Hint | Meaning |
|------|---------|
| `r` / `c` | row / column direction |
| `0`-`9` | gap value |
| `<` `=` `>` `~` | justify: start / center / end / space-between |
| `^` `-` `v` `+` | align: start / center / end / stretch |
| `*N` | flex: N |
| `f` | fill (width + height 100%) |
