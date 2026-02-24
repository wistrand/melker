# Styling

Melker supports CSS with terminal-adapted properties.

## Inline Styles

```xml
<text style="color: cyan; font-weight: bold;">Hello</text>
```

## Style Blocks

```css
.header {
  display: flex;
  flex-direction: row;
  padding: 0 1;
  border: thin;
}
```

## Animations

```css
@keyframes pulse {
  from { opacity: 0.3; }
  to   { opacity: 1; }
}
```

## Theming

Colors adapt automatically via CSS variables. Apps don't need to hardcode colors.
