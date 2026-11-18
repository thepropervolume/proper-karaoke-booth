# TPV Karaoke on Mobile

Open [the mobile web app](https://queue.thepropervolume.com/app/) on a phone or tablet. Use the browser menu's **Add to Home Screen** option to install it. This is an experimental development app; keep a backup of important show data.

## Full Host Mode

Choose **Full Host Mode**, search by artist/title, tap **＋**, optionally enter a singer, then **Add Song**. Search uses the shared Karaoke Nerds snapshot. Online recordings play through YouTube's embedded player; creators can restrict playback. **Add a Video** accepts a YouTube link or imports videos from this device. Local MP4/WebM/MOV/M4V playback depends on the device's codecs.

Press **Play** to start the queue. The bottom transport provides pause, restart, skip, fullscreen, volume and a seekable timeline. Built-in video controls stay synchronized. In **Room → Playback**, enable automatic advancement and set the gap between songs from 0 to 3,600 seconds. Turning off automatic advancement during the gap keeps the next song waiting for Play. Playback pauses in the background and after reopening the app; mobile platforms may require a tap inside the video to allow audio. Keep the host app in the foreground during a show.

**Queue** provides move-up/down and removal controls. Mobile hearts save favorites; the desktop's 1–10-heart recording rating is a separate feature. Favorites and completed-song history stay on this device. **Room** changes the booth name, automatic advancement and gap, and exports show/history metadata. A local video's **⋯** menu relinks its device copy without changing its song ID or removes an unqueued copy to free storage. Your original file is untouched. Imported files are not included in the metadata export.

To invite singers, choose **Room**, keep or edit its address and tap **Open Room**. Share the singer link; anyone with the active link can join. Temporary phone-host capabilities stay in memory and expire within 12 hours. Closing a room revokes its guests. Interrupted openings offer **Retry Open** or **Close Pending Room**; unresolved closure must be retried before opening another room. A closed/crashed host becomes unavailable to guests rather than replaying commands later. Reloading a phone host requires a new room; an old address may remain reserved until expiry.

## Piggyback Mode

Choose a detected room's **Join Room** button, or enter the host's room name/link. Enter your singer name, browse the host's published songs, and request one. You can withdraw your own waiting request, mark yourself unavailable for 1–60 minutes, or ask the host for an unavailable song. The host owns playback, approval and rotation. A phone host permits three upcoming requests per singer, or one while away; desktop hosts apply their own configured limits.

Native Android/iOS builds use local DNS-SD discovery when permitted. The web app suggests live rooms sharing your public internet connection; that is a hint, so confirm the room with your host. Guest Wi-Fi isolation, VPNs, denied network permissions and different internet routes can prevent discovery. Manual HTTPS room links work independently of discovery. **Preferences → Remote Queueing → Suggest my active internet room to nearby mobile singers** controls desktop advertising. Ending the room removes its suggestion; visibility may take a heartbeat to refresh.

## Data and Current Limits

Show metadata, favorites, history, unavailable-song requests and user-selected videos use this device's IndexedDB. No provider or room credentials are saved there. Only one tab can write the saved host show; another tab can still join a room. A damaged/unknown saved show is copied to a recovery record before a new one is created, and the latest recovery can be exported from Room. Clearing browser/app data removes these local files and records.

The offline cache contains the app interface only. Previously imported local videos can play offline; online search, room access and YouTube streams require a connection. Mobile KaraFun sign-in/playback, other paid providers, licensed offline downloads, key/tempo, per-stem vocal controls, account sync, remote voting and dedicated AirPlay/Chromecast controls remain planned. No quizzes are included. See [research](mobile-research.md), [native development](../mobile/README.md) and [QA findings](qa/mobile-090-summary.md) for evidence and limits.
