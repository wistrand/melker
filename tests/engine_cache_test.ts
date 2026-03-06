import { assertEquals, assertNotEquals } from 'jsr:@std/assert';
import { EngineCache } from '../src/engine-cache.ts';

async function withTempCache(fn: (cache: EngineCache, dir: string) => Promise<void>): Promise<void> {
  const dir = await Deno.makeTempDir({ prefix: 'melker_cache_test_' });
  try {
    const cache = new EngineCache({ baseDir: dir });
    await fn(cache, dir);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test('EngineCache: read returns null for missing key', async () => {
  await withTempCache(async (cache) => {
    const result = await cache.read('ns', 'missing');
    assertEquals(result, null);
  });
});

Deno.test('EngineCache: write then read round-trip', async () => {
  await withTempCache(async (cache) => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    await cache.write('ns', 'key1', data);
    const result = await cache.read('ns', 'key1');
    assertEquals(result, data);
  });
});

Deno.test('EngineCache: delete removes entry', async () => {
  await withTempCache(async (cache) => {
    await cache.write('ns', 'key1', new Uint8Array([1, 2, 3]));
    const deleted = await cache.delete('ns', 'key1');
    assertEquals(deleted, true);
    const result = await cache.read('ns', 'key1');
    assertEquals(result, null);
  });
});

Deno.test('EngineCache: delete returns false for missing key', async () => {
  await withTempCache(async (cache) => {
    const deleted = await cache.delete('ns', 'missing');
    assertEquals(deleted, false);
  });
});

Deno.test('EngineCache: scan returns all keys', async () => {
  await withTempCache(async (cache) => {
    await cache.write('ns', 'a', new Uint8Array([1]));
    await cache.write('ns', 'b', new Uint8Array([2]));
    await cache.write('ns', 'c', new Uint8Array([3]));
    const keys = await cache.scan('ns');
    assertEquals(keys.sort(), ['a', 'b', 'c']);
  });
});

Deno.test('EngineCache: scan returns empty for nonexistent namespace', async () => {
  await withTempCache(async (cache) => {
    const keys = await cache.scan('nonexistent');
    assertEquals(keys, []);
  });
});

Deno.test('EngineCache: namespace isolation', async () => {
  await withTempCache(async (cache) => {
    await cache.write('ns1', 'key', new Uint8Array([1]));
    await cache.write('ns2', 'key', new Uint8Array([2]));
    const r1 = await cache.read('ns1', 'key');
    const r2 = await cache.read('ns2', 'key');
    assertEquals(r1, new Uint8Array([1]));
    assertEquals(r2, new Uint8Array([2]));
  });
});

Deno.test('EngineCache: keys with / create subdirectories', async () => {
  await withTempCache(async (cache, dir) => {
    await cache.write('tiles', 'osm/12/2048_1024', new Uint8Array([10, 20]));
    const result = await cache.read('tiles', 'osm/12/2048_1024');
    assertEquals(result, new Uint8Array([10, 20]));
    // Verify subdirectory was created
    const stat = await Deno.stat(`${dir}/tiles/osm/12/2048_1024.bin`);
    assertEquals(stat.isFile, true);
  });
});

Deno.test('EngineCache: LRU eviction removes oldest entries', async () => {
  await withTempCache(async (cache) => {
    // Write entries with a small budget
    const data = new Uint8Array(100);
    await cache.write('ns', 'first', data, { maxBytes: 500 });
    await cache.write('ns', 'second', data, { maxBytes: 500 });
    await cache.write('ns', 'third', data, { maxBytes: 500 });
    await cache.write('ns', 'fourth', data, { maxBytes: 500 });
    await cache.write('ns', 'fifth', data, { maxBytes: 500 });
    // Trigger eviction: 6th entry pushes over 500 bytes
    await cache.write('ns', 'sixth', data, { maxBytes: 500 });

    // After eviction to 80% (400 bytes), should have 4 entries max
    const keys = await cache.scan('ns');
    // Should have evicted oldest entries
    assertEquals(keys.length <= 4, true, `Expected <= 4 entries, got ${keys.length}`);
    // Most recent should still be there
    const sixth = await cache.read('ns', 'sixth');
    assertNotEquals(sixth, null);
  });
});

Deno.test('EngineCache: read updates LRU order', async () => {
  await withTempCache(async (cache) => {
    const data = new Uint8Array(100);
    await cache.write('ns', 'a', data, { maxBytes: 350 });
    await cache.write('ns', 'b', data, { maxBytes: 350 });
    await cache.write('ns', 'c', data, { maxBytes: 350 });

    // Read 'a' to promote it in LRU
    await cache.read('ns', 'a');

    // Write more to trigger eviction - 'b' should be evicted (oldest unreferenced)
    await cache.write('ns', 'd', data, { maxBytes: 350 });

    // 'a' should survive because it was recently read
    const a = await cache.read('ns', 'a');
    assertNotEquals(a, null, 'Recently read entry should survive eviction');
  });
});

Deno.test('EngineCache: clear removes all entries', async () => {
  await withTempCache(async (cache) => {
    await cache.write('ns', 'a', new Uint8Array([1]));
    await cache.write('ns', 'b', new Uint8Array([2]));
    const count = await cache.clear('ns');
    assertEquals(count, 2);
    const keys = await cache.scan('ns');
    assertEquals(keys, []);
  });
});

Deno.test('EngineCache: stats returns correct counts', async () => {
  await withTempCache(async (cache) => {
    await cache.write('ns', 'a', new Uint8Array([1, 2, 3]));
    await cache.write('ns', 'b', new Uint8Array([4, 5]));
    const s = await cache.stats('ns');
    assertEquals(s.entries, 2);
    assertEquals(s.totalBytes, 5);
  });
});

Deno.test('EngineCache: startup scan populates index from existing files', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'melker_cache_scan_' });
  try {
    // Write files directly (simulating previous session)
    await Deno.mkdir(`${dir}/tiles/osm/5`, { recursive: true });
    await Deno.writeFile(`${dir}/tiles/osm/5/10_12.bin`, new Uint8Array([1, 2, 3]));
    await Deno.writeFile(`${dir}/tiles/osm/5/11_12.bin`, new Uint8Array([4, 5, 6, 7]));

    // Create new cache instance (should scan existing files)
    const cache = new EngineCache({ baseDir: dir });
    const keys = await cache.scan('tiles');
    assertEquals(keys.length, 2);
    assertEquals(keys.sort(), ['osm/5/10_12', 'osm/5/11_12']);

    const s = await cache.stats('tiles');
    assertEquals(s.entries, 2);
    assertEquals(s.totalBytes, 7);

    // Should be able to read them
    const data = await cache.read('tiles', 'osm/5/10_12');
    assertEquals(data, new Uint8Array([1, 2, 3]));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test('EngineCache: handles corrupt/missing files gracefully', async () => {
  const dir = await Deno.makeTempDir({ prefix: 'melker_cache_corrupt_' });
  try {
    // Create a cache, write an entry, then delete the file externally
    const cache = new EngineCache({ baseDir: dir });
    await cache.write('ns', 'key1', new Uint8Array([1, 2, 3]));

    // Delete the file directly
    await Deno.remove(`${dir}/ns/key1.bin`);

    // Read should return null (not throw)
    const result = await cache.read('ns', 'key1');
    assertEquals(result, null);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});
