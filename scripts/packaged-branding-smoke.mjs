import { waitForHostWindow } from './wait-for-host-window.mjs';
// Actual packaged branding, private profile, muted playback and no real library.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
const repo = await realpath(resolve('.')), require = createRequire(join(repo, 'package.json'));
const { _electron: electron } = require('playwright-core');
if (process.argv.length < 3 || process.argv.length > 4) throw Error('Usage: node scripts/packaged-branding-smoke.mjs <executable> [screenshots-directory]');
const executablePath = await realpath(resolve(process.argv[2]));
const screenshotDirectory = process.argv[3] ? resolve(process.argv[3]) : null;
const parent = await realpath(tmpdir()), temp = await mkdtemp(join(parent, 'tpv-brand-package-'));
const profile = join(temp, 'profile'); await mkdir(profile);
const canonicalProfile = await realpath(profile);
await writeFile(join(profile, 'settings.json'), JSON.stringify({sharedCatalogEnabled:false}));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
Object.assign(env, {APPDATA:join(temp,'appdata'),LOCALAPPDATA:join(temp,'localappdata'),XDG_CONFIG_HOME:join(temp,'config'),XDG_DATA_HOME:join(temp,'data')});
let app;
try {
  app = await electron.launch({executablePath,args:[`--user-data-dir=${canonicalProfile}`,'--mute-audio'],env,cwd:temp});
  const identity = await app.evaluate(({app})=>({profile:app.getPath('userData'),packaged:app.isPackaged,version:app.getVersion()}));
  assert.equal(await realpath(identity.profile),canonicalProfile); assert.equal(identity.packaged,true);
  assert.equal(identity.version,JSON.parse(await readFile(join(repo,'package.json'),'utf8')).version);
  const page = await waitForHostWindow(app); await page.waitForFunction(()=>!!window.tpv);
  if (screenshotDirectory) await mkdir(screenshotDirectory,{recursive:true});
  for (const [appearance,visible,hidden] of [['day','light','dark'],['night','dark','light']]) {
    await page.evaluate(appearance=>window.tpv.saveSettings({appearance}),appearance);
    await page.waitForFunction(value=>document.documentElement.dataset.theme===value,appearance);
    const logo=page.locator(`.brand__logo--${visible}`); await logo.waitFor({state:'visible'});
    await page.waitForFunction(selector=>{const image=document.querySelector(selector);return image?.complete&&image.naturalWidth>0&&image.naturalHeight>0&&Math.abs(image.naturalWidth/image.naturalHeight-1600/480)<.01;},`.brand__logo--${visible}`);
    assert.equal(await page.locator(`.brand__logo--${hidden}`).isVisible(),false);
    assert.equal(await page.getByRole('img',{name:'The Proper Volume Karaoke Booth',exact:true}).count(),1);
    if(screenshotDirectory) await page.screenshot({path:join(screenshotDirectory,`host-${appearance}.png`)});
  }
  await page.setViewportSize({width:780,height:600});
  const bounds=await page.locator('.topbar').evaluate(element=>({width:window.innerWidth,buttons:[...element.querySelectorAll('button')].map(button=>button.getBoundingClientRect().right)}));
  assert.ok(bounds.buttons.every(right=>right<=bounds.width+.5),'Header actions must fit at minimum supported width.');
  assert.equal((await page.evaluate(()=>window.tpv.getState())).playback,null);
  assert.equal((await page.evaluate(()=>window.tpv.getState())).versions.length,0);
  console.log(`PASS: packaged ${identity.version} theme-selected logos load with correct aspect/accessibility, minimum-width actions fit, private profile stays empty/stopped.`);
} finally {
  if(app) await app.close();
  const actual=await realpath(temp);
  if(dirname(actual)!==parent||!actual.startsWith(parent+sep)||!actual.split(sep).at(-1)?.startsWith('tpv-brand-package-'))throw Error('Unsafe branding QA cleanup path.');
  await rm(actual,{recursive:true,force:true});
}
