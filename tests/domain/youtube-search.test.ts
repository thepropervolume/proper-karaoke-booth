import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSettings } from '../../src/domain/settings';
import { filterYouTubeSearchEntries, MAX_YOUTUBE_SEARCH_OUTPUT_BYTES, normalizeYouTubeChannel, parseYouTubeChannels,
  parseYouTubeSubscriptions, youtubeKaraokeQuery, youtubeSongMetadata } from '../../src/domain/youtube-search';

const channelId = 'UC' + 'A'.repeat(22), secondChannel = 'UC' + 'B'.repeat(22), videoId = 'abcdEFG123_';
const record = { id: videoId, title: 'Nada Surf - Amateur (Karaoke Version)', channel_id: channelId,
  channel: 'Karaoke Studio', uploader_id: '@KaraokeStudio', duration: 210, live_status: 'not_live' };
const filter = (entries: unknown[], settings = parseSettings({})) => filterYouTubeSearchEntries({ entries }, settings);

test('YouTube preferences migrate safely and accept stable IDs or handles rather than display names', () => {
  const defaults = parseSettings({});
  assert.equal(defaults.youtubeSearchEnabled, true); assert.equal(defaults.youtubeSearchMode, 'karaoke-channels');
  assert.deepEqual(defaults.youtubeApprovedChannels, []); assert.deepEqual(defaults.youtubeBlockedChannels, []);
  const input = ['https://www.youtube.com/channel/' + channelId + '/videos', '@KaraokeStudio'];
  const configured = parseSettings({ youtubeSearchMode: 'approved-channels', youtubeApprovedChannels: input });
  input[0] = 'changed'; assert.deepEqual(configured.youtubeApprovedChannels, [channelId, '@karaokestudio']);
  assert.equal(normalizeYouTubeChannel(channelId.toLowerCase()), null, 'UC channel IDs retain case.');
  assert.equal(normalizeYouTubeChannel('https://www.youtube.com/@KaraokeStudio/videos'), '@karaokestudio');
  for (const value of ['Karaoke Studio', 'https://youtube.com.evil.test/@karaoke', 'https://youtube.com/user/LegacyUser', 'https://youtube.com/@karaoke%2fvideos', 'https://youtube.com/@karaoke?token=secret', 'http://youtube.com/@karaoke'])
    assert.equal(normalizeYouTubeChannel(value), null);
  assert.throws(() => parseYouTubeChannels(['@KaraokeStudio', '@karaokestudio']), /Duplicate/);
  for (const settings of [{ youtubeSearchEnabled: 'true' }, { youtubeSearchMode: 'anything' }, { youtubeApprovedChannels: ['Karaoke Studio'] }, { youtubeBlockedChannels: null }])
    assert.throws(() => parseSettings(settings));
});

test('every bounded search includes karaoke without converting query text into URLs or tool flags', () => {
  assert.equal(youtubeKaraokeQuery(' Nada Surf Amateur '), 'Nada Surf Amateur karaoke');
  assert.equal(youtubeKaraokeQuery('Nada Surf KARAOKE'), 'Nada Surf KARAOKE');
  assert.equal(youtubeKaraokeQuery('--exec $(private) https://other.test'), '--exec $(private) https://other.test karaoke');
  for (const value of ['', 'x', 'x'.repeat(201), 'text\n--cookies', null, 5]) assert.throws(() => youtubeKaraokeQuery(value));
});

test('public karaoke candidates reconstruct video/channel URLs and label guessed song metadata', () => {
  const result = filter([{ ...record, url: 'file:///private/path', webpage_url: 'https://evil.test/stream' }]);
  assert.equal(result.songs.length, 1);
  const song = result.songs[0];
  assert.equal(song.watchUrl, `https://www.youtube.com/watch?v=${videoId}`);
  assert.equal(song.channelUrl, `https://www.youtube.com/channel/${channelId}`);
  assert.equal(song.artist, 'Nada Surf'); assert.equal(song.title, 'Amateur');
  assert.equal(song.videoTitle, record.title); assert.equal(song.metadataSource, 'video-title');
  assert.equal(song.channelApproval, 'karaoke-hint'); assert.equal(song.channelHandle, '@karaokestudio');
  assert.equal(result.counts.examined, 1); assert.equal(result.counts.returned, 1);
});

test('host-approved channel mode requires exact identity and blocked IDs or handles always win', () => {
  const approved = parseSettings({ youtubeSearchMode: 'approved-channels', youtubeApprovedChannels: [channelId] });
  assert.equal(filter([{ ...record, channel: 'Studio', uploader_id: '@Studio' }], approved).songs[0].channelApproval, 'host-approved');
  const impostor = filter([{ ...record, channel_id: secondChannel }], approved);
  assert.equal(impostor.songs.length, 0); assert.equal(impostor.counts.channelNotApproved, 1);
  assert.equal(filter([record], parseSettings({ ...approved, youtubeBlockedChannels: [channelId] })).counts.blockedChannel, 1);
  assert.equal(filter([record], parseSettings({ ...approved, youtubeBlockedChannels: ['@KaraokeStudio'] })).counts.blockedChannel, 1);
  const handleApproved = parseSettings({ youtubeSearchMode: 'approved-channels', youtubeApprovedChannels: ['@KaraokeStudio'] });
  assert.equal(filter([record], handleApproved).songs.length, 1);
  assert.equal(filter([{ ...record, uploader_id: '@Unapproved', channel: 'KaraokeStudio' }], handleApproved).songs.length, 0, 'A display name cannot impersonate an approved handle.');
});

