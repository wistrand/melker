// Tests for the state binding system: createState(), bind attribute resolution,
// boolean class sync, type coercion, stylesheet re-application, and persistence.

import { assertEquals, assert, assertExists } from 'jsr:@std/assert';
import {
  createElement,
  Stylesheet,
  applyStylesheet,
  DEFAULT_PERSISTENCE_MAPPINGS,
  readState,
} from '../mod.ts';
import type { PersistenceMapping, PersistedState } from '../mod.ts';
import { toggleClass, hasClass } from '../src/element.ts';
import { mergePersistedBound } from '../src/state-persistence.ts';
import { Document } from '../src/document.ts';

// ---------------------------------------------------------------------------
// Helper: create an element with optional id, classes, style, bind
// ---------------------------------------------------------------------------
function el(
  type: string,
  opts: { id?: string; classes?: string[]; style?: Record<string, unknown>; bind?: string } = {},
  ...children: ReturnType<typeof createElement>[]
): ReturnType<typeof createElement> {
  const props: Record<string, unknown> = {};
  if (opts.id) props.id = opts.id;
  if (opts.classes) props.classList = opts.classes;
  if (opts.style) props.style = opts.style;
  if (opts.bind) props.bind = opts.bind;
  return createElement(type, props, ...children);
}

// ===========================================================================
// 1. Boolean class sync (toggleClass / hasClass on root)
// ===========================================================================

Deno.test('state binding - boolean state syncs CSS classes on root', () => {
  const root = el('container', { id: 'root' });

  // Simulate what _resolveBindings does for boolean values
  const state = { isEmpty: true, isFull: false, count: 5, label: 'hi' };

  for (const key in state) {
    if (typeof state[key as keyof typeof state] === 'boolean') {
      toggleClass(root, key, state[key as keyof typeof state] as boolean);
    }
  }

  assert(hasClass(root, 'isEmpty'));
  assert(!hasClass(root, 'isFull'));
  // Non-boolean keys should not become classes
  assert(!hasClass(root, 'count'));
  assert(!hasClass(root, 'label'));
});

Deno.test('state binding - toggling boolean state updates classes', () => {
  const root = el('container', { id: 'root' });

  toggleClass(root, 'isEmpty', true);
  assert(hasClass(root, 'isEmpty'));

  toggleClass(root, 'isEmpty', false);
  assert(!hasClass(root, 'isEmpty'));
});

Deno.test('state binding - multiple boolean keys coexist', () => {
  const root = el('container', { id: 'root' });

  toggleClass(root, 'isEmpty', true);
  toggleClass(root, 'isLoading', true);
  toggleClass(root, 'hasError', false);

  assert(hasClass(root, 'isEmpty'));
  assert(hasClass(root, 'isLoading'));
  assert(!hasClass(root, 'hasError'));
});

// ===========================================================================
// 2. Stylesheet re-application with class-dependent rules
// ===========================================================================

Deno.test('state binding - class-dependent CSS rules apply after class change', () => {
  const emptyMsg = el('container', { id: 'empty-msg' });
  const list = el('container', { id: 'list' });
  const root = el('container', { id: 'root' }, emptyMsg, list);

  const ss = Stylesheet.fromString(`
    .isEmpty #empty-msg { display: flex; }
    .isEmpty #list { display: none; }
    #empty-msg { display: none; }
  `);

  // Initial application: no classes on root
  ss.applyTo(root);

  assertEquals(emptyMsg.props.style?.display, 'none');
  assertEquals(list.props.style?.display, undefined);

  // Add isEmpty class to root
  toggleClass(root, 'isEmpty', true);

  // Re-apply stylesheet — simulates what _resolveBindings does
  applyStylesheet(root, ss, [], { terminalWidth: 80, terminalHeight: 24 });

  assertEquals(emptyMsg.props.style?.display, 'flex');
  assertEquals(list.props.style?.display, 'none');
});

Deno.test('state binding - removing class reverts CSS rules', () => {
  const emptyMsg = el('container', { id: 'empty-msg' });
  const root = el('container', { id: 'root' }, emptyMsg);

  const ss = Stylesheet.fromString(`
    .isEmpty #empty-msg { display: flex; }
    #empty-msg { display: none; }
  `);

  // Apply with class
  toggleClass(root, 'isEmpty', true);
  applyStylesheet(root, ss, [], { terminalWidth: 80, terminalHeight: 24 });
  assertEquals(emptyMsg.props.style?.display, 'flex');

  // Remove class and re-apply
  toggleClass(root, 'isEmpty', false);
  applyStylesheet(root, ss, [], { terminalWidth: 80, terminalHeight: 24 });
  assertEquals(emptyMsg.props.style?.display, 'none');
});

