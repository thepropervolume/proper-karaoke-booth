# Singer Guide for Development Version 0.10.8

If the host puts you on hold, your queued songs stay in rotation and you become eligible again when the host selects **Return now**. Ask the host when you are ready to return. A timed break still ends automatically.

## Applause, Points and Photos

When your host enables applause, tap **Applause** to play a clap sound. You begin with three credits and regain one whenever you complete a song, up to five. You cannot applaud yourself. Your available credits and, when enabled, points appear in your room. A failed sound does not use a credit. The six recorded claps play in order and vary in length; up to three can overlap.

Earn points for queueing songs, singing duets, applauding other performers, suggesting a missing song and sending a photo. Singers also earn points when others applaud their performances. Your host can turn the points system off.

To share a photo, choose **Share a photo**, select a JPEG or PNG, and tap **Send to singer display**. A mobile host gets up to 45 seconds to review and approve it. If approved, it appears for about ten seconds and can earn points. If another photo is being reviewed or displayed, or the display is unavailable, try again later. Photos are reduced for transmission and stay out of the host's show database. Share only pictures you want everyone at the venue to see.

Your host can hide sources from the singer catalog. Songs you already requested stay in your queue; an unavailable source cannot be used for a new request. An old result may remain visible until the page refreshes, normally within 15 seconds.

When a requested online song is still downloading at its turn, the host can continue with the next ready song. Your request stays in the rotation and is reconsidered after each performance.

Tell the host your name and the song or artist you would like to sing. They can enter a request, invite you to an experimental venue-network singer page or share an internet Remote Session link. Persistent singer accounts are not implemented. Physical-phone, venue-network and long-show checks remain; ask which installed version they are using.

## Choose a Song

The host's global search combines local files, Karaoke Nerds, curated YouTube, connected native KaraFun and public service metadata in one list. A colored edge and source label identify the recording. Search-only results cannot be queued or played. The singer page browses the host's published library rather than directly searching every provider.

KaraFun appears only while the host is signed in. Generic YouTube results appear last and hide songs already found in another source. Stored recordings remain in the library; the fallback rule changes search visibility only.

The host double-clicks a playable result or chooses **Add to Queue**. They may leave the optional singer empty, select your existing name or enter a new one. An unnamed request shows **Unassigned** and can be assigned later. Approved requests prepare and stage automatically; manual moderation waits for acceptance. Karaoke Nerds/YouTube requests download through yt-dlp, while native KaraFun prepares privately through the host's account. Failed preparation keeps your turn for recovery.

The host starts the show with Play. By default subsequent performances start after the configured gap when the recording and singer are ready. The host can disable automatic advancement or stop/pause it. Order follows fair rotation or request order, with host overrides. Preparation does not lock a queued song; the host may change the order before playback starts. Preparation alone never starts a new show, and restarting never resumes karaoke automatically.

The host may limit pending, accepted and staged future requests; playback does not count. They may edit the track or singer of a waiting/staged request without changing its identity. Remote requests always remain assigned to the singer who joined the session; guests cannot submit or take ownership of unassigned host requests. A duet can have two assigned singers when the host marks the recording as a duet; both singers’ availability is considered. Larger groups remain planned.

Native KaraFun checks the host's subscription for each start/resume. Its remembered session uses operating-system protection where available; expiry may require another official sign-in. Signing out silences native playback and forgets the session. Retained media never guarantees future access. The optional external KHost queue is separate and unnecessary for native TPV playback. Physical audio and native provider playback on Linux/macOS remain unverified.

## Join a Session

For a local room, connect to the venue network and open the private invitation. Enter your name and choose **Join the show**. Search the host’s saved library, load more matching results if needed, request one and check status. In the 0.10.5 singer page, you can withdraw your pending or queued request, including the next prepared song. Ask the host once your performance has started. Anyone holding an invitation may use it until expiry or revocation. Your device must trust the local hostname and certificate.

For an internet session, open the host's `queue.thepropervolume.com` link over Wi-Fi or mobile internet. Public browser recovery rehearsals passed; real iOS/Android and venue checks remain. After an uncertain connection result, check its outcome, then explicitly retry the original action if offered. Ending the session revokes access. If the host removes you from the show, your session and resume access also end; ask the host to join again.

The [mobile web app](https://queue.thepropervolume.com/app/) offers **Full Host Mode** for your own player/show and **Piggyback Mode** to join another host and request songs. A detected room still needs your **Join Room** choice. Native apps use local network discovery; browser suggestions share the internet connection and may include another venue. Manual room names/links also work. See the [mobile guide](mobile-app.md) for local storage, phone hosting and platform limits.

## Watch the Singer Screen

If the host enables LAN Singer Screens, open their address, such as `http://192.168.1.20:4051`, on the venue network. It is a silent visual mirror; sound stays on the host. It works while the separate singer window is hidden. A `.local` name works only if the network resolves it. Viewing does not join the request queue.

During an active room, your host can share a private internet singer-screen link at `booth.thepropervolume.com` or `queue.thepropervolume.com`. Open the full link, including the code after `#`. The viewer shows still images from the singer screen while audio plays at the venue. Viewing access ends when the host stops sharing or the stream expires.

On Windows, screen sharing listens on verified Private interfaces, with loopback fallback when classification is unavailable or Public. Network rechecks may stop sharing; ask for a current address. This read-only screen and authenticated singer-request rooms are separate services.

The host may show a booth name, adjustable logo, upcoming singers and a scrolling top/bottom announcement. A banner can expire and normally resets on next launch. Video fits the viewport. The host’s font choice applies to the screen’s overlays and live-rendered lyrics, including KaraFun. Imported and converted videos retain the lyric style rendered into them. Native KaraFun's primary completed-lyric color is pink.

## Missing Songs, Availability and Ratings

Use **Can't find your song?** to send a title and optional artist. This creates a review request, not a recording or rotation entry. The host privately tracks Pending, Reviewing, Fulfilled and Declined.

Use availability to step away for 1–60 minutes or return immediately. While away, at most one future request is allowed; existing extras remain. At return you become eligible in the existing fair/FIFO order, subject to host overrides. If already singing, speak to the host first.

Stars rate recording quality from 1–10, not your singing or Clean/Explicit classification. YouTube/Karaoke Nerds votes use the shared service; source-less file votes stay on this host. Version 0.7 also identifies KaraFun catalog/community recordings for shared ratings; the matching production validator is deployed and verified. Remote singer voting, personal accounts, favorites and self-service data management remain planned.

Singer/request information stays in the host show; internet requests also pass through the relay. Installers exclude private profiles, song media, yt-dlp and FFmpeg. Development versions remain `0.x.y`; `1.0.0` is the approved official-release target.

## Vocal Assistance

For native KaraFun recordings, ask the host to adjust **Vocal Mix** if you want guide vocals or different backing levels. Separate duet/choir controls appear only when the recording supplies separate audio channels. Singers cannot change these host controls remotely.

## Party Tyme Songs

A connected desktop host can publish saved Party Tyme consumer recordings in the room library. Request an offered recording normally; the host handles its account, preparation and playback. Singers do not receive or enter the host's subscription credentials. This does not add paid-provider playback to mobile Full Host mode.
