# Singer Guide for Development Version 0.4.3

The host operates the app and can enter a request for you, invite you to the experimental venue-network singer page, or start an internet Remote Session and share its link. The experimental relay is deployed and public browser request/recovery rehearsals passed; physical-phone, venue-network and long-show checks remain. Singer account sign-in is not available. The host’s Song Library searches local songs and Karaoke Nerds recordings. Singers search the host library, not the central catalog directly. Approved catalog requests schedule a download when the recording is not already saved; manual moderation waits for host acceptance. Downloads can fail and never start your turn automatically. The host can adjust waiting requests; staged performances remain locked.

Version 0.4.2 also lets the host search public KaraFun/Party Tyme metadata and configured partner catalogs. Those matches are marked **Search Only / Playback Pending** and cannot be requested or played through the booth. They do not appear in the singer library. Your usual local and downloaded Karaoke Nerds songs still use the existing request flow. Windows 0.4.2 is installed and its metadata-search/no-autoplay checks passed; this does not enable paid-service playback.

The 0.4.3 development build adds host-only Sunfly Store title/SF-SKU results without a developer key. They are limited store-product metadata, not the full streaming catalog, and cannot be requested or played in the booth. Artist search is unverified and a missing artist stays unknown. Windows 0.4.3 is installed and verified; Linux 0.4.3 package checks passed. These host-only results remain unavailable for singer requests until playable-provider integration exists.

The identity introduced in 0.4.1 uses an orange/pink vintage microphone with a play outline and no lettering in the app icon. Older installed versions may show the previous icon. The host can still choose a separate singer-display logo, and the TPV lyric-backdrop video remains the same.

## Join from the venue network

If the host has opened a local room, connect to the venue network and open the private invitation link they share with you. Enter your name and choose **Join the show**. The page lets you search loaded songs, request a song and check your request status. You can withdraw your own pending or accepted request; ask the host if the song is already staged or playing. The page shows up to 50 requests at a time, prioritizing active requests. Use **Load more songs** to browse additional pages of the library. If you cannot find a song, enter its title and optional artist under **Can't find your song?** and send it to the host; this does not add a recording or a rotation entry.

Your invitation can be used by anyone who has it until it expires or the host revokes it, so do not share it without the host's permission. Your access is tied to the open page; if you close or reload it, ask the host for a new link. Closing the room revokes guest access. The local page requires the host's network name and certificate to be trusted by your device. This experimental flow has not yet been verified on physical iOS or Android devices; ask the host to enter your request if it does not work. Do not bypass a browser certificate warning.

## Join an internet session

When the host offers an internet session, open their shared link, enter your name and browse or request songs from their published library. The host’s queue.thepropervolume.com link works over venue Wi-Fi or mobile internet. Public browser rehearsals passed; actual iOS/Android devices and venue networks still need checks. If a request response is uncertain after a connection interruption, use the offered action to check its outcome; only then explicitly retry the original request if needed. The retry preserves its original ID and contents and is not sent automatically. Ask the host for help if the session has ended or your link no longer works.

## Request an available song

1. Tell the host your name and the song or artist you would like to sing.
2. The host searches Song Library and double-clicks a song, or presses Enter on the selected row. Local title, artist, filename and code matches appear immediately; Karaoke Nerds matches follow after a short typing pause. They choose your name or enter a new name in the same request dialog. A new catalog recording does not need a separate library-import step. Its download must finish before your performance; the host can see progress or retry a failure. The show's content restrictions still apply.
   If the host is importing a library, newly imported songs appear as they finish; ask them to check again if your song has not appeared yet.
3. Requests are approved automatically by default. If the host has switched to manual approval, the request waits for their review and may be accepted or rejected before joining the queue.
4. The host may limit each singer’s pending, accepted and staged upcoming requests. The song currently playing does not count, and lowering the limit does not remove requests already made.
5. The host starts the performance when it is your turn. Queue order depends on whether the host selected singer rotation or first requested, first played. The host may show the singer display fullscreen, and if enabled it shows upcoming singers; the host may also set a gap between songs. The host starts the next song after the gap; it does not start automatically. The app checks the song file before starting; if it has moved or changed, the host may need to locate the original before your performance.

## Ask for a song that is missing

Tell the host the song title, your name and, if known, the artist. They can save it under **Can't Find a Song?** in the library. It appears in the host's **Unavailable Song Requests** list, but saving it does not add the recording to the library or put you in the rotation. The host can privately track whether a request is being reviewed, fulfilled or declined; that status is not shown on the singer page. The host needs an available recording before it can be requested for playback.

Your singer name and request information are stored locally for the host’s show. A remote relay handles guest requests when an internet session is available; public browser service tests passed, while physical-device and venue-network checks remain. The host can create singer playlists and review performances completed or skipped since the history feature was added. Personal self-service, favorites and cross-device profiles are not yet available.

## Step away and return

On the singer page, for either local or internet sessions, choose 1–60 whole minutes under availability, or use the return action when back. The host can do this for you. While unavailable you can have one upcoming request; existing extras are retained but block additions. You become eligible at the saved return time in the normal FIFO/fair order, subject to host manual order and the staged song. Returning does not start playback. If already staged or singing, ask the host before stepping away. After an uncertain connection result, check the outcome before another change. See [availability rules](singer-availability.md).

The current desktop source includes the default silent lyric backdrop, but installers do not contain private catalog configuration, song media, yt-dlp or FFmpeg. Fresh 0.4.1 catalog discovery needs no private reader file. The host sets up media tools and separately provisioned remote/rating profiles where used. Windows and Linux 0.4.1 packages passed isolated checks; physical show and phone checks remain. A host catalog outage does not automatically remove already loaded songs or saved videos from the show. Development versions remain `0.x.y`; the approved official release will be `1.0.0`.

## CDG Lyrics and Backgrounds

New CDG songs use the host’s TPV animated backdrop by default, with the original lyrics over the animation. The host can change the background before import. Your selected recording and song audio do not change. Existing converted songs may still show their earlier background. LRC lyric playback is planned.

## Recording Heart Ratings

The host can view a recording’s shared 1–10-heart score in library search and the queue and, with a provisioned rating profile, save one host vote for that exact recording. These hearts describe the recording and are separate from Clean/Explicit content restrictions or a singer performance score. Remote singer voting and account ownership are not implemented yet; ask the host if you want to discuss a recording’s quality.
