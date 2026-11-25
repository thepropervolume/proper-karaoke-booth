import assert from 'node:assert/strict';

export const iosAppId = 'com.thepropervolume.karaoke';
export const iosLiveActivityId = iosAppId + '.liveactivity';

/** The reviewed project can request only the app and its known extension. */
export function iosReleaseTargets(project) {
  const bundleIds = Array.from(project.matchAll(/\bPRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;]+);/g),
    match => match[1].trim()).sort();
  const hasWidget = /\bpath\s*=\s*RoomLiveActivity\.appex\s*;/.test(project);
  const ids = hasWidget ? [iosAppId, iosLiveActivityId] : [iosAppId];
  assert.deepEqual(bundleIds, ids.flatMap(id => [id, id]),
    'The iOS app and Live Activity extension bundle IDs do not match their store identities.');
  return ids;
}
