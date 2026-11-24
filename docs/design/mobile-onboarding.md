# Booth mobile launch and onboarding

**Design proposal.** Booth currently keeps the singer’s optional email in the app or browser’s local profile. It has no account creation, verification email, sign-in, or profile synchronization.

- **Launch.** The operating system shows the existing TPV mark on a light or dark background until Booth is ready. This screen has no interactive controls.
- **First use.** Welcome offers **Continue as Guest** and **Sign In / Create Account**. Guests can browse and join a room with a display name. People can upgrade from Guest in Profile.
- **Account.** Sign-in takes an email address. Creation asks for a display name and email. Both use a one-time email code in this proposal. Account sync for playlists and starred songs is proposed. An existing guest’s saved songs should be preserved and offered for import.
- **Kiosk.** A host sets the room before handing over the device. Singers use guest mode and enter a display name when joining. **Done** clears the current singer from the device while the room remains available and accepted requests stay in the host’s queue. Kiosk hides personal sign-in and account creation.

The mockup is self-contained once generated. The source is the HTML block below. Replace `@@LAUNCH_MARK@@` with a PNG data URI made from `assets/branding/mobile/adaptive-foreground.png`, and save the block as HTML. The prototype uses sample content and the demo code **123456**. It sends no email, contacts no rooms, and stores no account data.

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Booth for iPhone &amp; Android · Launch and onboarding</title>
<style>
:root { color-scheme: dark; font-family: system-ui, -apple-system, sans-serif; background:#10111b; color:#f7f6f3; }
* { box-sizing:border-box; }
body { margin:0; }
button,input { font:inherit; }
button { cursor:pointer; }
button:focus-visible,input:focus-visible { outline:3px solid #0eb7ff; outline-offset:3px; }
.deck { max-width:1220px; padding:34px clamp(20px,4vw,52px) 42px; margin:auto; }
.mast { display:flex; align-items:center; justify-content:space-between; gap:24px; flex-wrap:wrap; padding-bottom:22px; border-bottom:1px solid #34364a; }
.mast small { display:block; color:#a8a9bc; text-transform:uppercase; font-size:11px; letter-spacing:.14em; font-weight:750; margin-bottom:6px; }
.mast h1 { margin:0; font-size:clamp(26px,4.3vw,41px); letter-spacing:-.055em; line-height:1.06; }
.toggles { display:flex; gap:8px; flex-wrap:wrap; }
.toggles button, .jump, .preview-toggle { color:#f7f6f3; border:1px solid #434456; background:#191a27; border-radius:9px; padding:10px 13px; font-size:13px; font-weight:650; }
.toggles button[aria-pressed=true],.jump[aria-pressed=true] { background:#ece9ff; border-color:#ece9ff; color:#241655; }
.prototype { display:grid; grid-template-columns:minmax(165px,1fr) minmax(290px,355px) minmax(165px,1fr); gap:clamp(16px,4vw,46px); max-width:980px; margin:34px auto 0; align-items:start; }
.rail { display:grid; gap:8px; }
.rail h2,.notes h2 { margin:0 0 9px; font-size:16px; letter-spacing:-.02em; }
.jump { text-align:left; }
.notes { color:#c0c2d2; line-height:1.55; font-size:14px; }
.notes p { margin:0 0 14px; }
.notes h2 { color:#fff; }
.notes strong { color:#fff; }
.stage { min-width:0; }
.stage > .phone { margin:auto; }
[hidden] { display:none !important; }
.phone {
  --surface:#fdfef8; --ink:#171429; --sub:#535369; --hair:#dad8e3; --field:#fff;
  --layer:#f1eefc; --accent:#601ce9; --on-accent:#fff; --link:#5416c6; --success:#197451;
  position:relative; display:flex; flex-direction:column; color:var(--ink); background:var(--surface);
  border:5px solid #39394b; border-radius:32px; height:620px; width:100%; overflow:hidden;
  box-shadow:0 12px 24px #0003; isolation:isolate; color-scheme:light;
}
[data-theme=night] .phone {
  --surface:#090e18; --ink:#fbfaff; --sub:#bfc1d4; --hair:#3a3f55; --field:#171e30;
  --layer:#20213d; --accent:#bd9dff; --on-accent:#211041; --link:#c6aaff; --success:#7fe5b4; color-scheme:dark;
}
[data-platform=android] .phone { border-radius:25px; }
.status { display:flex; align-items:center; justify-content:space-between; padding:13px 20px 4px; font-weight:750; font-size:11px; flex:none; }
.status-icons { display:flex; gap:5px; align-items:center; }
.battery { width:18px; height:9px; border:1px solid currentColor; border-radius:3px; position:relative; }
.battery::before { position:absolute; content:''; inset:1px; border-radius:1px; background:currentColor; }
.battery::after { position:absolute; content:''; width:2px; height:4px; inset:1px auto auto 17px; background:currentColor; border-radius:0 1px 1px 0; }
.home { height:20px; flex:none; display:grid; place-items:center; }
.home::after { content:''; width:33%; height:4px; max-width:104px; border-radius:4px; background:var(--ink); opacity:.76; }
.content { flex:auto; min-height:0; overflow:auto; padding:12px 21px 17px; }
.phone h2 { font-size:29px; letter-spacing:-.055em; line-height:1.06; margin:0 0 9px; }
.phone p { margin:0 0 12px; font-size:14px; line-height:1.42; color:var(--sub); }
.mark { display:block; inline-size:100%; aspect-ratio:1; object-fit:contain; }
.launch { height:100%; display:grid; place-items:center; }
.launch img { width:min(224px,76%); }
.welcome { display:flex; flex-direction:column; min-height:100%; }
.welcome-brand { text-align:center; margin:auto 0; padding:12px 0 20px; }
.welcome-brand img { width:154px; margin:0 auto -7px; }
.welcome-brand h2 { font-size:36px; }
.welcome-brand p { max-width:235px; margin:0 auto; }
.stack { display:grid; gap:10px; }
.action { min-height:46px; border:1px solid transparent; border-radius:13px; padding:10px 12px; background:var(--accent); color:var(--on-accent); font-size:14px; font-weight:750; text-align:center; }
.action.secondary { border-color:var(--hair); background:var(--field); color:var(--ink); }
.action.link,.back { color:var(--link); background:none; border:0; font-weight:720; }
.back { padding:6px 0; min-height:40px; margin-bottom:13px; }
.auth { padding-top:6px; }
.auth p { margin-bottom:17px; }
.form { display:grid; gap:13px; }
.form label { display:grid; gap:5px; color:var(--ink); font-size:12px; font-weight:730; }
.form input { width:100%; min-height:44px; padding:9px 10px; border:1px solid var(--hair); border-radius:10px; background:var(--field); color:var(--ink); font-size:15px; }
.form .action { width:100%; }
.account-foot { display:grid; gap:3px; margin-top:11px; }
.context { display:flex; align-items:center; justify-content:space-between; gap:11px; padding-bottom:14px; margin-bottom:14px; border-bottom:1px solid var(--hair); color:var(--sub); font-size:12px; }
.context b { color:var(--ink); }
.context .pulse { display:inline-block; width:7px; height:7px; margin-inline-end:4px; border-radius:50%; background:var(--success); }
.sub-label { font-size:12px; font-weight:730; color:var(--sub); margin:15px 0 7px; }
.search { display:block; position:relative; margin:14px 0 12px; }
.search input { width:100%; padding:12px 12px 12px 34px; border:1px solid var(--hair); border-radius:11px; color:var(--ink); background:var(--field); }
.search span { position:absolute; left:13px; top:13px; color:var(--sub); }
.item { display:flex; align-items:center; justify-content:space-between; gap:10px; padding:12px 0; border-bottom:1px solid var(--hair); }
.item strong { display:block; color:var(--ink); font-size:14px; }
.item small { display:block; color:var(--sub); font-size:11px; margin-top:3px; }
.item .action { min-height:39px; padding:6px 9px; font-size:12px; }
.room-card { padding:14px 13px; margin:14px 0 13px; color:var(--ink); background:var(--layer); border-radius:12px; }
.room-card strong { display:block; }
.room-card small { color:var(--sub); }
.dock { flex:none; display:flex; justify-content:space-around; border-top:1px solid var(--hair); padding:5px 4px 0; }
.dock button { width:25%; min-height:39px; border:0; color:var(--sub); background:none; font-size:11px; font-weight:700; }
.dock button[aria-current] { color:var(--link); }
.dock span { display:block; font-size:16px; opacity:.95; }
.feedback { font-size:13px; color:var(--success); margin:11px 0; }
.board { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:22px; margin-top:25px; }
.board figure { margin:0; min-width:0; }
.board figcaption { margin:0 0 8px; color:#fff; font-size:14px; font-weight:700; }
.board .phone { height:530px; }
.board .phone h2 { font-size:26px; }
.board .welcome-brand h2 { font-size:31px; }
.board .notes { display:none; }
.board [inert] { pointer-events:none; }
@media(max-width:850px) {
  .prototype { grid-template-columns:minmax(140px, .75fr) minmax(265px, 350px); justify-content:center; }
  .notes { grid-column:1/-1; max-width:510px; margin:auto; }
  .board { grid-template-columns:repeat(2,minmax(0,1fr)); }
}
@media(max-width:570px) {
  .prototype { grid-template-columns:1fr; margin-top:20px; }
  .rail { display:flex; flex-wrap:wrap; }
  .rail h2 { width:100%; }
  .stage { width:min(100%,355px); margin:auto; }
  .board { grid-template-columns:1fr; }
  .board figure { width:min(100%,355px); margin:auto; }
  .phone { height:590px; }
}
</style>
</head>
<body>
<main class="deck" id="deck" data-theme="day" data-platform="ios">
  <header class="mast">
    <div><small>The Proper Volume · Mobile mockups</small><h1>Launch &amp; onboarding</h1></div>
    <div class="toggles">
      <button type="button" data-theme-choice="day" aria-pressed="true">Day</button>
      <button type="button" data-theme-choice="night" aria-pressed="false">Night</button>
      <button type="button" data-platform-choice="ios" aria-pressed="true">iPhone</button>
      <button type="button" data-platform-choice="android" aria-pressed="false">Android</button>
      <button type="button" id="toggle-board" aria-pressed="false">Overview</button>
    </div>
  </header>
  <section class="prototype" id="prototype" aria-label="Interactive preview">
    <nav class="rail" aria-label="Preview screens">
      <h2>Preview screens</h2>
      <button type="button" class="jump" data-preview="launch">Launch screen</button>
      <button type="button" class="jump" data-preview="welcome">Welcome</button>
      <button type="button" class="jump" data-preview="signin">Sign In</button>
      <button type="button" class="jump" data-preview="signup">Create Account</button>
      <button type="button" class="jump" data-preview="guest">Guest Library</button>
      <button type="button" class="jump" data-preview="kiosk">Kiosk Welcome</button>
      <button type="button" class="preview-toggle" id="replay">Play launch preview</button>
    </nav>
    <div class="stage" id="stage"></div>
    <aside class="notes"><h2 id="note-title"></h2><p id="note-body"></p><p><strong>Demo only.</strong> No messages, accounts, or real requests. Use code <strong>123456</strong> to try email verification.</p></aside>
  </section>
  <section class="board" id="board" aria-label="Onboarding overview" hidden></section>
</main>
<script>
'use strict';
const deck = document.querySelector('#deck');
const mark = '@@LAUNCH_MARK@@';
const library = [
  ['Amateur','Nada Surf','Karaoke Nerds'],
  ['A Praise Chorus','Jimmy Eat World','Karaoke Nerds'],
  ['Everybody’s Changing','Keane','Karaoke Nerds'],
  ['The Middle','Jimmy Eat World','Host Library']
];
const screens = {
  launch: ['System launch', 'The operating system shows the TPV mark during a cold launch. Booth opens Welcome when the app is ready.'],
  welcome: ['Welcome', 'Guests can browse and join a room. An account is optional.'],
  signin: ['Sign in', 'Enter the email address tied to an existing account.'],
  signup: ['Create account', 'A display name is used for room requests. Email is used for verification and sign-in.'],
  verify: ['Email verification', 'Both account paths verify email with a short code.'],
  guest: ['Guest Library', 'Browse songs immediately. Join a room to request the host’s available versions.'],
  room: ['Join a Room', 'Use a nearby or recent room, or paste the host’s room code or invite.'],
  joined: ['Room Library', 'Search the host’s enabled sources and request a recording.'],
  playlists: ['Playlists', 'Guest lists stay on this device. Account sync is proposed for personal devices.'],
  profile: ['Profile', 'Guests can keep browsing or sign in later to use their account.'],
  kiosk: ['Kiosk welcome', 'The host has already chosen the room. The only entry is Continue as Guest.'],
  kioskName: ['Kiosk singer', 'A display name is enough to join this shared device’s room.'],
  kioskLibrary: ['Kiosk Library', 'Queue songs for the configured room. Done returns the kiosk to its welcome screen.']
};
let active = 'welcome', email = '', displayName = '', roomName = 'Friday Night Karaoke', account = false, roomJoined = false, accountForm = 'signin', launchTimer;
const appMark = '<img class="mark" alt="" src="' + mark + '">';
const button = (text, to, style = '') => '<button type="button" class="action ' + style + '" data-go="' + to + '">' + text + '</button>';
const back = to => '<button class="back" type="button" data-go="' + to + '">‹ Back</button>';
const dock = tab => '<nav class="dock" aria-label="Mobile workspace">' +
  [['guest','⌕','Library'],['room','◉','Room'],['playlists','≡','Playlists'],['profile','○','Profile']].map(([to,icon,label]) =>
    '<button type="button" data-go="' + to + '"' + (tab === to ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + icon + '</span>' + label + '</button>').join('') + '</nav>';
const actions = {
  launch: () => '<div class="launch" aria-label="Booth launching">' + appMark + '</div>',
  welcome: () => '<div class="welcome"><div class="welcome-brand">' + appMark + '<h2>Karaoke Booth</h2><p>Find songs and join your host’s room.</p></div><div class="stack">' +
    button('Continue as Guest','guest') + button('Sign In / Create Account','signin','secondary') + '</div></div>',
  signin: () => '<div class="auth">' + back('welcome') + '<h2>Sign In</h2><p>We’ll send a code to your email address.</p><form class="form" data-form="account">' +
    '<label>Email address<input name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required></label>' +
    '<button class="action">Send Sign-In Code</button></form><div class="account-foot">' + button('Create Account','signup','secondary') +
    button('Continue as Guest','guest','link') + '</div></div>',
  signup: () => '<div class="auth">' + back('signin') + '<h2>Create Account</h2><p>Keep your playlists and starred songs with you.</p><form class="form" data-form="account">' +
    '<label>Display name<input name="name" maxlength="60" autocomplete="nickname" placeholder="e.g. Alex R." required></label>' +
    '<label>Email address<input name="email" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required></label>' +
    '<button class="action">Send Verification Code</button></form><div class="account-foot">' + button('Already have an account? Sign In','signin','link') + '</div></div>',
  verify: () => '<div class="auth">' + back(accountForm) + '<h2>Check Your Email</h2><p>Enter the code for <strong data-email></strong>.</p>' +
    '<form class="form" data-form="verify"><label>Verification code<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" placeholder="6 digits" required></label>' +
    '<button class="action">Verify &amp; Continue</button><button type="button" class="action link" data-resend>Resend code</button><div class="feedback" role="status"></div></form></div>',
  guest: () => searchContent('guest'),
  joined: () => searchContent('joined'),
  kioskLibrary: () => searchContent('kioskLibrary'),
  room: () => roomJoined ? '<h2>Room</h2><div class="room-card"><strong data-room></strong><small>Connected</small></div>' + button('Leave Room','leave','secondary') :
    '<h2>Room</h2><p>Join when you’re ready to request a song.</p><div class="room-card"><strong>Friday Night Karaoke</strong><small>Nearby · TPV Booth</small>' +
    '</div><form class="form" data-form="room"><label>Room code or invite<input name="room" placeholder="friday-night" autocapitalize="none" autocorrect="off" required></label>' +
    '<label>Display name<input name="name" maxlength="60" autocomplete="nickname" placeholder="e.g. Alex R." required></label><button class="action">Join Room</button></form>',
  playlists: () => '<h2>Playlists</h2><p>Your saved lists are available on this device.</p><div class="room-card"><strong>Starred Songs</strong><small>2 songs</small></div>' +
    button('Search Library','guest','secondary'),
  profile: () => '<h2>Profile</h2><div class="room-card"><strong data-name></strong><small>' + (account ? 'Signed in' : 'Guest') + '</small></div>' +
    (account ? button('Back to Library','guest','secondary') : button('Sign In / Create Account','signin')),
  kiosk: () => '<div class="welcome"><div class="welcome-brand">' + appMark + '<h2>Request a Song</h2><p><strong>Friday Night Karaoke</strong></p></div>' +
    '<div class="stack">' + button('Continue as Guest','kioskName') + '</div></div>',
  kioskName: () => '<div class="auth">' + back('kiosk') + '<h2>Your Singer Name</h2><p>Pick the name the host should call.</p>' +
    '<form class="form" data-form="kiosk"><label>Display name<input name="name" maxlength="60" autocomplete="off" placeholder="e.g. Alex R." required></label>' +
    '<button class="action">Find a Song</button></form></div>'
};
function searchContent(kind) {
  const kiosk = kind === 'kioskLibrary', connected = kind !== 'guest';
  return '<div class="context"><span><span class="pulse"></span><b>' + (connected ? '<span data-room></span>' : 'Browsing as ' + (account ? 'account holder' : 'guest')) + '</b></span>' +
    (kiosk ? button('Done','kiosk','secondary') : connected ? '<span>In room</span>' : '<button type="button" class="back" data-go="room">Join a Room</button>') + '</div>' +
    '<h2>' + (kiosk ? 'Find a Song' : 'Song Library') + '</h2><label class="search"><span aria-hidden="true">⌕</span><input aria-label="Search songs" type="search" placeholder="Artist or song title"></label>' +
    '<div class="sub-label">' + (connected ? 'Host sources' : 'Karaoke Nerds') + '</div><div class="feedback" role="status"></div>' + library.map(([title,artist,service]) =>
    '<div class="item"><div><strong>' + title + '</strong><small>' + artist + ' · ' + service + '</small></div>' +
    (connected ? '<button type="button" class="action secondary" data-queue="' + title + '">Queue</button>' : '') + '</div>').join('');
}
function phone(screen, preview = false) {
  const libraryTab = screen === 'joined' ? 'guest' : screen;
  const hasDock = ['guest','joined','room','playlists','profile'].includes(screen);
  return '<div class="phone"' + (preview ? ' inert' : '') + '><div class="status" aria-hidden="true"><span>9:41</span>' +
    '<span class="status-icons"><span>▴▴</span><span class="battery"></span></span></div><div class="content">' +
    actions[screen]() + '</div>' + (hasDock ? dock(libraryTab) : '') + '<div class="home" aria-hidden="true"></div></div>';
}
function show(screen, focus = false) {
  clearTimeout(launchTimer);
  if (!screens[screen]) return;
  if (screen === 'kiosk') { account = false; email = ''; displayName = ''; roomJoined = false; roomName = 'Friday Night Karaoke'; }
  active = screen;
  const stage = document.querySelector('#stage');
  stage.innerHTML = phone(screen);
  stage.querySelectorAll('[data-email]').forEach(node => { node.textContent = email || 'you@example.com'; });
  stage.querySelectorAll('[data-name]').forEach(node => { node.textContent = displayName || 'Your singer profile'; });
  stage.querySelectorAll('[data-room]').forEach(node => { node.textContent = roomName; });
  document.querySelector('#note-title').textContent = screens[screen][0];
  document.querySelector('#note-body').textContent = screens[screen][1];
  document.querySelectorAll('[data-preview]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.preview === active)));
  const heading = stage.querySelector('h2');
  if (heading && focus) { heading.tabIndex = -1; heading.focus(); }
}
const boardScreens = ['launch','welcome','signin','signup','guest','kiosk'];
document.querySelector('#board').innerHTML = boardScreens.map(screen =>
  '<figure><figcaption>' + screens[screen][0] + '</figcaption>' + phone(screen, true) + '</figure>').join('');
deck.addEventListener('click', event => {
  const control = event.target.closest('button');
  if (!control) return;
  if (control.dataset.go === 'leave') { roomJoined = false; show('room', true); }
  else if (control.dataset.go) show(control.dataset.go === 'guest' && roomJoined ? 'joined' : control.dataset.go, true);
  if (control.dataset.preview) show(control.dataset.preview);
  for (const property of ['theme','platform']) {
    const value = control.dataset[property + 'Choice'];
    if (!value) continue;
    deck.dataset[property] = value;
    document.querySelectorAll('[data-' + property + '-choice]').forEach(button =>
      button.setAttribute('aria-pressed', String(button === control)));
  }
  if (control.id === 'toggle-board') {
    const overview = document.querySelector('#board').hidden;
    document.querySelector('#board').hidden = !overview;
    document.querySelector('#prototype').hidden = overview;
    control.setAttribute('aria-pressed', String(overview));
  }
  if (control.id === 'replay') {
    show('launch');
    launchTimer = setTimeout(() => show('welcome'), 850);
  }
  if ('resend' in control.dataset) control.form.querySelector('[role=status]').textContent = 'Demo code: 123456.';
  if (control.dataset.queue) {
    control.closest('.content').querySelector('[role=status]').textContent = 'Requested “' + control.dataset.queue + '” for ' + (displayName || 'the guest') + '.';
    control.disabled = true;
    control.textContent = 'Queued';
  }
});
deck.addEventListener('input', event => {
  if (event.target.type !== 'search') return;
  const query = event.target.value.trim().toLowerCase();
  event.target.closest('.content').querySelectorAll('.item').forEach(row => { row.hidden = !row.textContent.toLowerCase().includes(query); });
});
deck.addEventListener('submit', event => {
  const form = event.target;
  event.preventDefault();
  const data = new FormData(form);
  if (form.dataset.form === 'account') { accountForm = active; email = data.get('email'); displayName = data.get('name') || displayName; show('verify', true); }
  if (form.dataset.form === 'verify') {
    if (data.get('code') !== '123456') { form.querySelector('[role=status]').textContent = 'Try the demo code 123456.'; return; }
    account = true; show(roomJoined ? 'joined' : 'guest', true);
  }
  if (form.dataset.form === 'room' || form.dataset.form === 'kiosk') {
    displayName = data.get('name').trim();
    if (!displayName) { form.elements.name.setCustomValidity('Enter a display name.'); form.reportValidity(); form.elements.name.setCustomValidity(''); return; }
    roomName = 'Friday Night Karaoke';
    roomJoined = form.dataset.form === 'room';
    show(form.dataset.form === 'kiosk' ? 'kioskLibrary' : 'joined', true);
  }
});
show('welcome');
</script>
</body>
</html>
```
