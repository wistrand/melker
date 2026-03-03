import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { envGet, envSet, envDelete, envToObject } from '../../src/runtime/node/env.ts';

describe('node/env', () => {
  const testKey = '__MELKER_TEST_ENV_VAR__';

  it('get/set/delete round-trip', () => {
    assert.equal(envGet(testKey), undefined);
    envSet(testKey, 'hello');
    assert.equal(envGet(testKey), 'hello');
    envDelete(testKey);
    assert.equal(envGet(testKey), undefined);
  });

  it('envToObject returns a record', () => {
    envSet(testKey, 'test-value');
    const obj = envToObject();
    assert.equal(typeof obj, 'object');
    assert.equal(obj[testKey], 'test-value');
    envDelete(testKey);
  });

  it('envToObject returns a copy (not live reference)', () => {
    envSet(testKey, 'original');
    const obj = envToObject();
    envSet(testKey, 'changed');
    assert.equal(obj[testKey], 'original');
    envDelete(testKey);
  });
});
