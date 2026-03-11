# I18n Architecture

Internationalization subsystem for .melker apps. Provides two message sources (inline `<messages>` elements and external JSON files), the `@key` sigil for declarative translation references, `$melker.i18n` API, pluralization via `Intl.PluralRules`, interpolation, and locale-aware number/date formatting.

## The @key Sigil

Any text content or string attribute starting with `@` is a translation key reference. The engine resolves it to the translated string at render time:

```xml
<text>@greeting</text>
<button label="@save" />
<input placeholder="@search.hint" />
<option value="red">@colors.red</option>
<text>This is literal text, no lookup</text>
```

Inspired by Android's `@string/key` pattern. Works uniformly in text content and string attributes. Auto-propagates on locale change — the engine re-resolves all `@`-prefixed values during render.

To write a literal `@` at the start of text, escape as `@@`:

```xml
<text>@@username</text>  <!-- renders as "@username" -->
```

### Interpolation

For messages with parameters like `"greeting": "Hello, {name}!"`, pass params via the `i18n-params` attribute:

```xml
<text i18n-params='{"name": "World"}'>@greeting</text>
```

This is the only i18n-specific attribute. It applies to any element with an `@key` reference. Params can also be set programmatically:

```typescript
const el = $melker.getElementById('greet');
el.props.i18nParams = { name: userName };
// auto-render after handler resolves @greeting with new params
```

### Resolution Rules

1. Text content or attribute starts with `@@` → strip one `@`, render remainder literally
2. Text content or attribute starts with `@` → treat remainder as translation key
3. Look up key in current locale catalog
4. If not found, fall back to default locale catalog
5. If still not found, render the key itself (e.g. `"greeting"`)
6. Interpolate `{param}` placeholders with `i18n-params` values
7. For plurals, use `count` param to select plural form via `Intl.PluralRules`

## Message Sources

Messages can come from two sources, used independently or combined.

### Source 1: Inline `<messages>` Elements

Embed messages directly in the .melker file. Parsed during template parsing (like `<policy>` or `<style>`). One `<messages>` element per locale:

```xml
<melker>
  <messages lang="en">
  {
    "greeting": "Hello, {name}!",
    "items": { "one": "{count} item", "other": "{count} items" },
    "menu": { "file": "File", "edit": "Edit" }
  }
  </messages>

  <messages lang="sv">
  {
    "greeting": "Hej, {name}!",
    "items": { "one": "{count} objekt", "other": "{count} objekt" },
    "menu": { "file": "Arkiv", "edit": "Redigera" }
  }
  </messages>

  <text i18n-params='{"name": "World"}'>@greeting</text>
  <button label="@menu.edit" />
</melker>
```

The `lang` attribute is required. Content is raw JSON. The `<messages>` element is extracted during parsing and not rendered to the element tree.

Benefits: self-contained apps, no file permissions needed, works for small apps with few strings.

### Source 2: External JSON Files

External JSON files, one per locale, in a configured directory:

```
my-app.melker
messages/
  en.json
  sv.json
  de.json
```

Message file structure (`messages/en.json`):

```json
{
  "greeting": "Hello, {name}!",
  "items": {
    "one": "{count} item",
    "other": "{count} items"
  },
  "menu": {
    "file": "File",
    "edit": "Edit"
  }
}
```

- Flat or nested keys (nested objects are flattened to dot-notation: `menu.file` → `"File"`)
- `{name}` for interpolation placeholders
- Plural forms use ICU-style subkeys: `zero`, `one`, `two`, `few`, `many`, `other`
- `_lang` key (optional): display name for the language in its native script (e.g. `"_lang": "Français"`). Used by `getLanguageName()` for UI labels like locale pickers

## Configuration

### Inline-only (no config needed)

If all messages are inline, i18n activates automatically when `<messages>` elements are present. The `defaultLocale` is the first `<messages>` element's `lang`:

