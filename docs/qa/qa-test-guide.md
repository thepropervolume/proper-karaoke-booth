# Karaoke Booth QA Test Guide

This guide explains what to test in The Proper Volume Karaoke Booth, what a successful result looks like, and which problems still need attention. It is written for a tester who can use the application but does not need to read its source code. Use it with the desktop host, the mobile web app, and the Android and iOS development builds when those builds are available.

The baseline is development version **0.9.0**, reviewed on **17 November 2026**. It is not the approved 1.0.0 release. Later provider work must be tested separately. Keep test results tied to the exact installed version or source revision.

## Current test status

The desktop source test run passed **1,076 checks**, skipped eight checks that needed a different platform or environment, and reported no failures. Twenty release checks and 13 checks against a separate MySQL test database also passed. These totals describe automated checks, not 1,076 manual tests or a complete hardware signoff.

Browser tests confirmed mobile song search, a real YouTube video starting, singer requests and withdrawal, room closure, and playing an imported video without an internet connection. The Windows package opened and restarted successfully in a separate test profile. Android and iOS development builds compiled, but their download steps failed because GitHub storage was full. A compiled app has not necessarily been installed or tested on a phone.

## What is available

- The desktop hides KaraFun results while signed out. Generic YouTube results appear after other sources and disappear when another source has the same artist and song title.
- Mobile **Full Host Mode** owns playback and its own queue. It supports the shared Karaoke Nerds search, YouTube links, imported local videos, favorites and history.
- Mobile **Piggyback Mode** joins a desktop or phone host. Singers can request and withdraw songs, report temporary unavailability, and ask for a missing song.
- A nearby room is suggested before joining. Native apps use local network discovery when permitted. The website uses a shared internet connection as a hint; that hint does not prove two devices are on the same Wi-Fi.
- Quizzes are outside the product scope.

## Open work and limits

**Playback position:** reopening the mobile host keeps the current song but restores it paused at the beginning. Restoring the exact elapsed position is unfinished. A test expecting exact resume should be recorded as a known limitation.

**Storage:** a tester can remove or relink a saved local video, but there is no combined storage usage display. Clearing browser or app data removes saved shows and imported device copies. Show metadata exports do not contain the video files.

**Physical devices:** actual Android and iOS playback, permission prompts, nearby discovery, battery use, background behavior, audio routing and long shows still need testing. Desktop browser emulation does not complete these checks.

**Mobile features:** paid-provider sign-in and playback, key and tempo changes, separate vocal volumes, account synchronization, licensed provider downloads, and dedicated casting controls remain planned. Android store packages and installable signed iPhone releases are not yet delivered.

**Distribution:** GitHub storage currently blocks new build downloads. This is separate from a failure to compile. Record the build and upload results separately.

## Test setup

Use a test show and disposable singer names. Back up an existing show before any upgrade. Do not clear the owner's app data or alter a real performance queue to create a test condition.

Have two devices or separate browser sessions available: one host and one singer. Open **https://queue.thepropervolume.com/app/** for mobile testing. For local discovery, connect both devices to the same ordinary private Wi-Fi; also test a network that separates guests. Use a short video that you are allowed to play, one available YouTube karaoke video, and a second local video with a clearly different name.

For each run, record the app version, operating system, browser or native build, device model, network type, test account type and whether audio was muted. Use real audio and an external display only during a planned hardware check.

Mark each case **Pass**, **Fail**, **Blocked** or **Not run**. Use Blocked when a missing device, unavailable download or unavailable account prevents the test. A passing browser check must not be copied into the result for an untested native phone.

## Desktop search tests

### D01 KaraFun results while signed out

1. Sign out of KaraFun in Sources and search for a song known to be in its catalog.
2. Confirm that neither old saved KaraFun matches nor new KaraFun results appear.
3. Sign in, repeat the search, then sign out while a search is still running.

**Expected:** KaraFun results appear only for the connected account. A late response after sign-out does not put them back. Local and other available results remain usable. Account expiry should lead to a clear reconnect path.

### D02 YouTube as a fallback

1. Search for an artist whose song exists locally or in Karaoke Nerds and also on YouTube.
2. Compare the artist and title of each result, including punctuation or spacing differences.
3. Repeat with a different artist and with an explicitly named live or remix version.

**Expected:** generic YouTube duplicates of the same artist and song are hidden, including previously saved generic YouTube results. Other sources appear first. Different artists and meaningful live or remix versions remain distinct. Search filtering does not delete recordings or ratings.

### D03 Common result actions

