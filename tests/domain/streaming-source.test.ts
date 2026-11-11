import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validStreamingSource, youtubeIdentity } from '../../src/domain/streaming-source';
import { applyCommand, createInitialState } from '../../src/domain';
import { youtubeShowPage } from '../../src/main/youtube-show-page';

test('YouTube links retain exact video identity and reject foreign hosts, credentials and malformed IDs', () => {
  for (const value of ['M7lc1UVf-VE', 'https://youtu.be/M7lc1UVf-VE?t=5', 'https://www.youtube.com/watch?v=M7lc1UVf-VE&list=example', 'https://www.youtube.com/shorts/M7lc1UVf-VE']) assert.equal(youtubeIdentity(value), 'M7lc1UVf-VE');
  for (const value of ['https://youtube.com.evil.test/watch?v=M7lc1UVf-VE', 'http://youtu.be/M7lc1UVf-VE', 'https://user@youtu.be/M7lc1UVf-VE', 'https://youtu.be/M7lc1UVf-VE/extra', 'https://youtube.com/watch?v=M7lc1UVf-VE&v=other123456', '<script>bad</script>']) assert.equal(youtubeIdentity(value), null);
});

test('streaming source metadata is narrow and preserves existing local versions', () => {
  assert.equal(validStreamingSource({ provider: 'youtube', videoId: 'M7lc1UVf-VE' }), true);
  for (const value of [{provider:'karafun',videoId:'M7lc1UVf-VE'}, {provider:'youtube',videoId:'bad'}, {provider:'youtube',videoId:'M7lc1UVf-VE',path:'/secret'}]) assert.equal(validStreamingSource(value), false);
  const original = createInitialState('show','epoch');
  const add = (source?: any) => applyCommand(original, { commandId:'c',showId:'show',hostEpoch:'epoch',expectedRevision:0,actor:{role:'host',id:'host'},command:{type:'addVersion',version:{id:'song',title:'Track',artist:'Artist',rating:'unrated',...(source?{source}: {})}} });
  assert.equal(add().outcome.ok, true);
  assert.equal(add({provider:'youtube',videoId:'M7lc1UVf-VE'}).state.versions[0].source?.videoId, 'M7lc1UVf-VE');
  assert.equal(add({provider:'youtube',videoId:'bad'}).outcome.ok, false);
});

test('show player uses the official API with visible native controls, no remote show authority or unvalidated markup', () => {
  const page = youtubeShowPage('M7lc1UVf-VE','http://127.0.0.1:1234');
  assert.match(page,/https:\/\/www\.youtube\.com\/iframe_api/);
  assert.match(page,/controls:1,playsinline:1,autoplay:0/);
  assert.match(page,/textContent=value.caption/);
  assert.doesNotMatch(page,/ipcRenderer|require\(|nodeIntegration|display:none|controls:0/);
  assert.throws(()=>youtubeShowPage('<bad>','http://127.0.0.1:1234'));
  assert.throws(()=>youtubeShowPage('M7lc1UVf-VE','http://evil.test'));
});