```xml
<melker>
  <messages lang="en">{ "save": "Save" }</messages>
  <messages lang="sv">{ "save": "Spara" }</messages>
  <button label="@save" />
</melker>
```

No policy, no permissions, no external files.

### External files (policy config)

For external message files, configure via the policy config system:

```xml
<policy>
{
  "config": {
    "i18n": {
      "defaultLocale": "en",
      "messagesDir": "./messages"
    }
  }
}
</policy>
```

### Config keys

Three config keys in `src/config/schema.json`:

| Key                  | Type     | Env var                 | Description                              |
|----------------------|----------|-------------------------|------------------------------------------|
| `i18n.locale`        | `string` | `MELKER_LOCALE`         | Override active locale                   |
| `i18n.defaultLocale` | `string` | `MELKER_DEFAULT_LOCALE` | Default/fallback locale                  |
| `i18n.messagesDir`   | `string` | `MELKER_MESSAGES_DIR`   | Directory containing locale JSON files   |

### Permissions

CWD is implicit for read in Melker's permission system. If the messages directory is within the app's project (relative path like `"./messages"`), no explicit `read` permission is needed when launching from that directory.

Explicit `read` permission is needed when:
- The messages directory is outside CWD (absolute path or launching from a different directory)
- `MELKER_MESSAGES_DIR` env var points to an external path

Inline `<messages>` elements require no permissions.

### Combined (inline + external)

Both sources can be used together. Inline messages are loaded first, then external files are merged on top. This lets apps ship with built-in defaults and allow overrides via external files:

```xml
<melker>
  <messages lang="en">{ "app.title": "My App", "save": "Save" }</messages>

  <policy>
  {
    "config": { "i18n": { "defaultLocale": "en", "messagesDir": "./messages" } }
  }
  </policy>
</melker>
```

Merge order: inline messages first, external file keys override inline keys for the same locale.

## $melker.i18n API

The `I18n` interface is exposed as `$melker.i18n` in script contexts. Defined in `src/i18n/i18n-engine.ts`:

```typescript
interface I18n {
  /** Current locale (e.g. "en", "sv-SE") */
  locale: string;

  /** Default/fallback locale */
  readonly defaultLocale: string;

  /** Available locales (derived from loaded catalogs + discovered files) */
  readonly availableLocales: string[];

  /**
   * Translate a message key with optional interpolation.
   * t("greeting", { name: "Alice" })  →  "Hello, Alice!"
   * t("items", { count: 3 })          →  "3 items" (plural)
   * t("menu.file")                    →  "File" (dot-notation)
   * t("missing.key")                  →  "missing.key" (fallback)
   */
  t(key: string, params?: Record<string, string | number>): string;

  /**
   * Switch locale. Triggers re-render, which re-resolves all @key references.
   * All external files are pre-loaded at startup, so no async I/O occurs.
   */
  setLocale(locale: string): Promise<void>;

  /** Get the display name of a locale from its "_lang" key, or fall back to the locale code */
  getLanguageName(locale: string): string;

  /** Format number per current locale using Intl.NumberFormat */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;

  /** Format date per current locale using Intl.DateTimeFormat */
  formatDate(value: Date, options?: Intl.DateTimeFormatOptions): string;

  /** Check if a key exists in current locale or fallback */
  has(key: string): boolean;
}
```

The `t()` method is for programmatic use in scripts. For markup, use the `@key` sigil instead.

`$melker.i18n` is `undefined` when no `<messages>` elements or `i18n.messagesDir` config are present.

## Message Resolution

### Lookup order

When resolving `@menu.file` or calling `t("menu.file")`:

1. Current locale catalog (`sv` → `menu.file`)
2. Default locale catalog (`en` → `menu.file`)
3. Return the key itself (`"menu.file"`)

### Plural resolution

For `@items` with `i18n-params='{"count": 3}'` or `t("items", { count: 3 })`:

