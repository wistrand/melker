# Melker App Examples

## Minimal Hello World

```xml
<melker>
  <container style="border: thin; padding: 1;">
    <text>Hello, World!</text>
  </container>
</melker>
```

## Counter App

```xml
<melker>
  <container style="width: 40; border: thin; padding: 2; display: flex; flex-direction: column;">
    <text style="font-weight: bold; text-align: center; margin-bottom: 2;">
      Counter App
    </text>

    <container style="display: flex; flex-direction: row; gap: 1; margin-bottom: 2;">
      <button
        id="decrementBtn"
        label="-"
        style="flex: 1;"
        onClick="
          const el = $melker.getElementById('counter');
          el.setValue(String(parseInt(el.getValue()) - 1));
        "
      />
      <text id="counter" style="width: 8; text-align: center; font-weight: bold;">0</text>
      <button
        id="incrementBtn"
        label="+"
        style="flex: 1;"
        onClick="
          const el = $melker.getElementById('counter');
          el.setValue(String(parseInt(el.getValue()) + 1));
        "
      />
    </container>

    <button onClick="$melker.getElementById('counter').setValue('0');">Reset</button>
  </container>
</melker>
```

## Form with Validation

```xml
<melker>
  <title>Registration Form</title>

  <container style="width: 50; border: thin; padding: 2; display: flex; flex-direction: column; gap: 1;">
    <text style="font-weight: bold;">User Registration</text>

    <text>Name:</text>
    <input id="name" placeholder="Enter your name" />

    <text>Email:</text>
    <input id="email" placeholder="Enter your email" />

    <text>Password:</text>
    <input id="password" placeholder="Enter password" format="password" />

    <text>Plan:</text>
    <radio id="free" title="Free Plan" name="plan" value="free" checked="true" />
    <radio id="pro" title="Pro Plan" name="plan" value="pro" />

    <checkbox id="terms" title="I agree to the terms" />

    <container style="display: flex; flex-direction: row; gap: 1; margin-top: 1;">
      <button label="Submit" onClick="
        const name = $melker.getElementById('name')?.getValue() ?? '';
        const email = $melker.getElementById('email')?.getValue() ?? '';
        const terms = $melker.getElementById('terms')?.props.checked;

        if (!name || !email) {
          alert('Please fill in all required fields');
          return;
        }
        if (!terms) {
          alert('Please agree to the terms');
          return;
        }
        alert('Registration successful: ' + name);
      " />
      <button label="Clear" onClick="
        $melker.getElementById('name')?.setValue('');
        $melker.getElementById('email')?.setValue('');
        $melker.getElementById('password')?.setValue('');
      " />
      <button label="Cancel" onClick="$melker.exit();" />
    </container>
  </container>
</melker>
```

## Dialog System

```xml
<melker>
  <script type="typescript">
    export function openDialog(id: string) {
      $melker.getElementById(id)?.show();
    }

    export function closeDialog(id: string) {
      $melker.getElementById(id)?.hide();
    }

    export function handleConfirm() {
      alert('Action confirmed!');
      closeDialog('confirm-dialog');
    }
  </script>

  <container style="width: 100%; height: 100%; padding: 2;">
    <text style="font-weight: bold; margin-bottom: 2;">Dialog Demo</text>

    <container style="display: flex; flex-direction: row; gap: 2;">
      <button label="Info" onClick="$app.openDialog('info-dialog')" />
      <button label="Confirm" onClick="$app.openDialog('confirm-dialog')" />
      <button label="Form" onClick="$app.openDialog('form-dialog')" />
    </container>

    <!-- Info Dialog -->
    <dialog id="info-dialog" title="Information"  modal="true" backdrop="true">
      <container style="padding: 1;">
        <text style="margin-bottom: 2;">This is an informational message.</text>
        <button label="OK" onClick="$app.closeDialog('info-dialog')" />
      </container>
    </dialog>

    <!-- Confirm Dialog -->
    <dialog id="confirm-dialog" title="Confirm"  modal="true" backdrop="true">
      <container style="padding: 1;">
        <text style="margin-bottom: 2;">Are you sure you want to proceed?</text>
        <container style="display: flex; flex-direction: row; gap: 1; justify-content: flex-end;">
          <button label="Cancel" onClick="$app.closeDialog('confirm-dialog')" />
          <button label="Confirm" onClick="$app.handleConfirm()" />
        </container>
      </container>
    </dialog>

    <!-- Form Dialog -->
    <dialog id="form-dialog" title="Enter Details"  modal="true" backdrop="true">
      <container style="padding: 1; display: flex; flex-direction: column; gap: 1;">
        <text>Name:</text>
        <input id="form-name" placeholder="Your name" style="width: 30;" />
        <container style="display: flex; flex-direction: row; gap: 1; justify-content: flex-end;">
          <button label="Cancel" onClick="$app.closeDialog('form-dialog')" />
          <button label="Submit" onClick="
            const name = $melker.getElementById('form-name')?.getValue();
            if (name) alert('Hello, ' + name + '!');
            $app.closeDialog('form-dialog');
          " />
        </container>
      </container>
    </dialog>
  </container>
</melker>
```

