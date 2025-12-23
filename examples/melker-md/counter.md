# Counter App

A simple counter demonstrating the melker-block markdown syntax.

## Styles

```css
/* @melker style */
#count {
  font-weight: bold;
  text-align: center;
}
.header {
  border-bottom: thin;
  padding-bottom: 1;
}
```

## Main Layout

```melker-block
+--App-----------------------------------+
| style: border: thin; padding: 1        |
| +--Header----------------------------+ |
| +--Counter---------------------------+ |
+----------------------------------------+
```

## Components

### Header

```melker-block
+--Header----------------------------+
| class: header                      |
| +--Title-------------------------+ |
| | type: text                     | |
| | text: Counter App              | |
| +--------------------------------+ |
+------------------------------------+
```

### Counter

```melker-block
+--Counter---------------------------------------+
| : r 1 =                                        |
| +--DecBtn--+ +--Display----+ +--IncBtn--+      |
| | type:    | | : *1        | | type:    |      |
| | button   | | type: text  | | button   |      |
| | id: dec  | | id: count   | | id: inc  |      |
| | title: - | | text: 0     | | title: + |      |
| +----------+ +-------------+ +----------+      |
+------------------------------------------------+
```

## Script

```typescript
// @melker script
let count = 0;

function update() {
  const el = $melker.getElementById('count');
  if (el) {
    el.props.text = String(count);
    $melker.render();
  }
}

function inc() {
  count++;
  update();
}

function dec() {
  count--;
  update();
}

export { inc, dec, update };
```

## Event Handlers

```typescript
// @melker handler #dec.onClick
$app.dec();
```

```typescript
// @melker handler #inc.onClick
$app.inc();
```

## Notes

This file demonstrates:
- `melker-block` for layout (first block is root, rest are components)
- Box name syntax: `+--id Display Name--+` (first word = ID, rest = title)
- `css` with `/* @melker style */` for styling
- `typescript` with `// @melker script` for application logic
- `typescript` with `// @melker handler #id.event` for event handlers
- Compact layout hints (`: r 1 =` for row, gap 1, justify center)
