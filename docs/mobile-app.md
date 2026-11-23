# TPV Karaoke Mobile Singer Guide

The mobile workspace opens to **Library**. Browse and save songs on your own, then join a desktop host’s room when you are ready to request a song. The same workspace is built for the [mobile web app](https://queue.thepropervolume.com/app/), iOS, and Android. Full Host is paused while the mobile singer experience takes priority.

## Browse and Save Songs

1. Open **Library** and enter at least two characters of an artist or title. Karaoke Nerds is selected by default. Tap **More Karaoke Nerds Results** to see the next page of matches from the shared catalog snapshot.
2. Turn catalogs on or off under **Profile → Browse Sources**. Karaoke Nerds, KaraFun’s public song list, and the Party Tyme Pro public songbook support browsing without an account. Party Tyme Pro’s listings may differ from what a host can queue using Party Tyme Consumer.
3. Tap **☆** beside a recording to save it to your personal **Starred Songs** playlist. Tap **★** to remove it. Open **Playlists** to see the list. For other collections, tap **Save to Playlist**, pick or name a playlist, and choose **Save Song**. Playback is on the host.

Joining a room sets the next Browse Mode defaults to the available public counterparts of the host’s reported sources. You can change those defaults after leaving. Catalog search requires an internet connection. Saved playlists and profile fields are available without a room.

## Set Up Your Profile

Open **Profile**, enter a display name and, optionally, an email, and choose **Save Profile**. Your display name can fill the join form. The email and playlists stay on this device, in the app or browser profile where you saved them. Clearing that app’s or site’s data removes them. A room still uses temporary guest access, and the host receives the name you submit when joining.

Your starred playlist uses your profile name. If you first star a song while in a room, Booth can use the name you joined with to name your list. The standalone room page keeps its own browser-local starred list for each join name.

## Join a Host

- **Nearby room.** Open **Room**, choose a suggestion, check that it belongs to your host, and tap **Join Room**. Native Android and iOS builds use DNS-SD when local-network access is available. A shared internet connection can also suggest rooms. A suggestion requires your confirmation, and results can include a room at a different venue on the same public connection.
- **Internet room.** In **Room**, paste the invitation link or enter the room code at the end of the host’s `queue.thepropervolume.com` address. Add your display name and tap **Join Room**. The app remembers the last room code for reuse. Restarting the app requires you to join again.
- **LAN-only room.** Connect to the host’s Wi-Fi, paste the trusted local HTTPS invitation, and choose **Open Local Invitation**. The invitation opens in the browser. Its certificate needs to be trusted by your device. If discovery is unavailable, ask the host for the exact invitation or room code.

## Request a Song in a Room

Search by artist or title in **Library**. Results come from the host’s library and currently enabled, supported providers. On a desktop host running 0.10.13 or later, tap **Load More Songs** to continue through matches from the shared Karaoke Nerds catalog. The host’s song rules still apply. Choose **Queue** on the exact version you want. The host controls approval, playback and rotation. From a saved playlist, **Find in Room** searches by title so you can choose an available recording before queueing.

Open **Room** to check your requests, withdraw eligible requests, or use the attendance, missing-song, applause, and photo actions the host makes available. Use **Reconnect** when the room is still open after an interruption. **Leave Room** returns you to catalog browsing and keeps your playlists. If the host closes the room, the app returns to browsing and asks for a live invitation when you want to queue again.

Browse sources may have different coverage from subscribed desktop providers. The mobile workspace uses the host’s access for joined searches. Physical iPhone and Android checks, venue network rehearsal, and signed store releases are tracked in [mobile requirements and status](mobile-requirements.md).
