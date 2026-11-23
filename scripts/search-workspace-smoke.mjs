// Real host/display IPC with an isolated build/profile and synthetic providers.
// No real account, provider request, media download or existing show is accessed.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { waitForHostCondition } from './wait-for-host-condition.mjs';

const repo = await realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'));
const require = createRequire(join(repo, 'package.json')), { build } = require('esbuild');
const { _electron: electron } = require('playwright-core');
const { build: buildUi } = await import(pathToFileURL(require.resolve('vite')).href);
const temporaryRoot = await realpath(tmpdir()), temp = await mkdtemp(join(temporaryRoot, 'tpv-search-workspace-'));
const profile = join(temp, 'profile'), stage = join(temp, 'app');
await mkdir(profile); await mkdir(join(stage, 'main'), { recursive: true });
const canonicalProfile = await realpath(profile);
const screenshots = resolve(process.argv[2] ?? join(repo, 'release/qa/search-workspace'));
await mkdir(screenshots, { recursive: true });
const fixture = join(temp, 'Synthetic Artist - Local Search Song.mp4'), logo = join(temp, 'synthetic-logo.png');
const metadata = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
const community = Array.from({ length: 20 }, (_, index) => ({ artist: 'Synthetic Artist', title: `Community Search Song ${String(index).padStart(2, '0')}`,
  brandSlug: 'SyntheticBrand', youtubeId: `knqa${String(index).padStart(7, '0')}`, uploadDate: null }));
const youtube = Array.from({ length: 5 }, (_, index) => ({ provider: 'youtube', videoId: `ytqa${String(index).padStart(7, '0')}`,
  title: `YouTube Search Song ${index}`, artist: 'Synthetic Artist', videoTitle: `Synthetic Artist - Search Song ${index} Karaoke`,
  watchUrl: `https://www.youtube.com/watch?v=ytqa${String(index).padStart(7, '0')}`, channelId: 'UC' + 'A'.repeat(22),
  channelHandle: '@synthetic-karaoke', channelName: 'Synthetic Karaoke', channelUrl: 'https://www.youtube.com/channel/UC' + 'A'.repeat(22),
  durationSeconds: 180, dateAdded: '2024-04-15', channelApproval: 'karaoke-hint', metadataSource: 'youtube-metadata' }));
