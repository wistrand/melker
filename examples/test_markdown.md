# Markdown Test File

This file tests various markdown constructs for the Melker markdown component.

## Headings

### Level 3 Heading
#### Level 4 Heading
##### Level 5 Heading
###### Level 6 Heading

## Text Formatting

This is **bold text** and this is *italic text*.
You can also combine ***bold and italic***.
Here is some `inline code` in a sentence.

## Links

- [Internal link to CLAUDE.md](../CLAUDE.md)
- [Link to architecture docs](../agent_docs/architecture.md)
- [External link to GitHub](https://github.com)
- [Link with title](https://example.com "Example Site")

## Images

Here's an image reference using HTML img tag (default 30x15):

<img src="../media/melker-128.png" alt="Maze Image">

And with explicit dimensions (20x10):

<img src="../media/melker-128.png" alt="Small Maze" width="20" height="10">

Markdown-style image:

![Test Image](melker/test_image.png)

## Tables

### Simple Table

| Name    | Age | City       |
|---------|-----|------------|
| Alice   | 30  | New York   |
| Bob     | 25  | London     |
| Charlie | 35  | Tokyo      |

### Table with Alignment

| Left   | Center | Right |
|:-------|:------:|------:|
| L1     |   C1   |    R1 |
| L2     |   C2   |    R2 |
| L3     |   C3   |    R3 |

### Table with Code

| Command | Description |
|---------|-------------|
| `deno task dev` | Start dev server |
| `deno task test` | Run tests |
| `deno task check` | Type check |

### Table with Long Text (Wrap Test)

| Feature | Description | Status |
|---------|-------------|--------|
| Text wrapping | This is a very long description that should wrap to multiple lines within the table cell to test the wrapping functionality | Complete |
| Multi-line cells | When content exceeds the maximum column width of 30 characters, it automatically wraps to the next line | Working |
| Vertical borders | The vertical table borders continue properly through all wrapped lines of a multi-line cell row | Verified |
| Short | Brief | OK |
| File paths | `/home/user/projects/my-application/src/components/very-long-component-name.ts` | Long path |
| API endpoint | `https://api.example.com/v1/users/profile/settings/notifications/preferences` | URL test |

## Lists

### Unordered List

- First item
- Second item
  - Nested item 1
  - Nested item 2
- Third item

### Ordered List

1. First step
2. Second step
3. Third step
   1. Sub-step A
   2. Sub-step B

## Code Blocks

### JavaScript

```javascript
function greet(name) {
  console.log(`Hello, ${name}!`);
}
greet('World');
```

### TypeScript

```typescript
interface User {
  name: string;
  age: number;
}

const user: User = { name: 'Alice', age: 30 };
```

### Bash

```bash
deno run --allow-all src/melker.ts examples/melker/counter.melker
```

## Blockquotes

> This is a blockquote.
> It can span multiple lines.

> Nested blockquotes:
>> This is nested.
>>> Even deeper nesting.

## Horizontal Rules

---

Above and below are horizontal rules.

***

## Mixed Content

Here's a paragraph with **bold**, *italic*, and `code` mixed together.
It also has a [link](https://example.com) inline.

| Feature | Supported |
|---------|-----------|
| **Bold** | Yes |
| *Italic* | Yes |
| `Code` | Yes |
| [Links](url) | Partial |

## Special Characters

- Ampersand: &
- Less than: <
- Greater than: >
- Quotes: "double" and 'single'
- Backslash: \

## End of Test

This concludes the markdown test file. Navigate to [CLAUDE.md](CLAUDE.md) for project documentation.