1. Detect plural category via `Intl.PluralRules(locale).select(count)` → `"other"`
2. Look up `items.other` → `"{count} items"`
3. If category key missing, fall back to `items.other`
4. Interpolate `{count}` → `"3 items"`

Plural subkeys follow ICU categories: `zero`, `one`, `two`, `few`, `many`, `other`. Which categories a language uses depends on `Intl.PluralRules` for that locale.

## Internal Data Structures

Defined in `src/i18n/message-loader.ts`:

```typescript
/** Flat key-value map of resolved message strings */
type FlatMessages = Map<string, string>;

/** All loaded catalogs, keyed by locale */
type MessageCatalog = Map<string, FlatMessages>;
```

The `I18nEngine` class (in `src/i18n/i18n-engine.ts`) holds:

```typescript
class I18nEngine implements I18n {
  locale: string;                                // Current active locale
  readonly defaultLocale: string;                // Fallback locale
  private _catalogs: MessageCatalog;             // All loaded message catalogs
  private _discoveredLocales: Set<string>;       // Locales found in external files
  private _langNames: Map<string, string>;       // Cached "_lang" display names per locale
  private _pluralRules: Intl.PluralRules;        // Cached for current locale, rebuilt on setLocale()
  private _onLocaleChange?: () => void;          // Callback to trigger re-render
  private _messagesDir: string | null;           // External messages directory, or null
}
```

### Message flattening

Nested JSON is flattened on load:

```json
{ "menu": { "file": "File", "edit": "Edit" } }
```

becomes:

```
"menu.file" → "File"
"menu.edit" → "Edit"
```

Plural keys follow the same pattern: `"items.one"`, `"items.other"`.

## @key Resolution in the Render Pipeline

Resolution is implemented in `src/engine.ts` via two methods: `_resolveI18n()` and `_resolveI18nElement()`. It runs in the render pipeline after `_resolveBindings()` and before painting (called in both the standard and stdout render paths).

### Performance optimization

The engine uses a generation-based tracking system to avoid scanning all elements on every render:

1. **Full scan** — on first render, or when elements are added/removed (detected by comparing `_document.registryGeneration` against `_i18nLastFullScanGeneration`). Iterates all elements via `getAllElements()`, checks every string prop for `@` prefix.
2. **Fast path** — when no element changes occurred since last scan, only re-resolves props in `_i18nOriginals` (a `Map<elementId, Map<propName, originalValue>>`). This is O(tracked) not O(all).

### Original value tracking

The engine stores original `@key` values in `_i18nOriginals` before overwriting props with translated text. This is necessary because:
- Props are mutated in place (`element.props[key] = translatedText`)
- On re-render or locale change, the original `@key` must be re-resolved
- If a script programmatically changes a prop away from its `@key` value, the tracking entry is removed

### Element ID requirement

Only elements with an `id` attribute participate in i18n resolution. Elements without IDs are skipped by `_resolveI18nElement()`. This means anonymous elements with `@key` references will not be resolved. In practice, `@key` is primarily used on elements that scripts also reference by ID.

### Props skipped during scanning

The following prop keys are skipped (they cannot be translation keys): `style`, `id`, `bind`, `bind-mode`, `bind:selection`.

## Select/Combobox Option Labels

Filterable list components (`<select>`, `<combobox>`, `<autocomplete>`, `<command-palette>`) cache option labels from child `<option>` elements during construction. Since `@key` resolution happens at render time (after construction), the cached labels would contain the raw `@key` values.

Fix: `getAllOptions()` in `src/components/filterable-list/core.ts` re-reads labels from option elements on each call, picking up any changes from i18n resolution or scripting:

```typescript
getAllOptions(): OptionData[] {
  // ...
  // Re-read labels from option elements (may have changed via i18n or scripting)
  for (const opt of this._childOptions) {
    if (opt.element) {
      opt.label = (opt.element as OptionElement).getLabel();
    }
  }
  return [...this._childOptions, ...propOptions];
}
```

