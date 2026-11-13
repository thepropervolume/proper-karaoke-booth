// Isolated component rehearsal: no show, real credentials, network or media.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(join(repo, 'package.json'));
const { build } = require('esbuild'), sass = require('sass'), { _electron: electron } = require('playwright-core');
const root = await realpath(tmpdir()), temp = await mkdtemp(join(root, 'tpv-rating-ui-'));
const profile = join(temp, 'profile'); await mkdir(profile);
let app;
try {
  const component = JSON.stringify(join(repo, 'src/renderer/SongRating.tsx').replaceAll('\\', '/'));
  const jsx = `import React,{useState} from 'react'; import {createRoot} from 'react-dom/client'; import {SongRatingButton,SongRatingDialog} from ${component};
    const key='youtube:abcDEF12345';
    const harness=window.qa={fail:false,malformed:false,calls:[],parentClicks:0,parentDoubleClicks:0,parentKeys:0,preferences:0,searches:0,preferenceKeys:0,helpKeys:0};
    window.addEventListener('keydown',event=>{if(event.code==='KeyF'&&event.ctrlKey)harness.searches++;if(event.code==='Comma'&&(event.ctrlKey||event.metaKey||event.altKey))harness.preferenceKeys++;if(event.code==='F1'||event.code==='Slash'&&(event.ctrlKey||event.metaKey))harness.helpKeys++;});
    function App(){const[rating,setRating]=useState({recordingKey:key,average:6,count:2,ownVote:null});const[open,setOpen]=useState(false),[canVote,setCanVote]=useState(false);harness.setCanVote=setCanVote;
      return <main><div role='option' tabIndex={0} onClick={()=>harness.parentClicks++} onDoubleClick={()=>harness.parentDoubleClicks++} onKeyDown={event=>{if(['Enter','Delete','ArrowDown'].includes(event.key))harness.parentKeys++;}}>
        <SongRatingButton title='Fixture Song' rating={rating} onClick={()=>setOpen(true)}/></div>
        {open&&<SongRatingDialog title='Fixture Song' recordingKey={key} rating={rating} canVote={canVote} onClose={()=>setOpen(false)} onOpenPreferences={()=>harness.preferences++}
          onSave={async value=>{harness.calls.push(value);if(harness.fail)throw Error('Test service unavailable');if(harness.malformed)return {...rating,ownVote:2};
            const next={recordingKey:key,average:value===null?6:(12+value)/3,count:value===null?2:3,ownVote:value};setRating(next);return next;}}/>}</main>;
    }createRoot(document.getElementById('root')).render(<App/>);`;
  await build({ stdin: { contents: jsx, loader: 'tsx', resolveDir: repo }, outfile: join(temp, 'ui.js'), bundle: true, platform: 'browser', format: 'iife',
    plugins: [{ name: 'rating-test-scss', setup(builder) { builder.onLoad({ filter: /\.scss$/ }, args => ({ contents: sass.compile(args.path).css, loader: 'css' })); } }] });
  await writeFile(join(temp, 'index.html'), '<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><style>:root{--bg:#080f18;--panel:#111c2c;--panel-raised:#1b2a3d;--text:#f4f6f8;--muted:#b9c2d0;--line:#43526a;--accent:#0eb7ff;--focus:#0eb7ff}body{background:var(--bg);color:var(--text);font:16px Arial}dialog{color:var(--text);background:var(--panel);padding:24px}form{display:grid;gap:14px}button{color:var(--text);background:var(--panel-raised);padding:8px}.settings-actions{display:flex;gap:8px;justify-content:flex-end}.muted{color:var(--muted)}</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>');
  const bootstrap = join(temp, 'bootstrap.cjs');
  await writeFile(bootstrap, `const {app,BrowserWindow}=require('electron');const fs=require('node:fs');app.setPath('userData',process.env.TPV_RATING_QA_PROFILE);if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_RATING_QA_PROFILE))throw Error('Unsafe profile');app.whenReady().then(()=>{const win=new BrowserWindow({show:false,width:1000,height:800,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});win.loadFile(process.env.TPV_RATING_QA_PAGE);});app.on('window-all-closed',()=>app.quit());`);
  const env = { ...process.env, TPV_RATING_QA_PROFILE: profile, TPV_RATING_QA_PAGE: join(temp, 'index.html'), APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') }; delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ executablePath: require('electron'), args: [bootstrap, `--user-data-dir=${profile}`, '--mute-audio'], cwd: temp, env });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), await realpath(profile));
  const page = await app.firstWindow();
  const compact = page.getByRole('button', { name: /^Rate Fixture Song/ });
  await compact.click();
  let dialog = page.getByRole('dialog', { name: 'Rate This Recording' }); await dialog.waitFor();
  assert.equal(await page.evaluate(() => window.qa.parentClicks), 0);
  await compact.dispatchEvent('dblclick');
  assert.equal(await page.evaluate(() => window.qa.parentDoubleClicks), 0);
  assert.equal(await dialog.getByRole('radio', { name: '7 hearts out of 10' }).isDisabled(), true);
  await dialog.getByRole('button', { name: 'Open Rating Preferences' }).click();
  await dialog.waitFor({ state: 'hidden' });
  assert.equal(await page.evaluate(() => window.qa.preferences), 1);
  await page.evaluate(() => window.qa.setCanVote(true));
  await compact.click(); dialog = page.getByRole('dialog', { name: 'Rate This Recording' });
  const seven = dialog.getByRole('radio', { name: '7 hearts out of 10' }); await seven.click(); await seven.press('ArrowRight');
  assert.equal(await dialog.getByRole('radio', { name: '8 hearts out of 10' }).getAttribute('aria-checked'), 'true');
  for (const key of ['Control+,', 'Meta+,', 'Alt+,', 'Control+/', 'Meta+/', 'F1', 'Control+f']) await page.keyboard.press(key);
  assert.deepEqual(await page.evaluate(() => [window.qa.preferenceKeys, window.qa.helpKeys, window.qa.searches]), [3, 3, 1], 'Default navigation/help keys must reach the host while a rating dialog is open.');
  assert.deepEqual(await page.evaluate(() => window.qa.calls), []);
  await page.evaluate(() => { window.qa.fail = true; });
  await dialog.getByRole('button', { name: 'Save Host Rating' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'Test service unavailable' }).waitFor();
  assert.match(await compact.getAttribute('aria-label'), /6\.0 \/ 10; 2 ratings/);
  await page.evaluate(() => { window.qa.fail = false; });
  await dialog.getByRole('button', { name: 'Save Host Rating' }).click();
  await dialog.getByRole('status').filter({ hasText: 'Your host rating was saved.' }).waitFor();
  assert.match(await compact.getAttribute('aria-label'), /Your host rating: 8/);
  await dialog.getByRole('button', { name: 'Clear My Host Rating' }).click();
  await dialog.getByRole('status').filter({ hasText: 'Your host rating was cleared.' }).waitFor();
  assert.equal(await dialog.getByRole('radio', { checked: true }).count(), 0);
  await dialog.getByRole('radio', { name: '1 heart out of 10' }).click();
  await page.evaluate(() => { window.qa.malformed = true; });
  await dialog.getByRole('button', { name: 'Save Host Rating' }).click();
  await dialog.getByRole('alert').filter({ hasText: 'did not confirm this rating' }).waitFor();
  assert.equal((await compact.getAttribute('aria-label')).includes('Your host rating:'), false);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await compact.focus(); await compact.press('Control+f');
  assert.equal(await page.evaluate(() => window.qa.searches), 2);
  await compact.press('Enter'); await dialog.waitFor();
  assert.equal(await page.evaluate(() => window.qa.parentKeys), 0);
  assert.deepEqual(await page.evaluate(() => window.qa.calls), [8, 8, null, 1]);
  console.log('Rating UI: aggregate, read-only setup, 10-heart keyboard selection, default host navigation propagation, explicit save/clear, error and invalid-response handling, and isolated row activation verified.');
} finally {
  if (app) await app.close();
  const actual = await realpath(temp);
  if (dirname(actual) !== root || !actual.startsWith(root + sep) || !actual.split(sep).at(-1)?.startsWith('tpv-rating-ui-')) throw new Error('Unsafe rating UI cleanup path.');
  await rm(actual, { recursive: true, force: true });
}
