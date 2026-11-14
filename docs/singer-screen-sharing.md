# LAN Singer-Screen Sharing

Source development **0.5.0** adds an opt-in, read-only visual mirror of the actual singer window. Other browsers see the same lyrics and singer-screen overlays. Audio remains on the host's selected output; the mirror never creates another karaoke or bumper player.

## Start and Stop

1. Connect the host and viewing devices to the venue network.
2. Open **Remote Sessions → LAN Singer Screens** and select **Start Singer-Screen Sharing**. Alternatively, enable sharing under **Preferences → Singer Display**, choose the port and save.
3. Copy one of the displayed numeric addresses to each viewing browser, for example `http://192.168.1.20:4051`.
4. Open the ordinary singer display from the host or start an eligible queued song. The browsers mirror that display; while it is absent they show a waiting screen.
5. Use **Stop Singer-Screen Sharing** to close the listener. Stopping sharing does not stop the singer performance. The local host preview can continue independently.

Sharing is off by default. The default port is **4051**; Preferences accepts ports 1024–65535. If another program is using the port, choose a different one and save, or use **Retry Sharing** after resolving the conflict. Reconfiguration closes the previous listener and connections before opening the replacement.

## Addresses and Network Access

Use the numeric address when a name such as `proper-computer.local` does not resolve. The application does not install an mDNS service or make a hostname work on every venue network. Changing Wi-Fi, interfaces or host addresses may require copying a fresh address.

Windows may ask whether to allow the application on **Private networks**. An inbound private-network firewall allowance may be needed for the chosen port. Guest-network client isolation can prevent devices from reaching one another even when they share Wi-Fi. Check these network settings with the venue; the app does not silently change firewall rules.

Keep this listener private to the venue. It is not an internet relay and should not be port-forwarded publicly. The service accepts directly connected private, link-local or loopback peers, validates request hosts/origins and offers only read-only display assets/status. It does not expose the show database, file paths, credentials, media-file URLs or host-control actions.

## Viewing Is Separate from Requesting

Anyone able to reach this LAN port can view the singer screen while sharing is enabled. This viewing page does not identify a singer, join the queue or permit requests. Use the separate local-room invitation or the public internet Remote Session link for song requests. An internet request session does not enable public internet access to this visual mirror.

The host's **Singer Preview** uses the same captured singer-window pixels. Appearance preferences place it above/below Host Queue or hide it; the separators resize it and the surrounding panels. The preview is silent.

## Limits and Recovery

- The current server allows up to **64 simultaneous browser streams**. Browser connection limits, Wi-Fi bandwidth and host CPU can lower practical capacity.
- It sends JPEG frames over a multipart HTTP stream, using approximately 125 ms capture polling with static-frame deduplication. It is a visual mirror, not a sample-accurate audio/video synchronization system.
- Captures do not overlap. Generation checks reject late images from a closed/replaced display; losing demand, capture failures or invalidation clears old pixels. Slow viewers have bounded pending data and can reconnect.
- The page fits its viewport and reconnects after connection loss. Audio comes only from the host, so a viewing device cannot fix a host audio-output problem.

Source HTTP/capture tests and private UI control rehearsals pass. A silent synthetic MP4 played in the actual 0.5.0 source app; its host JPEG preview and two isolated LAN browsers decoded the same gray singer-window image. Stop returned idle, closing the display cleared the image, and reconnect, port migration and shutdown passed. This verifies the actual muted compositor path, not physical audio or real-venue synchronization. Multi-device venue-network, lyric-latency, full-show endurance and physical output checks remain release work.
