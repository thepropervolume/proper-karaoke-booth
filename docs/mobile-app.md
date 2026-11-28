# TPV Karaoke Mobile Singer Guide

Booth for iPhone, Android, and the [mobile web app](https://queue.thepropervolume.com/app/) helps you find songs, join a host’s room, and follow the show. The desktop host handles playback, approval, and rotation.

## First launch and accounts

Choose **Continue as Guest** or **Sign In / Create Account**. Guests can browse, save tracks, and join rooms with a singer name. The queue website opens directly to **Rooms**. You can sign in from **Account** and keep the playlists on this device.

Enter your email address and choose **Continue**. If you have a Booth password, the app asks for it. If you already have an account and need to set your first password, Booth sends you a password setup link and shows where it was sent. Open the email and tap the link. **Email me a sign-in link** and **Forgot password?** send links on request. For a new account, choose a singer name and a password of at least 12 characters, then open the confirmation email and re-enter the password you chose. If you started on a different device, copy the full address from the email and choose **I Already Have a Booth Email** to paste it. Your Booth account is separate from your karaoke subscriptions. Playlists live on this device. Use **Account → Singing Profile** to add a photo, pronouns or a short bio when the profile service is available.

## Discover a room

- **Nearby.** Connect to the host’s Wi-Fi and visit [the queue website](https://queue.thepropervolume.com/). If the host enabled nearby discovery, the browser can suggest rooms sharing the same public IPv4 address or IPv6 subnet. Native builds can also use local-network discovery. Verify the room with your host before joining. Networks with separate address families, VPNs or private browsing relays may need a room code.
- **Room code or invitation.** Use your host's code or paste the internet invitation from any network. Enter the name the host should use when calling you up. **Invite to Room** opens the share sheet, and **Copy Invitation** copies the room link. Signed-in singers can return to their last still-active room on this device. Admission is confirmed again after restarting.
- **LAN-only invitation.** Connect to the host's Wi-Fi and open its trusted local HTTPS link in your device browser.

## Search and Playlists

Open **Search** and enter at least two characters of a song title or artist. Karaoke Nerds is selected by default outside a room. Public KaraFun and Party Tyme Pro listings can be enabled in **Account**. Joined search uses the host's available sources and their room policies. Where offered, **Load More Songs** continues through the catalog. Public Party Tyme Pro listings can differ from a host's Party Tyme Consumer results.

Star a recording to save it to **Starred Songs**, or choose **Save to Playlist** to keep it in a named list. **Playlists** holds both. A playlist's **Find in Room** searches for a version your host can queue. Leaving a room keeps your saved songs. **Performance History** shows requests you completed while this device received room updates.

## Queue and Now Playing

Queue the exact version from your search results. **Queue** shows your request statuses and lets you withdraw eligible requests. Compatible desktop hosts also share the room's current singer, upcoming tracks, and playback timing when available. Tap **Now Playing** to follow the host’s performance. You can applaud, star the track or save it to a playlist. Older hosts can still admit singers and accept requests, and will show only your requests when room-wide details are unavailable.

Room actions such as applause, attendance, unavailable-song requests, and photo submission depend on what the host enables. If the connection drops, reconnect while the room is open. **Leave Room** returns to public catalog browsing.

Choose **Request a Custom Song** to open the website’s request form. If the host enables photo casting, choose **Send a Photo to the Screen** in Rooms or Now Playing. The singer display shows the image briefly.

In a native build, open **Account → Singer Notifications** to opt in. Choose how many songs away to get an alert, whether to hear about nearby Wi-Fi rooms, and whether to hear when a song becomes available. These alerts require Booth to receive live updates. Android can also show the host’s current song on the lock screen and hides old status when updates stop.

See [mobile requirements](mobile-requirements.md) for version and device test coverage.

## Update the web app

A reopened web app checks for the current Booth interface when online. If a browser or Home Screen shortcut still shows an older screen, [open a fresh copy](https://queue.thepropervolume.com/app/?fresh=1). This keeps your local profile and playlists. For the installed iPhone beta, use **TestFlight → Karaoke Booth** to check which build you have.
