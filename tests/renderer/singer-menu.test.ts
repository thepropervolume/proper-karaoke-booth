import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SingerAvailabilityControl } from '../../src/renderer/SingerAvailabilityControl';

test('singer list keeps availability controls in the actions menu', () => {
  const html=renderToStaticMarkup(React.createElement(SingerAvailabilityControl, {
    singer:{id:'singer-1',name:'Ben'},nowMs:0,busy:false,onChange:()=>{},onRemove:()=>{},removeBlocked:false,
  }));
  assert.match(html,/Actions for Ben/); assert.match(html,/aria-haspopup="menu"/);
  assert.doesNotMatch(html,/Mark unavailable|Unavailable for|Remove from show/);
});