## File Browser Dialog

```xml
<melker>
  <policy>
  {
    "name": "File Opener",
    "permissions": { "read": ["*"] }
  }
  </policy>

  <script type="typescript">
    let selectedFile = '(none)';

    export function openFileBrowser() {
      $melker.getElementById('file-dialog')?.show();
    }

    export function closeFileBrowser() {
      $melker.getElementById('file-dialog')?.hide();
    }

    export function handleFileSelect(event: { path: string }) {
      selectedFile = event.path;
      closeFileBrowser();
      $melker.getElementById('selected-text')?.setValue(selectedFile);
    }
  </script>

  <container style="width: 100%; height: 100%; padding: 2;">
    <text style="font-weight: bold; margin-bottom: 1;">File Browser Demo</text>
    <button label="Open File..." onClick="$app.openFileBrowser()" />
    <text style="margin-top: 1;">Selected:</text>
    <text id="selected-text">(none)</text>

    <dialog id="file-dialog" title="Select File"  modal="true" width="70" height="20">
      <file-browser
        id="file-browser"
        selectionMode="single"
        selectType="file"
        onSelect="$app.handleFileSelect(event)"
        onCancel="$app.closeFileBrowser()"
        maxVisible="12"
      />
    </dialog>
  </container>
</melker>
```

## Tabbed Settings

```xml
<melker>
  <title>Settings</title>

  <container style="width: 60; height: 20; border: thin; padding: 1;">
    <text style="font-weight: bold; margin-bottom: 1;">Application Settings</text>

    <tabs id="settings-tabs">
      <tab title="General">
        <container style="padding: 1; display: flex; flex-direction: column; gap: 1;">
          <text>Username:</text>
          <input id="username" placeholder="Enter username" />
          <checkbox id="notifications" title="Enable notifications" checked="true" />
          <checkbox id="darkMode" title="Dark mode" />
        </container>
      </tab>

      <tab title="Advanced">
        <container style="padding: 1; display: flex; flex-direction: column; gap: 1;">
          <text>API Endpoint:</text>
          <input id="apiEndpoint" value="https://api.example.com" />
          <text>Timeout (seconds):</text>
          <input id="timeout" value="30" />
        </container>
      </tab>

      <tab title="About">
        <container style="padding: 1;">
          <text style="font-weight: bold;">My App v1.0</text>
          <text>Built with Melker</text>
        </container>
      </tab>
    </tabs>
  </container>
</melker>
```

## Data Table with Sorting

```xml
<melker>
  <title>Employee Directory</title>

  <container style="width: 100%; height: 100%; display: flex; flex-direction: column; gap: 1; padding: 1;">
    <text style="font-weight: bold;">Employee Directory</text>

    <data-table
      id="employees"
      style="width: fill; height: fill;"
      selectable="single"
      sortColumn="0"
      sortDirection="asc"
    >
    {
      "columns": [
        { "header": "ID", "width": 5, "align": "right" },
        { "header": "Name", "width": "25%" },
        { "header": "Department", "width": "20%" },
        { "header": "Status", "width": 10 },
        { "header": "Salary", "width": 12, "align": "right" }
      ],
      "rows": [
        [1, "Alice Smith", "Engineering", "Active", 95000],
        [2, "Bob Johnson", "Marketing", "Away", 72000],
        [3, "Carol Williams", "Engineering", "Active", 105000],
        [4, "David Brown", "Sales", "Active", 68000],
        [5, "Eve Davis", "HR", "Busy", 62000]
      ]
    }
    </data-table>

    <container style="display: flex; flex-direction: row; gap: 2;">
      <text>Click header to sort</text>
      <text>Arrow keys to navigate</text>
      <text>Enter to select</text>
      <button label="Exit" onClick="$melker.exit()" />
    </container>
  </container>
</melker>
```

