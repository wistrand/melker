// Tests for the $app Proxy (missing export warnings, primitive assignment warnings)

import { assertEquals, assertThrows, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { _testing } from '../src/bundler/mod.ts';
import { enableLint } from '../src/lint.ts';

const { createAppProxy } = _testing;

// Ensure lint mode is off by default for tests
function withLintOff(fn: () => void) {
  enableLint(false);
  try {
    fn();
  } finally {
    enableLint(false);
  }
}

function withLintOn(fn: () => void) {
  enableLint(true);
  try {
    fn();
  } finally {
    enableLint(false);
  }
}

// =========================================================================
// Phase 1: Missing export detection (get trap)
// =========================================================================

Deno.test('$app proxy: accessing existing export returns value', () => {
  withLintOff(() => {
    const proxy = createAppProxy({ count: 42, name: 'test' });
    assertEquals(proxy.count, 42);
    assertEquals(proxy.name, 'test');
  });
});

Deno.test('$app proxy: accessing missing export returns undefined', () => {
  withLintOff(() => {
    const proxy = createAppProxy({ count: 42 });
    assertEquals(proxy.typo, undefined);
  });
});

Deno.test('$app proxy: missing export warns only once per key', () => {
  withLintOff(() => {
    const proxy = createAppProxy({ count: 42 });
    // Access same missing key multiple times — should not throw or crash
    proxy.typo;
    proxy.typo;
    proxy.typo;
    assertEquals(proxy.typo, undefined);
  });
});

Deno.test('$app proxy: missing export in lint mode throws', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ count: 42 });
    assertThrows(
      () => { proxy.typo; },
      Error,
      '$app.typo is not a known export',
    );
  });
});

Deno.test('$app proxy: missing export suggests similar names', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ count: 0, counter: 0, name: '' });
    try {
      proxy.conut;
      assert(false, 'should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      assert(msg.includes('Did you mean'), `Expected suggestion in: ${msg}`);
      assert(msg.includes("'count'"), `Expected 'count' in: ${msg}`);
    }
  });
});

Deno.test('$app proxy: missing export with no similar names suggests exporting', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ alpha: 1 });
    try {
      proxy.zzzzz;
      assert(false, 'should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      assert(msg.includes('Export it from <script>'), `Expected export hint in: ${msg}`);
    }
  });
});

Deno.test('$app proxy: missing export with empty exports suggests exporting', () => {
  withLintOn(() => {
    const proxy = createAppProxy({});
    try {
      proxy.anything;
      assert(false, 'should have thrown');
    } catch (e) {
      const msg = (e as Error).message;
      assert(!msg.includes('Did you mean'), `Unexpected suggestion in: ${msg}`);
      assert(msg.includes('Export it from <script>'), `Expected export hint in: ${msg}`);
    }
  });
});

Deno.test('$app proxy: skips warning for built-in properties', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ count: 42 });
    // These should NOT throw even in lint mode
    proxy.then;
    proxy.toJSON;
    proxy.toString;
    proxy.valueOf;
    proxy.constructor;
  });
});

Deno.test('$app proxy: skips warning for symbol properties', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ count: 42 });
    // Symbol access should not throw
    (proxy as any)[Symbol.toPrimitive];
    (proxy as any)[Symbol.iterator];
  });
});

// =========================================================================
// Phase 2: Primitive assignment detection (set trap)
// =========================================================================

Deno.test('$app proxy: assigning to primitive export warns (non-lint returns value)', () => {
  withLintOff(() => {
    const proxy = createAppProxy({ count: 0 });
    // Should warn but still assign
    proxy.count = 5;
    assertEquals(proxy.count, 5);
  });
});

Deno.test('$app proxy: assigning to primitive export in lint mode throws', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ count: 0 });
    assertThrows(
      () => { proxy.count = 5; },
      Error,
      'will not update the original exported variable',
    );
  });
});

Deno.test('$app proxy: primitive assignment warns only once per key', () => {
  withLintOff(() => {
    const proxy = createAppProxy({ count: 0 });
    proxy.count = 1; // warns
    proxy.count = 2; // no warn (deduplicated)
    proxy.count = 3; // no warn
    assertEquals(proxy.count, 3);
  });
});

Deno.test('$app proxy: assigning to string export warns', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ name: 'initial' });
    assertThrows(
      () => { proxy.name = 'updated'; },
      Error,
      "variable 'name'",
    );
  });
});

Deno.test('$app proxy: assigning to boolean export warns', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ visible: true });
    assertThrows(
      () => { proxy.visible = false; },
      Error,
      "variable 'visible'",
    );
  });
});

Deno.test('$app proxy: assigning to object export does NOT warn', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ state: { x: 1 } });
    // Object assignment should not throw — mutation propagates
    proxy.state = { x: 2 };
    assertEquals((proxy.state as any).x, 2);
  });
});

Deno.test('$app proxy: assigning to function export does NOT warn', () => {
  withLintOn(() => {
    const fn1 = () => 1;
    const fn2 = () => 2;
    const proxy = createAppProxy({ handler: fn1 });
    proxy.handler = fn2;
    assertEquals((proxy.handler as any)(), 2);
  });
});

Deno.test('$app proxy: assigning to array export does NOT warn', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ items: [1, 2, 3] });
    proxy.items = [4, 5];
    assertEquals((proxy.items as any).length, 2);
  });
});

Deno.test('$app proxy: assigning to null export does NOT warn', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ data: null });
    proxy.data = 'something';
    assertEquals(proxy.data, 'something');
  });
});

Deno.test('$app proxy: assigning to undefined export does NOT warn', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ data: undefined });
    proxy.data = 42;
    assertEquals(proxy.data, 42);
  });
});

Deno.test('$app proxy: assigning new ad-hoc key does NOT warn', () => {
  withLintOn(() => {
    const proxy = createAppProxy({ count: 0 });
    // New key that was never exported — no warning
    proxy.newProp = 'hello';
    assertEquals(proxy.newProp, 'hello');
  });
});

// =========================================================================
// Combined behavior
// =========================================================================

Deno.test('$app proxy: reads and writes work together', () => {
  withLintOff(() => {
    const proxy = createAppProxy({ count: 0, items: [1, 2] });

    // Read existing
    assertEquals(proxy.count, 0);

    // Write primitive (warns but works)
    proxy.count = 10;
    assertEquals(proxy.count, 10);

    // Write object (no warn)
    proxy.items = [3, 4, 5];
    assertEquals((proxy.items as any).length, 3);

    // Read missing (warns but returns undefined)
    assertEquals(proxy.typo, undefined);
  });
});

Deno.test('$app proxy: Object.keys works on proxy', () => {
  withLintOff(() => {
    const proxy = createAppProxy({ a: 1, b: 'two', c: () => {} });
    const keys = Object.keys(proxy);
    assertEquals(keys.sort(), ['a', 'b', 'c']);
  });
});

Deno.test('$app proxy: "in" operator works on proxy', () => {
  withLintOff(() => {
    const proxy = createAppProxy({ count: 0 });
    assertEquals('count' in proxy, true);
    assertEquals('missing' in proxy, false);
  });
});

Deno.test('$app proxy: merging exports after creation is visible', () => {
  withLintOff(() => {
    const exports: Record<string, unknown> = {};
    const proxy = createAppProxy(exports);

    // Simulate __mergeExports writing to backing object
    exports.count = 0;
    exports.increment = () => {};

    // Proxy should see the new keys
    assertEquals(proxy.count, 0);
    assertEquals(typeof proxy.increment, 'function');
    assertEquals('count' in proxy, true);
  });
});