## Template Parsing

The `<messages>` element is handled in `parseMelkerFile()` in `src/template.ts`, alongside `<policy>`, `<style>`, and `<help>` extraction. The `MelkerParseResult` includes:

```typescript
interface MelkerParseResult {
  // ...
  /** Inline i18n messages from <messages lang="..."> elements, keyed by locale */
  i18nMessages?: Map<string, Record<string, unknown>>;
}
```

Parsing rules:
- `<messages>` requires a `lang` attribute; elements without `lang` are silently skipped
- Content is raw JSON parsed with `JSON.parse()`; invalid JSON is silently skipped
- `<messages>` elements are not added to the rendered element tree
- Multiple `<messages>` elements with different `lang` values create separate catalog entries

## Initialization (melker-runner.ts)

The i18n engine is created in `src/melker-runner.ts` during app startup. The sequence:

```
1. Parse template → extract <messages> elements into parseResult.i18nMessages
2. Read config: i18n.messagesDir, i18n.defaultLocale, i18n.locale
3. Determine if i18n is needed (inline messages exist OR messagesDir configured)
4. If not needed → skip, $melker.i18n is undefined
5. Determine defaultLocale:
   - Config i18n.defaultLocale (highest priority)
   - First <messages> element's lang attribute
   - "en" (final fallback)
6. Resolve messagesDir path:
   - If source is 'env' or 'cli' → resolve relative to CWD
   - Otherwise → resolve relative to source file directory
   (uses config.getSource('i18n.messagesDir') to determine origin)
7. Create I18nEngine with { defaultLocale, messagesDir }
8. Load inline messages via addMessages() (flatten nested JSON to FlatMessages)
9. Determine active locale:
   - i18n.locale config (resolves CLI flag > env var > config file)
   - Falls back to defaultLocale
10. Load ALL external message files via loadInitialMessages()
    (discovers all JSON files, loads fully, merges on top of inline)
11. Register onLocaleChange callback → engine.render()
12. Call engine.setI18nEngine(i18nEngine)
13. Attach as context.i18n for $melker.i18n access
```

### Locale detection chain

Priority (highest to lowest):

1. `MELKER_LOCALE` env var / CLI config override
2. `i18n.defaultLocale` policy config
3. First `<messages>` element's `lang` attribute
4. `"en"` hardcoded fallback

### All files loaded at startup

All external message files are loaded during `loadInitialMessages()` at startup via `discoverLocalesWithLang()`. This means `setLocale()` does no async I/O — it simply switches the active locale and triggers a re-render. The `_lang` metadata key from each file is extracted and cached for `getLanguageName()`. The `availableLocales` getter returns the union of loaded catalogs and discovered locales, sorted alphabetically.

## Module Structure

```
src/i18n/
  mod.ts              — Re-exports all public types and functions
  i18n-engine.ts      — I18nEngine class (I18n interface, t(), setLocale(), formatting)
  message-loader.ts   — Message loading, parsing, flattening, merging, file discovery
```

### message-loader.ts exports

| Function                  | Purpose                                                                      |
|---------------------------|------------------------------------------------------------------------------|
| `flattenMessages`         | Flatten nested JSON object to dot-notation FlatMessages                      |
| `parseMessages`           | Parse JSON string into FlatMessages                                          |
| `mergeMessages`           | Merge two FlatMessages maps (override wins)                                  |
| `loadMessageFile`         | Load and parse a JSON file from disk (returns undefined if not found)        |
| `discoverLocales`         | List available locale codes from a messages directory                        |
| `discoverLocalesWithLang` | Load all files in messages dir, return locale metadata + catalogs            |
| `DiscoveredLocale`        | Type: `{ locale: string; langName?: string }`                                |

### i18n-engine.ts exports

