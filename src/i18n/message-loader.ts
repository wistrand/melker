/**
 * Message loading and flattening for the i18n subsystem.
 *
 * Message catalogs are nested JSON objects that get flattened to dot-notation keys:
 *   { "menu": { "file": "File" } }  ->  "menu.file" = "File"
 *
 * Plural forms use ICU-style subkeys (zero, one, two, few, many, other)
 * and are kept as flat keys: "items.one", "items.other".
 */

/** Flat key-value map of resolved message strings */
export type FlatMessages = Map<string, string>;

/** All loaded catalogs, keyed by locale */
export type MessageCatalog = Map<string, FlatMessages>;

/**
 * Flatten a nested message object into dot-notation keys.
 *
 * { "menu": { "file": "File", "edit": "Edit" } }
 * becomes: "menu.file" -> "File", "menu.edit" -> "Edit"
 *
 * Plural groups like { "one": "1 item", "other": "{count} items" }
 * become: "items.one" -> "1 item", "items.other" -> "{count} items"
 */
export function flattenMessages(obj: Record<string, unknown>, prefix = ''): FlatMessages {
  const result: FlatMessages = new Map();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'string') {
      result.set(fullKey, value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = value as Record<string, unknown>;
      // Flatten regardless -- plural groups and namespaces both use dot notation
      const sub = flattenMessages(nested, fullKey);
      for (const [k, v] of sub) {
        result.set(k, v);
      }
    }
    // Skip arrays and other non-string/non-object values
  }

  return result;
}

/**
 * Parse a JSON string into a flat message map.
 * Throws if the JSON is invalid.
 */
export function parseMessages(json: string): FlatMessages {
  const obj = JSON.parse(json);
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
    throw new Error('Message file must be a JSON object');
  }
  return flattenMessages(obj as Record<string, unknown>);
}

/**
 * Merge additional messages into an existing flat map.
 * New keys override existing keys.
 */
export function mergeMessages(base: FlatMessages, override: FlatMessages): FlatMessages {
  const result = new Map(base);
  for (const [key, value] of override) {
    result.set(key, value);
  }
  return result;
}

/**
 * Load and parse a message file from disk.
 * Returns the flattened messages, or undefined if the file doesn't exist.
 */
export async function loadMessageFile(path: string): Promise<FlatMessages | undefined> {
  try {
    const content = await Deno.readTextFile(path);
    return parseMessages(content);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) {
      return undefined;
    }
    throw e;
  }
}

/**
 * Discover available locales by listing JSON files in a messages directory.
 * Returns locale codes derived from filenames (e.g. "en" from "en.json").
 */
export async function discoverLocales(messagesDir: string): Promise<string[]> {
  const locales: string[] = [];
  try {
    for await (const entry of Deno.readDir(messagesDir)) {
      if (entry.isFile && entry.name.endsWith('.json')) {
        locales.push(entry.name.slice(0, -5));
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  return locales.sort();
}

/** Locale info returned by discoverLocalesWithLang */
export interface DiscoveredLocale {
  locale: string;
  langName?: string;
}

/**
 * Discover available locales, load all message files, and extract "_lang" display names.
 */
export async function discoverLocalesWithLang(messagesDir: string): Promise<{ locales: DiscoveredLocale[], catalogs: Map<string, FlatMessages> }> {
  const locales: DiscoveredLocale[] = [];
  const catalogs: Map<string, FlatMessages> = new Map();
  try {
    for await (const entry of Deno.readDir(messagesDir)) {
      if (entry.isFile && entry.name.endsWith('.json')) {
        const locale = entry.name.slice(0, -5);
        try {
          const messages = await loadMessageFile(`${messagesDir}/${entry.name}`);
          if (messages) {
            catalogs.set(locale, messages);
            locales.push({ locale, langName: messages.get('_lang') });
          } else {
            locales.push({ locale });
          }
        } catch {
          locales.push({ locale });
        }
      }
    }
  } catch {
    // Directory doesn't exist or not readable
  }
  locales.sort((a, b) => a.locale.localeCompare(b.locale));
  return { locales, catalogs };
}