1. Right-click an imported song, a community result and a connected KaraFun result.
2. Add an eligible result with no singer name, then with an existing or new singer.

**Expected:** each result uses the common menu. Unsupported actions are disabled. Queueing does not immediately interrupt the current song. An empty singer is allowed for host requests; a remote singer still requests under their own identity.

## Mobile host tests

### M01 Start and play a show

1. Choose Full Host Mode, find a song and add it to the queue.
2. Add a second song, optionally using a different singer, then press Play.
3. Pause, seek, restart the song and skip to the next turn.

**Expected:** the chosen recording plays and the controls follow the actual player. Seeking changes the position without starting a second audio stream. A phone may require a tap inside an online player before audio starts; record that behavior. Do not mark the whole song as verified after checking only its first second.

### M02 Automatic next song and settings

1. Enable automatic advancement and set a short gap between songs.
2. Finish the current song and measure the gap before the next song starts.
3. Change the booth name or volume while another session adds a request.

**Expected:** eligible songs advance after the selected gap. Changing settings does not restore an older queue or lose the new request. Turning off automatic advancement leaves the next song waiting for the host.

**0.9.2 update:** Full Host Mode exposes these controls under **Room → Playback**. A desktop-browser rehearsal verified a two-second gap, cancelling advancement during the gap, and manually starting the waiting song. Test on actual phones and record any user-gesture or audio restrictions separately.

### M03 Queue controls and favorites

1. Add three songs, start the first, and move waiting songs up and down.
2. Remove one waiting request, then favorite a song and complete another.

**Expected:** moving waiting songs does not change the playing song. Removal affects the selected request. Favorites and completed-song history remain after reopening. Mobile favorite hearts are separate from the desktop's 1 to 10 recording rating.

### M04 Import and manage local videos

1. Import valid and unsupported or unreadable files together.
2. Try a batch larger than 20 files and review the results.
3. Relink a local song to its replacement file. Remove an unused saved device copy.

**Expected:** each file receives a useful result; files beyond the batch limit are reported as skipped. Relinking keeps the song identity. A queued or playing copy cannot be removed. Removing the app's saved copy does not delete the original file.

### M05 Restart and offline use

1. Import a playable local video, open the app online, and close and reopen it.
2. Disable the network and reopen the installed mobile website.
3. Play the imported local video, then try online search and an online recording.

**Expected:** the interface reopens offline after its first successful installation. The show restores paused, without unexpected audio. A saved local video can play. Online search, rooms and YouTube require a connection and should explain that. Exact playback position is not yet restored.

### M06 Protect the saved show

1. Open the host in one browser tab and try Full Host Mode in a second tab using the same browser profile.
2. Try joining a room from the second tab instead.
3. Use the controlled storage-failure and damaged-save fixtures when supplied by development.

**Expected:** only one tab writes the saved show; the other can still be a singer. A failed save must not be reported to a singer as a successful saved request. A damaged save is preserved for recovery before a new show is created. Do not corrupt a real user's data to run this case.

## Room and singer tests

### R05 Applause and points

1. In a disposable show, confirm applause and points are enabled. Add a performer and three other singers. Start a song, then have the three singers and the host each applaud once.
2. Confirm the performer receives 70 points for the four applauses plus 50 once all three other singers have applauded. The three singers should each spend one credit and receive 8 giver points. No more than three sounds should overlap; wait for a sound to finish if a press is rejected and retry it.
3. Complete the song and confirm the performer gains one credit, with no more than five credits in total. Repeat with one listener missing; no 50-point bonus should appear.
4. Check that a singer cannot applaud their own performance, and that failed audio does not deduct credits. Turn each setting off separately and confirm its behavior. Test the selected physical output as well as the default device.

### R06 Queue points, suggestions and photos

1. Queue an assigned song with known unused host history and confirm 36 points: 12 for queueing, 6 for a song nobody else completed during this show, and 18 for a song absent from host history. Mark a song as a duet and confirm the lead and assigned partner each receive 14 additional points. Repeat using a known previously queued song and with unknown history; the all-time bonus must not be awarded.
   On mobile Full Host, cross-show history is not complete; expect the all-time 18-point bonus to be withheld when history is unknown.
2. From a signed-in room singer, suggest a missing song and confirm 10 points. Select a JPEG or PNG using **Share a photo** and send it. Confirm a temporary image appears on the singer display and the sender earns 24 points only after the display accepts it.
3. Retry the same request after an interrupted connection and confirm it does not award points twice. While a photo is visible, try another and confirm it is rejected with a clear message. Test local Wi-Fi and the deployed internet room separately, and include the mobile host when available. These are test instructions, not a claim that the devices or relay have passed.

