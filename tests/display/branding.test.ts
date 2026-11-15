import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSingerDisplayBranding } from '../../src/display/branding';

function fixture() {
  let now = Date.parse('2026-11-15T12:00:00Z'), nextTimer = 0;
  const timers = new Map<number, { callback: () => void; delay: number }>(), styles = new Map<string, string>();
  const names = [{ textContent: '' }, { textContent: '' }];
  const logos = [0, 1].map(() => ({ hidden: true, src: '', removeAttribute(name: string) { if (name === 'src') this.src = ''; } }));
  const banner = { hidden: true, dataset: { position: 'bottom' } }, text = { textContent: '' };
  Object.defineProperty(text, 'innerHTML', { set() { assert.fail('Announcements must be plain text.'); } });
  const branding = createSingerDisplayBranding({
    root: { style: { setProperty: (key: string, value: string) => styles.set(key, value) } } as unknown as HTMLElement,
    names: names as HTMLElement[], logos: logos as HTMLImageElement[], banner: banner as unknown as HTMLElement, bannerText: text as HTMLElement,
  }, { now: () => now, setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => { timers.delete(id as number); } });
  return { branding, styles, names, logos, banner, text, timers,
    advance(milliseconds: number) { now += milliseconds; const ready = [...timers]; timers.clear(); for (const [, timer] of ready) timer.callback(); },
  };
}

test('booth name, viewport-sized logo and plain-text banner update together without media dependencies', () => {
  const value = fixture();
  value.branding.update({ boothName: 'Ben’s Booth', displayLogoSize: 80, bannerEnabled: true,
    bannerText: '<img src=x onerror=alert(1)> Sing with us!', bannerPosition: 'top', bannerExpiresAt: '' }, 'data:image/png;base64,AAAA');
  assert.deepEqual(value.names.map(name => name.textContent), ['Ben’s Booth', 'Ben’s Booth']);
  assert.equal(value.styles.get('--display-logo-size'), '80vw');
  assert.ok(value.logos.every(logo => !logo.hidden && logo.src === 'data:image/png;base64,AAAA'));
  assert.equal(value.banner.hidden, false); assert.equal(value.banner.dataset.position, 'top');
  assert.equal(value.text.textContent, '<img src=x onerror=alert(1)> Sing with us!');
  assert.equal(value.timers.size, 0, 'An announcement without expiry stays until disabled or the display closes.');
  value.branding.update(undefined, null);
  assert.ok(value.logos.every(logo => logo.hidden && logo.src === '')); assert.equal(value.banner.hidden, true);
});

test('banner expires autonomously and old timers cannot hide a newer announcement', () => {
  const value = fixture();
  value.branding.update({ bannerEnabled: true, bannerText: 'Last call', bannerExpiresAt: '2026-11-15T12:00:01Z' }, null);
  assert.equal(value.banner.hidden, false); assert.equal([...value.timers.values()][0].delay, 1000);
  const oldCallback = [...value.timers.values()][0].callback;
  value.advance(1000); assert.equal(value.banner.hidden, true);
  value.branding.update({ bannerEnabled: true, bannerText: 'Keep singing', bannerExpiresAt: '' }, null);
  oldCallback(); assert.equal(value.banner.hidden, false); assert.equal(value.text.textContent, 'Keep singing');
  value.branding.dispose(); assert.equal(value.timers.size, 0);
});

test('expired, invalid and empty banners remain hidden; replacement and disposal cancel pending work', () => {
  const value = fixture();
  for (const expiry of ['invalid', '2026-11-15T11:00:00Z']) {
    value.branding.update({ bannerEnabled: true, bannerText: 'Hidden', bannerExpiresAt: expiry }, null);
    assert.equal(value.banner.hidden, true); assert.equal(value.timers.size, 0);
  }
  value.branding.update({ bannerEnabled: true, bannerText: '   ' }, null); assert.equal(value.banner.hidden, true);
  value.branding.update({ displayLogoSize: 1000, bannerEnabled: true, bannerText: 'Soon', bannerExpiresAt: '2026-11-15T12:00:01Z' }, null);
  assert.equal(value.styles.get('--display-logo-size'), '85vw'); assert.equal(value.timers.size, 1);
  value.branding.update({ displayLogoSize: -10, bannerEnabled: false }, null);
  assert.equal(value.styles.get('--display-logo-size'), '10vw'); assert.equal(value.timers.size, 0);
  value.branding.update({ bannerEnabled: true, bannerText: 'Soon', bannerExpiresAt: '2026-11-15T12:00:01Z' }, null);
  value.branding.dispose(); assert.equal(value.timers.size, 0);
  value.branding.update({ boothName: 'Obsolete' }, null); assert.notEqual(value.names[0].textContent, 'Obsolete');
});

test('far-future expiry uses bounded browser timers and is checked again before hiding', () => {
  const value = fixture();
  value.branding.update({ bannerEnabled: true, bannerText: 'Long show', bannerExpiresAt: '2027-11-15T12:00:00Z' }, null);
  assert.equal([...value.timers.values()][0].delay, 2_147_483_647);
  value.advance(2_147_483_647); assert.equal(value.banner.hidden, false); assert.equal(value.timers.size, 1);
  value.branding.dispose();
});