## Command Palette App

```xml
<melker>
  <script>
    export function runCommand(value, label) {
      const status = $melker.getElementById('status');
      status.setValue('Executed: ' + label);

      switch (value) {
        case 'new':
          alert('Creating new file...');
          break;
        case 'open':
          alert('Opening file...');
          break;
        case 'save':
          alert('Saving file...');
          break;
        case 'exit':
          $melker.exit();
          break;
      }
    }
  </script>

  <container style="width: 100%; height: 100%; padding: 2;">
    <text style="font-weight: bold;">Command Palette Demo</text>
    <text style="margin-bottom: 2;">Press Ctrl+K to open command palette</text>

    <text id="status">No command executed</text>

    <command-palette onSelect="$app.runCommand(event.value, event.label)">
      <group label="File">
        <option value="new" shortcut="Ctrl+N">New File</option>
        <option value="open" shortcut="Ctrl+O">Open File</option>
        <option value="save" shortcut="Ctrl+S">Save</option>
      </group>
      <group label="Application">
        <option value="settings">Settings</option>
        <option value="exit" shortcut="Ctrl+Q">Exit</option>
      </group>
    </command-palette>
  </container>
</melker>
```

## Searchable List with Combobox

```xml
<melker>
  <script>
    export function selectItem(value, label) {
      const selected = $melker.getElementById('selected');
      selected.setValue('Selected: ' + label + ' (' + value + ')');
    }
  </script>

  <container style="width: 50; padding: 2; border: thin;">
    <text style="font-weight: bold; margin-bottom: 1;">Country Selector</text>

    <combobox
      placeholder="Search countries..."
      filter="fuzzy"
      maxVisible="6"
      onSelect="$app.selectItem(event.value, event.label)"
    >
      <group label="North America">
        <option value="us">United States</option>
        <option value="ca">Canada</option>
        <option value="mx">Mexico</option>
      </group>
      <group label="Europe">
        <option value="uk">United Kingdom</option>
        <option value="de">Germany</option>
        <option value="fr">France</option>
        <option value="es">Spain</option>
        <option value="it">Italy</option>
      </group>
      <group label="Asia">
        <option value="jp">Japan</option>
        <option value="cn">China</option>
        <option value="kr">South Korea</option>
      </group>
    </combobox>

    <text id="selected" style="margin-top: 2;">Selected: (none)</text>
  </container>
</melker>
```

## Full-Screen Layout

```xml
<melker>
  <container style="width: 100%; height: 100%; display: flex; flex-direction: column;">
    <!-- Header -->
    <container style="border-bottom: thin; padding: 1;">
      <text style="font-weight: bold;">My Application</text>
    </container>

    <!-- Main content -->
    <container style="flex: 1; display: flex; flex-direction: row;">
      <!-- Sidebar -->
      <container style="width: 20; border-right: thin; padding: 1;">
        <text style="font-weight: bold; margin-bottom: 1;">Menu</text>
        <button label="Dashboard" style="width: 100%; margin-bottom: 1;" />
        <button label="Settings" style="width: 100%; margin-bottom: 1;" />
        <button label="Help" style="width: 100%;" />
      </container>

      <!-- Content area -->
      <container style="flex: 1; padding: 2;">
        <text style="font-weight: bold; margin-bottom: 1;">Welcome</text>
        <text>Select an option from the menu.</text>
      </container>
    </container>

    <!-- Footer -->
    <container style="border-top: thin; padding: 1;">
      <text>Status: Ready</text>
    </container>
  </container>
</melker>
```

## Canvas Drawing

```xml
<melker>
  <script type="typescript">
    export function draw(canvas: any) {
      canvas.clear();

      const { width, height } = canvas.getBufferSize();
      const centerX = Math.floor(width / 2);
      const centerY = Math.floor(height / 2);

      // Draw circle
      canvas.drawCircleCorrected(centerX, centerY, 15);

      // Draw crosshairs
      canvas.drawLine(centerX - 20, centerY, centerX + 20, centerY);
      canvas.drawLine(centerX, centerY - 10, centerX, centerY + 10);

      canvas.markDirty();
    }
  </script>

  <container style="width: 100%; height: 100%; border: thin; padding: 1;">
    <text style="font-weight: bold; margin-bottom: 1;">Canvas Demo</text>

    <canvas
      id="myCanvas"
      width="60"
      height="20"
      onPaint="$app.draw(event.canvas)"
    />

    <text style="margin-top: 1;">Circle with crosshairs</text>
  </container>
</melker>
```

