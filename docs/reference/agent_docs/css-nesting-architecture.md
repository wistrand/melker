# CSS Nesting Architecture

## Summary

- Nest rules inside parent rules: `.card { .title { font-weight: bold; } }` → `.card .title`
- `&` for compound selectors: `&.active` → `.card.active`
- Works with pseudo-classes, media queries, and container queries inside nested blocks

CSS Nesting Level 1 support in the stylesheet parser, allowing rules to be nested inside parent rules.

## Syntax

```css
.card {
  width: 30;

  /* Descendant (implicit): .card .title */
  .title { font-weight: bold; }

  /* Compound via &: .card.active */
  &.active { border: double; }

  /* Child combinator via &: .card > .footer */
  & > .footer { dim: true; }

  /* Pseudo-class via &: .card:hover */
  &:hover { border: thick; }

  /* Deep nesting: .card .body .text */
  .body {
    .text { font-style: italic; }
  }

  /* Nested @media: .card with media condition */
  @media (max-width: 80) { width: 20; }

  /* Nested @container: .card with container condition */
  @container (min-width: 40) { padding: 2; }
}

/* Comma selectors: each parent gets all nested children */
.card, .panel {
  .title { font-weight: bold; }
  /* Produces: .card .title AND .panel .title */
}
```

## File Map

All changes are in a single file:

| File                                        | What                                                        |
|---------------------------------------------|-------------------------------------------------------------|
| [`src/stylesheet.ts`](../src/stylesheet.ts) | `splitBody()`, `resolveNestedSelector()`, `parseStyleBlock()` changes |
| [`tests/stylesheet_test.ts`](../tests/stylesheet_test.ts) | 24 tests covering all nesting features |
| [`examples/basics/css-nesting.melker`](../examples/basics/css-nesting.melker) | Interactive demo |

## How It Works

### Parse Pipeline

```
CSS string
    │
    ▼
tokenizeCSS()           Brace-depth tokenizer → top-level CSSBlock[]
    │
    ▼
parseStyleBlock()       Dispatches each block:
    │                     @keyframes  → parseKeyframeBlock()
    │                     @media      → recurse parseStyleBlock()
    │                     @container  → recurse parseStyleBlock()
    │                     regular     → splitBody() + recurse nested
    │
    ├─► splitBody()     Separates "width: 30; .title { ... } padding: 2;"
    │                   into properties ("width: 30; padding: 2;")
    │                   and nestedBlocks ([{ selector: ".title", body: "..." }])
    │
    ├─► resolveNestedSelector()   Resolves child selector relative to parent:
    │                               & present  → replace & with parent
    │                               & absent   → prepend parent as descendant
    │
    └─► parseStyleBlock()         Recurse: handles arbitrary nesting depth
```

### `splitBody(body)` — Body Splitting

Single-pass depth tracker that separates property declarations from nested blocks:

1. Walk the body character by character tracking brace depth
2. At depth 0, when hitting `{`: everything since the last `;` is the nested selector; everything before it is properties
3. At depth 0, when hitting `}`: emit a `CSSBlock` with the selector and inner body
4. Remaining text after the last nested block is appended to properties

```
Input:  "width: 30; .title { font-weight: bold; } padding: 2;"
                     ↑ selector   ↑ body
Output: {
  properties: "width: 30;  padding: 2;",
  nestedBlocks: [{ selector: ".title", body: "font-weight: bold;" }]
}
```

### `resolveNestedSelector(parent, child)` — Selector Resolution

String-level `&` substitution before parsing into `StyleSelector`:

| Child selector | Parent `.card` | Resolution                | Result             |
|----------------|----------------|---------------------------|--------------------|
| `.title`       | `.card`        | Prepend parent + space    | `.card .title`     |
| `& .title`     | `.card`        | Replace `&` with parent   | `.card .title`     |
| `&.active`     | `.card`        | Replace `&` with parent   | `.card.active`     |
| `& > .footer`  | `.card`        | Replace `&` with parent   | `.card > .footer`  |
| `&:hover`      | `.card`        | Replace `&` with parent   | `.card:hover`      |

Operating at the string level means `parseSelector()` handles the expanded selector normally — no changes needed to the selector parser, specificity calculation, or matching logic.

### Comma-Separated Selectors

The regular rule branch splits the selector on commas before processing:

```css
.card, .panel { width: 10; .title { font-weight: bold; } }
```

Produces 4 `StyleItem`s:
1. `.card { width: 10 }`
2. `.panel { width: 10 }`
3. `.card .title { font-weight: bold }`
4. `.panel .title { font-weight: bold }`

Each parent selector is expanded independently with all nested blocks.

### Nested At-Rules

At-rules inside a regular rule wrap the parent selector around inner rules:

```css
.card {
  @media (max-width: 80) { padding: 1; }
}
/* Equivalent to: */
@media (max-width: 80) { .card { padding: 1; } }
```

Implementation: re-wrap as `parseStyleBlock(".card { padding: 1; }")` and attach the media/container condition to each resulting item.

| Nested at-rule   | Handling                                                             |
|------------------|----------------------------------------------------------------------|
| `@media`         | Parse condition, recurse with parent selector, attach `mediaCondition` to items |
| `@container`     | Parse condition, recurse with parent selector, attach `containerCondition`, push to `containerItems` |
| `@keyframes`     | Global — parsed normally regardless of nesting context               |

### Recursion

Deep nesting works via recursion through `parseStyleBlock()`. Each nested regular rule is re-wrapped as a top-level rule with its resolved selector:

```css
.a { .b { .c { width: 1; } } }
```

1. `parseStyleBlock` sees `.a` block, calls `splitBody` → nested block `.b { .c { width: 1; } }`
2. Resolves to `.a .b`, recurses: `parseStyleBlock(".a .b { .c { width: 1; } }")`
3. `splitBody` → nested block `.c { width: 1; }`
4. Resolves to `.a .b .c`, recurses: `parseStyleBlock(".a .b .c { width: 1; }")`
5. No nested blocks → produces `StyleItem` with selector `.a .b .c`

## Specificity

No special handling needed. The resolved flat selector (e.g., `.card .title`) is parsed by `parseSelector()` and its specificity is computed by `selectorSpecificity()` — both already support multi-segment selectors of any depth.

## Test Coverage

24 tests in `tests/stylesheet_test.ts`:

**Comma selectors (5):** multiple items, shared style, element matching, compound selectors, single selector regression

**Nesting (13):** basic nesting, `&` descendant, `&` compound, `&` child combinator, `&:hover`, deep nesting (3 levels), properties before/after blocks, multiple nested blocks, comma parent + child, empty blocks, no direct properties, element matching, type selectors, complex parent

**Nested at-rules (6):** `@media` inside rule, `@media` with nested rule inside, `@container` inside rule, `@keyframes` inside rule (global), `@media` element matching
