import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bannerExpiryForInput, bannerExpiryFromInput } from '../../src/renderer/SingerBrandingSettings';

test('a banner stop time persists as an absolute instant and reopens in the host local clock', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    assert.equal(bannerExpiryFromInput('2030-01-15T21:45'), '2030-01-16T02:45:00.000Z');
    assert.equal(bannerExpiryFromInput('2030-07-15T21:45'), '2030-07-16T01:45:00.000Z');
    assert.equal(bannerExpiryForInput('2030-07-16T01:45:00.000Z'), '2030-07-15T21:45');
    assert.equal(bannerExpiryForInput('2030-07-16T03:45:00+02:00'), '2030-07-15T21:45');
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});

test('clearing the optional banner stop time keeps the indefinite setting', () => {
  assert.equal(bannerExpiryFromInput(''), '');
  assert.equal(bannerExpiryForInput(''), '');
  assert.equal(bannerExpiryForInput('not-a-date'), '');
});

test('invalid calendar and nonexistent local stop times cannot silently shift the expiry', () => {
  const original = process.env.TZ;
  try {
    process.env.TZ = 'America/New_York';
    for (const invalid of ['2030-02-30T21:45', '2030-01-15T25:00', '2030-03-10T02:30', '2030-01-15', '2030-01-15T21:45Z'])
      assert.throws(() => bannerExpiryFromInput(invalid), /valid local banner stop time/);
    assert.equal(bannerExpiryFromInput('2028-02-29T21:45'), '2028-03-01T02:45:00.000Z');
  } finally { if (original === undefined) delete process.env.TZ; else process.env.TZ = original; }
});
