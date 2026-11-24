# The Proper Volume Karaoke Booth · mobile design

**Design draft for iPhone and Android.** The singer app discovers and joins a host’s room, finds songs, sends requests, and saves playlists. It can browse supported catalogs and save songs outside a room. Kiosk mode opens a host-selected room and offers only guest entry.

The visual system follows [The Proper Volume brand guide](https://thepropervolume.com/brand-guide/) with Nunito Sans, Night and Day surfaces, cyan actions, purple graphic fields, warm cream, and limited pink accents. The offset TPV wordmark is reserved for launch. The Booth microphone mark appears on Welcome, kiosk entry, Account, and Rooms.

## Screens

- **Room Discovery** puts nearby rooms first, with room codes and invite links always available. The room controls its connected search sources.
- **Search Results** groups the song, artist, source, and duration in compact rows. The song sheet offers Queue and Save. Queue requires a room. Saving works while browsing.
- **Queue** shows the live singer, your position, and what’s next. Requests show their status, including preparation and host review. A singer can withdraw their own waiting request.
- **Account** shows the profile, account state, and available settings. Guests can upgrade and bring their saved songs.
- **Playlists** puts Starred Songs up front, with named collections and their song lists one tap away.
- **Now Playing** shows the song, singer, timing, and who’s next. It reflects the host’s player and exposes singer actions such as applause and saving the song.

## Onboarding

The launch screen adapts the [website’s opening view](https://thepropervolume.com/) with its centered offset wordmark, navy field, and stage haze in a static composition. Welcome follows with **Continue as Guest** and **Sign In / Create Account**. After a valid email is entered, an existing account gets a password prompt with **Email me a sign-in link** and **Forgot password?** as secondary choices. A new email gets **Create Account** with a display name and password. The kiosk has a guest-only entry and a **Done** button that resets the singer’s session while retaining the host room and submitted requests.

Prototype only. Use `ben@example.com` with `Demo-B00th!` for the returning-account path and any other example address for account creation. The prototype processes its sample data in memory, with no real email, sign-in, download, or room connection.

## Editable prototype

Generate standalone HTML from the block below. Replace the asset placeholders with data URIs as follows:

- `@@FONT@@` · the [website’s Nunito Sans Latin variable font](https://thepropervolume.com/assets/fonts/nunito-sans-latin.woff2)
- `@@LAUNCH_PROPER@@` and `@@LAUNCH_VOLUME@@` · the homepage’s [purple block](https://thepropervolume.com/assets/images/logo-block-proper-purple.svg) and [cyan block](https://thepropervolume.com/assets/images/logo-block-volume-blue.svg)
- `@@LAUNCH_FOG@@` · the homepage’s [stage haze texture](https://thepropervolume.com/assets/images/fog-wisps.png)
- `@@MARK@@` · `assets/branding/mobile/adaptive-foreground.png` in Booth
- `@@ROOM_PHOTO@@` and `@@STAGE_PHOTO@@` · the TPV homepage’s [group photo](https://thepropervolume.com/api/photo/upload-8e0d11fc6db02a296980017bbfb2c7f4) and [Katie on stage](https://thepropervolume.com/api/photo/upload-4cb5f3a428d19ad7a809828ae8135c42) photos

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>The Proper Volume Karaoke Booth · Mobile Design</title>
<style>
@font-face{font-family:Nunito;src:url("@@FONT@@") format("woff2");font-display:swap;font-weight:200 1000}
*{box-sizing:border-box}
[hidden]{display:none!important}
:root{font-family:Nunito,system-ui,sans-serif;background:#080a10;color:#f4f2e9;color-scheme:dark}
body{margin:0}
button,input,select{font:inherit}
button{color:inherit;cursor:pointer}
button:disabled{cursor:default;opacity:.55}
button:focus-visible,input:focus-visible{outline:2px solid var(--focus,#0eb7ff);outline-offset:3px}
button, input, a{-webkit-tap-highlight-color:transparent}
button{touch-action:manipulation}
button svg{flex:none}
.i{width:21px;height:21px;vertical-align:middle}
.studio{--bg:#090e18;--surface:#101724;--raised:#182332;--ink:#f4f2e9;--muted:#b9c2d0;--fine:#2a3548;--accent:#0eb7ff;--focus:#0eb7ff;--on-accent:#06111f;--pop:#ff007f;--field:#601ce9;--field-ink:#fff;--live:#5ce4c4;--shadow:#0006}
.studio[data-theme=day]{--bg:#fdfef8;--surface:#f3f2e9;--raised:#eae9e3;--ink:#1c1a18;--muted:#625e58;--fine:#d4d2c9;--accent:#1765a6;--focus:#3a82ca;--on-accent:#fff;--pop:#c30068;--live:#157654;--shadow:#231c1226}
.studio{max-width:1390px;margin:auto;padding:36px 42px 42px}
.mast{display:flex;justify-content:space-between;align-items:flex-end;gap:20px;padding-bottom:26px;border-bottom:1px solid #283449}
.mast h1{font-size:clamp(24px,3vw,40px);margin:0;line-height:1.06;letter-spacing:-.04em}
.mast p{color:#b9c2d0;font-size:12px;font-weight:800;margin:5px 0 0}
.mast .project-name{color:#8bdcff;letter-spacing:.1em;text-transform:uppercase;margin:0 0 8px}
.tools{display:flex;gap:7px;flex-wrap:wrap}
.tool{background:#111827;border:1px solid #2a3548;border-radius:7px;padding:7px 12px;font-size:12px;font-weight:850;min-height:36px;white-space:nowrap}
.tool[aria-pressed=true]{background:#0eb7ff;color:#06111f;border-color:#0eb7ff}
.prototype{display:grid;grid-template-columns:minmax(176px,1fr) minmax(0,393px) minmax(172px,1fr);justify-items:center;gap:40px;margin-top:28px;align-items:start}
.rail{width:100%;max-width:211px;align-self:start}
.rail h2,.notes h2{margin:0 0 12px;font-size:17px}
.jump{width:100%;text-align:left;min-height:42px;color:#bdc8da;padding:0 12px;background:transparent;border:0;border-left:2px solid #2a3548;font-size:14px;font-weight:750}
.jump[aria-pressed=true]{color:#80d7ff;border-left-color:#0eb7ff;background:#111b2c}
.rail .tool{margin-top:14px}
.notes{color:#b9c2d0;font-size:14px;max-width:222px}
.notes h2{color:#f4f2e9}
.notes p{margin:0 0 14px}
.board{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:23px 28px;margin-top:26px;justify-items:center}
.board figure{margin:0;width:100%;max-width:393px}
.board figcaption{color:#e4e9f3;font-size:15px;display:flex;align-items:center;gap:10px;font-weight:800;padding-bottom:10px}
.board figcaption span{display:block;width:13px;height:4px;background:linear-gradient(90deg,#601ce9 0 45%,#0eb7ff 45% 100%)}
#device{width:100%}
.phone{height:732px;border:1px solid #394156;border-radius:33px;overflow:hidden;position:relative;isolation:isolate;display:flex;flex-direction:column;color:var(--ink);background:var(--bg);box-shadow:0 14px 48px #0004}
[data-theme=day] .phone{color-scheme:light}
[data-platform=android] .phone{border-radius:22px}
.status{display:flex;height:40px;flex:none;align-items:center;justify-content:space-between;padding:4px 23px 0;font-size:12px;font-weight:900;letter-spacing:.015em;z-index:2}
.signals{display:flex;align-items:center;gap:5px}
.signals .i{width:15px;height:15px}
.camera{position:absolute;top:12px;left:50%;transform:translateX(-50%);width:79px;height:17px;background:#000;border-radius:20px;z-index:3}
[data-platform=android] .camera{width:10px;height:10px;top:15px}
.home{height:17px;display:grid;place-items:center;flex:none;background:var(--bg)}
.home::after{content:"";width:105px;height:4px;border-radius:8px;background:var(--ink);opacity:.61}
[data-platform=android] .home::after{width:73px}
.content{overflow:auto;overscroll-behavior:contain;scrollbar-width:none;flex:1;min-height:0;padding:8px 19px 16px}
.content::-webkit-scrollbar{display:none}
.header{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:8px 0 14px}
h2,h3,p{margin:0}
.phone h2{font-size:35px;font-weight:800;line-height:1.04;letter-spacing:-.045em}
.phone h3{font-size:17px;font-weight:800;line-height:1.22;letter-spacing:-.018em}
.phone p{font-size:14px;line-height:1.35;color:var(--muted)}
.small{font-size:12px;color:var(--muted);line-height:1.25}
.meta{font-size:10px;font-weight:900;letter-spacing:.12em;text-transform:uppercase;color:var(--accent)}
.brand-small{width:33px;height:33px;object-fit:contain}
.quiet{color:var(--muted)}
.stack{display:grid;gap:10px}
.action{min-height:46px;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:1px solid transparent;border-radius:9px;padding:9px 14px;background:var(--accent);color:var(--on-accent);font-size:14px;font-weight:900;text-align:center}
.action.secondary{color:var(--ink);background:var(--surface);border-color:var(--fine)}
.action.ghost{background:transparent;color:var(--accent)}
.icon-btn{width:44px;height:44px;border:1px solid var(--fine);background:var(--surface);border-radius:9px;display:inline-grid;place-items:center;padding:0;color:var(--ink)}
.icon-btn.bare{border-color:transparent;background:transparent;color:var(--muted)}
.icon-btn[aria-pressed=true]{color:var(--accent);border-color:var(--accent)}
.text{color:var(--accent);padding:8px 0;min-height:44px;background:transparent;border:0;font-weight:850;font-size:13px}
.subhead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin:17px 0 8px}
.field{position:relative;display:block}
.field label,.form label{display:grid;gap:6px;color:var(--ink);font-size:12px;font-weight:850}
.field input,.form input,.form select{min-width:0;width:100%;min-height:46px;color:var(--ink);background:var(--surface);border:1px solid var(--fine);border-radius:8px;padding:0 12px;font-size:15px}
input::placeholder{color:var(--muted);opacity:.85}
.search input{padding:0 39px 0 37px}
.search>.i{position:absolute;top:13px;left:11px;color:var(--accent)}
.search .icon-btn{position:absolute;top:1px;right:1px;width:36px}
.hint{min-height:18px;font-size:12px;color:var(--muted)}
.room-hero{min-height:235px;padding:15px 15px 15px;display:flex;flex-direction:column;justify-content:space-between;background:linear-gradient(0deg,#071725 0%,#09131bd8 26%,#09131b1a 84%),url("@@ROOM_PHOTO@@") center 44%/cover,#101724;border:1px solid #34526c;border-radius:11px;color:#fff}
.room-hero.alt{min-height:166px}
.room-hero h3{font-size:26px;line-height:1.01;letter-spacing:-.04em}
.room-hero p{color:#e0eaf4;font-size:12px;margin:5px 0 11px}
.room-hero .action{align-self:start;color:#06111f;background:#0eb7ff}
.room-hero .badge{align-self:start}
.badge{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--fine);padding:4px 7px;border-radius:5px;font-size:10px;line-height:1.25;font-weight:900;white-space:nowrap;background:var(--surface);color:var(--ink)}
.badge.live{background:#09222c;color:#77ead7;border-color:#217269}
.badge.live::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.badge.mine{color:var(--accent);border-color:var(--accent);background:transparent}
.room-join.form{display:flex;gap:8px}
.room-join input{flex:1;min-width:0}
.rooms-help{font-size:12px;color:var(--muted);margin-top:8px}
.chips{display:flex;align-items:center;gap:5px;margin:10px 0 4px;overflow:auto;scrollbar-width:none}
.chip{background:var(--surface);color:var(--muted);border:1px solid var(--fine);border-radius:7px;padding:0 8px;min-height:33px;white-space:nowrap;font-size:11px;font-weight:850}
.chip[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
.row{display:flex;align-items:center;gap:9px;width:100%;min-height:59px;border-bottom:1px solid var(--fine);padding:4px 0;text-align:left}
.row:last-child{border-bottom-color:transparent}
.row>.copy,.row>.row-btn{flex:1;min-width:0}
.row-btn{display:flex;align-items:center;gap:10px;padding:0;border:0;background:transparent;text-align:left;min-height:46px;color:var(--ink)}
.copy{min-width:0;display:grid;gap:2px}
.row-btn>.copy{flex:1}
.copy strong,.copy small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.copy strong{font-size:14px;font-weight:900;line-height:1.18}
.copy small{font-size:11px;color:var(--muted)}
.duration{font-size:11px;font-variant-numeric:tabular-nums;color:var(--muted)}
.cover{width:43px;height:43px;flex:none;display:grid;place-items:center;overflow:hidden;border-radius:6px;background-color:#1f244a;background-image:radial-gradient(ellipse at 65% 65%,transparent 18%,#ffffff48 19% 21%,transparent 23% 34%,#ffffff2b 35% 36%,transparent 37%),linear-gradient(143deg,var(--cover-a,#146880),var(--cover-b,#2c1168));color:white}
.cover .i{width:17px;height:17px;filter:drop-shadow(0 2px 2px #0008)}
.cover.a{--cover-a:#145e70;--cover-b:#501e8e}.cover.b{--cover-a:#a9492a;--cover-b:#3a1658}.cover.c{--cover-a:#244bc0;--cover-b:#751a63}.cover.d{--cover-a:#28644d;--cover-b:#171f62}.cover.e{--cover-a:#7c195a;--cover-b:#982d2e}
.nav{display:grid;grid-template-columns:repeat(5,1fr);color:var(--muted);min-height:56px;border-top:1px solid var(--fine);flex:none;background:var(--bg);padding:3px 4px 0}
.nav button{background:transparent;color:inherit;border:0;display:grid;justify-items:center;align-content:center;gap:3px;font-size:10px;font-weight:800;min-width:0;padding:0 2px}
.nav button[aria-current=page]{color:var(--accent)}
.nav .i{width:20px;height:20px}
.mini{width:calc(100% - 24px);flex:none;margin:0 12px 5px;display:flex;align-items:center;gap:8px;min-height:49px;padding:5px 9px;border:1px solid var(--fine);border-radius:9px;background:var(--surface);text-align:left}
.mini .cover{height:31px;width:31px}.mini .copy{flex:1}.mini .copy strong{font-size:12px}.mini .copy small{font-size:10px}.mini>.i{color:var(--accent);width:16px}
.live-card{display:flex;align-items:center;gap:11px;color:var(--ink);width:100%;text-align:left;background:linear-gradient(108deg,var(--surface),var(--raised));border:1px solid var(--fine);border-left:3px solid var(--accent);border-radius:8px;padding:11px}
.live-card .copy{flex:1}
.live-card .copy strong{font-size:16px}
.live-card .i:last-child{color:var(--accent)}
.mine-card{margin:12px 0;padding:9px 11px;border-left:3px solid var(--accent);background:var(--surface);border-radius:0 7px 7px 0}
.mine-card strong{font-size:14px}
.rank{flex:0 0 24px;align-self:center;color:var(--accent);font-size:12px;font-weight:900;text-align:center;font-variant-numeric:tabular-nums}
.queue-row{min-height:56px}
.queue-row .badge{font-size:9px}
.playlist-hero{min-height:135px;width:100%;text-align:left;padding:11px 13px;border:0;border-radius:10px;color:white;background:linear-gradient(112deg,#351389,#601ce9 75%);overflow:hidden;position:relative;display:grid;align-content:space-between;isolation:isolate}
.playlist-hero:after,.arc:after{content:"";position:absolute;z-index:-1;right:-24%;top:-95%;height:290%;width:78%;transform:rotate(-34deg);background:repeating-linear-gradient(90deg,transparent 0 13px,#c5b1ff34 13px 14px)}
.playlist-hero .i{color:#c3eaff}
.playlist-hero h3{font-size:27px}.playlist-hero small{color:#f0eaff}
.set-glyph{display:grid;place-items:center;width:39px;height:39px;border-radius:6px;background:var(--raised);color:var(--accent);flex:none}
.account-card{border-radius:10px;min-height:133px;display:flex;align-items:center;gap:12px;color:#fff;padding:13px;background:linear-gradient(118deg,#151d48,#351389 84%);position:relative;isolation:isolate;overflow:hidden}
.account-card .small{color:#dddff3}
.account-card h3{font-size:21px}
.avatar{background:#0eb7ff;color:#06111f;border-radius:50%;width:54px;height:54px;display:grid;place-items:center;font-size:19px;font-weight:1000;flex:none}
.account-list{display:grid}
.account-list .row-btn{gap:12px;min-height:49px;padding:4px 0;border-bottom:1px solid var(--fine)}
.account-list .row-btn>.i{color:var(--accent);width:19px}
.account-list .row-btn>.copy{flex:1}
.account-list .row-btn>.i:last-child{color:var(--muted);width:14px}
.stage-art{height:242px;border-radius:9px;position:relative;isolation:isolate;overflow:hidden;display:grid;align-content:end;background:linear-gradient(160deg,#0b142329,#34128e2e 45%,#07111df5 100%),url("@@STAGE_PHOTO@@") center 23%/cover,#281459;padding:14px}
.stage-art:before{content:"";position:absolute;inset:9px;border:1px solid #a4e3ff42;border-top-color:#ff007f9c;z-index:-1;border-radius:3px}
.stage-art .badge{justify-self:start}
.player-track{padding:12px 0 3px}
.player-track h2{font-size:35px}
.player-track p{margin-top:4px}
.times{margin:12px 0 8px}
.progress{height:4px;border-radius:3px;background:var(--fine);overflow:hidden}
.progress::before{content:"";display:block;width:43%;height:100%;background:linear-gradient(90deg,#601ce9,#0eb7ff)}
.time-labels{display:flex;justify-content:space-between;font-size:10px;color:var(--muted);margin-top:5px;font-variant-numeric:tabular-nums}
.player-actions{display:flex;gap:8px}
.player-actions .action{flex:1}
.nextline{margin-top:10px;padding:10px 0 0;border-top:1px solid var(--fine)}
.welcome{flex:1;min-height:100%;display:flex;align-items:center;flex-direction:column;justify-content:center;gap:12px;text-align:center}
.welcome .mark{width:124px;height:124px;object-fit:contain;margin-bottom:3px}
.welcome h2{font-size:37px}
.welcome .stack{width:100%;margin-top:34px}
.phone:has(.launch){background:#090e18;color:#f4f2e9;color-scheme:dark}
.phone:has(.launch) .content{padding:0}
.phone:has(.launch) .home{background:transparent}
.launch{position:absolute;inset:0;display:grid;place-items:center;isolation:isolate;background:
  radial-gradient(ellipse at 29% 45%,#0eb7ff0b,transparent 55%),
  radial-gradient(ellipse at 79% 58%,#601ce914,transparent 57%),
  conic-gradient(from 170deg at 9% 3%,transparent 0deg,#8878f60e 144deg,transparent 176deg),
  conic-gradient(from 154deg at 90% 1%,transparent 0deg,#80d5ff10 31deg,transparent 64deg),
  #090e18}
.launch::before{content:"";position:absolute;inset:0;z-index:-1;opacity:.42;background:url("@@LAUNCH_FOG@@") 50% 103%/150% auto no-repeat}
.launch-logo{position:relative;width:78%;max-width:440px;aspect-ratio:675.75/225}
.launch-logo img{display:block;position:absolute;height:auto}
.launch-proper{top:0;left:0;width:51.25%;z-index:1}
.launch-volume{top:22.07%;right:0;width:52.70%}
.auth h2{font-size:32px;margin:8px 0}
.auth>.icon-btn{margin-bottom:12px}
.auth p{margin:0 0 12px}
.form{display:grid;gap:11px}
.form .action{width:100%}
.form .text{justify-self:start;margin:-4px 0}
.utility{margin-top:9px;display:grid;gap:3px}
.utility .action{width:100%}
.sheet{position:absolute;inset:0;z-index:5;background:#030911af;display:flex;align-items:end}
.sheet-panel{width:100%;background:var(--bg);border-radius:17px 17px 0 0;border-top:1px solid var(--fine);padding:16px 17px 27px;box-shadow:0 -10px 40px var(--shadow)}
.sheet-panel .header{margin-top:0}
.sheet-panel h2{font-size:28px}
.sheet-panel .row{margin-bottom:13px}
.sheet-panel .stack{margin-top:14px}
.handle{margin:-9px auto 7px;width:32px;height:3px;border-radius:4px;background:var(--fine)}
.toast{position:absolute;bottom:78px;left:12px;right:12px;z-index:7;background:var(--accent);color:var(--on-accent);border-radius:8px;padding:9px 12px;font-size:12px;font-weight:900;box-shadow:0 3px 16px var(--shadow)}
@media(max-width:1040px){.studio{padding:27px 24px}.prototype{gap:23px}.notes{font-size:13px}.board{gap:17px}.board .phone{height:710px}}
@media(max-width:845px){.mast{align-items:start;flex-direction:column}.board{grid-template-columns:repeat(2,minmax(0,1fr))}.prototype{grid-template-columns:minmax(136px,184px) minmax(0,393px);justify-content:center}.notes{display:none}}
@media(max-width:570px){.studio{padding:14px 10px 16px}.mast{gap:10px;padding-bottom:12px}.mast h1{font-size:23px}.mast p{font-size:10px}.tools{gap:4px}.tool{padding:6px 8px;font-size:10px;min-height:33px}.prototype{display:flex;flex-direction:column;align-items:center;gap:12px;margin-top:11px}.rail{max-width:none;display:flex;overflow:auto;gap:3px;scrollbar-width:none}.rail h2{display:none}.jump{width:auto;min-height:35px;white-space:nowrap;padding:0 8px;font-size:12px}.rail .tool{margin:0}.board{grid-template-columns:1fr}.phone{width:100%;max-width:393px;margin:0 auto;height:min(732px,calc(100svh - 130px));min-height:530px}}
</style>
</head>
<body>
<main id="studio" class="studio" data-theme="night" data-platform="ios">
  <header class="mast">
    <div><p class="project-name">The Proper Volume</p><h1>Karaoke Booth</h1><p>Mobile design · Singer app</p></div>
    <div class="tools" aria-label="Mockup controls">
      <button class="tool" data-mode="prototype" aria-pressed="true">Try the app</button>
      <button class="tool" data-mode="screens" aria-pressed="false">App screens</button>
      <button class="tool" data-mode="onboarding" aria-pressed="false">Onboarding</button>
      <button class="tool" data-choice="theme" data-value="day" aria-pressed="false">Day</button>
      <button class="tool" data-choice="theme" data-value="night" aria-pressed="true">Night</button>
      <button class="tool" data-choice="platform" data-value="ios" aria-pressed="true">iPhone</button>
      <button class="tool" data-choice="platform" data-value="android" aria-pressed="false">Android</button>
    </div>
  </header>
  <section id="prototype" class="prototype">
    <nav class="rail" aria-label="Mockup screens">
      <h2>Try a screen</h2>
      <button class="jump" data-view="rooms">Room Discovery</button>
      <button class="jump" data-view="search">Search Results</button>
      <button class="jump" data-view="queue">Queue</button>
      <button class="jump" data-view="account">Account</button>
      <button class="jump" data-view="lists">Playlists</button>
      <button class="jump" data-view="playing">Now Playing</button>
      <button class="tool" data-do="launch">Replay launch</button>
      <button class="tool" data-view="kiosk">Kiosk preview</button>
    </nav>
    <div id="device"></div>
    <aside class="notes"><h2 id="note-title"></h2><p id="note"></p><p>Demo only. Returning account <strong>ben@example.com</strong><br>Demo password <strong>Demo-B00th!</strong></p></aside>
  </section>
  <section id="board" class="board" hidden aria-label="Screen overview"></section>
</main>
<script>
const icons = {
  rooms:'<path d="M2 9c6-6 14-6 20 0M5 13c4-4 10-4 14 0m-11 3c2-2 6-2 8 0"/><circle cx="12" cy="20" r="1"/>',
  search:'<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5 5"/>',
  queue:'<path d="M8 5h12M8 12h12M8 19h12M4 5h.01M4 12h.01M4 19h.01"/>',
  lists:'<path d="M5 8h14v12H5zm2-4h10m-4 8v5m0-4 3-1"/><circle cx="11.5" cy="17.5" r="1.5"/>',
  account:'<circle cx="12" cy="8" r="3.5"/><path d="M4.5 21v-2a7.5 7.5 0 0 1 15 0v2"/>',
  chev:'<path d="m9 5 7 7-7 7"/>', back:'<path d="m15 5-7 7 7 7"/>', down:'<path d="m5 9 7 7 7-7"/>',
  plus:'<path d="M5 12h14M12 5v14"/>', close:'<path d="m6 6 12 12M18 6 6 18"/>',
  music:'<path d="M9 18V5l10-2v12"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="16" cy="15" rx="3" ry="2"/>',
  star:'<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  mic:'<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 9v2a7 7 0 0 0 14 0V9m-7 9v4m-3 0h6"/>',
  wave:'<path d="M3 10v4m4-7v10m5-15v20m5-15v10m4-7v4"/>',
  more:'<circle cx="4" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="20" cy="12" r="1"/>',
  battery:'<rect x="2" y="6" width="18" height="12" rx="2"/><path d="M22 10v4M5 9h12v6H5z"/>',
  signal:'<path d="M4 19v-3m5 3v-6m5 6V9m5 10V5"/>',
  applaud:'<path d="M8 14V7a1.5 1.5 0 0 1 3 0v5-8a1.5 1.5 0 0 1 3 0v8-6a1.5 1.5 0 0 1 3 0v7-3a1.5 1.5 0 0 1 3 0v5a7 7 0 0 1-13 4l-3-4a1.6 1.6 0 0 1 2.5-2zM2 5l2 2M3 2l2 2"/>',
  appearance:'<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
  mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  shield:'<path d="M12 2 4 6v5c0 5 3 8 8 11 5-3 8-6 8-11V6zM9 12l2 2 4-4"/>'
};
const i = key => '<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+icons[key]+'</svg>';
const mark = size => '<img class="'+size+'" src="@@MARK@@" alt="">';
const tracks = [
  {id:'amateur',title:'Amateur',artist:'Nada Surf',source:'Karaoke Nerds',duration:'3:55',cover:'a'},
  {id:'popular',title:'Popular',artist:'Nada Surf',source:'KaraFun',duration:'3:41',cover:'b'},
  {id:'inside',title:'Inside of Love',artist:'Nada Surf',source:'Karaoke Nerds',duration:'4:59',cover:'c'},
  {id:'always',title:'Always Love',artist:'Nada Surf',source:'Party Tyme',duration:'3:21',cover:'d'},
  {id:'blank',title:'Blankest Year',artist:'Nada Surf',source:'Karaoke Nerds',duration:'2:16',cover:'e'},
  {id:'praise',title:'A Praise Chorus',artist:'Jimmy Eat World',source:'Karaoke Nerds',duration:'4:02',cover:'b'},
  {id:'changes',title:'Everybody’s Changing',artist:'Keane',source:'KaraFun',duration:'3:35',cover:'a'},
  {id:'bad',title:'Bad Habit',artist:'Steve Lacy',source:'Party Tyme',duration:'3:52',cover:'e'}
];
const selections={amateur:0,popular:1,inside:2,always:3,blank:4,praise:5,changes:6,bad:7};
const sources=['All','Karaoke Nerds','KaraFun','Party Tyme'];
const signedInEmail='ben@example.com';
const self={name:'Beej',email:signedInEmail};
const showName='Friday Night Karaoke';
const score={title:'A Praise Chorus',singer:'Alex R.'};
const initialQueue=[
  {track:tracks[6],singer:'Sam K.',status:'Up next'},
  {track:tracks[3],singer:'Jules',status:'Waiting'},
  {track:tracks[7],singer:'Morgan',status:'Preparing'}
];
const collectionData=[
  {id:'starred',name:'Starred Songs',icon:'star',songs:['amateur','inside','praise']},
  {id:'warmup',name:'Warm-up Songs',icon:'music',songs:['changes','popular']},
  {id:'duets',name:'Duet Ideas',icon:'mic',songs:['always','inside']},
  {id:'late',name:'Late-Night Picks',icon:'wave',songs:['bad','blank']}
];
const descriptions={
  rooms:['Room Discovery','Join a host on the same network, or enter a room code or invite link.'],
  search:['Search Results','Search by song or artist. When joined, the room sets which sources can be requested.'],
  queue:['Queue','Check your place, see which requests are preparing, or withdraw your own waiting song.'],
  account:['Account','Manage your profile, sign in, and choose an appearance. Guests keep their playlists on the device.'],
  lists:['Playlists','Open Starred Songs or a named playlist in one tap.'],
  playing:['Now Playing','See the host’s current song, singer, progress, and who’s next.'],
  launch:['Launch Screen','The Proper Volume’s homepage wordmark and stage lighting appear while Booth opens.'],
  welcome:['Welcome','Continue as a guest or sign in.'],
  email:['Email Entry','Enter an email to start.'],
  auth:['Returning Account','A returning account gets a password prompt and an optional email link.'],
  signup:['Create Account','A new email opens a short sign-up form.'],
  kiosk:['Kiosk Welcome','The room is already set by the host. The kiosk only offers guest entry.']
};
const studio=document.querySelector('#studio');
const device=document.querySelector('#device');
const board=document.querySelector('#board');
const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[char]);
const trackById=id=>tracks[selections[id]];
const blankState=()=>({page:'rooms',joined:false,kiosk:false,name:'',account:null,query:'',source:'All',queue:[],lists:structuredClone(collectionData),list:'starred',modal:null,previous:'queue',email:'',authKind:'',claps:3});
let state=blankState();
let launchTimer, emailTimer;
const action=(label,props='',style='')=>'<button class="action '+style+'" type="button" '+props+'>'+label+'</button>';
const iconButton=(key,label,props='',style='')=>'<button class="icon-btn '+style+'" type="button" aria-label="'+label+'" '+props+'>'+i(key)+'</button>';
const cover=track=>'<span class="cover '+track.cover+'">'+i('music')+'</span>';
const copy=(title,subtitle)=>'<span class="copy"><strong>'+escapeHtml(title)+'</strong><small>'+escapeHtml(subtitle)+'</small></span>';
const header=(title,right='')=>'<header class="header"><h2>'+title+'</h2>'+right+'</header>';
const nav=page=>'<nav class="nav" aria-label="Booth">'+[['rooms','Rooms'],['search','Search'],['queue','Queue'],['lists','Playlists'],['account','Account']].map(([key,label])=>
  '<button type="button" data-view="'+key+'"'+(page===key?' aria-current="page"':'')+'>'+i(key)+label+'</button>').join('')+'</nav>';
const mini=()=>'<button class="mini" type="button" data-view="playing" aria-label="Open Now Playing">'+cover(tracks[5])+copy(score.title,'Live · '+score.singer)+i('wave')+'</button>';
const liveCard=()=>'<button class="live-card" type="button" data-view="playing">'+cover(tracks[5])+copy(score.title,'Sung by '+score.singer)+i('wave')+'</button>';
const roomCard=ctx=>'<div class="room-hero '+(ctx.joined?'alt':'')+'"><span class="badge live">'+(ctx.joined?'Connected':'Nearby · Live')+'</span><div><h3>'+showName+'</h3><p>The Proper Volume · Hosted by Beej</p>'+
  action(ctx.joined?'Open Queue':'Join Room',ctx.joined?'data-view="queue"':'data-do="join"')+'</div></div>';
const roomScreen=ctx=>header('Rooms',mark('brand-small'))+roomCard(ctx)+
  '<div class="subhead"><h3>Join with a code</h3></div><form class="room-join form" data-form="room-code"><label class="field" style="flex:1"><input aria-label="Room code or invite link" name="room" placeholder="Room code or invite link" required></label><button class="action" style="width:auto">Go</button></form>'+
  '<div class="subhead"><h3>'+(ctx.joined?'Room options':'Recently joined')+'</h3></div>'+
  (ctx.joined?'<div class="account-list"><button class="row-btn" type="button" data-do="leave">'+i('rooms')+copy('Leave Room',showName)+i('chev')+'</button></div>':
    '<div class="account-list"><button class="row-btn" type="button" data-do="join">'+i('rooms')+copy('Beechwold Open Mic','The Proper Volume')+i('chev')+'</button></div>');
const matchTracks=ctx=>tracks.filter(track=>(ctx.source==='All'||ctx.source===track.source)&&
  (ctx.joined||track.source==='Karaoke Nerds')&&[track.title,track.artist,track.source].join(' ').toLowerCase().includes(ctx.query.trim().toLowerCase()));
const resultRows=ctx=>{
  const hits=matchTracks(ctx);
  return '<div class="subhead"><span class="small">'+hits.length+(hits.length===1?' result':' results')+'</span></div>'+
    (hits.length?hits.map(track=>'<div class="row"><button class="row-btn" type="button" data-song="'+track.id+'">'+cover(track)+copy(track.title,track.artist+' · '+track.source)+'</button><span class="duration">'+track.duration+'</span>'+
    iconButton('more','Options for '+escapeHtml(track.title),'data-song="'+track.id+'"','bare')+'</div>').join(''):'<p>No songs found. Try another artist or title.</p>');
};
const searchScreen=ctx=>header('Search',ctx.joined?'<span class="badge live">In room</span>':'')+
  '<div class="field search">'+i('search')+'<input aria-label="Search songs" type="search" placeholder="Song or artist" value="'+escapeHtml(ctx.query)+'">'+
  iconButton('close','Clear search','data-do="clear"','bare')+'</div><div class="chips" aria-label="Search sources">'+
  (ctx.joined?sources:['All','Karaoke Nerds']).map(source=>'<button class="chip" type="button" data-source="'+source+'" aria-pressed="'+String(ctx.source===source)+'">'+source+'</button>').join('')+
  '</div><div class="results">'+resultRows(ctx)+'</div>';
const queueScreen=ctx=>{
  if(!ctx.joined) return header('Queue')+'<p>Join a room to see what’s playing and send song requests.</p><div class="subhead">'+action('Find a Room','data-view="rooms"')+'</div>';
  const all=[...initialQueue.slice(0,2),...ctx.queue,...initialQueue.slice(2)];
  const mine=all.findIndex(entry=>entry.mine);
  return header('Queue','<span class="badge live">Live</span>')+'<p>'+showName+'</p><div class="subhead"><h3>Now Playing</h3></div>'+liveCard()+
    (mine<0?'':'<div class="mine-card"><strong>Your turn · #'+(mine+1)+'</strong><p>'+escapeHtml(all[mine].track.title)+' · '+escapeHtml(all[mine].status)+'</p></div>')+
    '<div class="subhead"><h3>Coming Up</h3><span class="small">'+all.length+' songs</span></div>'+all.map((entry,index)=>
    '<div class="row queue-row"><span class="rank">'+String(index+1).padStart(2,'0')+'</span>'+copy(entry.track.title,entry.singer)+'<span class="badge '+(entry.mine?'mine':'')+'">'+entry.status+'</span>'+
    (entry.mine?iconButton('more','Manage '+escapeHtml(entry.track.title),'data-own="'+entry.track.id+'"','bare'):'')+'</div>').join('');
};
const listScreen=ctx=>header('Playlists',iconButton('plus','New playlist','data-do="new-list"'))+
  '<button class="playlist-hero" type="button" data-list="starred">'+i('star')+'<div><h3>Starred Songs</h3><small>'+ctx.lists[0].songs.length+' songs</small></div></button>'+
  '<div class="subhead"><h3>My Playlists</h3><span class="small">'+ctx.lists.slice(1).length+' playlists</span></div>'+
  ctx.lists.slice(1).map(list=>'<div class="row"><button class="row-btn" type="button" data-list="'+escapeHtml(list.id)+'"><span class="set-glyph">'+i(list.icon)+'</span>'+copy(list.name,list.songs.length+' songs')+i('chev')+'</button></div>').join('');
const listDetail=ctx=>{
  const list=ctx.lists.find(entry=>entry.id===ctx.list);
  return '<div class="header">'+iconButton('back','Back to Playlists','data-view="lists"')+'</div>'+header(escapeHtml(list.name))+
    '<p>'+list.songs.length+' songs</p><div class="subhead"></div>'+list.songs.map(id=>{
      const track=trackById(id);
      return '<div class="row"><button class="row-btn" type="button" data-song="'+track.id+'">'+cover(track)+copy(track.title,track.artist)+'</button><span class="duration">'+track.duration+'</span></div>';
    }).join('');
};
const accountRow=(key,title,detail,props)=>'<button class="row-btn" type="button" '+props+'>'+i(key)+copy(title,detail)+i('chev')+'</button>';
const accountScreen=ctx=>{
  const name=ctx.account?.name||ctx.name||'Guest';
  const initials=name.trim().split(/\s+/).map(bit=>bit[0]).slice(0,2).join('').toUpperCase();
  return header('Account',mark('brand-small'))+
    '<div class="account-card arc"><span class="avatar">'+escapeHtml(initials)+'</span><div><h3>'+escapeHtml(name)+'</h3><div class="small">'+escapeHtml(ctx.account?.email||'Guest profile')+'</div></div></div>'+
    (ctx.account?'':'<div class="utility">'+action('Sign In / Create Account','data-view="auth"')+'</div>')+
    '<div class="subhead"><h3>Profile &amp; Settings</h3></div><div class="account-list">'+
    accountRow('account','Display Name','Shown to hosts','data-do="edit-name"')+accountRow('appearance','Appearance','Day or Night','data-do="appearance"')+
    accountRow('lists','Playlists',ctx.account?'Account library':'Saved on this device','data-view="lists"')+
    '</div>'+(ctx.account?'<div class="utility">'+action('Sign Out','data-do="sign-out"','secondary')+'</div>':'')+
    '<div class="subhead"><span class="small">The Proper Volume Karaoke Booth</span></div>';
};
const playingScreen=ctx=>{
  if(!ctx.joined) return header('Now Playing')+'<p>Join a room to follow the live show.</p><div class="subhead">'+action('Find a Room','data-view="rooms"')+'</div>';
  return '<div class="header">'+iconButton('down','Close Now Playing','data-do="close-player"')+
    '<div style="text-align:right"><div class="meta">Now Playing</div><div class="small">'+showName+'</div></div></div>'+
    '<div class="stage-art"><span class="badge live">On stage</span></div><div class="player-track"><h2>'+score.title+'</h2><p>Jimmy Eat World · Sung by '+score.singer+'</p></div>'+
    '<div class="times"><div class="progress" role="progressbar" aria-label="Song progress" aria-valuemin="0" aria-valuemax="242" aria-valuenow="104"></div><div class="time-labels"><span>1:44</span><span>4:02</span></div></div>'+
    '<div class="player-actions">'+action(i('applaud')+' Applaud','data-do="applaud"'+(ctx.claps===0?' disabled':''))+action(i('star')+' '+(ctx.lists[0].songs.includes('praise')?'Starred':'Save'),'data-do="star-live"','secondary')+
    '</div><div class="nextline"><div class="meta">Up Next</div><div class="row"><span class="rank">01</span>'+copy(initialQueue[0].track.title,initialQueue[0].singer)+
    iconButton('chev','Open Queue','data-view="queue"','bare')+'</div></div>';
};
const welcomeScreen=kiosk=>'<div class="welcome">'+mark('mark')+'<h2>'+(kiosk?'Request a Song':'Karaoke Booth')+
  '</h2><p>'+(kiosk?showName:'Find a song. Take the mic.')+'</p><div class="stack">'+action('Continue as Guest',kiosk?'data-do="join"':'data-view="rooms"')+
  (kiosk?'':action('Sign In / Create Account','data-view="auth"','secondary'))+'</div></div>';
const authExtras=ctx=>ctx.authKind==='existing'?
  '<label>Password<input type="password" name="password" autocomplete="current-password" required></label><button class="action">Sign In</button>'+
  '<button type="button" class="text" data-do="recover">Forgot password?</button>'+action(i('mail')+' Email me a sign-in link','data-do="email-link"','secondary'):
  ctx.authKind==='new'?'<label>Display name<input name="signup-name" autocomplete="nickname" maxlength="60" placeholder="Name the host should call" required></label>'+
  '<label>Create a password<input type="password" name="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters" required></label><button class="action">Create Account</button>':'';
const authScreen=ctx=>'<div class="auth">'+iconButton('back','Back','data-do="auth-back"')+
  '<h2 data-auth-title>'+(ctx.authKind==='new'?'Create Account':'Sign In')+'</h2><p data-auth-copy>'+authCopy(ctx.authKind)+'</p>'+
  '<form class="form" data-form="auth"><label>Email address<input name="email" aria-label="Email address" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="'+escapeHtml(ctx.email)+'" required></label>'+
  '<div class="form" data-auth-extras>'+authExtras(ctx)+'</div><div class="hint" role="status"></div></form></div>';
function authCopy(kind){
  if(kind==='new') return 'Choose a display name and password.';
  if(kind==='existing') return 'Welcome back. Enter your password to continue.';
  return 'Use the email address for your Booth account.';
}
const screenTemplates={
  rooms:roomScreen,search:searchScreen,queue:queueScreen,account:accountScreen,lists:listScreen,list:listDetail,playing:playingScreen,
  launch:()=>'<div class="launch"><div class="launch-logo" role="img" aria-label="The Proper Volume"><img class="launch-proper" src="@@LAUNCH_PROPER@@" alt=""><img class="launch-volume" src="@@LAUNCH_VOLUME@@" alt=""></div></div>',
  welcome:()=>welcomeScreen(false),kiosk:()=>welcomeScreen(true),email:authScreen,auth:authScreen,signup:authScreen
};
const tabs=['rooms','search','queue','lists','account','list'];
const demoJoined=['Friday Night Karaoke','Friday-Night','friday-night'];
function sheet(ctx){
  const modal=ctx.modal;
  if(!modal) return '';
  let title, details;
  if(modal.type==='join'){
    title='Join Room';
    details='<p>'+escapeHtml(modal.room||showName)+'</p><div class="subhead"></div><form class="form" data-form="join"><label>Display name<input name="name" autocomplete="'+(ctx.kiosk?'off':'nickname')+
      '" maxlength="60" value="'+escapeHtml(ctx.name||ctx.account?.name||'')+'" required></label><button class="action">Join as '+(ctx.account?'Singer':'Guest')+'</button></form>';
  }
  if(modal.type==='track'){
    const track=trackById(modal.id);
    title=escapeHtml(track.title);
    details='<div class="row">'+cover(track)+copy(track.artist,track.source+' · '+track.duration)+'</div><div class="stack">'+
      (ctx.joined?action('Add to Queue','data-do="request"'):action('Join a Room to Queue','data-view="rooms"'))+
      (ctx.kiosk?'':action(i('star')+' '+(ctx.lists[0].songs.includes(track.id)?'Remove from Starred':'Star Song'),'data-do="star"','secondary')+
        '<form class="form" data-form="save-list"><label>Save to Playlist<select name="list" required>'+ctx.lists.map(list=>'<option value="'+escapeHtml(list.id)+'">'+escapeHtml(list.name)+'</option>').join('')+
        '</select></label><button class="action secondary">Save</button></form>')+'</div>';
  }
  if(modal.type==='own'){
    title='Song Request';
    details='<p>'+escapeHtml(trackById(modal.id).title)+'</p><div class="stack">'+action('Withdraw Request','data-do="withdraw"','secondary')+'</div>';
  }
  if(modal.type==='name'||modal.type==='new-list'){
    const name=modal.type==='name';
    title=name?'Display Name':'New Playlist';
    details='<form class="form" data-form="'+modal.type+'"><label>'+(name?'Display name':'Playlist name')+
      '<input name="name" maxlength="60" value="'+escapeHtml(name?(ctx.account?.name||ctx.name):'')+'" required></label><button class="action">Save</button></form>';
  }
  if(modal.type==='appearance'){
    title='Appearance';
    details='<div class="stack">'+action('Day','data-choice="theme" data-value="day"','secondary')+action('Night','data-choice="theme" data-value="night"','secondary')+'</div>';
  }
  return '<div class="sheet"><section class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sheet-title"><div class="handle"></div><header class="header"><h2 id="sheet-title">'+title+'</h2>'+
    iconButton('close','Close','data-do="dismiss"','bare')+'</header>'+details+'</section></div>';
}
function phone(ctx,inert=false){
  const page=ctx.page;
  const tab=page==='list'?'lists':page;
  const primary=tabs.includes(page);
  return '<div class="phone"'+(inert?' inert':'')+'><div class="status" aria-hidden="true"><span>9:41</span><div class="camera"></div><span class="signals">'+i('signal')+i('rooms')+i('battery')+'</span></div>'+
    '<div class="content"'+(ctx.modal?' inert':'')+'>'+(ctx.kiosk&&page==='search'?'<div class="header"><span class="small">'+showName+'</span>'+action('Done','data-do="kiosk-done"','secondary')+'</div>':'')+
    screenTemplates[page](ctx)+'</div>'+(primary&&!ctx.kiosk?'<div'+(ctx.modal?' inert':'')+'>'+(ctx.joined&&page!=='queue'?mini():'')+nav(tab)+'</div>':'')+
    '<div class="home" aria-hidden="true"></div>'+sheet(ctx)+'</div>';
}
function render(focus=false){
  device.innerHTML=phone(state);
  const note=descriptions[state.page]||descriptions.lists;
  document.querySelector('#note-title').textContent=note[0];
  document.querySelector('#note').textContent=note[1];
  studio.querySelectorAll('.jump').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.view===state.page)));
  if(focus){
    let target=device.querySelector('.sheet h2')||device.querySelector('.content h2');
    if(target){target.tabIndex=-1;target.focus();}
  }
}
function openView(page,focus=true){
  clearTimeout(launchTimer);
  clearTimeout(emailTimer);
  if(!screenTemplates[page]) return;
  if(page==='playing'&&state.page!=='playing') state.previous=state.page;
  if(page==='auth'&&state.page!=='auth') state.authBack=state.page;
  if(page==='kiosk'){state.kiosk=true;state.joined=false;state.name='';state.account=null;state.email='';state.authKind='';state.query='';state.source='All';}
  else if(state.kiosk&&['rooms','queue','account','lists','welcome'].includes(page)) state.kiosk=false;
  state.page=page;
  state.modal=null;
  render(focus);
}
function showBoard(mode){
  const onboarding=mode==='onboarding';
  const pages=onboarding?['launch','welcome','email','auth','signup','kiosk']:['rooms','search','queue','account','lists','playing'];
  board.innerHTML=pages.map(page=>{
    const sample={...blankState(),page,query:'Nada Surf',joined:!onboarding&&page!=='rooms',name:self.name,account:self,
      queue:[{track:tracks[0],singer:self.name,mine:true,status:'Queued'}]};
    if(page==='auth') Object.assign(sample,{email:signedInEmail,authKind:'existing'});
    if(page==='signup') Object.assign(sample,{email:'alex@example.com',authKind:'new'});
    return '<figure><figcaption><span></span>'+descriptions[page][0]+'</figcaption>'+phone(sample,true)+'</figure>';
  }).join('');
}
function demoToast(message){
  device.querySelector('.toast')?.remove();
  const alert=document.createElement('div');
  alert.className='toast';
  alert.setAttribute('role','status');
  alert.textContent=message;
  device.querySelector('.phone').append(alert);
  setTimeout(()=>alert.remove(),2800);
}
function toggleStar(id){
  const songs=state.lists[0].songs;
  const on=songs.includes(id);
  if(on) songs.splice(songs.indexOf(id),1);
  else songs.push(id);
  state.modal=null;
  render();
  demoToast(on?'Removed from Starred Songs.':'Saved to Starred Songs.');
}
function detectAccount(field){
  if(!field.isConnected) return;
  const email=field.value.trim();
  const kind=email&&field.validity.valid?(email.toLowerCase()===signedInEmail?'existing':'new'):'';
  if(state.authKind!==kind){
    state.authKind=kind;
    device.querySelector('[data-auth-extras]').innerHTML=authExtras(state);
    device.querySelector('[data-auth-title]').textContent=kind==='new'?'Create Account':'Sign In';
    device.querySelector('[data-auth-copy]').textContent=authCopy(kind);
  }
  state.email=email;
}
function dialog(type,fields={}){
  state.modal={type,...fields};
  render(true);
}
const handlers={
  launch:()=>{state=blankState();openView('launch');launchTimer=setTimeout(()=>openView('welcome'),900);},
  join:()=>dialog('join',{room:showName}),
  clear:()=>{state.query='';const field=device.querySelector('input[type=search]');field.value='';device.querySelector('.results').innerHTML=resultRows(state);field.focus();},
  leave:()=>{state.joined=false;state.source='All';render();demoToast('Left the room.');},
  dismiss:()=>{state.modal=null;render();},
  appearance:()=>dialog('appearance'),
  'edit-name':()=>dialog('name'),
  'new-list':()=>dialog('new-list'),
  'sign-out':()=>{state.account=null;state.authKind='';state.email='';render();demoToast('Signed out of this demo.');},
  'close-player':()=>openView(state.previous),
  'auth-back':()=>openView(state.authBack??'welcome'),
  'email-link':()=>{device.querySelector('.hint').textContent='Demo only. This would send a sign-in link.';},
  recover:()=>{device.querySelector('.hint').textContent='Demo only. This would send a reset link.';},
  applaud:()=>{if(state.claps){state.claps--;render();demoToast('Applause sent · '+state.claps+' credits left.');}},
  'star-live':()=>toggleStar('praise'),
  star:()=>toggleStar(state.modal.id),
  request:()=>{
    const track=trackById(state.modal.id);
    if(!state.queue.some(entry=>entry.mine&&entry.track.id===track.id&&entry.singer===state.name))
      state.queue.push({track,singer:state.name,mine:true,status:'Queued'});
    state.modal=null;
    if(state.kiosk){render();demoToast('Request sent. Tap Done when finished.');}
    else {openView('queue');demoToast('Added to the demo queue.');}
  },
  withdraw:()=>{state.queue=state.queue.filter(entry=>entry.track.id!==state.modal.id);state.modal=null;render();demoToast('Request withdrawn.');},
  'kiosk-done':()=>openView('kiosk')
};
studio.addEventListener('click',event=>{
  const button=event.target.closest('button');
  if(!button)return;
  const data=button.dataset;
  if(data.mode){
    board.hidden=data.mode==='prototype';
    document.querySelector('#prototype').hidden=!board.hidden;
    if(!board.hidden) showBoard(data.mode);
    studio.querySelectorAll('[data-mode]').forEach(candidate=>candidate.setAttribute('aria-pressed',String(candidate===button)));
  }
  if(data.choice){
    studio.dataset[data.choice]=data.value;
    studio.querySelectorAll('.tools [data-choice="'+data.choice+'"]').forEach(candidate=>candidate.setAttribute('aria-pressed',String(candidate.dataset.value===data.value)));
    if(state.modal?.type==='appearance') handlers.dismiss();
  }
  if(data.view){
    if(button.classList.contains('jump')&&state.kiosk){state.kiosk=false;state.joined=false;}
    openView(data.view);
  }
  if(data.source){
    state.source=data.source;
    device.querySelectorAll('[data-source]').forEach(candidate=>candidate.setAttribute('aria-pressed',String(candidate===button)));
    device.querySelector('.results').innerHTML=resultRows(state);
  }
  if(data.song) dialog('track',{id:data.song});
  if(data.own) dialog('own',{id:data.own});
  if(data.list){state.list=data.list;openView('list');}
  if(data.do) handlers[data.do]?.();
});
studio.addEventListener('input',event=>{
  const field=event.target;
  if(field.type==='search'){
    state.query=field.value;
    device.querySelector('.results').innerHTML=resultRows(state);
  }
  if(field.name==='email'){
    clearTimeout(emailTimer);
    emailTimer=setTimeout(()=>detectAccount(field),180);
  }
});
studio.addEventListener('focusout',event=>{
  if(event.target.name==='email'&&event.target.isConnected) detectAccount(event.target);
});
studio.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&state.modal)handlers.dismiss();
});
studio.addEventListener('submit',event=>{
  event.preventDefault();
  const form=event.target, data=new FormData(form);
  const type=form.dataset.form;
  if(type==='room-code'){
    const code=data.get('room').trim();
    if(!code||!demoJoined.some(room=>room.toLowerCase()===code.toLowerCase())&&!/^(https?:\/\/)?queue\.thepropervolume\.com\//i.test(code)){
      form.elements.room.setCustomValidity('Try the demo code friday-night.');
      form.elements.room.reportValidity();
      form.elements.room.setCustomValidity('');
      return;
    }
    handlers.join();
  }
  if(type==='join'){
    const name=data.get('name').trim();
    if(!name)return;
    state.name=name;state.joined=true;openView('search');
  }
  if(type==='auth'){
    detectAccount(form.elements.email);
    if(!state.authKind||!data.get('password')){
      form.querySelector('[name=password]')?.focus();
      return;
    }
    if(state.authKind==='existing'&&data.get('password')!=='Demo-B00th!'){
      form.querySelector('.hint').textContent='Demo password: Demo-B00th!';
      return;
    }
    const name=state.authKind==='existing'?self.name:data.get('signup-name').trim();
    if(!name)return;
    state.account={name,email:state.email};state.name=name;openView('account');
  }
  if(type==='name'||type==='new-list'){
    const name=data.get('name').trim();
    if(!name)return;
    if(type==='name'){state.name=name;if(state.account)state.account.name=name;}
    else state.lists.push({id:'custom-'+state.lists.length,name,icon:'music',songs:[]});
    state.modal=null;render();
  }
  if(type==='save-list'){
    const playlist=state.lists.find(entry=>entry.id===data.get('list'));
    if(!playlist.songs.includes(state.modal.id))playlist.songs.push(state.modal.id);
    state.modal=null;render();demoToast('Saved to '+playlist.name+'.');
  }
});
render();
</script>
</body>
</html>
```
