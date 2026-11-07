import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metadataFromFilename, metadataFromPath, validateMetadataTemplates } from '../../src/domain/metadata';

test('legacy formats retain their old filename parsing', () => {
  assert.deepEqual(metadataFromFilename('Artist - Song - Mix', 'artist-title'), { artist: 'Artist', title: 'Song - Mix' });
  assert.deepEqual(metadataFromFilename('Song - Artist', 'title-artist'), { artist: 'Artist', title: 'Song' });
  assert.deepEqual(metadataFromFilename('Artist - Song', 'filename'), { artist: '', title: 'Artist - Song' });
  assert.deepEqual(metadataFromPath('C:\\songs\\Artist - Song.mp4', [], 'artist-title'),
    { title: 'Song', artist: 'Artist', matchedTemplate: null, ambiguous: false });
});

test('extracts disk code, title, artist and track number, including directory components', () => {
  const template = '{Artist}/{DJ Code} - {Track Number} - {Track Name}';
  assert.deepEqual(metadataFromPath('C:\\library\\Queen\\SC123 - 07 - Bohemian Rhapsody.MP4', [template], 'filename'),
    { title: 'Bohemian Rhapsody', artist: 'Queen', djCode: 'SC123', trackNumber: '07', matchedTemplate: template, ambiguous: false });
  assert.deepEqual(metadataFromPath('/music/Queen/03 - Song.mp4', ['{artist}/{trackNumber} - {title}'], 'filename'),
    { title: 'Song', artist: 'Queen', trackNumber: '03', matchedTemplate: '{artist}/{trackNumber} - {title}', ambiguous: false });
});

test('supports requested ${...} examples and optional MP4 extension in templates', () => {
  const code = '${DJ Code} - ${Artist} - ${Track Name}';
  assert.deepEqual(metadataFromPath('DJID-002 - Nada Surf - Popular.mp4', [code], 'filename'),
    { title: 'Popular', artist: 'Nada Surf', djCode: 'DJID-002', matchedTemplate: code, ambiguous: false });
  const numbered = '${Track Number}.${Artist} - ${Title}';
  assert.deepEqual(metadataFromPath('03.Nada Surf - Popular.mp4', [numbered], 'filename'),
    { title: 'Popular', artist: 'Nada Surf', trackNumber: '03', matchedTemplate: numbered, ambiguous: false });
  const folders = 'Media/${Artist}/${Track Name}.mp4';
  assert.deepEqual(metadataFromPath('C:\\library\\Media\\Nada Surf\\Popular.MP4', [folders], 'filename'),
    { title: 'Popular', artist: 'Nada Surf', matchedTemplate: folders, ambiguous: false });
  const reverse = '${Title} - ${Artist}';
  assert.deepEqual(metadataFromPath('Popular - Nada Surf.mp4', [reverse], 'artist-title'),
    { title: 'Popular', artist: 'Nada Surf', matchedTemplate: reverse, ambiguous: false });
  assert.throws(() => validateMetadataTemplates(['${Artist}${Title}']));
});

test('ordered templates determine priority and differing results are marked ambiguous', () => {
  const templates = ['{djCode} - {artist} - {title}', '{artist} - {title}'];
  assert.deepEqual(metadataFromPath('/songs/SC123 - Queen - Song.mp4', templates, 'artist-title'),
    { title: 'Song', artist: 'Queen', djCode: 'SC123', matchedTemplate: templates[0], ambiguous: true });
  assert.equal(metadataFromPath('/songs/A - B - C.mp4', ['{artist} - {title}'], 'filename').ambiguous, true);
  assert.equal(metadataFromPath('/songs/A - B.mp4', ['{artist} - {title}', '{artist} - {title}'], 'filename').ambiguous, false);
});

test('unmatched or invalid captures fall back and never fabricate directory fields', () => {
  assert.deepEqual(metadataFromPath('/songs/Queen/Song.mp4', ['{artist}/{trackNumber} - {title}'], 'filename'),
    { title: 'Song', artist: '', matchedTemplate: null, ambiguous: false });
  assert.deepEqual(metadataFromPath('Song.mp4', ['{artist}/{title}'], 'filename'),
    { title: 'Song', artist: '', matchedTemplate: null, ambiguous: false });
});

test('template validation rejects invalid, duplicate, and ambiguous-adjacent fields', () => {
  for (const item of ['{artist}', '{artist}{title}', '{artist} - {title} - {track}', '{title}/{unknown}', '/{title}', '{title}//x', '{title}\\x', '{title', '{title}}'])
    assert.throws(() => validateMetadataTemplates([item]), item);
  assert.throws(() => validateMetadataTemplates('not a list'));
  assert.throws(() => validateMetadataTemplates(Array(33).fill('{title}')));
  assert.deepEqual(validateMetadataTemplates([]), []);
  assert.deepEqual(validateMetadataTemplates(['{DJ Code} - {artist} - {trackName}']), ['{DJ Code} - {artist} - {trackName}']);
});

