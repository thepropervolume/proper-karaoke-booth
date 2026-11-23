import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SingerAvailabilityControl } from '../../src/renderer/SingerAvailabilityControl';
import { SINGER_ON_HOLD } from '../../src/domain/singer-availability';

test('singer list keeps availability controls in the actions menu', () => {
  const html=renderToStaticMarkup(React.createElement(SingerAvailabilityControl, {
    singer:{id:'singer-1',name:'Ben'},nowMs:0,busy:false,onChange:()=>{},onHold:()=>{},onRemove:()=>{},onRename:async()=>true,removeBlocked:false,
  }));
  assert.match(html,/Actions for Ben/); assert.match(html,/aria-haspopup="menu"/);
  assert.doesNotMatch(html,/Mark unavailable|Unavailable for|Hold until returned|Remove from show|Rename Singer/);
});

test('held singers show a hold label without an invented return time', () => {
  const html = renderToStaticMarkup(React.createElement(SingerAvailabilityControl, {
    singer: { id: 'singer-1', name: 'Ben', unavailableUntilMs: SINGER_ON_HOLD }, nowMs: 0, busy: false,
    onChange: () => {}, onHold: () => {}, onRemove: () => {}, onRename: async () => true, removeBlocked: false,
  }));
  assert.match(html, /On hold/);
  assert.doesNotMatch(html, /back in|minutes/);
});
