import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MissingSongReviewView } from '../../src/renderer/MissingSongReviewPanel';

test('host review lists the requester and accessible statuses while escaping user text', () => {
  const html = renderToStaticMarkup(React.createElement(MissingSongReviewView, {
    items: [{ id: 'r1', title: '<Song>', artist: 'Artist', singer: 'Alice', createdAt: '2026-01-01', status: 'reviewing', updatedAt: null }],
    error: '', updating: null, onUpdate: () => {},
  }));
  assert.match(html, /Unavailable Song Requests/); assert.match(html, /&lt;Song&gt;/); assert.doesNotMatch(html, /<Song>/);
  assert.match(html, /requested by Alice/); assert.match(html, /aria-label="Status for &lt;Song&gt;, requested by Alice"/);
  for (const status of ['Pending', 'Reviewing', 'Fulfilled', 'Declined']) assert.match(html, new RegExp(status));
  assert.match(html, /value="reviewing" selected=""/);
});
test('empty, loading, and failed states explain what the host can see', () => {
  const render = (items: null | [], error: string) => renderToStaticMarkup(React.createElement(MissingSongReviewView, { items, error, updating: null, onUpdate: () => {} }));
  assert.match(render(null, ''), /Loading requests/); assert.match(render([], ''), /No unavailable song requests yet/);
  assert.match(render([], 'Unavailable'), /role="alert"/);
});