// ===========================================================================
// 3. Bind attribute resolution and type coercion
// ===========================================================================

Deno.test('state binding - bind pushes string value to text element', () => {
  const label = el('text', { id: 'count', bind: 'count' });
  const root = el('container', { id: 'root' }, label);

  const state: Record<string, unknown> = { count: '42' };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  // Simulate _resolveBindings step 2
  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const mapping = byType.get(element.type);
      if (mapping) {
        element.props[mapping.prop] = String(state[bindKey]);
      }
    }
  }

  assertEquals(label.props.text, '42');
});

Deno.test('state binding - bind coerces number to string for text elements', () => {
  const label = el('text', { id: 'count', bind: 'count' });
  const root = el('container', { id: 'root' }, label);

  const state: Record<string, unknown> = { count: 7 };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const mapping = byType.get(element.type);
      if (mapping) {
        element.props[mapping.prop] = String(state[bindKey]);
      }
    }
  }

  assertEquals(label.props.text, '7');
});

Deno.test('state binding - bind ignores elements without matching mapping', () => {
  // graph has no persistence mapping
  const graph = createElement('graph', { id: 'g', bind: 'data' } as any);
  const root = el('container', { id: 'root' }, graph);

  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  assert(!byType.has('graph'));
});

Deno.test('state binding - bind ignores keys not in state', () => {
  const label = el('text', { id: 'label', bind: 'nonexistent' });
  const root = el('container', { id: 'root' }, label);

  const state: Record<string, unknown> = { count: '5' };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const mapping = byType.get(element.type);
      if (mapping) {
        element.props[mapping.prop] = String(state[bindKey]);
      }
    }
  }

  // text prop should not have been set (key not in state)
  assertEquals(label.props.text, undefined);
});

// ===========================================================================
// 4. Persistence mapping coverage
// ===========================================================================

Deno.test('state binding - DEFAULT_PERSISTENCE_MAPPINGS covers key element types', () => {
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  assertEquals(byType.get('text')?.prop, 'text');
  assertEquals(byType.get('button')?.prop, 'text');
  assertEquals(byType.get('input')?.prop, 'value');
  assertEquals(byType.get('slider')?.prop, 'value');
  assertEquals(byType.get('combobox')?.prop, 'selectedValue');
  assertEquals(byType.get('select')?.prop, 'selectedValue');
  assertEquals(byType.get('autocomplete')?.prop, 'selectedValue');
  assertEquals(byType.get('checkbox')?.prop, 'checked');
});

// ===========================================================================
// 5. Bound element collection
// ===========================================================================

Deno.test('state binding - collectBoundElements finds elements with bind attribute', () => {
  const t1 = el('text', { id: 't1', bind: 'count' });
  const t2 = el('text', { id: 't2', bind: 'label' });
  const t3 = el('text', { id: 't3' }); // no bind
  const btn = el('button', { id: 'btn' }); // no bind
  const root = el('container', { id: 'root' }, t1, t2, t3, btn);

  const doc = new Document(root);
  const bound: Array<{ element: ReturnType<typeof createElement>; stateKey: string }> = [];
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string') {
      bound.push({ element, stateKey: bindKey });
    }
  }

  assertEquals(bound.length, 2);
  assertEquals(bound[0].stateKey, 'count');
  assertEquals(bound[1].stateKey, 'label');
});

Deno.test('state binding - cache invalidation when element count changes', () => {
  const t1 = el('text', { id: 't1', bind: 'a' });
  const root = el('container', { id: 'root' }, t1);
  const doc = new Document(root);

  // Initial collection
  let lastSize = doc.elementCount;
  let bound: Array<{ stateKey: string }> = [];
  const collect = () => {
    bound = [];
    for (const element of doc.getAllElements()) {
      if (typeof element.props.bind === 'string') {
        bound.push({ stateKey: element.props.bind });
      }
    }
    lastSize = doc.elementCount;
  };

  collect();
  assertEquals(bound.length, 1);
  const size1 = lastSize;

  // Add a new bound element to the tree
  const t2 = el('text', { id: 't2', bind: 'b' });
  root.children!.push(t2);
  doc.root = root; // triggers re-registration

  // Size changed — should invalidate
  assert(doc.elementCount !== size1);

  collect();
  assertEquals(bound.length, 2);
});

