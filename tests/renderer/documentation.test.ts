import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderGuide } from '../../scripts/desktop-documentation.mjs';

test('the bundled help links only to its included guides and guide sections', () => {
  const html = renderGuide('help', `# Quick Start

[Queue](./queue-management.md#singer-rotation) [Here](#quick-start)

[Website](https://example.com) [Unknown](unknown.md) [File](../README.md) [Absolute](/help.md)

<img src="file:///example.png"> ![Remote image](https://example.com/image.jpg)

## Quick Start`);
  assert.deepEqual([...html.matchAll(/href="([^"]+)"/g)].map(match => match[1]), ['#queue-management/singer-rotation', '#help/quick-start']);
  assert.match(html, /id="help\/quick-start-1"/);
  assert.match(html, /Website Unknown File Absolute/);
  assert.doesNotMatch(html, /<img|https?:\/\/|file:\/\//);
  assert.throws(() => renderGuide('unknown', '# Heading'), /Unknown Booth guide/);
});