## Animated Shader

Per-pixel shaders for animated effects. Requires `shader: true` in policy.

```xml
<melker>
  <policy>
  {
    "permissions": { "shader": true }
  }
  </policy>

  <script type="typescript">
    export function noiseShader(
      x: number,
      y: number,
      time: number,
      resolution: { width: number; height: number; pixelAspect: number },
      _source: unknown,
      utils: {
        simplex3d: (x: number, y: number, z: number) => number;
        palette: (t: number, a: [number, number, number], b: [number, number, number], c: [number, number, number], d: [number, number, number]) => [number, number, number];
      }
    ): [number, number, number] {
      // Normalize coordinates
      const u = x / resolution.width;
      const v = y / resolution.height;

      // Scale and animate (z = time for animation)
      const scale = 4.0;
      const n = utils.simplex3d(u * scale, (v / resolution.pixelAspect) * scale, time * 0.5);

      // Map noise from [-1, 1] to [0, 1]
      const t = (n + 1) * 0.5;

      // Apply color palette (Inigo Quilez style)
      return utils.palette(t,
        [0.5, 0.5, 0.5],  // a - base
        [0.5, 0.5, 0.5],  // b - amplitude
        [1.0, 1.0, 1.0],  // c - frequency
        [0.0, 0.1, 0.2]   // d - phase (fire colors)
      );
    }
  </script>

  <container style="flex-direction: column; padding: 1; height: fill; width: fill;">
    <text style="font-weight: bold;">Animated Noise Shader</text>
    <img
      width="100%"
      height="100%"
      style="flex: 1;"
      onShader="$app.noiseShader"
      shaderFps="30"
    />
  </container>
</melker>
```

**Shader utils available:** `noise2d`, `simplex2d`, `simplex3d`, `perlin2d`, `perlin3d`, `fbm`, `fbm3d`, `palette`, `smoothstep`, `mix`, `fract`

**Aspect correction:** Divide y by `resolution.pixelAspect` (~0.5) for circles/correct shapes.

## Auto-Start with async="ready"

Use `async="ready"` scripts for initialization that needs access to rendered elements:

```xml
<melker>
  <script type="typescript">
    let intervalId: number | undefined;

    // Initialize the clock (called on ready)
    export function init() {
      const canvas = $melker.getElementById('clockCanvas');
      if (canvas) {
        drawClock(canvas);
        intervalId = setInterval(() => {
          drawClock(canvas);
          $melker.engine.render();
        }, 1000);
      }
    }

    export function drawClock(canvas: any) {
      canvas.clear();
      const now = new Date();
      const seconds = now.getSeconds();
      // Draw clock face and hands...
      canvas.markDirty();
    }
  </script>

  <!-- Ready script runs after first render -->
  <script type="typescript" async="ready">
    $app.init();
  </script>

  <container style="width: 100%; height: 100%; border: thin; padding: 1;">
    <text style="font-weight: bold; margin-bottom: 1;">Clock</text>
    <canvas id="clockCanvas" width="60" height="20" />
    <button label="Exit" onClick="$melker.exit()" />
  </container>
</melker>
```

**Note:** Functions called from `async="ready"` scripts must be exported to be accessible via `$app.*`.

## Async Data Loading

Apps that access network, files, or system commands should declare a `<policy>` section.

```xml
<melker>
  <!-- Policy required for network access -->
  <policy>
  {
    "name": "API Data Loader",
    "description": "Fetches data from an API",
    "permissions": {
      "net": ["api.example.com"]
    }
  }
  </policy>

  <script type="typescript">
    export async function loadData() {
      const status = $melker.getElementById('status');
      const result = $melker.getElementById('result');

      status.setValue('Loading...');
      $melker.render();

      try {
        const response = await fetch('https://api.example.com/data');
        const data = await response.json();
        result.setValue(JSON.stringify(data, null, 2));
        status.setValue('Loaded successfully');
      } catch (error) {
        status.setValue('Error: ' + error.message);
        result.setValue('');
      }
    }
  </script>

  <container style="width: 60; padding: 2; border: thin;">
    <text style="font-weight: bold;">API Data Loader</text>

    <button
      label="Load Data"
      style="margin: 1 0;"
      onClick="$app.loadData()"
    />

    <text id="status">Ready</text>

    <container style="border: thin; padding: 1; margin-top: 1; height: 10; overflow: auto;">
      <text id="result"></text>
    </container>
  </container>
</melker>
```