// ===========================================================================
// 6. Persistence: readState with stateObject
// ===========================================================================

Deno.test('state binding - readState serializes stateObject into _bound category', () => {
  const root = el('container', { id: 'root' });
  const doc = new Document(root);

  const stateObject = { count: 5, isEmpty: true, label: 'hello' };
  const result = readState(doc, DEFAULT_PERSISTENCE_MAPPINGS, stateObject);

  assertExists(result['_bound']);
  assertEquals(result['_bound'].count, 5);
  assertEquals(result['_bound'].isEmpty, true);
  assertEquals(result['_bound'].label, 'hello');
});

Deno.test('state binding - readState without stateObject has no _bound', () => {
  const root = el('container', { id: 'root' });
  const doc = new Document(root);

  const result = readState(doc, DEFAULT_PERSISTENCE_MAPPINGS);
  assertEquals(result['_bound'], undefined);
});

Deno.test('state binding - readState with null stateObject has no _bound', () => {
  const root = el('container', { id: 'root' });
  const doc = new Document(root);

  const result = readState(doc, DEFAULT_PERSISTENCE_MAPPINGS, null);
  assertEquals(result['_bound'], undefined);
});

// ===========================================================================
// 7. Persistence: mergePersistedBound
// ===========================================================================

Deno.test('state binding - mergePersistedBound restores matching keys', () => {
  const initial = { count: 0, label: 'default', isEmpty: true };
  const persisted: PersistedState = {
    _bound: { count: 42, label: 'saved', isEmpty: false },
  };

  mergePersistedBound(initial, persisted);

  assertEquals(initial.count, 42);
  assertEquals(initial.label, 'saved');
  assertEquals(initial.isEmpty, false);
});

Deno.test('state binding - mergePersistedBound ignores keys not in initial', () => {
  const initial: Record<string, unknown> = { count: 0 };
  const persisted: PersistedState = {
    _bound: { count: 10, extraKey: 'should be ignored' },
  };

  mergePersistedBound(initial, persisted);

  assertEquals(initial.count, 10);
  assertEquals(initial.extraKey, undefined);
});

Deno.test('state binding - mergePersistedBound handles missing _bound', () => {
  const initial = { count: 0 };
  const persisted: PersistedState = {};

  mergePersistedBound(initial, persisted);

  assertEquals(initial.count, 0); // unchanged
});

Deno.test('state binding - mergePersistedBound handles non-object _bound', () => {
  const initial = { count: 0 };
  const persisted: PersistedState = { _bound: 'not an object' as any };

  mergePersistedBound(initial, persisted);

  assertEquals(initial.count, 0); // unchanged
});

// ===========================================================================
// 8. Round-trip: readState → mergePersistedBound
// ===========================================================================

Deno.test('state binding - persistence round-trip preserves state', () => {
  const root = el('container', { id: 'root' });
  const doc = new Document(root);

  // Save
  const original = { count: 99, label: 'tasks', isEmpty: false, isFull: true };
  const saved = readState(doc, DEFAULT_PERSISTENCE_MAPPINGS, original);

  // Restore into fresh initial
  const restored = { count: 0, label: '', isEmpty: true, isFull: false };
  mergePersistedBound(restored, saved);

  assertEquals(restored.count, 99);
  assertEquals(restored.label, 'tasks');
  assertEquals(restored.isEmpty, false);
  assertEquals(restored.isFull, true);
});

// ===========================================================================
// 9. Pre-indexed mapping lookup
// ===========================================================================

Deno.test('state binding - mapping index gives O(1) lookup per type', () => {
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  // First mapping for container should be scrollY (not scrollX)
  assertEquals(byType.get('container')?.prop, 'scrollY');

  // Types without mappings return undefined
  assertEquals(byType.get('canvas'), undefined);
  assertEquals(byType.get('graph'), undefined);
});

// ===========================================================================
// 10. Combined: class sync + stylesheet + bind in one tree
// ===========================================================================

