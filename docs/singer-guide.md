# Singer Guide for Development Version 0.7.1

Tell the host your name and the song or artist you would like to sing. They can enter a request, invite you to an experimental venue-network singer page or share an internet Remote Session link. Persistent singer accounts are not implemented. Physical-phone, venue-network and long-show checks remain; ask which installed version they are using.

## Choose a Song

The host's global search combines local files, Karaoke Nerds, curated YouTube, connected native KaraFun and public service metadata in one list. A colored edge and source label identify the recording. Search-only results cannot be queued or played. The singer page browses the host's published library rather than directly searching every provider.

The host double-clicks a playable result or chooses **Add to Queue**. They may leave the optional singer empty, select your existing name or enter a new one. An unnamed request shows **Unassigned** and can be assigned later. Approved requests prepare and stage automatically; manual moderation waits for acceptance. Karaoke Nerds/YouTube requests download through yt-dlp, while native KaraFun prepares privately through the host's account. Failed preparation keeps your turn for recovery.

The host starts the show with Play. By default subsequent performances start after the configured gap when the recording and singer are ready. The host can disable automatic advancement or stop/pause it. Order follows fair rotation or request order, with host overrides and a locked staged turn. Preparation alone never starts a new show, and restarting never resumes karaoke automatically.

The host may limit pending, accepted and staged future requests; playback does not count. They may edit the track or singer of a waiting/staged request without changing its identity. Remote requests always remain assigned to the singer who joined the session; guests cannot submit or take ownership of unassigned host requests. Multiple performers per request remain planned.

Native KaraFun checks the host's subscription for each start/resume. Its remembered session uses operating-system protection where available; expiry may require another official sign-in. Signing out silences native playback and forgets the session. Retained media never guarantees future access. The optional external KHost queue is separate and unnecessary for native TPV playback. Physical audio and native provider playback on Linux/macOS remain unverified.

## Join a Session

For a local room, connect to the venue network and open the private invitation. Enter your name and choose **Join the show**. Browse loaded songs, request one and check status. You may withdraw your pending/accepted request; ask the host if it is staged or playing. Anyone holding an invitation may use it until expiry/revocation. Access belongs to the open page; after closing/reloading ask for another invitation. Your device must trust the local hostname/certificate; do not bypass browser certificate warnings.

For an internet session, open the host's `queue.thepropervolume.com` link over Wi-Fi or mobile internet. Public browser recovery rehearsals passed; real iOS/Android and venue checks remain. After an uncertain connection result, check its outcome, then explicitly retry the original action if offered. Ending the session revokes access.

## Watch the Singer Screen

If the host enables LAN Singer Screens, open their address, such as `http://192.168.1.20:4051`, on the venue network. It is a silent visual mirror; sound stays on the host. It works while the separate singer window is hidden. A `.local` name works only if the network resolves it. Viewing does not join the request queue.

On Windows, screen sharing listens on verified Private interfaces, with loopback fallback when classification is unavailable or Public. Network rechecks may stop sharing; ask for a current address. This read-only screen and authenticated singer-request rooms are separate services.

The host may show a booth name, adjustable logo, upcoming singers and a scrolling top/bottom announcement. A banner can expire and normally resets on next launch. Video fits the viewport; native KaraFun's primary completed-lyric color is pink. CDG retains its original lyric colors over the selected animated backdrop. Full LRC playback remains planned.

## Missing Songs, Availability and Ratings

Use **Can't find your song?** to send a title and optional artist. This creates a review request, not a recording or rotation entry. The host privately tracks Pending, Reviewing, Fulfilled and Declined.

Use availability to step away for 1–60 minutes or return immediately. While away, at most one future request is allowed; existing extras remain. At return you become eligible in the existing fair/FIFO order, subject to host overrides and staged lock. If already staged or singing, speak to the host first.

Hearts rate recording quality from 1–10, not your singing or Clean/Explicit classification. YouTube/Karaoke Nerds votes use the shared service; source-less file votes stay on this host. Version 0.7 also identifies KaraFun catalog/community recordings for shared ratings; the matching production validator is deployed and verified. Remote singer voting, personal accounts, favorites and self-service data management remain planned.

Singer/request information stays in the host show; internet requests also pass through the relay. Installers exclude private profiles, song media, yt-dlp and FFmpeg. Development versions remain `0.x.y`; `1.0.0` is the approved official-release target.