## Slider Controls

```xml
<melker>
  <script type="typescript">
    let volume = 50;
    let brightness = 75;

    export function updateVolume(event: { value: string }) {
      volume = parseFloat(event.value);
      $melker.getElementById('volumeLabel')!.setValue(`Volume: ${Math.round(volume)}%`);
    }

    export function updateBrightness(event: { value: string }) {
      brightness = parseFloat(event.value);
      $melker.getElementById('brightnessLabel')!.setValue(`Brightness: ${Math.round(brightness)}%`);
    }
  </script>

  <container style="width: 50; border: thin; padding: 2; display: flex; flex-direction: column; gap: 1;">
    <text style="font-weight: bold;">Settings</text>

    <!-- Basic slider with value display -->
    <container style="display: flex; flex-direction: row; gap: 1;">
      <text style="width: 12;">Volume:</text>
      <slider min="0" max="100" value="50" showValue="true" style="flex: 1;" onChange="$app.updateVolume(event)" />
    </container>
    <text id="volumeLabel" style="color: gray;">Volume: 50%</text>

    <!-- Slider with step -->
    <container style="display: flex; flex-direction: row; gap: 1;">
      <text style="width: 12;">Brightness:</text>
      <slider min="0" max="100" step="10" value="75" showValue="true" style="flex: 1;" onChange="$app.updateBrightness(event)" />
    </container>
    <text id="brightnessLabel" style="color: gray;">Brightness: 75%</text>

    <!-- Slider with snap points -->
    <text style="margin-top: 1;">Quality:</text>
    <slider min="0" max="100" snaps="[0, 25, 50, 75, 100]" value="50" showValue="true" />

    <button label="Close" style="margin-top: 1;" onClick="$melker.exit();" />
  </container>
</melker>
```

## Open Browser Example

Open URLs in the system browser (requires `browser: true` in policy):

```xml
<melker>
  <policy>
  {
    "name": "Link Opener",
    "permissions": {
      "browser": true
    }
  }
  </policy>

  <script type="typescript">
    export async function openLink(url: string) {
      const success = await $melker.openBrowser(url);
      if (!success) {
        alert('Failed to open browser');
      }
    }
  </script>

  <container style="width: 50; border: thin; padding: 2; display: flex; flex-direction: column; gap: 1;">
    <text style="font-weight: bold;">Links</text>
    <button label="Open GitHub" onClick="$app.openLink('https://github.com')" />
    <button label="Open Docs" onClick="$app.openLink('https://melker.sh')" />
  </container>
</melker>
```

## Tips & Best Practices

1. **Use flexbox for layouts** - `flex-direction: column` or `row` (display: flex is auto-inferred)
2. **Set explicit dimensions** - Use `width` and `height` for predictable layouts
3. **Use `fill` for full-screen** - `width: fill; height: fill;` or `100%`
4. **Group related elements** - Wrap in containers with gap/margin
5. **Use IDs for dynamic elements** - Required for `getElementById()`
6. **Export functions in scripts** - Access via `$app.functionName()`
7. **Call `$melker.render()` in async** - For intermediate state updates
8. **`console.log()` works in app code** - Automatically redirects to `$melker.logger.info()` (F12 shows log location)
9. **Avoid emojis** - They break terminal character width calculations
10. **Avoid specifying colors** - Let the theme engine handle colors; only use for canvas or intentional effects
11. **Add `<policy>` for file/network access** - Required for remote apps, recommended for all apps with external access
12. **Use `--trust` for CI/scripts** - Bypasses interactive approval prompt that would hang non-interactive environments
13. **Use `$melker.openBrowser(url)` for links** - Requires `browser: true` in policy permissions

## Advanced Examples

For more complex patterns, see these examples in the codebase:

| Example | Patterns Demonstrated |
|---------|----------------------|
| `map.melker` | Canvas `onPaint`, async tile fetching, `decodeImageBytes()`, command line args via `${argv[N]}`, variable sharing between scripts (setter functions), delaying render until async completes, `$melker.cacheDir` |
| `htop.melker` | Data table, live updates, process management |
| `analog-clock.melker` | Canvas animation, aspect ratio correction |
| `markdown_viewer.melker` | File loading, markdown rendering |
| `noise-shader-demo.melker` | Per-pixel shaders, 3D noise animation, `simplex3d`/`perlin3d`/`fbm3d`, Inigo Quilez palettes, select controls |
