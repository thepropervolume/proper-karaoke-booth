# LAN Singer-Screen Sharing

Source development **0.7.0** provides an opt-in, read-only visual mirror from the single persistent singer renderer, even before its window is shown. Other browsers see the same lyrics and singer-screen overlays. Audio remains on the host's selected output; the mirror never creates another karaoke or bumper player.

## Start and Stop

1. Connect the host and viewing devices to the venue network.
2. Open **Remote Sessions → LAN Singer Screens** and select **Start Singer-Screen Sharing**. You can also turn sharing on under **Preferences → Singer Display**. Starting with 0.10.16 on Windows, a saved setting remembers the port and preference, and you start sharing again in **Remote Sessions** after each launch.
3. Copy one of the displayed numeric addresses to each viewing browser, for example `http://192.168.1.20:4051`.
4. The hidden singer renderer already supplies the interlude or current performance. Opening a visible singer window is optional. Browsers wait/reconnect if its renderer is unavailable; preview never creates another player or starts karaoke.
5. Use **Stop Singer-Screen Sharing** to close the listener. Stopping sharing does not stop the singer performance. The local host preview can continue independently.

Sharing is off by default. The default port is **4051**; Preferences accepts ports 1024–65535. If another program is using the port, choose a different one and save, or use **Retry Sharing** after resolving the conflict. Reconfiguration closes the previous listener and connections before opening the replacement.

## Addresses and Network Access

Development 0.7 binds separate listeners to verified private interfaces plus loopback, rather than every interface. On Windows the adapter must have an actual **Private** network profile; if that check fails, only this computer (127.0.0.1) is available. Other platforms use locally assigned private/link-local IPv4 addresses. **Refresh Addresses** discovers changes immediately; periodic checks retire a removed or no-longer-private interface every 30 seconds plus up to five seconds of discovery time. The app never modifies firewall rules or organization policies.

Use the numeric address when a name such as `proper-computer.local` does not resolve. The application does not install an mDNS service or make a hostname work on every venue network. Changing Wi-Fi, interfaces or host addresses may require copying a fresh address.

If Windows shows a **Public networks** access prompt when you start sharing, you can select **Cancel**. Keep the viewing devices on the same trusted Private network. If the screen is unreachable, check the Private firewall profile for the installed Booth executable and selected port. Venue Wi-Fi can also isolate clients on the same network.

The Windows prompt was inspected without changing policy. See the [firewall findings and recovery guidance](windows-firewall-diagnosis.md).

Keep this listener private to the venue. It is not an internet relay and should not be port-forwarded publicly. The service accepts directly connected private, link-local or loopback peers, validates request hosts/origins and offers only read-only display assets/status. It does not expose the show database, file paths, credentials, media-file URLs or host-control actions.

## Viewing Is Separate from Requesting

Anyone able to reach this LAN port can view the singer screen while sharing is enabled. This viewing page does not identify a singer, join the queue or permit requests. Use the separate local-room invitation or the public internet Remote Session link for song requests. An internet request session does not enable public internet access to this visual mirror.

The host's **Singer Preview** uses the same captured singer-window pixels. Appearance preferences place it above/below Host Queue or hide it; the separators resize it and the surrounding panels. The preview is silent and stays available after Close hides the singer window.

## Limits and Recovery

- The current server allows up to **64 simultaneous browser streams**. Browser connection limits, Wi-Fi bandwidth and host CPU can lower practical capacity.
- It sends JPEG frames over a multipart HTTP stream, using approximately 125 ms capture polling with static-frame deduplication. It is a visual mirror, not a sample-accurate audio/video synchronization system.
- Captures do not overlap. Generation checks reject late images from a closed/replaced display; losing demand, capture failures or invalidation clears old pixels. Slow viewers have bounded pending data and can reconnect.
- The page fits its viewport and reconnects after connection loss. Audio comes only from the host, so a viewing device cannot fix a host audio-output problem.

**Historical 0.5.0 evidence:** source HTTP/capture tests and private UI control rehearsals passed. A silent synthetic MP4 played in that source app; its host JPEG preview and two isolated LAN browsers decoded the same gray singer-window image. Stop returned idle, closing the display cleared the image, and reconnect, port migration and shutdown passed. This verifies the actual muted compositor path, not physical audio or real-venue synchronization. Multi-device venue-network, lyric-latency, full-show endurance and physical output checks remain release work.

**0.7.0 verification:** an isolated muted Electron rehearsal captured interlude and playing frames while the singer window stayed hidden, including after native Close. Completion/Skip advanced the running show after the gap; Stop cancelled its pending next start and restart left karaoke paused. Launch bumper is a separate preference. These checks do not establish physical mixer output, real-device LAN latency or a production support guarantee.