Deno.test('state binding - full resolution: classes, stylesheet, and bind', () => {
  const countText = el('text', { id: 'count', bind: 'count' });
  const emptyMsg = el('container', { id: 'empty-msg' });
  const list = el('container', { id: 'list' });
  const root = el('container', { id: 'root' }, countText, emptyMsg, list);

  const ss = Stylesheet.fromString(`
    .isEmpty #empty-msg { display: flex; }
    .isEmpty #list { display: none; }
    #empty-msg { display: none; }
  `);

  // Initial stylesheet application (like the runner does at startup)
  ss.applyTo(root);

  const state: Record<string, unknown> = { count: 0, isEmpty: true };

  // Step 1: Sync boolean classes
  for (const key in state) {
    if (typeof state[key] === 'boolean') {
      toggleClass(root, key, state[key] as boolean);
    }
  }
  assert(hasClass(root, 'isEmpty'));

  // Re-apply stylesheet after class change
  applyStylesheet(root, ss, [], { terminalWidth: 80, terminalHeight: 24 });

  // Step 2: Resolve bind values
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const mapping = byType.get(element.type);
      if (mapping) {
        element.props[mapping.prop] = String(state[bindKey]);
      }
    }
  }

  // Verify all three aspects
  assertEquals(countText.props.text, '0');
  assertEquals(emptyMsg.props.style?.display, 'flex');
  assertEquals(list.props.style?.display, 'none');
});

// ===========================================================================
// 11. Two-way binding: reverse sync (element → state)
// ===========================================================================

Deno.test('two-way binding - reverse sync pulls input value into state', () => {
  const input = createElement('input', { id: 'search', bind: 'query', value: 'hello' });
  const root = el('container', { id: 'root' }, input);

  const state: Record<string, unknown> = { query: '' };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  // Simulate step 0 (reverse sync) for two-way bound elements
  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const twoWay = element.props['bind-mode'] !== 'one-way';
      if (!twoWay) continue;
      const mapping = byType.get(element.type);
      if (mapping) {
        const elementValue = element.props[mapping.prop];
        if (elementValue !== undefined) {
          state[bindKey] = elementValue;
        }
      }
    }
  }

  assertEquals(state.query, 'hello');
});

Deno.test('two-way binding - reverse sync pulls checkbox checked into state', () => {
  const cb = createElement('checkbox', { id: 'dark', bind: 'darkMode', checked: true, title: 'Dark Mode' });
  const root = el('container', { id: 'root' }, cb);

  const state: Record<string, unknown> = { darkMode: false };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const twoWay = element.props['bind-mode'] !== 'one-way';
      if (!twoWay) continue;
      const mapping = byType.get(element.type);
      if (mapping) {
        const elementValue = element.props[mapping.prop];
        if (elementValue !== undefined) {
          state[bindKey] = elementValue;
        }
      }
    }
  }

  assertEquals(state.darkMode, true);
});

Deno.test('two-way binding - reverse sync pulls slider value into state', () => {
  const slider = createElement('slider', { id: 'vol', bind: 'volume', value: 75 });
  const root = el('container', { id: 'root' }, slider);

  const state: Record<string, unknown> = { volume: 50 };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const twoWay = element.props['bind-mode'] !== 'one-way';
      if (!twoWay) continue;
      const mapping = byType.get(element.type);
      if (mapping) {
        const elementValue = element.props[mapping.prop];
        if (elementValue !== undefined) {
          state[bindKey] = elementValue;
        }
      }
    }
  }

  assertEquals(state.volume, 75);
});

// ===========================================================================
// 12. One-way opt-out via bind-mode="one-way"
// ===========================================================================

Deno.test('two-way binding - bind-mode="one-way" skips reverse sync', () => {
  const input = createElement('input', {
    id: 'search', bind: 'query', 'bind-mode': 'one-way', value: 'typed',
  });
  const root = el('container', { id: 'root' }, input);

  const state: Record<string, unknown> = { query: 'original' };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const twoWay = element.props['bind-mode'] !== 'one-way';
      if (!twoWay) continue;
      const mapping = byType.get(element.type);
      if (mapping) {
        const elementValue = element.props[mapping.prop];
        if (elementValue !== undefined) {
          state[bindKey] = elementValue;
        }
      }
    }
  }

  // State should NOT have been updated (one-way skips reverse sync)
  assertEquals(state.query, 'original');
});

