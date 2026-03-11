import { assertEquals } from 'jsr:@std/assert';
import { flattenMessages, parseMessages, mergeMessages, loadMessageFile, discoverLocales } from '../src/i18n/message-loader.ts';
import { I18nEngine } from '../src/i18n/i18n-engine.ts';

// --- message-loader tests ---

Deno.test('flattenMessages: flat object stays flat', () => {
  const result = flattenMessages({ save: 'Save', cancel: 'Cancel' });
  assertEquals(result.get('save'), 'Save');
  assertEquals(result.get('cancel'), 'Cancel');
  assertEquals(result.size, 2);
});

Deno.test('flattenMessages: nested keys use dot notation', () => {
  const result = flattenMessages({
    menu: { file: 'File', edit: 'Edit' },
    status: 'OK',
  });
  assertEquals(result.get('menu.file'), 'File');
  assertEquals(result.get('menu.edit'), 'Edit');
  assertEquals(result.get('status'), 'OK');
  assertEquals(result.size, 3);
});

Deno.test('flattenMessages: deeply nested', () => {
  const result = flattenMessages({
    a: { b: { c: 'deep' } },
  });
  assertEquals(result.get('a.b.c'), 'deep');
  assertEquals(result.size, 1);
});

Deno.test('flattenMessages: plural subkeys', () => {
  const result = flattenMessages({
    items: { one: '{count} item', other: '{count} items' },
  });
  assertEquals(result.get('items.one'), '{count} item');
  assertEquals(result.get('items.other'), '{count} items');
  assertEquals(result.size, 2);
});

Deno.test('flattenMessages: skips arrays and non-string values', () => {
  const result = flattenMessages({
    valid: 'yes',
    arr: [1, 2, 3] as unknown as string,
    num: 42 as unknown as string,
    nil: null as unknown as string,
  });
  assertEquals(result.get('valid'), 'yes');
  assertEquals(result.size, 1);
});

Deno.test('parseMessages: parses JSON and flattens', () => {
  const json = '{"menu": {"file": "File"}, "ok": "OK"}';
  const result = parseMessages(json);
  assertEquals(result.get('menu.file'), 'File');
  assertEquals(result.get('ok'), 'OK');
});