| Export        | Purpose                                                          |
|---------------|------------------------------------------------------------------|
| `I18nConfig`  | Configuration interface for creating an engine                   |
| `I18n`        | Public API interface (exposed as `$melker.i18n`)                 |
| `I18nEngine`  | Implementation class (includes `getLanguageName()`, `addMessages()`) |

## Prior Art

The `@key` sigil is inspired by Android's `@string/key` resource reference syntax:

| Framework | Syntax           | How it works                                              |
|-----------|------------------|-----------------------------------------------------------|
| Android   | `@string/save`   | Resource reference resolved at render time                |
| SwiftUI   | `Text("save")`   | Every string literal is a potential key (content-is-key)  |
| Godot     | `"SAVE"`         | Uppercase convention, auto-translate on controls          |
| XAML      | `x:Uid="Save"`   | Element identifier, system resolves properties            |
| Vue i18n  | `$t('save')`     | Function call in template interpolation                   |

The `@key` pattern was chosen over alternatives:
- **`t="key"` attribute** (XAML/Angular style) — feels like framework plumbing leaking into markup
- **Content-is-key** (SwiftUI/Godot) — ambiguity between keys and literal text
- **`$t('key')` function** (Vue/Svelte) — requires template interpolation, which Melker does not support
- **State binding** — couples translation keys to state variables, one export per string

## Usage Examples

### Inline messages (self-contained)

```xml
<melker>
  <messages lang="en">
  { "greeting": "Hello!", "save": "Save", "lang": "Language" }
  </messages>
  <messages lang="sv">
  { "greeting": "Hej!", "save": "Spara", "lang": "Språk" }
  </messages>

  <container style="flex-direction: column; gap: 1;">
    <text>@greeting</text>
    <button label="@save" />
    <container style="flex-direction: row; gap: 1;">
      <text>@lang</text>
      <select id="lang" onChange="$app.switchLang">
        <option value="en">English</option>
        <option value="sv">Svenska</option>
      </select>
    </container>
  </container>

  <script>
    export async function switchLang(event) {
      await $melker.i18n.setLocale(event.value);
    }
  </script>
</melker>
```

### Programmatic use

For dynamic content where markup sigils are insufficient (e.g. computed strings, plurals in status text):

```typescript
export function updateStatus() {
  const { i18n } = $melker;
  const count = tasks.length;
  const summary = i18n.t('tasks.count', { count });
  $melker.getElementById('summary').props.text = summary;

  // Formatted values
  const dateStr = i18n.formatDate(new Date(), { dateStyle: 'medium' });
  const numStr = i18n.formatNumber(3.14159, { maximumFractionDigits: 2 });
}
```

### External message files

```xml
<melker>
  <policy>
  {
    "config": {
      "i18n": { "defaultLocale": "en", "messagesDir": "./messages" }
    }
  }
  </policy>

  <text>@greeting</text>
  <button label="@save" />

  <script>
    export async function switchLang(event) {
      await $melker.i18n.setLocale(event.value);
    }
  </script>
</melker>
```

## Examples

Two example apps demonstrate the i18n subsystem:

- [examples/basics/i18n-basic.melker](../examples/basics/i18n-basic.melker) — Multi-language demo with 3 inline languages (en/sv/de) and 15 external languages in `i18n-basic-messages/`. Dynamic language picker populated from `availableLocales` with native names via `getLanguageName()`. Color picker using `$melker.i18n.t()` programmatically. Run with `MELKER_MESSAGES_DIR` to load external languages.
- [examples/basics/i18n-advanced.melker](../examples/basics/i18n-advanced.melker) — Task manager with pluralization (`Intl.PluralRules`), `formatDate()`, `formatNumber()`, state binding, and a language switcher select. Demonstrates `@key` sigils and `$melker.i18n.t()` working together.

### DevTools I18n Tab

When i18n is active, the DevTools panel includes an **I18n** tab showing:
- Locale picker (select) to switch the active locale
- Data table with all flattened message keys and their resolved values for the current locale
- Footer showing locale count and key count
