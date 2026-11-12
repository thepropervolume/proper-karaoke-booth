# Singer guide for development version 0.3.0

The host operates the app and can enter a request for you, invite you to the experimental venue-network singer page, or start an internet Remote Session and share its link. The internet relay deployment and public end-to-end testing are still pending, so do not depend on it for a show yet. Singer account sign-in is not available. The host’s Song Library searches local songs and Karaoke Nerds recordings. Singers search the host library, not the central catalog directly. Approved catalog requests schedule a download when the recording is not already saved; manual moderation waits for host acceptance. Downloads can fail and never start your turn automatically. The host can adjust waiting requests; staged performances remain locked.

## Join from the venue network

If the host has opened a local room, connect to the venue network and open the private invitation link they share with you. Enter your name and choose **Join the show**. The page lets you search loaded songs, request a song and check your request status. You can withdraw your own pending or accepted request; ask the host if the song is already staged or playing. The page shows up to 50 requests at a time, prioritizing active requests. Use **Load more songs** to browse additional pages of the library. If you cannot find a song, enter its title and optional artist under **Can't find your song?** and send it to the host; this does not add a recording or a rotation entry.

Your invitation can be used by anyone who has it until it expires or the host revokes it, so do not share it without the host's permission. Your access is tied to the open page; if you close or reload it, ask the host for a new link. Closing the room revokes guest access. The local page requires the host's network name and certificate to be trusted by your device. This experimental flow has not yet been verified on physical iOS or Android devices; ask the host to enter your request if it does not work. Do not bypass a browser certificate warning.

## Join an internet session

When the host offers an internet session, open their shared link, enter your name and browse or request songs from their published library. This path is being prepared and has not yet passed a public end-to-end test. If a request response is uncertain after a connection interruption, use the offered action to check its outcome; only then explicitly retry the original request if needed. The retry preserves its original ID and contents and is not sent automatically. Ask the host for help if the session has ended or your link no longer works.

## Request an available song

1. Tell the host your name and the song or artist you would like to sing.
2. The host searches Song Library and double-clicks a song, or presses Enter on the selected row. Local title, artist, filename and code matches appear immediately; Karaoke Nerds matches follow after a short typing pause. They choose your name or enter a new name in the same request dialog. A new catalog recording does not need a separate library-import step. Its download must finish before your performance; the host can see progress or retry a failure. The show's content restrictions still apply.
   If the host is importing a library, newly imported songs appear as they finish; ask them to check again if your song has not appeared yet.
3. Requests are approved automatically by default. If the host has switched to manual approval, the request waits for their review and may be accepted or rejected before joining the queue.
4. The host may limit each singer’s pending, accepted and staged upcoming requests. The song currently playing does not count, and lowering the limit does not remove requests already made.
5. The host starts the performance when it is your turn. Queue order depends on whether the host selected singer rotation or first requested, first played. The host may show the singer display fullscreen, and if enabled it shows upcoming singers; the host may also set a gap between songs. The host starts the next song after the gap; it does not start automatically. The app checks the song file before starting; if it has moved or changed, the host may need to locate the original before your performance.

## Ask for a song that is missing

Tell the host the song title, your name and, if known, the artist. They can save it under **Can't Find a Song?** in the library. It appears in the host's **Unavailable Song Requests** list, but saving it does not add the recording to the library or put you in the rotation. The host can privately track whether a request is being reviewed, fulfilled or declined; that status is not shown on the singer page. The host needs an available recording before it can be requested for playback.

Your singer name and request information are stored locally for the host’s show. A remote relay handles guest requests when an internet session is available; public service and device testing are pending. The host can create singer playlists and review performances completed or skipped since the history feature was added. Personal self-service, favorites and cross-device profiles are not yet available.

## Step away and return

On the local singer page, choose 1–60 whole minutes under availability, or use the return action when back. The host can do this for you. While unavailable you can have one upcoming request; existing extras are retained but block additions. You become eligible at the saved return time in the normal FIFO/fair order, subject to host manual order and the staged song. Returning does not start playback. If already staged or singing, ask the host before stepping away. After an uncertain connection result, check the outcome before another change. See [availability rules](singer-availability.md).

The desktop installer includes the default silent lyric backdrop, but does not contain private catalog configuration, song media, yt-dlp or FFmpeg. Those are host setup requirements. A host catalog outage does not automatically remove already loaded songs or saved videos from the show. Development versions remain `0.x.y`; the approved official release will be `1.0.0`.

## CDG Lyrics and Backgrounds

New CDG songs use the host’s TPV animated backdrop by default, with the original lyrics over the animation. The host can change the background before import. Your selected recording and song audio do not change. Existing converted songs may still show their earlier background. LRC lyric playback is planned.
