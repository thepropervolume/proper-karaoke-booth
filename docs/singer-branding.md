# Singer Display Branding — 0.7.0

Open **Preferences → Singer Display**. Set your **Booth Name** for the header and between-song screen. Choose a PNG or JPEG logo (up to 2 MB); its thumbnail appears beside the picker immediately. Removing or choosing an image applies immediately; name, visibility and size apply on Save. Logo size is 10–85% of viewport width, with a height limit to preserve its aspect ratio and keep it on screen.

Enable a **Scrolling Banner**, enter the message and choose Top or Bottom. An optional stop time uses the host's local clock and is stored as an absolute ISO timestamp. With no stop time it stays until disabled; **Show After Restart** controls whether a later app launch shows it again (off by default). Text is rendered as text, including punctuation or markup characters. Reduced-motion system preferences disable scrolling.

The host preview works with the singer window hidden and reflects saved branding. It captures the same renderer used for playback, so there is only one audio player. Banner expiry has its own timer and does not restart the track or depend on playback events.

Settings JSON fields: `boothName`, `displayLogoSize`, `showDisplayLogo`, `bannerEnabled`, `bannerText`, `bannerPosition`, `bannerExpiresAt`, `bannerOnLaunch`. Changing any of them does not change song media. The actual selected logo is stored separately in the private app profile and is absent from show database backups.
