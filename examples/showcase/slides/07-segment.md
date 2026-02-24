# Segment Display

```melker
<segment-display value="MELKER - Run text with meaning - Rich Terminal UI powered by Deno" renderer="pixel" scroll="true" scrollSpeed="12" style="height: 7; width: 60; color: cyan;" />
```

The `<segment-display>` component renders LCD-style digits and text.

| Renderer     | Style                           |
|--------------|---------------------------------|
| `classic`    | 7-segment LCD digits            |
| `rounded`    | Rounded Unicode segments        |
| `geometric`  | Block-style geometric glyphs    |
| `pixel`      | Bitmap font (5x7 or 5x5)       |

Supports scrolling, custom colors, and vertical orientation.
