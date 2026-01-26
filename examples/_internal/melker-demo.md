# Melker Blocks in Markdown

This demonstrates embedding Melker UI elements directly in markdown using
fenced code blocks with the `melker` language identifier.

## Canvas/Image Example

Display an image using the canvas element:

```melker
<canvas
  src="../../media/melker-1024.png"
  width="40"
  height="15"
/>
```

## Button Example

Interactive button (note: click events work when focused):

```melker
<button label="Click Me" style="width: 15; height: 1;" />
```

## Text Example

Styled text element:

```melker
<text style="font-weight: bold; color: cyan;">
  This is styled text from a melker block!
</text>
```

## Notes

- Melker blocks are parsed and rendered as actual UI components
- Elements must be single root elements (no fragments)
- Element dimensions should be specified for proper layout
- Video elements require ffmpeg to be installed for playback
