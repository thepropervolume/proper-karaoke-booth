/** Public browser check for a disposable `--browser-window` synthetic room only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const [link] = process.argv.slice(2);
if (!link || !/^https:\/\/queue\.thepropervolume\.com\/qa-catalog-[0-9a-f]{24}$/.test(link))
  throw new Error('Provide the random synthetic QA room URL printed by the live smoke.');
const require = createRequire(import.meta.url), { chromium } = require('playwright-core');
const executablePath = process.env.TPV_QA_CHROME || (process.platform === 'win32' ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
if (!executablePath) throw new Error('Set TPV_QA_CHROME to an installed Chromium browser.');
const browser = await chromium.launch({ executablePath, headless: true });
try {
  const page = await browser.newPage();
  await page.goto(link, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.getByLabel('Your name').fill('Synthetic Browser Guest');
  await page.getByRole('button', { name: 'Join the show', exact: true }).click();
  await page.getByText('Hello, Synthetic Browser Guest!', { exact: true }).waitFor({ timeout: 25000 });
  const results = page.locator('.singer-songs');
  await page.getByLabel('Search host library').waitFor({ state: 'visible' });
  assert.equal(await results.locator('li').count(), 50);
  assert.equal(await results.getByText('Synthetic Shared 62', { exact: true }).count(), 0);
  await page.getByLabel('Search host library').fill('Needle Synthetic 62');
  await results.getByText('Synthetic Shared 62', { exact: true }).waitFor({ timeout: 25000 });
  assert.equal(await results.locator('li').count(), 1);
  await page.getByLabel('Search host library').fill('Synthetic Shared');
  await page.getByRole('button', { name: 'Load more songs', exact: true }).waitFor({ timeout: 25000 });
  await page.getByRole('button', { name: 'Load more songs', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.singer-songs li').length === 65, null, { timeout: 25000 });
  console.log('PASS: public singer browser searched beyond the first 50 songs and loaded all matching pages.');
} finally { await browser.close(); }