test('song and artist blacklists suppress all video IDs and either common title ordering', () => {
  const settings = parseSettings({ songBlacklist: [{ artist: 'Nada Surf', title: 'Amateur' }] });
  assert.equal(filter([record], settings).counts.blockedSong, 1);
  assert.equal(filter([{ ...record, id: 'otherID123_', title: 'Amateur - Nada Surf (Karaoke)' }], settings).counts.blockedSong, 1);
  assert.equal(filter([record], parseSettings({ artistBlacklist: ['Nada Surf'] })).counts.blockedSong, 1);
  assert.equal(filter([{ ...record, artist: 'Nada Surf', track: 'Amateur' }], settings).songs.length, 0);
  assert.equal(filter([{ ...record, title: 'Other Artist - Amateur (Karaoke)' }], settings).songs.length, 1);
});

test('filters reject missing identities, live/upcoming, unknown durations, restricted and non-karaoke content', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ id: '../outside' }, 'invalid'], [{ channel_id: 'Display Name' }, 'invalid'], [{ duration: null }, 'duration'],
    [{ duration: Infinity }, 'duration'], [{ duration: 44 }, 'duration'], [{ duration: 1801 }, 'duration'],
    [{ is_live: true }, 'live'], [{ live_status: 'is_upcoming' }, 'live'], [{ live_status: 'post_live' }, 'live'],
    [{ availability: 'needs_auth' }, 'restricted'], [{ age_limit: 18 }, 'restricted'], [{ age_limit: '18' }, 'invalid'],
    [{ title: 'Nada Surf official music video' }, 'notKaraoke'], [{ channel: 'Music Videos', uploader_id: '@MusicVideos' }, 'channelNotApproved'],
  ];
  for (const [patch, reason] of cases) {
    const result = filter([{ ...record, ...patch }]);
    assert.equal(result.songs.length, 0, JSON.stringify(patch));
    assert.equal(result.counts[reason as keyof typeof result.counts], 1, reason);
  }
  assert.equal(filter([record, record]).counts.duplicate, 1);
  assert.throws(() => filter(Array(21).fill(record)), /Invalid/);
  assert.throws(() => filterYouTubeSearchEntries({ entries: 'not an array' }, parseSettings({})), /Invalid/);
});

test('metadata suggestions preserve uncertainty and never invent a cross-provider song ID', () => {
  assert.deepEqual(youtubeSongMetadata('Karaoke: Nada Surf - Amateur', null, null), { artist: 'Nada Surf', title: 'Amateur', metadataSource: 'video-title' });
  assert.deepEqual(youtubeSongMetadata('Unstructured Karaoke', undefined, undefined), { artist: null, title: 'Unstructured', metadataSource: 'unparsed-video-title' });
  assert.deepEqual(youtubeSongMetadata(record.title, 'Verified Artist', 'Verified Track'), { artist: 'Verified Artist', title: 'Verified Track', metadataSource: 'youtube-metadata' });
});

test('search presentation strips karaoke production suffixes and validates publication dates', () => {
  const rawTitle = 'Nada Surf - Amateur (Karaoke Version) - Karaoke Studio';
  const [song] = filter([{ ...record, title: rawTitle, release_date: '20221009', upload_date: '20221102' }]).songs;
  assert.deepEqual([song.artist, song.title, song.channelName, song.durationSeconds, song.dateAdded], ['Nada Surf', 'Amateur', 'Karaoke Studio', 210, '2022-10-09']);
  assert.equal(song.videoTitle, rawTitle);
  assert.equal(filter([{ ...record, release_date: '20240230', upload_date: '20240229' }]).songs[0].dateAdded, '2024-02-29');
  assert.deepEqual(youtubeSongMetadata('Wonderwall (Karaoke Version) by Oasis', null, null), { artist: 'Oasis', title: 'Wonderwall', metadataSource: 'video-title' });
  assert.deepEqual(youtubeSongMetadata('Oasis - Wonderwall (Live) | Karaoke With Lyrics', null, null), { artist: 'Oasis', title: 'Wonderwall (Live)', metadataSource: 'video-title' });
});

test('Google Takeout CSV imports only stable channel IDs with quoted names and duplicate reporting', () => {
  const csv = `\uFEFFChannel Id,Channel Url,Channel Title\r\n${channelId},https://youtube.com/channel/${channelId},"Studio, Karaoke"\r\n${secondChannel},https://youtube.com/channel/${secondChannel},"A ""quoted"" studio"\r\n${channelId},,Duplicate`;
  assert.deepEqual(parseYouTubeSubscriptions(csv), { channels: [channelId, secondChannel], ignored: 1 });
  assert.throws(() => parseYouTubeSubscriptions('Channel Title\nKaraoke Studio'), /Channel Id/);
  assert.throws(() => parseYouTubeSubscriptions('Channel Id,Channel Title\n"unterminated'), /quoting/);
});

test('JSON subscriptions read target channel IDs without treating subscription record IDs or names as channel identities', () => {
  const json = JSON.stringify({ items: [{ id: 'subscription-id', snippet: { resourceId: { channelId } } }, { channelId: secondChannel },
    { channel_id: channelId }, { id: secondChannel, title: 'Do not trust subscription ID' }] });
  assert.deepEqual(parseYouTubeSubscriptions(json), { channels: [channelId, secondChannel], ignored: 2 });
  assert.deepEqual(parseYouTubeSubscriptions(JSON.stringify([channelId])), { channels: [channelId], ignored: 0 });
  for (const input of ['{bad', '[]', '{}', 'Channel Id\nnot-a-channel', 'x'.repeat(MAX_YOUTUBE_SEARCH_OUTPUT_BYTES + 1)])
    assert.throws(() => parseYouTubeSubscriptions(input));
});
