# Bundled Dependency Notices

The package builder writes production dependency notices to `THIRD-PARTY-LICENSES.txt`. Electron and Chromium carry their own runtime notices. Packaging fails when an installed production dependency has no notice. The collector skips an absent optional dependency only when its lockfile platform constraints exclude the build host.

Some npm archives omit their license files. The collector prefers a notice in the package and can use the following verified upstream copies from `assets/licenses/`.

- `saxes-6.0.0-LICENSE` includes the complete ISC license and the inherited sax notice. [saxes release source](https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE)
- `ionic-react-9.0.13-LICENSE` contains the Ionic Framework MIT license at the commit tagged `v9.0.13`. [Ionic Framework release source](https://github.com/ionic-team/ionic-framework/blob/8deb9240d48bc1206fa36f4682fcfcf4b4d5abc8/LICENSE)
- `react-property-2.0.2-LICENSE` contains the React MIT notice from the React submodule pinned by `react-property` 2.0.2. The package README points to that notice for its extracted React code. [react-property release source](https://github.com/remarkablemark/react-dom-core/tree/c4199877ca3b349fef669a7315ca4efcdab45a76/packages/react-property), [pinned React license](https://github.com/facebook/react/blob/1314299c7f70914d61d8e1cef56767f112110674/LICENSE)
- `rollup-4.44.0-LICENSE.md` contains the complete upstream notice for the `@rollup/rollup-*` native variants pulled in by Stencil. [Rollup release source](https://github.com/rollup/rollup/blob/fa4b2842c823f6a61f6b994a28b7fcb54419b6c6/LICENSE.md)

A fallback requires the reviewed name, version and license in the package metadata, with the same version and license in the lockfile. The collector checks the complete text against its SHA-256 hash in `scripts/production-notices.mjs` after normalizing CRLF line endings and includes the original source link in the output. When upgrading one of these dependencies, inspect the new archive and review any replacement notice before updating the matching entry and hash.
