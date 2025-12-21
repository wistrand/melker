# Shorthand Syntax Demo

Demonstrates shorthand type syntax for declaring elements without `type:` property lines.

## Syntax Reference

| Syntax | Element | Generated |
|--------|---------|-----------|
| `+--[Title]--+` | button | `<button title="Title" />` |
| `+--"content"--+` | text | `<text>content</text>` |
| `+--{id}--+` | input | `<input id="id" />` |
| `+--<type> content--+` | explicit | `<type title/text="content" />` |

## Example

```melker-block
+--root Shorthand Demo-------------------------------+
| : c 1 f                                            |
| +--"Welcome to the shorthand demo!"--------------+ |
| +--form------------------------------------------+ |
| | : c 1                                          | |
| | +--"Enter your name:"------------------------+ | |
| | +--{username}--------------------------------+ | |
| | +--<checkbox> Remember me--------------------+ | |
| +------------------------------------------------+ |
| +--buttons---------------------------------------+ |
| | : r 1                                          | |
| | +--[Submit]--+ +--[Cancel]--+ +--[Exit]--+     | |
| +------------------------------------------------+ |
+----------------------------------------------------+
```

```typescript
// @melker handler #submit.onClick
const input = $melker.getElementById('username');
const name = input?.getValue() ?? 'Guest';
alert('Hello, ' + name + '!');
```

```typescript
// @melker handler #cancel.onClick
const input = $melker.getElementById('username');
input?.setValue('');
```

```typescript
// @melker handler #exit.onClick
$melker.exit();
```
