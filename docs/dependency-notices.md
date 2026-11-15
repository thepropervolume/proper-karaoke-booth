# Bundled Dependency Notices

The package builder collects every production dependency's license/copyright files into `THIRD-PARTY-LICENSES.txt`; Electron/Chromium notices remain with the runtime. Missing notices stop packaging.

The published `saxes` 6.0.0 npm archive omits its license file. `assets/licenses/saxes-6.0.0-LICENSE` retains the complete official [upstream license at the 6.0.0 source commit](https://github.com/lddubeau/saxes/blob/211fa0ebec9b628affc09219199639887174bfc3/LICENSE), including the inherited sax notice. Its LF-normalized SHA256 is `0fac2374380621b22e6b50451057721a9c52935b02d16d106a9f04897f061d0e`.

The notice collector accepts that fallback only for the exact lockfile and installed package name/version/license, verifies its full hash and includes its provenance. CRLF checkout conversion is normalized for hashing. A changed version, license, notice or unexpected path fails rather than silently omitting attribution. Other dependencies must carry their own notices. Fixture tests cover these cases and package collection is checked against the actual production lockfile before distribution.