Deno.test('parseMessages: throws on invalid JSON', () => {
  let threw = false;
  try {
    parseMessages('not json');
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('parseMessages: throws on non-object JSON', () => {
  let threw = false;
  try {
    parseMessages('"just a string"');
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

Deno.test('mergeMessages: override keys override base', () => {
  const base = new Map([['a', '1'], ['b', '2']]);
  const override = new Map([['b', 'TWO'], ['c', '3']]);
  const result = mergeMessages(base, override);
  assertEquals(result.get('a'), '1');
  assertEquals(result.get('b'), 'TWO');
  assertEquals(result.get('c'), '3');
  assertEquals(result.size, 3);
});

// --- I18nEngine tests ---

function makeEngine() {
  const engine = new I18nEngine({ defaultLocale: 'en' });
  engine.addMessages('en', new Map([
    ['greeting', 'Hello, {name}!'],
    ['save', 'Save'],
    ['items.one', '{count} item'],
    ['items.other', '{count} items'],
    ['items.zero', 'No items'],
    ['only.en', 'English only'],
    ['status', 'Connected to {host} on port {port}'],
  ]));
  engine.addMessages('sv', new Map([
    ['greeting', 'Hej, {name}!'],
    ['save', 'Spara'],
    ['items.one', '{count} objekt'],
    ['items.other', '{count} objekt'],
    ['items.zero', 'Inga objekt'],
  ]));
  return engine;
}

Deno.test('I18nEngine: t() simple key lookup', () => {
  const engine = makeEngine();
  assertEquals(engine.t('save'), 'Save');
});

Deno.test('I18nEngine: t() interpolation', () => {
  const engine = makeEngine();
  assertEquals(engine.t('greeting', { name: 'Alice' }), 'Hello, Alice!');
});

Deno.test('I18nEngine: t() multiple interpolation params', () => {
  const engine = makeEngine();
  assertEquals(
    engine.t('status', { host: 'db.example.com', port: 5432 }),
    'Connected to db.example.com on port 5432',
  );
});

Deno.test('I18nEngine: t() missing param left as placeholder', () => {
  const engine = makeEngine();
  assertEquals(engine.t('greeting'), 'Hello, {name}!');
});

Deno.test('I18nEngine: t() missing key returns key', () => {
  const engine = makeEngine();
  assertEquals(engine.t('nonexistent.key'), 'nonexistent.key');
});

Deno.test('I18nEngine: t() plural - one', () => {
  const engine = makeEngine();
  assertEquals(engine.t('items', { count: 1 }), '1 item');
});

Deno.test('I18nEngine: t() plural - other', () => {
  const engine = makeEngine();
  assertEquals(engine.t('items', { count: 5 }), '5 items');
});

Deno.test('I18nEngine: t() plural - zero', () => {
  const engine = makeEngine();
  // English Intl.PluralRules: 0 -> "other", but we have an explicit "zero" key
  // PluralRules for "en" maps 0 to "other", so this tests the "other" fallback
  assertEquals(engine.t('items', { count: 0 }), '0 items');
});

Deno.test('I18nEngine: fallback to defaultLocale', async () => {
  const engine = makeEngine();
  await engine.setLocale('sv');
  // 'only.en' exists in en but not sv -- should fall back
  assertEquals(engine.t('only.en'), 'English only');
});

Deno.test('I18nEngine: setLocale switches translations', async () => {
  const engine = makeEngine();
  assertEquals(engine.t('save'), 'Save');
  await engine.setLocale('sv');
  assertEquals(engine.t('save'), 'Spara');
  assertEquals(engine.locale, 'sv');
});

Deno.test('I18nEngine: setLocale same locale is no-op', async () => {
  const engine = makeEngine();
  let called = false;
  engine.onLocaleChange(() => { called = true; });
  await engine.setLocale('en');
  assertEquals(called, false);
});

Deno.test('I18nEngine: setLocale fires onLocaleChange', async () => {
  const engine = makeEngine();
  let called = false;
  engine.onLocaleChange(() => { called = true; });
  await engine.setLocale('sv');
  assertEquals(called, true);
});

Deno.test('I18nEngine: plural after setLocale', async () => {
  const engine = makeEngine();
  await engine.setLocale('sv');
  assertEquals(engine.t('items', { count: 1 }), '1 objekt');
  assertEquals(engine.t('items', { count: 5 }), '5 objekt');
});

Deno.test('I18nEngine: has()', () => {
  const engine = makeEngine();
  assertEquals(engine.has('save'), true);
  assertEquals(engine.has('nonexistent'), false);
});

Deno.test('I18nEngine: has() checks fallback', async () => {
  const engine = makeEngine();
  await engine.setLocale('sv');
  assertEquals(engine.has('only.en'), true);
});

Deno.test('I18nEngine: availableLocales', () => {
  const engine = makeEngine();
  const locales = engine.availableLocales;
  assertEquals(locales.includes('en'), true);
  assertEquals(locales.includes('sv'), true);
  assertEquals(locales.length, 2);
});

Deno.test('I18nEngine: addMessages merges into existing locale', () => {
  const engine = makeEngine();
  engine.addMessages('en', new Map([['new.key', 'New'], ['save', 'Save!']]));
  assertEquals(engine.t('new.key'), 'New');
  assertEquals(engine.t('save'), 'Save!'); // overridden
  assertEquals(engine.t('greeting', { name: 'X' }), 'Hello, X!'); // still there
});

Deno.test('I18nEngine: formatNumber', () => {
  const engine = new I18nEngine({ defaultLocale: 'en' });
  const result = engine.formatNumber(1234.5);
  // en-US formats as "1,234.5"
  assertEquals(result.includes('1'), true);
  assertEquals(result.includes('234'), true);
});

Deno.test('I18nEngine: formatNumber with locale', async () => {
  const engine = new I18nEngine({ defaultLocale: 'sv' });
  const result = engine.formatNumber(1234.5);
  // sv formats with non-breaking space as thousands separator
  // Just verify it contains the digits
  assertEquals(result.includes('1'), true);
  assertEquals(result.includes('234'), true);
});

Deno.test('I18nEngine: formatDate', () => {
  const engine = new I18nEngine({ defaultLocale: 'en' });
  const date = new Date(2026, 2, 11); // March 11, 2026
  const result = engine.formatDate(date, { dateStyle: 'long' });
  assertEquals(result.includes('March'), true);
  assertEquals(result.includes('2026'), true);
});

Deno.test('I18nEngine: constructor with pre-loaded catalogs', () => {
  const catalogs = new Map([
    ['en', new Map([['hi', 'Hello']])],
    ['de', new Map([['hi', 'Hallo']])],
  ]);
  const engine = new I18nEngine({ defaultLocale: 'en', catalogs });
  assertEquals(engine.t('hi'), 'Hello');
  assertEquals(engine.availableLocales.length, 2);
});

// --- External file loading tests ---

const TEST_MESSAGES_DIR = '/tmp/melker-i18n-test-messages';

async function setupTestMessages() {
  await Deno.mkdir(TEST_MESSAGES_DIR, { recursive: true });
  await Deno.writeTextFile(`${TEST_MESSAGES_DIR}/en.json`, JSON.stringify({
    greeting: 'Hello',
    menu: { save: 'Save', open: 'Open' },
  }));
  await Deno.writeTextFile(`${TEST_MESSAGES_DIR}/sv.json`, JSON.stringify({
    greeting: 'Hej',
    menu: { save: 'Spara', open: 'Öppna' },
  }));
  await Deno.writeTextFile(`${TEST_MESSAGES_DIR}/de.json`, JSON.stringify({
    greeting: 'Hallo',
  }));
}

async function cleanupTestMessages() {
  try {
    await Deno.remove(TEST_MESSAGES_DIR, { recursive: true });
  } catch { /* ignore */ }
}

Deno.test('loadMessageFile: loads and flattens JSON', async () => {
  await setupTestMessages();
  try {
    const messages = await loadMessageFile(`${TEST_MESSAGES_DIR}/en.json`);
    assertEquals(messages?.get('greeting'), 'Hello');
    assertEquals(messages?.get('menu.save'), 'Save');
    assertEquals(messages?.get('menu.open'), 'Open');
  } finally {
    await cleanupTestMessages();
  }
});

Deno.test('loadMessageFile: returns undefined for missing file', async () => {
  const result = await loadMessageFile('/tmp/nonexistent-i18n-file.json');
  assertEquals(result, undefined);
});

Deno.test('discoverLocales: lists JSON files as locale codes', async () => {
  await setupTestMessages();
  try {
    const locales = await discoverLocales(TEST_MESSAGES_DIR);
    assertEquals(locales, ['de', 'en', 'sv']);
  } finally {
    await cleanupTestMessages();
  }
});

Deno.test('discoverLocales: returns empty for missing dir', async () => {
  const locales = await discoverLocales('/tmp/nonexistent-i18n-dir');
  assertEquals(locales, []);
});

Deno.test('I18nEngine: loadInitialMessages from messagesDir', async () => {
  await setupTestMessages();
  try {
    const engine = new I18nEngine({ defaultLocale: 'en', messagesDir: TEST_MESSAGES_DIR });
    await engine.loadInitialMessages();
    assertEquals(engine.t('greeting'), 'Hello');
    assertEquals(engine.t('menu.save'), 'Save');
  } finally {
    await cleanupTestMessages();
  }
});

Deno.test('I18nEngine: setLocale loads external file on demand', async () => {
  await setupTestMessages();
  try {
    const engine = new I18nEngine({ defaultLocale: 'en', messagesDir: TEST_MESSAGES_DIR });
    await engine.loadInitialMessages();
    assertEquals(engine.t('greeting'), 'Hello');

    await engine.setLocale('sv');
    assertEquals(engine.t('greeting'), 'Hej');
    assertEquals(engine.t('menu.save'), 'Spara');
  } finally {
    await cleanupTestMessages();
  }
});

Deno.test('I18nEngine: external messages merge with inline', async () => {
  await setupTestMessages();
  try {
    const engine = new I18nEngine({ defaultLocale: 'en', messagesDir: TEST_MESSAGES_DIR });
    // Add inline message first
    engine.addMessages('en', new Map([['greeting', 'Inline Hello'], ['extra', 'Extra']]));
    // Load external — should override 'greeting' but keep 'extra'
    await engine.loadInitialMessages();
    assertEquals(engine.t('greeting'), 'Hello'); // external overrides inline
    assertEquals(engine.t('extra'), 'Extra');     // inline-only key preserved
    assertEquals(engine.t('menu.save'), 'Save');  // external-only key available
  } finally {
    await cleanupTestMessages();
  }
});

Deno.test('I18nEngine: setLocale with missing external file uses fallback', async () => {
  await setupTestMessages();
  try {
    const engine = new I18nEngine({ defaultLocale: 'en', messagesDir: TEST_MESSAGES_DIR });
    await engine.loadInitialMessages();
    // 'fr' has no file
    await engine.setLocale('fr');
    // Falls back to defaultLocale 'en'
    assertEquals(engine.t('greeting'), 'Hello');
  } finally {
    await cleanupTestMessages();
  }
});
