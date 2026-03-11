/**
 * Core i18n engine for Melker apps.
 *
 * Manages message catalogs, locale switching, translation lookup with
 * interpolation and pluralization, and number/date formatting.
 */

import type { FlatMessages, MessageCatalog } from './message-loader.ts';
import { mergeMessages, discoverLocalesWithLang } from './message-loader.ts';

/** Configuration for creating an I18nEngine */
export interface I18nConfig {
  /** Default/fallback locale */
  defaultLocale: string;
  /** Pre-loaded message catalogs (e.g. from inline <messages> elements) */
  catalogs?: MessageCatalog;
  /** Directory containing external message JSON files (e.g. "./messages") */
  messagesDir?: string;
}

/** Public i18n API exposed as $melker.i18n */
export interface I18n {
  /** Current locale (e.g. "en", "sv-SE") */
  locale: string;
  /** Default/fallback locale */
  readonly defaultLocale: string;
  /** Available locales (derived from loaded catalogs) */
  readonly availableLocales: string[];
  /** Translate a message key with optional interpolation params */
  t(key: string, params?: Record<string, string | number>): string;
  /** Switch locale. Returns a promise for compatibility with async file loading. */
  setLocale(locale: string): Promise<void>;
  /** Get the display name of a locale from its "_lang" key, or fall back to the locale code */
  getLanguageName(locale: string): string;
  /** Format a number per the current locale */
  formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
  /** Format a date per the current locale */
  formatDate(value: Date, options?: Intl.DateTimeFormatOptions): string;
  /** Check if a key exists in the current locale or fallback */
  has(key: string): boolean;
}

/**
 * Interpolation pattern: matches {paramName} in message strings.
 * Param names are alphanumeric + underscore.
 */
const INTERPOLATION_RE = /\{(\w+)\}/g;

export class I18nEngine implements I18n {
  locale: string;
  readonly defaultLocale: string;
  private _catalogs: MessageCatalog;
  private _discoveredLocales: Set<string> = new Set();
  private _langNames: Map<string, string> = new Map();
  private _pluralRules: Intl.PluralRules;
  private _onLocaleChange?: () => void;
  private _messagesDir: string | null;

  constructor(config: I18nConfig) {
    this.defaultLocale = config.defaultLocale;
    this.locale = config.defaultLocale;
    this._catalogs = config.catalogs ?? new Map();
    this._pluralRules = new Intl.PluralRules(this.locale);
    this._messagesDir = config.messagesDir ?? null;
  }

  get availableLocales(): string[] {
    const locales = new Set([...this._catalogs.keys(), ...this._discoveredLocales]);
    return [...locales].sort();
  }

  /**
   * Register a callback for locale changes.
   * Used internally by the engine to trigger re-renders.
   */
  onLocaleChange(callback: () => void): void {
    this._onLocaleChange = callback;
  }

  /**
   * Add or merge messages for a locale.
   * If the locale already has messages, new keys override existing ones.
   * If messages contain a "_lang" key, it is extracted as the display name.
   */
  addMessages(locale: string, messages: FlatMessages): void {
    // Extract _lang metadata before merging
    const langName = messages.get('_lang');
    if (langName) {
      this._langNames.set(locale, langName);
    }

    const existing = this._catalogs.get(locale);
    if (existing) {
      this._catalogs.set(locale, mergeMessages(existing, messages));
    } else {
      this._catalogs.set(locale, new Map(messages));
    }
  }

  /**
   * Translate a message key.
   *
   * Resolution order:
   * 1. Current locale catalog
   * 2. Default locale catalog (fallback)
   * 3. Return the key itself
   *
   * For plurals, the `count` param selects the plural form via Intl.PluralRules.
   */
  t(key: string, params?: Record<string, string | number>): string {
    let message = this._resolve(key, params);

    if (message === undefined) {
      // Key not found in any catalog -- return the key itself
      return key;
    }

    // Interpolate {param} placeholders
    if (params) {
      message = message.replace(INTERPOLATION_RE, (_match, name) => {
        const value = params[name];
        return value !== undefined ? String(value) : `{${name}}`;
      });
    }

    return message;
  }

  /**
   * Resolve a message key, handling plural forms.
   * Returns undefined if key is not found in any catalog.
   */
  private _resolve(key: string, params?: Record<string, string | number>): string | undefined {
    // If params contains 'count', try plural resolution first
    if (params && typeof params.count === 'number') {
      const category = this._pluralRules.select(params.count);
      const pluralKey = `${key}.${category}`;

      // Try plural key in current locale
      const pluralMsg = this._lookupKey(pluralKey);
      if (pluralMsg !== undefined) return pluralMsg;

      // Try 'other' as final plural fallback
      if (category !== 'other') {
        const otherMsg = this._lookupKey(`${key}.other`);
        if (otherMsg !== undefined) return otherMsg;
      }
    }

    // Try direct key lookup
    return this._lookupKey(key);
  }

  /**
   * Look up a key in current locale, then fallback locale.
   */
  private _lookupKey(key: string): string | undefined {
    // Try current locale
    const currentMessages = this._catalogs.get(this.locale);
    if (currentMessages) {
      const msg = currentMessages.get(key);
      if (msg !== undefined) return msg;
    }

    // Try default locale as fallback
    if (this.locale !== this.defaultLocale) {
      const defaultMessages = this._catalogs.get(this.defaultLocale);
      if (defaultMessages) {
        const msg = defaultMessages.get(key);
        if (msg !== undefined) return msg;
      }
    }

    return undefined;
  }

  async setLocale(locale: string): Promise<void> {
    if (locale === this.locale) return;
    this.locale = locale;
    this._pluralRules = new Intl.PluralRules(locale);
    this._onLocaleChange?.();
  }

  /**
   * Load initial external message files for the default locale (and current locale if different).
   * Called during app initialization, before first render.
   */
  async loadInitialMessages(): Promise<void> {
    if (!this._messagesDir) return;

    // Load all external message files and discover locales
    const { locales, catalogs } = await discoverLocalesWithLang(this._messagesDir);
    for (const { locale, langName } of locales) {
      this._discoveredLocales.add(locale);
      if (langName) {
        this._langNames.set(locale, langName);
      }
    }

    // Merge external catalogs (external keys override inline)
    for (const [locale, messages] of catalogs) {
      this.addMessages(locale, messages);
    }
  }

  formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.locale, options).format(value);
  }

  formatDate(value: Date, options?: Intl.DateTimeFormatOptions): string {
    return new Intl.DateTimeFormat(this.locale, options).format(value);
  }

  has(key: string): boolean {
    return this._lookupKey(key) !== undefined;
  }

  getLanguageName(locale: string): string {
    // Check cached _lang names (from inline messages, loaded files, or discovery)
    const name = this._langNames.get(locale);
    if (name) return name;

    // Check _lang key in loaded catalog
    const catalog = this._catalogs.get(locale);
    if (catalog) {
      const langKey = catalog.get('_lang');
      if (langKey) {
        this._langNames.set(locale, langKey);
        return langKey;
      }
    }

    // Fall back to locale code
    return locale;
  }
}
