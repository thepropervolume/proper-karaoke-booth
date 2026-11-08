import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { validInternetInvitation } from '../../src/remote/internet-control';

test('internet invitation must be a single fragment credential on the active HTTPS tunnel origin', () => {
  const origin = 'https://sample-name.trycloudflare.com', token = 'A'.repeat(43);
  assert.equal(validInternetInvitation(`${origin}/singer/#invite=${token}`, origin), true);
  for (const link of [`http://sample-name.trycloudflare.com/singer/#invite=${token}`, `https://evil.trycloudflare.com/singer/#invite=${token}`,
    `${origin}/singer/?invite=${token}`, `${origin}/singer/#invite=${token}&x=1`, `${origin}/singer/#invite=short`,
    `${origin}/other/#invite=${token}`, `https://user@sample-name.trycloudflare.com/singer/#invite=${token}`]) assert.equal(validInternetInvitation(link, origin), false);
  assert.equal(validInternetInvitation(`${origin}/singer/#invite=${token}`, 'https://sample-name.trycloudflare.com.evil.test'), false);
  assert.equal(validInternetInvitation(`${origin}/singer/#invite=${token}`, null), false);
});
