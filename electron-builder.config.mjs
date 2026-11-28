import desktopIdentity from './assets/branding/desktop-identity.json' with { type: 'json' };

/** Development packages have no publisher certificate. macOS uses ad-hoc integrity signing. */
export default {
  appId: desktopIdentity.appId,
  productName: 'The Proper Volume Karaoke Booth',
  executableName: 'proper-karaoke-booth',
  artifactName: 'Proper-Karaoke-Booth-${version}-${os}-${arch}.${ext}',
  asar: true,
  npmRebuild: false,
  nodeGypRebuild: false,
  files: ['dist/**/*', 'package.json', 'LICENSE', 'LICENSING.md', 'TRADEMARKS.md', 'THIRD-PARTY-LICENSES.txt', '!node_modules/**/*', '!**/*.map'],
  extraResources: [
    { from: 'dist/control/cli.cjs', to: 'control/cli.cjs' },
    { from: 'assets/backdrops', to: 'backdrops', filter: ['tpv-karaoke-v3.mp4', 'README.md'] },
    { from: 'assets/audio/bumpers', to: 'bumpers', filter: ['Zen.ogg', 'README.md'] },
    { from: 'assets/branding', to: 'branding', filter: ['app.ico', 'app.png', 'icon-dark.svg', 'icon-light.svg', 'logo-dark.svg', 'logo-light.svg', 'wordmark-dark.svg', 'wordmark-light.svg', 'logo-dark.png', 'logo-light.png', 'wordmark-dark.png', 'wordmark-light.png', 'LICENSE-Lobster.txt', 'README.md'] },
  ],
  extraFiles: [
    { from: 'assets/cli/tpv-karaoke.cmd', to: 'tpv-karaoke.cmd' },
    { from: 'assets/cli/tpv-karaoke', to: 'tpv-karaoke' },
  ],
  directories: { output: 'release' },
  publish: null,
  win: { target: ['nsis', 'zip'], icon: 'assets/branding/app.ico', signExecutable: false },
  nsis: {
    oneClick: false,
    perMachine: false,
    selectPerMachineByDefault: true,
    allowElevation: true,
    allowToChangeInstallationDirectory: true,
    runAfterFinish: true,
    shortcutName: 'The Proper Volume Karaoke Booth',
    uninstallDisplayName: 'The Proper Volume Karaoke Booth',
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    installerIcon: 'assets/branding/app.ico',
    uninstallerIcon: 'assets/branding/app.ico',
    installerHeader: 'assets/branding/installer-header.bmp',
    installerSidebar: 'assets/branding/installer-sidebar.bmp',
    uninstallerSidebar: 'assets/branding/installer-sidebar.bmp',
    include: 'assets/branding/installer.nsh',
    deleteAppDataOnUninstall: false,
    artifactName: 'Proper-Karaoke-Booth-${version}-windows-${arch}-setup.${ext}',
  },
  linux: {
    target: ['AppImage', 'deb'], icon: 'assets/branding/linux', category: 'AudioVideo', maintainer: 'The Proper Volume',
    desktop: { entry: { Keywords: 'KaraBooth;TPV;Proper;Proper Volume;The Proper Volume;Karaoke;Karaoke App;Host;Booth;Karaoke Booth;Karaoke Host;Karaoke Player;CDG;LRC;Karaoke Nerds;YouTube;' } },
  },
  // Require genuine ALSA on both t64 and older distributions. Ubuntu can satisfy
  // an unversioned libasound2 with an OSS compatibility library missing Electron symbols.
  deb: { depends: ['libgtk-3-0 | libgtk-3-0t64', 'libnotify4', 'libnss3', 'libxss1', 'libxtst6', 'xdg-utils',
    'libatspi2.0-0 | libatspi2.0-0t64', 'libuuid1', 'libsecret-1-0', 'libgbm1', 'libasound2t64 | libasound2 (>= 1.0.16)', 'libdrm2', 'libx11-xcb1', 'ffmpeg'] },
  mac: { target: ['dmg', 'zip'], icon: 'assets/branding/app.icns', category: 'public.app-category.music',
    minimumSystemVersion: '13.0.0', hardenedRuntime: true, identity: '-', notarize: false,
    extendInfo: {
      MDItemKeywords: 'KaraBooth, TPV, Proper, Proper Volume, The Proper Volume, Karaoke, Karaoke App, Host, Booth, Karaoke Booth, Karaoke Host, Karaoke Player, CDG, LRC, Karaoke Nerds, YouTube',
    } },
};
