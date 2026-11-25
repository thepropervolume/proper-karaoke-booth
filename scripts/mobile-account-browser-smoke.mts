/** Exercise actual account UI over a same-origin fixture. No real account or message is created. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { chromium } from 'playwright-core';

const origin = 'https://queue.thepropervolume.com';
const accountPath = '/v1/mobile/account/';
const root = resolve('dist/mobile');
const mediaType: Record<string, string> = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png',
  '.webp': 'image/webp', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
};
const existing = { email: 'member@example.test', name: 'Test Member' };
const newEmail = 'new@example.test';
const password = 'A strong test password 23';
const sessionToken = 's'.repeat(43);
const verifyToken = 'v'.repeat(43);
const resetToken = 'r'.repeat(43);
const loginToken = 'l'.repeat(43);
const browser = await chromium.launch({
  executablePath: process.env.TPV_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true,
});
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
  const errors: string[] = [];
  const calls: string[] = [];
  let active = existing;
  const profiles = new Map<string, { pronouns: string; bio: string; avatar: string | null }>();
  await context.route(origin + '/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname.startsWith(accountPath)) {
      assert.equal(url.search, '', 'An account operation must not put data in the URL.');
      const operation = url.pathname.slice(accountPath.length);
      calls.push(operation);
      const input = request.method() === 'POST' ? request.postDataJSON() : {};
      const respond = (status: number, json: object) => route.fulfill({ status, json });
      if (operation === 'lookup') return respond(200, { registered: input.email === existing.email });
      if (operation === 'login') {
        assert.deepEqual(input, { email: existing.email, password });
        active = existing;
        return respond(200, { account: active, token: sessionToken });
      }
      if (operation === 'register') {
        assert.deepEqual(input, { email: newEmail, name: 'New Singer', password });
        return respond(202, { pending: true });
      }
      if (operation === 'link') {
        assert.equal(input.email, existing.email);
        assert(['signin', 'reset'].includes(input.purpose));
        return respond(202, { pending: true });
      }
      if (operation === 'link/redeem') {
        if (input.token === verifyToken && !input.password) return respond(400, { error: 'VERIFY_PASSWORD_REQUIRED' });
        if (input.token === resetToken && !input.password) return respond(400, { error: 'PASSWORD_REQUIRED' });
        assert(input.token === loginToken || input.password === password);
        active = input.token === verifyToken ? { email: newEmail, name: 'New Singer' } : existing;
        return respond(200, { account: active, token: sessionToken });
      }
      if (operation === 'profile') {
        assert.equal(request.headers().authorization, 'Bearer ' + sessionToken);
        if (request.method() === 'POST') {
          assert.deepEqual(Object.keys(input).sort(), ['avatar', 'bio', 'pronouns']);
          assert.match(input.avatar, /^data:image\/jpeg;base64,/);
          profiles.set(active.email, input);
        }
        return respond(200, { profile: profiles.get(active.email) ?? { pronouns: '', bio: '', avatar: null } });
      }
      if (operation === 'session' || operation === 'logout') {
        assert.equal(request.headers().authorization, 'Bearer ' + sessionToken);
        return respond(200, operation === 'session' ? { account: active } : {});
      }
      return respond(404, { error: 'UNKNOWN_TEST_OPERATION' });
    }
    if (!url.pathname.startsWith('/app/')) return route.fulfill({ status: 200, json: { rooms: [], items: [] } });
    const asset = resolve(root, url.pathname === '/app/' ? 'index.html' : url.pathname.slice('/app/'.length));
    assert(asset.startsWith(root + sep));
    try {
      await route.fulfill({ body: await readFile(asset), contentType: mediaType[extname(asset)] ?? 'application/octet-stream' });
    } catch { await route.fulfill({ status: 404 }); }
  });

  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(origin + '/app/');
  const button = (name: string) => page.getByRole('button', { name, exact: true });
  const accountTab = () => page.getByRole('navigation', { name: 'Singer workspace' }).getByRole('tab', { name: 'Account', exact: true }).click();
  await button('Sign In / Create Account').click();
  assert.equal(await page.getByLabel('Password', { exact: true }).count(), 0);
  await page.getByLabel('Email address').fill(existing.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await button('Sign In').click();
  await accountTab();
  await page.getByText(existing.email, { exact: true }).waitFor();

  // Simulate another browser tab replacing the persistent token before this editor opens.
  await page.evaluate(() => localStorage.setItem('tpv-mobile-account-session', 'b'.repeat(43)));
  await page.getByText('Singing Profile', { exact: true }).click();
  await page.getByLabel('Pronouns').fill('they/them');
  await page.getByLabel('Bio', { exact: true }).fill('I like a duet.');
  await page.getByLabel('Profile photo', { exact: true }).setInputFiles({
    name: 'profile.png',
    mimeType: 'image/png',
    buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRuoAAAAASUVORK5CYII=', 'base64'),
  });
  await page.getByRole('img', { name: 'Your profile photo' }).waitFor();
  await button('Save Singing Profile').click();
  await page.getByText('Profile saved.', { exact: true }).waitFor();
  assert.equal(profiles.get(existing.email)?.pronouns, 'they/them');
  assert.equal(await page.evaluate(() => Object.values(localStorage).some(value => value.includes('I like a duet.'))), false);
  await page.evaluate(token => localStorage.setItem('tpv-mobile-account-session', token), sessionToken);

  await page.reload();
  await accountTab();
  await page.getByText(existing.email, { exact: true }).waitFor();
  await page.getByText('Singing Profile', { exact: true }).click();
  await page.getByRole('img', { name: 'Your profile photo' }).waitFor();
  assert.equal(await page.getByLabel('Bio', { exact: true }).inputValue(), 'I like a duet.');
  await button('Sign Out').click();
  await button('Sign In / Create Account').click();
  await page.getByLabel('Email address').fill(newEmail);
  await page.getByLabel('Display name', { exact: true }).fill('New Singer');
  await page.getByLabel('Create a password').fill(password);
  await button('Create Account').click();
  await page.getByLabel('Email link', { exact: true }).fill(origin + '/app/?account=1#accountLink=' + verifyToken);
  await button('Continue').click();
  await page.getByLabel('Your Booth password').fill(password);
  await button('Continue').click();
  await page.getByText(newEmail, { exact: true }).waitFor();

  // A link can be handed from the browser URL into the app without echoing its token in the address.
  await page.goto(origin + '/app/?account=1#accountLink=' + resetToken);
  await page.getByRole('heading', { name: 'Use an Email Link' }).waitFor();
  assert.equal(new URL(page.url()).hash, '');
  await button('Continue').click();
  await page.getByLabel('New password').fill(password);
  await button('Set New Password').click();
  await accountTab();
  await page.getByText(existing.email, { exact: true }).waitFor();
  await button('Sign Out').click();

  await button('Sign In / Create Account').click();
  await page.getByLabel('Email address').fill(existing.email);
  await button('Email me a sign-in link').click();
  await page.getByLabel('Email link', { exact: true }).fill(origin + '/app/?account=1#accountLink=' + loginToken);
  await button('Continue').click();
  await page.getByText(existing.email, { exact: true }).waitFor();
  assert(calls.includes('session') && calls.includes('logout') && calls.includes('register') && calls.includes('link'));
  assert.deepEqual(errors, []);
  console.log('Mobile account smoke passed password, verification, reset, email-link sign-in, profile photo persistence, and sign-out.');
} finally { await browser.close(); }
