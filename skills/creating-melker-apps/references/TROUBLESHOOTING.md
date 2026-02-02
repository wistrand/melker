# Troubleshooting Guide

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `$app.functionName is not a function` | Function not exported | Add `export` keyword: `export function functionName()` |
| `$app.varName = value` doesn't update original | Primitives copied by value | Use setter function: `export function setVar(v) { varName = v; }` |
| `Cannot read properties of undefined (reading 'getValue')` | Element not found | Check element `id` matches, ensure element exists before access |
| `Permission denied` | Missing policy permission | Add required permission to `<policy>` section |
| `Deno.bundle is not a function` | Old Deno version | Update to Deno 2.5+ |
| UI doesn't update after change | Missing render call | Call `$melker.render()` after async operations |
| Button shows `[ [ Label ] ]` | Double border | Remove `border` style from button |
| Layout broken by emoji | Emoji width calculation | Avoid emojis in text content |

## Handler Issues

**Function not callable via `$app.*`:**
```xml
<!-- WRONG: not exported -->
<script>
  function myFunc() { ... }  // Can't call via $app.myFunc()
</script>

<!-- CORRECT: exported -->
<script>
  export function myFunc() { ... }  // $app.myFunc() works
</script>
```

**Element is undefined:**
```typescript
// WRONG: element might not exist
const el = $melker.getElementById('myId');
el.setValue('value');  // Error if el is undefined

// CORRECT: check before use
const el = $melker.getElementById('myId');
if (el) el.setValue('value');

// OR use optional chaining
$melker.getElementById('myId')?.setValue('value');
```

## Async/Rendering Issues

**UI not updating during async operation:**
```xml
<!-- WRONG: no intermediate render -->
<button onClick="
  await longOperation();  // UI frozen during this
  updateStatus('Done');
" />

<!-- CORRECT: render before await -->
<button onClick="
  updateStatus('Loading...');
  $melker.render();  // Show loading state
  await longOperation();
  updateStatus('Done');  // Auto-renders after handler
" />
```

## Policy/Permission Issues

**App hangs on startup (non-interactive):**
```bash
# WRONG: waits for approval prompt
./melker.ts app.melker

# CORRECT: bypass approval for CI/scripts
./melker.ts --trust app.melker
```

**Network request fails:**
```xml
<!-- Add net permission for the host -->
<policy>
{
  "permissions": {
    "net": ["api.example.com"]
  }
}
</policy>
```

**File read outside cwd fails:**
Apps without a `<policy>` tag only have read access to the current working directory. For files outside cwd:
```xml
<policy>
{
  "permissions": {
    "read": ["cwd", "/other/path"]
  }
}
</policy>
```

## Terminal Issues

**Garbled output after crash:**
```bash
# Reset terminal state
reset
# OR
stty sane
```

**Mouse not working:**
- Check terminal supports mouse reporting
- Try a different terminal (iTerm2, Alacritty, Kitty)
- Verify SSH client passes mouse events (`ssh -t`)

## Remote/Cache Issues

**Remote app not updating (stale cache):**
```bash
# Force reload remote modules
./melker.ts --reload https://example.com/app.melker
```

**Running melker.ts from remote URL with stale cache:**
```bash
# Flags before melker.ts affect the launcher, flags after affect the app
# melker.sh/melker.ts serves the latest commit from main on GitHub
deno run --allow-all --reload --no-lock https://melker.sh/melker.ts --reload app.melker

# For reproducible builds, pin to a specific version:
deno run --allow-all https://melker.sh/melker-v2026.01.1.ts app.melker  # CalVer tag
deno run --allow-all https://melker.sh/melker-abc123f.ts app.melker     # commit hash
```

**"Version not found" error:**
Non-existent versions (tags or commits) show: `Version not found: v2026.01.99`. Check available versions at https://github.com/wistrand/melker/tags

**Type checking too slow:**
```bash
# Skip type checking for faster startup
./melker.ts --no-check app.melker
```

## Debug Strategies

1. **Check the log file** - Press F12, look at log file path, then `tail -f /path/to/log`
2. **Use `--debug` flag** - Shows bundler output and retains temp files
3. **Inspect document tree** - F12 -> Inspect tab shows live element hierarchy
4. **Add strategic logging** - `$melker.logger.debug('state:', myVar)`
5. **Check policy** - F12 -> Policy tab shows effective permissions
6. **Suppress noise** - Use `--quiet` to hide Deno's download/check messages
