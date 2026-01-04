# Recipe: Taking Screenshots of Melker Apps

How to capture a screenshot of a Melker app and add it to documentation.

## Steps

### 1. Launch the app in gnome-terminal

```bash
gnome-terminal --title="App Name" -- bash -c "MELKER_THEME=fullcolor-dark deno run --allow-all melker.ts path/to/app.melker; exec bash"
```

### 2. Capture with flameshot

```bash
flameshot gui --path /path/to/output.png
```

Select the terminal window, then press Enter or click save.

### 3. Add to markdown

```markdown
![App Screenshot](screenshot.png)
```

## Example

For the showcase demo:

```bash
# Launch
gnome-terminal --title="Showcase" -- bash -c "MELKER_THEME=fullcolor-dark deno run --allow-all melker.ts examples/melker/showcase.melker; exec bash"

# Capture (select window, press Enter)
flameshot gui --path docs/showcase.png
```

Then add to README:
```markdown
![Showcase](docs/showcase.png)
```

## Notes

- Use `MELKER_THEME=fullcolor-dark` for best visual results
- The `exec bash` keeps the terminal open after the app exits
- flameshot works on both X11 and Wayland
