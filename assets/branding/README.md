# Selected Application Identity — Microphone Play

On 13 November 2026 the owner selected the supplied **Microphone Play** reference
(`mic-play`) as the provisional application identity. Its vintage microphone and
play outline supersede the earlier Velvet Script selection. The application icon
must contain **no visible text**. The full logo uses **TPV** and **KARAOKE BOOTH**;
the extra E in the reference's karaoke lettering has been corrected.

Reference palette: orange `#F68713`, pink `#ED0D63`, navy `#131457`, and gray
`#E9E9E9`. Keep matching dark and light editions. This identity is separate from
the host's configurable interface accent.

## Source And Exports

`source/` is the maintained location for self-contained SVG masters: dark/light
square icons, horizontal logos, and wordmarks. The clean masters reproduce the supplied reference as vector paths, with a contrast keyline on the dark mark. The default installed edition is the original navy mark on a white rounded tile. All visible
lettering belongs in the logo/wordmark, not the app icon. Outline lettering in the
masters, include accessible SVG titles, and avoid external fonts, images or scripts.

Earlier explorations remain design history. Preserve the included font licenses:
Velvet Script used Lobster by Pablo Impallari under the SIL Open Font License
(`LICENSE-Lobster.txt`) and outlined Lato by Łukasz Dziedzic for supporting text.
The new lettering is vector geometry reproduced from the owner's supplied image, not an embedded font. Reference/hash provenance is under `design/branding/2026-11-13-microphone-play`; the previous masters, README, manifest and license are archived under `design/branding-history/2026-11-12-velvet-script`.

`scripts/generate-brand-assets.py` reproduces the exports from those masters using
CairoSVG and Pillow. Install those dependencies in an isolated Python environment,
then run the generator with that environment's Python:

```sh
python scripts/generate-brand-assets.py
```

Use `--output-root /separate/path` to verify exports without touching the checkout.
No design-service account or installed font is required to regenerate the assets.

- `app.ico`: Windows executable, installer/uninstaller and window icon, with nine
  explicit 16–256 px PNG entries. `app-dark.ico` and `app-light.ico` retain both editions.
- `app.icns`: macOS icon container with 16–1024 px representations; both theme
  containers are also included. Creating this file does not constitute a Mac build.
- `app.png`: default 1024 px icon for desktop window managers.
- `linux/`: standard raster sizes for AppImage/Debian desktop integration.
- `png/dark/`, `png/light/`: thirteen sizes per theme, 16–1024 px.
- `logo-*`: horizontal TPV logo SVGs and transparent 1600 px PNGs.
- `wordmark-*`: stacked TPV / KARAOKE BOOTH lockups and transparent 1600 px PNGs.
- `installer-header.bmp`, `installer-sidebar.bmp`: proportional 24-bit RGB NSIS artwork; `installer.nsh` adds the welcome page.
- `web/`: SVG/ICO favicons and 32, 180, 192, 512 px PNGs.
- `mobile/`: opaque square dark/light icons and a transparent adaptive foreground
  contained within Android's central 66% safe zone. The generated `mobile/assets/`
  copies are used by the singer preview's Expo configuration.
- `manifest.json`: selected identity, palette and SHA-256 hashes for generated files.

## Packaging And Scope

`electron-builder.config.mjs` uses this identity for Windows, NSIS, Linux and macOS
targets. Packaging snapshots the assets into its isolated staging directory before
using them. The runtime reads the matching resources under `resources/branding`;
both Host and Singer Display windows use the application icon. The host HTML also
references the SVG favicon. Platform-specific files remain available in the source
tree for future distributions; the desktop package includes only its runtime
branding allowlist, not the complete design archive.

Application identity does not replace a host-selected singer-display logo or the
TPV lyric-backdrop video. Changing the UI accent does not change the installed icon.
Older installers are unchanged. Windows 0.4.1 app/setup/uninstaller resources
contain all nine approved icon images. The actual upgrade on this PC, Start menu
and uninstall icon references, and private-profile Day/Night host logos passed
verification. Linux 0.4.1 AppImage/Debian payloads, all ten default light PNGs,
packaged Day/Night logos and favicon also passed; the actual extracted AppRun
passed isolated launch/restart checks. Check remaining native taskbar/launcher/Dock
surfaces on their respective systems. A configured
target or an exported ICNS is not a native Mac build or a verified Dock result.

## Verification

```sh
node scripts/verify-brand-assets.mjs
node scripts/verify-brand-assets.mjs --windows-resource-check
node scripts/verify-brand-assets.mjs --executable /path/to/windows/executable.exe
node scripts/packaged-branding-smoke.mjs /path/to/packaged/executable
```

The first command checks generated hashes, PNG dimensions, ICO/ICNS frames and
package/mobile references. The optional Windows check uses the packager's actual
resource editor on a temporary Electron executable copy and reads back all nine
embedded images. It never launches the app or writes its show profile. Both
checks passed on 13 November for Microphone Play: 69 generated hashes, both ICO/ICNS sets, text-free vector icon masters, 150×57/164×314 24-bit BMP dimensions and all nine icon sizes after Windows resource editing. The executable check also read all nine exact images from the packaged and installed app, setup and uninstaller. The private-profile branding smoke verifies loaded Day/Night logos, accessible names, minimum-width header fit and no autoplay. Actual package/installation results and the protected pre-upgrade backup are recorded in the installation guide. Mobile opacity and adaptive safe-zone checks pass; native mobile appearance remains unverified.

Historical verification on 12 November 2026 covered Velvet Script: generated
hashes, independent Pillow decoding, platform containers, mobile opacity and
adaptive safe-zone checks, the Windows executable resource editor and an isolated
Vite favicon build. It does not verify Microphone Play or any newly built package.
The earlier NSIS compile-only check was blocked by automatic approval review with
the generic reason “blocked by policy”. No native macOS build is claimed.
