// I18n module exports

export type { I18n, I18nConfig } from './i18n-engine.ts';
export { I18nEngine } from './i18n-engine.ts';

export type { FlatMessages, MessageCatalog, DiscoveredLocale } from './message-loader.ts';
export { flattenMessages, parseMessages, mergeMessages, loadMessageFile, discoverLocales, discoverLocalesWithLang } from './message-loader.ts';
