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

test('template validation rejects malformed and ambiguous-adjacent fields while accepting repeated and unused placeholders', () => {
  for (const item of ['{artist}', '{artist}{title}', '/{title}', '{title}//x', '{title}\\x', '{title', '{title}}', '{title}/{}', '{title}/${unused/path}', '{title}/${nested{field}}', '{title}/${bad\nname}'])
    assert.throws(() => validateMetadataTemplates([item]), item);
  assert.throws(() => validateMetadataTemplates('not a list'));
  assert.throws(() => validateMetadataTemplates(Array(33).fill('{title}')));
  assert.throws(() => validateMetadataTemplates(['x'.repeat(506) + '{title}']));
  assert.deepEqual(validateMetadataTemplates([]), []);
  assert.deepEqual(validateMetadataTemplates(['{DJ Code} - {artist} - {trackName}']), ['{DJ Code} - {artist} - {trackName}']);
  assert.deepEqual(validateMetadataTemplates(['{artist} - {title} - {track}', '{title}/{unknown}']), ['{artist} - {title} - {track}', '{title}/{unknown}']);
});

test('all six owner-supplied patterns save and extract their intended fields', () => {
  const examples = [
    { template: '${DJ Code}-${Track Number} - ${Artist} - ${Title}', path: 'PVOL-0382 - Nada Surf - Popular.mp4', extra: { djCode: 'PVOL', trackNumber: '0382' } },
    { template: '${Artist}/${Artist} - ${Title}', path: 'Nada Surf/Nada Surf - Popular.mp4' },
    { template: '${Artist}/${Title}', path: 'Nada Surf/Popular.mp4' },
    { template: '${Artist}/${Track Number}.${Title}', path: 'Nada Surf/03.Popular.mp4', extra: { trackNumber: '03' } },
    { template: '${Track Number}.${Artist} - ${Title}', path: '03.Nada Surf - Popular.mp4', extra: { trackNumber: '03' } },
    { template: '${Artist}/${Track Number} - ${Artist} - ${Title}', path: 'Nada Surf/03 - Nada Surf - Popular.mp4', extra: { trackNumber: '03' } },
  ];
  const templates = examples.map(example => example.template);
  assert.deepEqual(validateMetadataTemplates(templates), templates);
  for (const example of examples)
    assert.deepEqual(metadataFromPath(`C:/Karaoke/${example.path}`, [example.template], 'filename'),
      { title: 'Popular', artist: 'Nada Surf', ...example.extra, matchedTemplate: example.template, ambiguous: false }, example.template);
});

test('repeated known fields constrain the match without overwriting the first spelling', () => {
  const repeatedArtist = '${Artist}/${artist} - ${Title}';
  assert.deepEqual(metadataFromPath('Nada Surf/NADA SURF - Popular.mp4', [repeatedArtist], 'filename'),
    { title: 'Popular', artist: 'Nada Surf', matchedTemplate: repeatedArtist, ambiguous: false });
  assert.deepEqual(metadataFromPath('Wrong Artist/Nada Surf - Popular.mp4', [repeatedArtist], 'artist-title'),
    { title: 'Popular', artist: 'Nada Surf', matchedTemplate: null, ambiguous: false });
  const repeatedTitle = '${Title} - ${Track Name}';
  assert.equal(metadataFromPath('Popular - Popular.mp4', [repeatedTitle], 'filename').title, 'Popular');
  assert.equal(metadataFromPath('Popular - Another Song.mp4', [repeatedTitle], 'filename').matchedTemplate, null);
});

test('arbitrary unused placeholders are ignored, may repeat, and do not pollute returned metadata', () => {
  const template = '${Genre}/${Year}/${Genre}/${__proto__}/${Artist} - ${Title}';
  assert.deepEqual(metadataFromPath('/Rock/1996/Alternative/ignored/Nada Surf - Popular.mp4', [template], 'filename'),
    { title: 'Popular', artist: 'Nada Surf', matchedTemplate: template, ambiguous: false });
  const many = '${Unused}/'.repeat(40) + '${Title}';
  assert.deepEqual(validateMetadataTemplates([many]), [many]);
  assert.deepEqual(metadataFromPath('ignored/'.repeat(40) + 'Popular.mp4', [many], 'filename'),
    { title: 'Popular', artist: '', matchedTemplate: many, ambiguous: false });
});

test('equivalent ignored-field splits cannot hide a later distinct metadata result', () => {
  const template = '${Title} - ${Artist} - ${Unused} - ${Unused}';
  assert.deepEqual(metadataFromPath('Popular - Nada Surf - A - B - C.mp4', [template], 'filename'),
    { title: 'Popular', artist: 'Nada Surf', matchedTemplate: template, ambiguous: true });
  const onlyIgnored = '${Artist}/${Title}/${Unused} - ${Unused}';
  assert.equal(metadataFromPath('Nada Surf/Popular/A - B - C.mp4', [onlyIgnored], 'filename').ambiguous, false);
});

test('many unused captures retain the bounded-search ambiguity signal', () => {
  const template = '${Unused}-'.repeat(20) + '${Title} - REQUIRED';
  const result = metadataFromPath('part-'.repeat(40) + 'Song.mp4', [template], 'filename');
  assert.equal(result.matchedTemplate, null);
  assert.equal(result.ambiguous, true);
});

