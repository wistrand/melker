# Recipe: Taking Screenshots of Melker Apps

How to capture a screenshot of a Melker app and add it to documentation.

## Steps

### 1. Launch the app in gnome-terminal

```bash
gnome-terminal --title="App Name" -- bash -c "MELKER_THEME=fullcolor-dark deno run --allow-all melker.ts path/to/app.melker; exec bash"
```

### 2. Wait for render

```bash
sleep 2
```

### 3. Capture the window

```bash
gnome-screenshot -w -f /path/to/output.png
```

Options:
- `-w` captures the focused window
- `-f` specifies output file path

### 4. Add to markdown

```markdown
<img src="screenshot.png" alt="App Screenshot" />
```

## Example

For the color selector demo:

```bash
# Launch
gnome-terminal --title="Color Selector Demo" -- bash -c "MELKER_THEME=fullcolor-dark deno run --allow-all melker.ts examples/melker-md/color_selector.md; exec bash"

# Wait
sleep 2

# Capture
gnome-screenshot -w -f examples/melker-md/color_selector.png
```

Then add to the markdown file:
```markdown
<img src="color_selector.png" alt="Color Selector Screenshot" />
```

## Notes

- Use `MELKER_THEME=fullcolor-dark` for best visual results in screenshots
- The `exec bash` keeps the terminal open after the app exits
- Place the PNG next to the markdown file for relative path references