### R01 Discover and join a room

1. Open a host room with a recognizable booth name and custom address.
2. Open the mobile app on another device, dismiss a nearby suggestion, and check manual room entry.
3. Join explicitly and enter a singer name.

**Expected:** discovery alone never joins. The selected room and host are clear. A dismissed suggestion stays dismissed for that room during the current app session. Manual links remain available if discovery fails. Website suggestions can include another room sharing the same public internet connection; confirm the room before joining.

### R02 Request withdraw and return

1. Join a room and request a published song. Withdraw the waiting request.
2. Submit an unavailable-song request, then mark the singer away for 1 minute and for 60 minutes.
3. Try the future-request limit and request a song for another singer.

**Expected:** the host receives the right song and singer once. Withdrawal updates both views. The missing-song request remains available after host reload. Phone hosts allow three upcoming requests, or one while away. Requests beyond the limit explain why they were refused. A singer cannot edit another singer's requests or gain host controls.

### R03 Close and reopen a room

1. Join, close the host room, and try another action in the old singer view.
2. Open a new room and try using the old view or saved access details.

**Expected:** closure removes guest access. Old access cannot operate the new room; the singer must join again. The host's queue remains available. A room name may remain reserved until its temporary registration expires after an interrupted phone host; record the message rather than assuming a different room owns it.

### R04 Interrupt opening and reconnect

1. With a controlled network tool, interrupt the reply while the host opens a room.
2. Retry the same opening, then test cancelling an opening that completes late.
3. Interrupt an established connection and reconnect after at least 60 seconds.

**Expected:** the host offers recovery for an uncertain opening. Retrying does not create a second room. Cancelling cleans up a room created by a late reply. Reconnection continues processing new singer actions without duplicating an earlier request. Expired or revoked access leads to a clear unavailable state rather than endless retries.

## Accessibility and device tests

### A01 Small screens and keyboard use

1. Check widths of 320, 390 and 768 pixels, then rotate a real phone.
2. Open the queue dialog, move through it with Tab, close it with Escape and check focus.
3. Try every tab and transport control, including Room and fullscreen.

**Expected:** no sideways page overflow hides controls. Dialog focus stays inside while open and returns to its trigger when closed. Controls have readable labels and usable touch targets. Routine success messages disappear; errors remain understandable. Unsupported fullscreen gives a message. A real screen reader and phone keyboard still require separate checks.

### A02 Native permissions and show hardware

1. On both Android and iOS, allow and deny local network permission, then repeat with guest Wi-Fi isolation and a VPN.
2. Check streaming, local codecs, speaker and intended external audio output, locking the phone and returning from the background.
3. Run a full-length song and then a long show, watching timing, temperature, battery, interruption recovery and duplicate audio.

**Expected:** denied or unavailable discovery still allows manual joining. Returning from the background leaves playback safely paused until the user acts. Record actual permission and audio behavior on each device. Casting and paid mobile providers are planned features, so do not report them as regressions in this baseline.

## Findings from the specialist reviews

The original reviews recorded **38 findings**. Some overlap. The summaries below explain their effect in ordinary test language. **Fixed** means the source change and listed regression checks passed; it does not mean every real phone has passed. Keep the original IDs in bug reports so development can find the detailed evidence.

### Room reliability findings

- **MP 01 Fixed:** a singer from a closed room could retain access when another room opened. Each room now requires fresh access.
- **MP 02 Fixed:** losing an opening reply could strand the chosen address. Retry now retains the original opening details.
- **MP 03 Fixed:** cancelling before a late opening reply could leave a room open. Late successful openings are now closed.
- **MP 04 Fixed:** reconnecting after a delayed reply could retry forever. Expired replies no longer prevent new singer actions.
- **MP 05 Fixed:** some requests could wait indefinitely. Requests now have time limits as well as cancellation.
- **MP 06 Fixed:** the deployed server could not reach the new catalog path. It now reads the existing catalog through an allowed local connection; live search passed.
- **MP 07 Fixed:** temporary phone rooms could occupy all desktop room capacity. Their reservations now have a separate cap.
- **MP 08 Fixed:** an outage could permanently hide a still-open room suggestion. Suggestions can recover while the room is still valid.
- **MP 09 Fixed:** missing-song requests disappeared after host reload. They are now saved with the show.
- **MP 10 Fixed:** a singer could see success before the request was saved. The host now waits for saving before confirming success.
- **MP 11 Fixed:** expired temporary host records accumulated in the database. Cleanup now removes eligible temporary records while retaining configured desktop hosts.

