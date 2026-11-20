import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../../mobile/web-public/youtube-player.js', import.meta.url), 'utf8');
function launch(start?: string) {
  const query = new URLSearchParams({ video: 'Video123456', channel: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', ...(start === undefined ? {} : { start }) });
  const messages: unknown[] = []; let handler: ((event: unknown) => void) | undefined, options: any, plays = 0;
  const parent = { postMessage: (message: unknown) => messages.push(message) };
  const window = { addEventListener: (_type: string, listener: (event: unknown) => void) => { handler = listener; }, onYouTubeIframeAPIReady: () => {} };
  runInNewContext(source, { window, parent, URLSearchParams, location: { hash: '#' + query, origin: 'https://queue.thepropervolume.com' },
    document: { createElement: () => ({}), head: { append() {} } }, setInterval() {},
    YT: { Player: function (_id: string, value: unknown) { options = value; return { playVideo: () => plays++, pauseVideo() {}, seekTo() {}, setVolume() {}, getCurrentTime: () => 0, getDuration: () => 0 }; } } });
  window.onYouTubeIframeAPIReady();
  handler?.({ source: parent, origin: 'capacitor://localhost', data: { type: 'tpv-player-command', channel: query.get('channel'), command: 'hello' } });
  options.events.onReady();
  return { options, messages, plays };
}

test('native YouTube start checkpoint never instructs autoplay and remains backwards compatible', () => {
  const resumed = launch('42'); assert.equal(resumed.options.playerVars.start, 42); assert.equal(resumed.options.playerVars.autoplay, 0); assert.equal(resumed.plays, 0);
  assert.equal((resumed.messages[0] as { event: string }).event, 'ready');
  const old = launch(); assert.equal(old.options.playerVars.start, 0); assert.equal(old.options.playerVars.autoplay, 0); assert.equal(old.plays, 0);
  assert.equal(launch('garbage').options.playerVars.start, 0);
});