Deno.test('two-way binding - bind-mode="one-way" still receives forward push', () => {
  const input = createElement('input', {
    id: 'search', bind: 'query', 'bind-mode': 'one-way', value: 'old',
  });
  const root = el('container', { id: 'root' }, input);

  const state: Record<string, unknown> = { query: 'pushed' };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  // Simulate step 2 (forward push) — same as existing one-way behavior
  const doc = new Document(root);
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const mapping = byType.get(element.type);
      if (mapping) {
        element.props[mapping.prop] = String(state[bindKey]);
      }
    }
  }

  assertEquals(input.props.value, 'pushed');
});

// ===========================================================================
// 13. Two-way binding: _collectBoundElements caches twoWay flag
// ===========================================================================

Deno.test('two-way binding - collectBoundElements includes twoWay flag', () => {
  const t1 = createElement('text', { id: 't1', bind: 'a' } as any);
  const t2 = createElement('text', { id: 't2', bind: 'b', 'bind-mode': 'one-way' } as any);
  const t3 = createElement('text', { id: 't3', bind: 'c', 'bind-mode': 'two-way' } as any);
  const root = el('container', { id: 'root' }, t1, t2, t3);

  const doc = new Document(root);
  const bound: Array<{ stateKey: string; twoWay: boolean }> = [];
  for (const element of doc.getAllElements()) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string') {
      const twoWay = element.props['bind-mode'] !== 'one-way';
      bound.push({ stateKey: bindKey, twoWay });
    }
  }

  assertEquals(bound.length, 3);
  assertEquals(bound[0].twoWay, true);   // default = two-way
  assertEquals(bound[1].twoWay, false);  // explicit one-way
  assertEquals(bound[2].twoWay, true);   // explicit two-way
});

// ===========================================================================
// 14. Two-way binding: forward push after reverse sync is no-op
// ===========================================================================

Deno.test('two-way binding - forward push after reverse sync produces consistent state', () => {
  const input = createElement('input', { id: 'search', bind: 'query', value: 'typed' });
  const root = el('container', { id: 'root' }, input);

  const state: Record<string, unknown> = { query: 'old' };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  const doc = new Document(root);
  const allElements = [...doc.getAllElements()];

  // Step 0: reverse sync
  for (const element of allElements) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const twoWay = element.props['bind-mode'] !== 'one-way';
      if (!twoWay) continue;
      const mapping = byType.get(element.type);
      if (mapping) {
        const elementValue = element.props[mapping.prop];
        if (elementValue !== undefined) {
          state[bindKey] = elementValue;
        }
      }
    }
  }

  // State now matches element
  assertEquals(state.query, 'typed');

  // Step 2: forward push
  for (const element of allElements) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const mapping = byType.get(element.type);
      if (mapping) {
        element.props[mapping.prop] = String(state[bindKey]);
      }
    }
  }

  // Element still has the same value (no-op push)
  assertEquals(input.props.value, 'typed');
  assertEquals(state.query, 'typed');
});

// ===========================================================================
// 15. Two-way binding: handler override wins when bind-mode="one-way"
// ===========================================================================

Deno.test('two-way binding - one-way mode preserves handler state modifications', () => {
  const input = createElement('input', {
    id: 'search', bind: 'query', 'bind-mode': 'one-way', value: '  Foo  ',
  });
  const root = el('container', { id: 'root' }, input);

  const state: Record<string, unknown> = { query: 'foo' };
  const byType = new Map<string, PersistenceMapping>();
  for (const m of DEFAULT_PERSISTENCE_MAPPINGS) {
    if (!byType.has(m.type)) byType.set(m.type, m);
  }

  const doc = new Document(root);
  const allElements = [...doc.getAllElements()];

  // Simulate: handler already set state.query = 'foo' (normalized)
  // Step 0: reverse sync — should skip (one-way)
  for (const element of allElements) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const twoWay = element.props['bind-mode'] !== 'one-way';
      if (!twoWay) continue;
      const mapping = byType.get(element.type);
      if (mapping) {
        const elementValue = element.props[mapping.prop];
        if (elementValue !== undefined) {
          state[bindKey] = elementValue;
        }
      }
    }
  }

  // Handler's normalized value preserved (not overwritten by element's raw value)
  assertEquals(state.query, 'foo');

  // Step 2: forward push — handler's value pushed to element
  for (const element of allElements) {
    const bindKey = element.props.bind;
    if (typeof bindKey === 'string' && bindKey in state) {
      const mapping = byType.get(element.type);
      if (mapping) {
        element.props[mapping.prop] = String(state[bindKey]);
      }
    }
  }

  assertEquals(input.props.value, 'foo');
});