### Usability and saved data findings

- **M UX 001 Fixed:** player and transport buttons could disagree about pause state. Player events now update the controls.
- **M UX 002 Fixed:** keyboard focus could escape the queue dialog. Focus is now kept inside and restored on closing.
- **M UX 003 Fixed:** saving settings could overwrite a newer queue. Only the intended setting fields are copied.
- **M UX 004 Fixed:** an unreadable saved show could be replaced without a recovery copy. The original is now preserved first.
- **M UX 005 Fixed:** two tabs could overwrite the same show. Only one tab now holds host write access.
- **M UX 006 Fixed:** dismissed room suggestions returned repeatedly. Dismissal is remembered for the current room and app session.
- **M UX 007 Fixed:** imports beyond the batch limit were silently omitted. Skipped files and individual failures are now reported.
- **M UX 008 Partly fixed:** unused local device copies can now be removed, with restrictions for queued or playing copies. A total storage usage display and a separate Clear Downloads action remain follow-up work.
- **M UX 009 Fixed:** reimporting a missing video used to create a new song while leaving the queued song broken. Relink now replaces the device copy for the existing song identity.
- **M UX 010 Fixed:** changing modes could hide the fact that a host room remained open. The chooser now shows it and offers Return or Close.
- **M UX 011 Fixed:** routine success messages occupied too much phone space. They now expire.
- **M UX 012 Fixed:** the Room tab could be offscreen. Tabs now wrap.
- **M UX 013 Fixed:** unsupported fullscreen could do nothing without explanation. A recovery message is now shown.
- **M UX 014 Follow up:** exact playback position is not restored after reopening. The current song returns paused at the beginning.

### Native app findings

- **N01 Fixed in source:** the iOS launch path did not register nearby discovery correctly. The launch registration was corrected; real iPhone discovery still needs testing.
- **N02 Fixed:** the native network timeout was shorter than the server's normal wait. It now allows the expected wait.
- **N03 Fixed:** desktop discovery errors or a network profile change could cause failure. Errors are handled and private-network status is rechecked.
- **N04 Device check pending:** the native YouTube player now uses a fixed web page that supplies the identity YouTube expects. Actual Android and iOS streaming still need testing.
- **N05 Fixed in source:** denied or empty discovery needed a fallback. Shared-connection hints and manual entry are now available.
- **N06 Fixed in source:** old scan callbacks could affect a newer scan. Results are now tied to the scan that produced them.
- **N07 Fixed in source:** long or non-English booth names could exceed network naming limits. Names are now limited by their encoded length.
- **N08 Fixed:** branding checks still referred to the removed mobile prototype. They now check the current web and native assets.
- **N09 Distribution pending:** development packages are not signed store releases. Stable signing and store delivery remain open.
- **N10 Fixed in source:** a new native song could retain the old embedded player. Each performance now gets the correct player instance.
- **N11 Fixed in source:** native controls needed to follow the actual player state. Player state now drives them.
- **N12 Fixed:** the inline player could become too short. It now has a minimum height.
- **N13 Fixed in source:** two booths with the same name could advertise the same network identity. Room-specific identities now distinguish them.

## Reporting a defect

Use a short title describing the visible problem. Include the test ID, app version or build, device and browser, host or singer mode, network arrangement, starting conditions, exact steps, expected result, actual result, how often it happens and the impact on a show. Attach a screenshot or short recording when helpful. State whether sound was actually heard or playback was only checked while muted.

Use **Critical** for show or data loss without a usable recovery, **High** for blocked playback or wrong-room access, **Medium** for a recoverable workflow problem, and **Low** for a cosmetic issue or minor inconvenience. Development may adjust priority after assessing the cause and affected users.

Do not include passwords, session access details, private notes or unnecessary account information. Use synthetic names. Share a private diagnostic file through the agreed channel if support needs it.

## Detailed records

The technical evidence is retained in [the QA resolution report](https://github.com/thepropervolume/proper-karaoke-booth/blob/main/docs/qa/mobile-090-summary.md), which links the protocol, usability and native reviews. The maintained [remaining work list](https://github.com/thepropervolume/proper-karaoke-booth/blob/main/docs/remaining-work.md) covers the wider application. Those records preserve what ran, what failed originally and what remains unverified.

This Markdown is the editable source for the separate Word QA guide. Regenerate the document after changing this guide; do not independently edit the generated copy.