const catalogs = ['partytyme', 'sunfly', 'stingray'].map(provider => ({ provider, label: provider, status: 'ok', message: '', songs: [
  { provider, id: 'synthetic-1', title: `${provider} Search Song`, artist: 'Synthetic Artist', durationSeconds: 180,
    language: 'en', webUrl: null, playbackAvailable: false },
] }));
const mocks = {
  auth: 'exports.authenticateKaraFunAccount=async()=>({sessionKey:"synthetic-search-session"});',
  youtube: `exports.YouTubeSearchService=class {async search(query){globalThis.searchWorkspaceQa.youtubeQueries.push(query);return {provider:'youtube',status:'ok',searchId:'synthetic-youtube-search',songs:${JSON.stringify(youtube)},counts:{examined:5,returned:5,invalid:0,duplicate:0,live:0,duration:0,notKaraoke:0,channelNotApproved:0,blockedChannel:0,blockedSong:0,restricted:0},message:'',qualityNote:''};}cancel(){}lookup(){return null;}};`,
  catalogs: `exports.ProviderCatalogService=class {async status(){return ${JSON.stringify(catalogs)}.map(value=>({provider:value.provider,label:value.label,configured:true,searchAvailable:true,playbackAvailable:false,catalogMode:'public',message:'Synthetic catalog'}));}async search(){return ${JSON.stringify(catalogs)};}url(){return null;}};`,
};
let app, host;
const pageErrors = [];
try {
  const media = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:r=10:d=2',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an', fixture], { windowsHide: true });
  assert.equal(media.status, 0, 'Synthetic local-media rehearsal needs FFmpeg.');
  const image = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=0xd5167a:s=120x80', '-frames:v', '1', logo], { windowsHide: true });
  assert.equal(image.status, 0, 'Synthetic logo generation failed.');
  await build({ entryPoints: [join(repo, 'src/main/index.ts')], outfile: join(stage, 'main/index.cjs'), bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'], plugins: [{ name: 'synthetic-search-providers', setup(builder) {
      builder.onResolve({ filter: /(?:karafun-account-auth|provider-catalog-service|youtube-search)$/ }, args => {
        const name = args.path === './karafun-account-auth' ? 'auth' : /[\\/]src[\\/]main[\\/]index\.ts$/.test(args.importer) &&
          args.path === './provider-catalog-service' ? 'catalogs' : /[\\/]src[\\/]main[\\/]index\.ts$/.test(args.importer) && args.path === './youtube-search' ? 'youtube' : null;
        return name ? { path: name, namespace: 'tpv-search-qa' } : null;
      });
      builder.onLoad({ filter: /.*/, namespace: 'tpv-search-qa' }, args => ({ contents: mocks[args.path], loader: 'js' }));
    } }] });
  await build({ entryPoints: [join(repo, 'src/preload/index.ts')], outfile: join(stage, 'preload/index.cjs'), bundle: true,
    platform: 'node', format: 'cjs', target: 'node24', external: ['electron'] });
  await buildUi({ root: repo, configFile: join(repo, 'vite.config.mts'), build: { outDir: join(stage, 'ui'), emptyOutDir: true }, logLevel: 'warn' });
  const bootstrap = join(temp, 'bootstrap.cjs');
  await writeFile(join(profile, 'settings.json'), JSON.stringify({ appearance: 'day', sharedCatalogEnabled: true,
    providerCatalogEnabled: true, youtubeSearchEnabled: true, showDisplayLogo: false, masterVolume: 0,
    autoBumper: false, bumperOnLaunch: false, autoAdvance: false, localControlEnabled: false,
    ratingProfileConfigFile: join(profile, 'rating-connection.json'), singerDisplayFullscreen: false }));
  await writeFile(join(profile, 'catalog-connection.json'), JSON.stringify({ baseUrl: 'https://catalog.example.test', token: 'synthetic-catalog-read-token-123456789' }), { mode: 0o600 });
  await writeFile(join(profile, 'rating-connection.json'), JSON.stringify({ baseUrl: 'https://ratings.example.test', token: 'synthetic-host-voter-token-12345678901234567890' }), { mode: 0o600 });
  await writeFile(bootstrap, `const {app,dialog,session,shell}=require('electron');const fs=require('node:fs');
app.setPath('userData',process.env.TPV_SEARCH_QA_PROFILE);app.setAppPath(process.env.TPV_SEARCH_QA_REPO);app.getVersion=()=>${JSON.stringify(metadata.version)};
if(fs.realpathSync(app.getPath('userData'))!==fs.realpathSync(process.env.TPV_SEARCH_QA_PROFILE))throw Error('Unsafe rehearsal profile');
globalThis.searchWorkspaceQa={unexpectedFetches:0,downloads:0,youtubeQueries:[],ratingKeys:[],ratingVotes:[],failNextVote:true,nextOpenFile:null,dialogs:[]};
dialog.showOpenDialog=async()=>{const file=searchWorkspaceQa.nextOpenFile;searchWorkspaceQa.nextOpenFile=null;return file?{canceled:false,filePaths:[file]}:{canceled:true,filePaths:[]};};
dialog.showMessageBox=async(_parent,value)=>{searchWorkspaceQa.dialogs.push(value?.message||'');return{response:0};};
shell.openExternal=async()=>{throw Error('External browsers are disabled in this rehearsal');};
globalThis.fetch=async(input,options)=>{const url=new URL(String(input));const xml=body=>new Response('<response status="ok">'+body+'</response>',{headers:{'Content-Type':'application/xml'}});
if(url.origin==='https://ratings.example.test'&&url.pathname==='/v1/ratings/lookup'){const keys=JSON.parse(options.body).recordingKeys;searchWorkspaceQa.ratingKeys.push(...keys);return new Response(JSON.stringify({items:keys.map(recordingKey=>({recordingKey,average:null,count:0,ownVote:null}))}),{headers:{'content-type':'application/json'}});}
if(url.origin==='https://ratings.example.test'&&url.pathname==='/v1/ratings/vote'){const {recordingKey,value}=JSON.parse(options.body);searchWorkspaceQa.ratingVotes.push({recordingKey,value});if(searchWorkspaceQa.failNextVote){searchWorkspaceQa.failNextVote=false;return new Response('',{status:503});}return new Response(JSON.stringify({recordingKey,average:value,count:1,ownVote:value}),{headers:{'content-type':'application/json'}});}
if(url.origin==='https://catalog.example.test'&&url.pathname==='/v1/catalog/tracks')return new Response(JSON.stringify({items:${JSON.stringify(community)},nextCursor:null,metadata:{revision:'1',lastSuccess:null,lastAttempt:null}}),{headers:{'content-type':'application/json'}});
if(url.hostname==='api.karafun.com')switch(url.pathname){case'/session/info':return xml('<session/>');case'/search/top':return xml('<list><song id="6229"/></list>');case'/song/info':return xml('<song id="6229"><title>KaraFun Search Song</title><artist>Synthetic Artist</artist><len>180</len><explicit>0</explicit></song>');case'/song/request':searchWorkspaceQa.downloads++;throw Error('No media downloads are allowed in this rehearsal');}
searchWorkspaceQa.unexpectedFetches++;throw Error('Unexpected network request blocked');};
app.whenReady().then(()=>session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_details,callback)=>callback({cancel:true})));
require(process.env.TPV_SEARCH_QA_ENTRY);`);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('TPV_') && key !== 'ELECTRON_RUN_AS_NODE'));
  Object.assign(env, { TPV_SEARCH_QA_PROFILE: canonicalProfile, TPV_SEARCH_QA_REPO: repo, TPV_SEARCH_QA_ENTRY: join(stage, 'main/index.cjs'),
    APPDATA: join(temp, 'appdata'), LOCALAPPDATA: join(temp, 'localappdata'), XDG_CONFIG_HOME: join(temp, 'config'), XDG_DATA_HOME: join(temp, 'data') });
  const args = [bootstrap, `--user-data-dir=${canonicalProfile}`, '--mute-audio', '--disable-background-networking'];
  if (process.env.TPV_TEST_NO_SANDBOX === '1') args.push('--no-sandbox');
  app = await electron.launch({ executablePath: require('electron'), args, env, cwd: repo, timeout: 30000 });
  assert.equal(await realpath(await app.evaluate(({ app }) => app.getPath('userData'))), canonicalProfile);
  const deadline = performance.now() + 15000;
  do {
    host = app.windows().find(page => page.url().replaceAll('\\', '/').includes('/src/renderer/index.html'));
    if (!host) await new Promise(resolve => setTimeout(resolve, 30));
  } while (!host && performance.now() < deadline);
  assert.ok(host, 'Select the host by its renderer URL, not the first (possibly hidden singer) window.');
  host.on('pageerror', error => pageErrors.push(error.message));
  await host.waitForFunction(() => !!window.tpv?.getSettings);
  await waitForHostCondition(host, async () => (await window.tpv.getState()).playback === null);
  const search = host.getByRole('searchbox', { name: 'Search library', exact: true });
  for (const section of ['Sources', 'Singers', 'Playlists']) {
    await host.getByRole('button', { name: section, exact: true }).click();
    assert.equal(await search.isVisible(), true, `Global search must stay visible in ${section}.`);
    if (section === 'Playlists') {
      const layout = await host.locator('.collections-nav').evaluate(nav => {
        const buttons = [...nav.querySelectorAll('button')].map(button => ({ rect: button.getBoundingClientRect().toJSON(), radius: getComputedStyle(button).borderRadius }));
        return { gap: parseFloat(getComputedStyle(nav).columnGap), buttons };
      });
      assert.ok(layout.gap >= 8, 'Collection navigation needs visible space between buttons.');
      assert.ok(layout.buttons.every(button => button.rect.height >= 42 && parseFloat(button.radius) <= 4), 'Collection buttons remain accessible and use compact corners.');
      assert.equal(await host.getByRole('searchbox', { name: 'Find a playlist', exact: true }).isVisible(), true, 'Playlists provide a visible search field.');
      const picker = await host.locator('.playlist-browser__list').evaluate(list => {
        const probe = list.cloneNode(false);
        probe.style.width = '260px';
        for (let i = 0; i < 2; i++) { const button = document.createElement('button'); button.className = 'playlist-browser__item'; button.textContent = `Playlist ${i}`; probe.append(button); }
        list.after(probe);
        const parent = probe.getBoundingClientRect(), boxes = [...probe.children].map(child => child.getBoundingClientRect());
        const result = { gap: parseFloat(getComputedStyle(probe).gap), fits: boxes.every(box => box.right <= parent.right + 1 && box.height >= 42) };
        probe.remove(); return result;
      });
      assert.ok(picker.gap >= 8 && picker.fits, 'Playlist buttons need spaced, accessible targets even in a narrow picker.');
    }
    await host.keyboard.press('Control+f');
    assert.equal(await search.evaluate(node => document.activeElement === node), true);
    assert.equal(await host.getByRole('button', { name: 'Library', exact: true }).getAttribute('aria-current'), 'page');
  }
  await host.getByRole('button', { name: 'Preferences', exact: true }).click();
  const preferences = host.getByRole('dialog', { name: 'Preferences', exact: true }); await preferences.waitFor();
  await host.keyboard.press('Control+f'); await preferences.waitFor({ state: 'hidden' });
  assert.equal(await search.evaluate(node => document.activeElement === node), true);

  await app.evaluate(({ dialog }, fixture) => { globalThis.searchWorkspaceQa.nextOpenFile = fixture; }, fixture);
  await host.getByRole('button', { name: 'Import Video File', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getState()).versions.length === 1);
  const saved = await host.evaluate(() => window.tpv.addYouTube({ url: 'knqa0000000', title: 'Saved Metadata Override', artist: 'Synthetic Artist', brandSlug: 'SyntheticBrand' }));
  assert.equal(saved.ok, true);
  await host.getByRole('button', { name: 'Sources', exact: true }).click();
  await host.getByRole('button', { name: 'Sign In to KaraFun', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.karaFun.status()).state === 'connected');
  await host.keyboard.press('Control+f'); await search.fill('Search');
  const songs = host.getByRole('listbox', { name: 'Songs', exact: true });
  await songs.getByText('KaraFun Search Song', { exact: true }).waitFor();
  await songs.getByText('YouTube Search Song 0', { exact: true }).waitFor();
  await songs.getByText('Community Search Song 01', { exact: true }).waitFor();
  await songs.getByText('Saved Metadata Override', { exact: true }).waitFor();
  assert.equal(await songs.getByText('Community Search Song 00', { exact: true }).count(), 0, 'Stored host metadata must win over exact catalog duplicates.');
  const headers = host.locator('.song-list__columns span');
  assert.deepEqual(await headers.allTextContents(), ['Name / Title', 'Artist', 'Duration', 'Service / Location', 'Date Added']);
  const localRow = songs.locator('[data-provider="local"]').first();
  await localRow.getByText('0:02', { exact: true }).waitFor();
  const sourceFilter = host.getByRole('combobox', { name: 'Source', exact: true });
  await sourceFilter.selectOption('youtube');
  await songs.getByText('YouTube Search Song 0', { exact: true }).waitFor();
  assert.equal(await songs.locator('[data-provider]:not([data-provider="youtube"])').count(), 0);
  const youtubeRow = songs.locator('[data-provider="youtube"]').first();
  assert.equal(await youtubeRow.locator('[data-field="source"]').textContent(), 'Synthetic Karaoke');
  assert.ok(await youtubeRow.locator('[data-field="date"]').textContent());
  await sourceFilter.selectOption('all');
  await songs.getByText('KaraFun Search Song', { exact: true }).waitFor();
  await host.locator('.library-fields summary').click();
  await host.getByRole('checkbox', { name: 'Duration', exact: true }).click();
  await waitForHostCondition(host, async () => !(await window.tpv.getSettings()).settings.libraryResultFields.includes('duration'));
  await host.getByRole('button', { name: 'Restore Defaults', exact: true }).click();
  await waitForHostCondition(host, async () => (await window.tpv.getSettings()).settings.libraryResultFields.includes('duration'));
  await host.locator('.library-fields summary').click();
  const colors = { local: 'rgb(96, 28, 233)', karafun: 'rgb(213, 22, 122)', karaokenerds: 'rgb(0, 123, 255)', youtube: 'rgb(255, 0, 51)', partytyme: 'rgb(250, 204, 21)' };
  for (const [provider, color] of Object.entries(colors)) {
    const row = songs.locator(`[data-provider="${provider}"]`).first(); await row.waitFor();
    const actual = await row.evaluate(node => ({ color: getComputedStyle(node).borderLeftColor, width: parseFloat(getComputedStyle(node).borderLeftWidth) }));
    assert.equal(actual.color, color); assert.ok(actual.width >= 2 && actual.width <= 3, `${provider} border: ${JSON.stringify(actual)}`);
  }
  const partyRow = songs.locator('[data-provider="partytyme"]').first();
  const compact = await songs.locator('[data-provider="local"]').first().evaluate(node => {
    const style = getComputedStyle(node);
    return { height: node.getBoundingClientRect().height, radius: style.borderRadius };
  });
  assert.ok(compact.height >= 34 && compact.height <= 50 && parseFloat(compact.radius) === 0, `Song results must be compact, accessible flat rows: ${JSON.stringify(compact)}`);
  const dayKeyline = await partyRow.evaluate(node => { const line = getComputedStyle(node, '::before'); return { content: line.content, color: line.backgroundColor, width: line.width }; });
  assert.equal(dayKeyline.content, '""'); assert.equal(dayKeyline.color, 'rgb(107, 82, 0)'); assert.equal(dayKeyline.width, '1px', 'Day theme keeps a contrasting edge next to the yellow stripe.');
  for (const provider of ['local', 'karafun', 'karaokenerds', 'youtube', 'partytyme', 'sunfly', 'stingray']) {
    const row = songs.locator(`[data-provider="${provider}"]`).first(); await row.scrollIntoViewIfNeeded(); await row.click({ button: 'right' });
    const menu = host.getByRole('menu').filter({ has: host.getByRole('menuitem', { name: 'Add to Queue', exact: true }) });
    await menu.waitFor();
    const menuBox = await menu.evaluate(node => ({ top: node.getBoundingClientRect().top, bottom: node.getBoundingClientRect().bottom, viewport: innerHeight }));
    assert.ok(menuBox.top >= 0 && menuBox.bottom <= menuBox.viewport + 1, `The ${provider} context menu must fit the viewport: ${JSON.stringify(menuBox)}`);
    const catalogOnly = ['partytyme', 'sunfly', 'stingray'].includes(provider);
    assert.equal(await menu.getByRole('menuitem', { name: 'Add to Queue', exact: true }).isEnabled(), !catalogOnly);
    assert.equal(await menu.getByRole('menuitem', { name: 'Edit Metadata', exact: true }).isEnabled(), ['local'].includes(provider) || provider === 'karaokenerds' && await row.getByText('Saved Metadata Override', { exact: true }).count() === 1);
    if (!catalogOnly) {
      await menu.getByRole('menuitem', { name: 'Add to Queue', exact: true }).click();
      const request = host.getByRole('dialog', { name: 'Add to Queue', exact: true }); await request.waitFor();
      await request.getByRole('button', { name: 'Cancel', exact: true }).click(); await request.waitFor({ state: 'hidden' });
    } else await host.keyboard.press('Control+f');
  }
  const karaFunRow = songs.locator('[data-provider="karafun"]').first();
  await karaFunRow.scrollIntoViewIfNeeded(); await karaFunRow.click({ button: 'right' });
  await host.screenshot({ path: join(screenshots, 'unified-karafun-context-menu.png') });
  await host.keyboard.press('Control+f');
  await karaFunRow.getByRole('button', { name: /^Rate KaraFun Search Song\./ }).click();
  const rating = host.getByRole('dialog', { name: 'Rate This Recording', exact: true }); await rating.waitFor();
  assert.equal(await rating.getByRole('radio', { name: '7 stars out of 10', exact: true }).isEnabled(), true);
  assert.equal((await app.evaluate(() => searchWorkspaceQa.ratingKeys)).includes('karafun:catalog:6229'), true,
    'A search-only KaraFun recording must use its exact global identity without an imported fingerprint.');
  await rating.getByRole('radio', { name: '7 stars out of 10', exact: true }).click();
  await rating.getByRole('alert').waitFor();
  assert.equal(await rating.isVisible(), true, 'A failed vote keeps the dialog open for review.');
  await rating.getByRole('radio', { name: '8 stars out of 10', exact: true }).click();
  await rating.waitFor({ state: 'hidden' });
  assert.deepEqual(await app.evaluate(() => searchWorkspaceQa.ratingVotes), [
    { recordingKey: 'karafun:catalog:6229', value: 7 }, { recordingKey: 'karafun:catalog:6229', value: 8 }]);
  await host.locator('.library-results').evaluate(node => { node.scrollTop = 0; });
  const geometry = await host.evaluate(() => {
    const results = document.querySelector('.library-results').getBoundingClientRect(), workspace = document.querySelector('.main-panel').getBoundingClientRect();
    const transport = document.querySelector('.transport').getBoundingClientRect();
    return { results: results.height, workspace: workspace.height, transportTop: transport.top, transportBottom: transport.bottom, viewport: innerHeight, page: document.documentElement.scrollHeight };
  });
  const geometryProblems = [];
  if (geometry.results < geometry.workspace * .4) geometryProblems.push(`Search results must dominate the workspace: ${JSON.stringify(geometry)}`);
  if (!(geometry.transportTop >= 0 && geometry.transportBottom <= geometry.viewport + 1 && geometry.page <= geometry.viewport + 1)) geometryProblems.push(`Transport must fit: ${JSON.stringify(geometry)}`);
  await host.mouse.move(5, 5);
  await host.screenshot({ path: join(screenshots, 'search-workspace-day.png') });
  const previousPreviewImage = await host.getByAltText('Live singer display preview', { exact: true }).getAttribute('src');

  await host.getByRole('button', { name: 'Preferences', exact: true }).click(); await preferences.waitFor();
  const section = preferences.locator('[data-settings-section="singer-display"]');
  if (await section.count()) { if (!await section.evaluate(node => node.open)) await section.locator('summary').click(); }
  else await preferences.locator('summary').filter({ hasText: /^Singer Display$/ }).click();
  const showLogo = preferences.getByLabel('Show custom logo', { exact: true }); assert.equal(await showLogo.isChecked(), false);
  await app.evaluate((_electron, file) => { globalThis.searchWorkspaceQa.nextOpenFile = file; }, logo);
  await preferences.getByRole('button', { name: 'Choose Logo…', exact: true }).click();
  const preview = preferences.getByAltText('Selected singer display logo', { exact: true }); await preview.waitFor();
  assert.match(await preview.getAttribute('src'), /^data:image\/png;base64,/);
  assert.equal(await showLogo.isChecked(), false, 'Choosing a logo still previews it while display visibility is disabled.');
  await preferences.getByRole('button', { name: 'Remove Logo', exact: true }).click(); await preview.waitFor({ state: 'hidden' });
  await app.evaluate((_electron, file) => { globalThis.searchWorkspaceQa.nextOpenFile = file; }, logo);
  await preferences.getByRole('button', { name: 'Choose Logo…', exact: true }).click(); await preview.waitFor();
  await preview.scrollIntoViewIfNeeded(); await preferences.screenshot({ path: join(screenshots, 'logo-preview-settings.png') });
  await preferences.getByLabel('Booth Name', { exact: true }).fill('Synthetic Search Booth');
  const size = preferences.getByRole('slider', { name: 'Logo Size', exact: true });
  await size.focus(); await size.press('Home'); for (let index = 0; index < 65; index++) await size.press('ArrowRight');
  await showLogo.check();
  await preferences.getByLabel('Show scrolling banner', { exact: true }).check();
  await preferences.getByLabel('Banner Message', { exact: true }).fill('Welcome, synthetic singers!');
  await preferences.getByLabel('Banner Position', { exact: true }).selectOption('top');
  const expiry = new Date(Date.now() + 3_600_000); expiry.setSeconds(0, 0);
  const localTime = new Date(expiry.getTime() - expiry.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  await preferences.getByLabel('Banner Stop Time', { exact: true }).fill(localTime);
  await preferences.screenshot({ path: join(screenshots, 'singer-branding-settings.png') });
  await preferences.getByRole('button', { name: 'Save preferences', exact: true }).click(); await preferences.waitFor({ state: 'hidden' });
  const settings = (await host.evaluate(() => window.tpv.getSettings())).settings;
  assert.equal(settings.boothName, 'Synthetic Search Booth'); assert.equal(settings.displayLogoSize, 75);
  assert.equal(settings.bannerText, 'Welcome, synthetic singers!'); assert.equal(settings.bannerPosition, 'top');
  assert.equal(Date.parse(settings.bannerExpiresAt), expiry.getTime(), 'Local banner time must persist as the same UTC instant.');
  await host.waitForFunction(() => document.querySelector('.topbar__identity h1')?.textContent === 'Synthetic Search Booth');
  await host.waitForFunction(previous => document.querySelector('img[alt="Live singer display preview"]')?.getAttribute('src') !== previous, previousPreviewImage);
  await waitForHostCondition(host, async () => !!await window.tpv.singerScreens.preview());
  const windows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => ({ url: window.webContents.getURL(), visible: window.isVisible() })));
  const display = windows.find(window => window.url.replaceAll('\\', '/').includes('/src/display/index.html'));
  assert.ok(display); assert.equal(display.visible, false, 'The preview must render without a visible singer window.');
  const singer = app.windows().find(page => page.url().replaceAll('\\', '/').includes('/src/display/index.html'));
  assert.ok(singer); await singer.locator('#idle-booth-name').filter({ hasText: 'Synthetic Search Booth' }).waitFor({ state: 'attached' });
  assert.equal(await singer.locator('#booth-banner-text').textContent(), 'Welcome, synthetic singers!');
  assert.equal(await singer.locator('#booth-banner').getAttribute('data-position'), 'top');
  const brandingState = await singer.evaluate(() => ({ logoWidth: getComputedStyle(document.querySelector('#idle-logo')).width,
    bannerVisible: !document.querySelector('#booth-banner').hidden }));
  assert.equal(brandingState.bannerVisible, true); assert.ok(parseFloat(brandingState.logoWidth) > 500, 'A 75vw logo must exceed the old 500px cap on this display.');
  await host.evaluate(() => window.tpv.saveSettings({ appearance: 'night' }));
  await host.waitForFunction(() => document.documentElement.dataset.theme === 'night');
  const nightKeyline = await partyRow.evaluate(node => getComputedStyle(node, '::before').content);
  assert.equal(nightKeyline, 'none', 'Night theme retains the unoutlined yellow stripe.');
  await host.mouse.move(5, 5);
  await host.screenshot({ path: join(screenshots, 'search-workspace-night.png') });
  const state = await host.evaluate(() => window.tpv.getState()); assert.equal(state.requests.length, 0); assert.equal(state.playback, null);
  const counters = await app.evaluate(() => ({ unexpectedFetches: searchWorkspaceQa.unexpectedFetches, downloads: searchWorkspaceQa.downloads }));
  assert.deepEqual(counters, { unexpectedFetches: 0, downloads: 0 }); assert.deepEqual(pageErrors, []);
  assert.deepEqual(geometryProblems, []);
  console.log(`PASS ${metadata.version}: global search/navigation/focus, unified synthetic providers, borders/context menus/metadata precedence, global KaraFun rating identity, dominant results (${Math.round(geometry.results / geometry.workspace * 100)}% of workspace), fixed transport, immediate logo preview, branding/timezone save and hidden singer preview. Screenshots: ${screenshots}`);
} catch (error) {
  if (host) { await host.screenshot({ path: join(screenshots, 'failure.png') }).catch(() => {}); console.error((await host.locator('body').ariaSnapshot().catch(() => '')).slice(-12000)); }
  throw error;
} finally {
  if (app) await app.close().catch(() => {});
  const actual = await realpath(temp);
  if (dirname(actual) !== temporaryRoot || !actual.startsWith(temporaryRoot + sep) || !basename(actual).startsWith('tpv-search-workspace-')) throw Error('Unsafe search rehearsal cleanup path.');
  await rm(actual, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
