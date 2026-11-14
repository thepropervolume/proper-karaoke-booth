import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseHostPolicy } from '../../src/main/host-policy';

const open = () => ({ ageRestricted: false, includeVersionIds: null, excludeVersionIds: [] as string[] });

test('host policy keeps an explicit open policy and drops unrelated fields', () => {
  assert.deepEqual(parseHostPolicy({ ...open(), role: 'host', token: 'discard' }), open());
  assert.deepEqual(parseHostPolicy({ ageRestricted: true, includeVersionIds: [], excludeVersionIds: ['v'] }),
    { ageRestricted: true, includeVersionIds: [], excludeVersionIds: ['v'] });
});

test('host policy requires a record, strict boolean and explicit valid lists', () => {
  for (const value of [null, undefined, [], true, 'policy', {}, { ...open(), ageRestricted: 1 },
    { ...open(), ageRestricted: 'false' }, { ...open(), includeVersionIds: undefined },
    { ...open(), includeVersionIds: 'v' }, { ...open(), excludeVersionIds: null },
    { ...open(), excludeVersionIds: {} }]) assert.equal(parseHostPolicy(value), null, JSON.stringify(value));
});

test('host policy rejects empty, nonstring, oversized and missing version identifiers', () => {
  for (const invalid of ['', '   ', 1, null, {}, 'v'.repeat(501), undefined]) {
    assert.equal(parseHostPolicy({ ...open(), includeVersionIds: [invalid] }), null);
    assert.equal(parseHostPolicy({ ...open(), excludeVersionIds: [invalid] }), null);
  }
  assert.equal(parseHostPolicy({ ...open(), includeVersionIds: Array(1) }), null);
  assert.equal(parseHostPolicy({ ...open(), excludeVersionIds: Array(1) }), null);
  assert.deepEqual(parseHostPolicy({ ...open(), includeVersionIds: ['v'.repeat(500)] })?.includeVersionIds, ['v'.repeat(500)]);
});

test('host policy bounds each list and detaches arrays from caller-owned input', () => {
  const ids = Array.from({ length: 10_000 }, (_, index) => `v${index}`);
  const input = { ageRestricted: true, includeVersionIds: ids, excludeVersionIds: [...ids] };
  const parsed = parseHostPolicy(input); assert.ok(parsed);
  assert.equal(parsed.includeVersionIds?.length, 10_000); assert.equal(parsed.excludeVersionIds.length, 10_000);
  assert.notEqual(parsed.includeVersionIds, input.includeVersionIds); assert.notEqual(parsed.excludeVersionIds, input.excludeVersionIds);
  input.includeVersionIds[0] = 'changed'; input.excludeVersionIds.pop();
  assert.equal(parsed.includeVersionIds?.[0], 'v0'); assert.equal(parsed.excludeVersionIds.length, 10_000);
  assert.equal(parseHostPolicy({ ...open(), includeVersionIds: Array(10_001).fill('v') }), null);
  assert.equal(parseHostPolicy({ ...open(), excludeVersionIds: Array(10_001).fill('v') }), null);
});
