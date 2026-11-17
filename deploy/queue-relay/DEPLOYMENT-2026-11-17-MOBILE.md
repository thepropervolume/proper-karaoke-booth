# Mobile deployment verification

Deployed 17 November 2026 at 10:30 UTC on Linode III. The mobile web app is `https://queue.thepropervolume.com/app/`; the relay health response reports 0.9.0. Source commit: `c85a1f079ae678ab74a566a15d5e862da3296b96`. No active room or retained route named `app`/`mobile` was present before installation.

The reviewed bundle replaced the relay executable, the mobile static build was installed under its dedicated Apache alias, and a service drop-in enabled mobile routes. The current service unit, configured owners, database passwords, credential exports, website, catalog schema and firewall policy were preserved. No migration or provider-feed refresh was needed. A new private code/config rollback copy is retained at `/var/backups/tpv-queue-relay/code/mobile-090-20261117T103059-d0d97e`.

| Installed input | SHA256 |
| --- | --- |
| Relay bundle | `65fae0cd7d3932e56073c89a80eedcbd2a2709ac4656c27a82b0f23bf624bb04` |
| Mobile web archive | `64cc1dab3e01f3d54fe8d6210fd3472ee6a68b52ca31339c8ada166863d44883` |
| Apache mobile include | `7de5e537c775230eb17cb688bf6d28a1b1466b90aeac5a816ff34443160ea3d6` |

Apache syntax and loopback relay health passed before public testing. Public browser verification used fresh isolated phone-sized Chrome contexts with no account/provider credential. It passed shared MySQL snapshot search and queue import, same-egress suggestion with explicit Join, guest admission, request, withdrawal and room-close revocation. A real YouTube IFrame recording advanced its clock to 0:01 with 4:29 duration. The app's service worker installed and populated its interface cache; no console/page errors were observed. The temporary QA room was explicitly closed. Evidence and screenshots remain under ignored `release/mobile-live-090*` in the local checkout.

The disposable MySQL suite passed all 13 tests, including concurrent reservation quotas, 150 remaining desktop slots, room/tombstone expiry and anonymous-owner cleanup while retaining configured owners. The test schema was removed after verification. Public catalog reads use fixed loopback port 8765, preserving the relay's localhost-only network sandbox. Ordinary application/CFNetwork user agents passed public health/catalog requests; generic Python urllib probes received 403 and were not used as browser evidence.

Native workflow [44064086210](https://github.com/thepropervolume/proper-karaoke-booth/actions/runs/44064086210) compiled Android APK/AAB and the iOS Simulator app. GitHub rejected both artifact uploads because Actions storage is full; the workflow therefore failed after successful compilation. No native download or phone installation is implied. Physical phones, Wi-Fi isolation/local discovery permissions, actual native playback/output, store signing and long-show acceptance remain open. The browser app is usable independently of those distribution gates.
