# Approved Application Identity — Velvet Script

The owner selected **option 1, Velvet Script**, on 12 November 2026. This refers to
the later vintage/cursive exploration, not option 1 in the older TPV block-letter
review. The design combines an angled vintage capsule microphone, cyan sound arcs,
and Lobster script lettering. Use the dark edition for the installed app identity;
matching light editions are included for appropriate surfaces.

Palette: purple `#601CE9`, cyan `#0EB7FF`, ink `#19102D`, cream `#FFFFF3`.

## Source And Exports

`source/` contains the six approved self-contained SVGs: dark/light square icons,
TPV horizontal logos, and full-name wordmarks. All lettering is outlined. SVGs have
accessible titles and do not fetch fonts, images, or scripts. The icon artwork and
wordmark are original drawings; Lobster lettering is by Pablo Impallari and is
used under the SIL Open Font License, included in `LICENSE-Lobster.txt`. Small
supporting lettering uses outlined Lato by Łukasz Dziedzic; font binaries are not
required to use the exported artwork.

`scripts/generate-brand-assets.py` creates the committed exports from those masters
using CairoSVG and Pillow. Run it from any working directory:

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
- `wordmark-*`: full-name logo SVGs and transparent 1600 px PNGs.
- `web/`: SVG/ICO favicons and 32, 180, 192, 512 px PNGs.
- `mobile/`: opaque square dark/light icons and a transparent adaptive foreground
  contained within Android's central 66% safe zone. The generated `mobile/assets/`
  copies are used by the singer preview's Expo configuration.
- `manifest.json`: approved identity, palette and SHA-256 hashes for generated files.

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
Previously built installers are unchanged. Verify the next actual package's icons,
Start menu/taskbar, Linux launcher, and macOS Dock on their respective systems.

## Verification

```sh
node scripts/verify-brand-assets.mjs
node scripts/verify-brand-assets.mjs --windows-resource-check
```

The first command checks generated hashes, PNG dimensions, ICO/ICNS frames and
package/mobile references. The optional Windows check uses the packager's actual
resource editor on a temporary Electron executable copy and reads back all nine
embedded images. It never launches the app or writes its show profile. Both
checks passed on 12 November 2026, along with independent Pillow decoding of every
PNG and both platform containers, mobile opacity and adaptive safe-zone checks.
An isolated Vite build emitted the exact approved host favicon and preserved the
singer static-handler allowlist. These checks do not establish a finished installer
or native Mac/Linux appearance. An additional NSIS compile-only icon check was
blocked by automatic approval review with the generic reason “blocked by policy”.
