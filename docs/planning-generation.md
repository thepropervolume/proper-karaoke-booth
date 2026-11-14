# Maintaining the product specification and mockups

`docs/product-specification.md` is the sole editable source for the product specification and the mockup book. The prose describes current and planned behavior. Its `mockup-theme` and `mockup` fenced JSON blocks specify the visual content and its implementation status. They are regular editable Markdown, not a separate data file. The PDF generator draws Night and Day views from the same blocks; the Word generator prints the specification prose and, in the complete workflow, includes figures generated from the PDF. Do not edit the generated Word or PDF files independently.

Update the relevant prose and mockup blocks together when behavior or designs change. Keep the implementation reference and status labels accurate: a drawing is a design, not proof that a feature is implemented or tested. Use fictional examples. Update the related host, singer, and developer help alongside behavior changes.

## Generate both deliverables

Use Python 3.10 or newer and Poppler's `pdftoppm` executable, then install the pinned Python dependencies in an environment of your choice:

```sh
python -m pip install -r scripts/planning-requirements.txt
python scripts/generate-planning.py --output-dir /path/to/planning
```

On Windows, pass a quoted Windows path for `--output-dir`. If `pdftoppm` is not on `PATH`, add `--pdftoppm /path/to/pdftoppm` (or the Windows `.exe` path). The output directory is explicit, so the process also works in other checkouts and on Linux or macOS. The commands write `TPV_Karaoke_Mockups_Dark_and_Light_Current.pdf` and `TPV_Karaoke_Product_Specification_Current.docx` there, replacing files with those names. Earlier versioned planning files remain untouched. Inspect the generated artifacts before sharing them.

The wrapper validates the mockup blocks, generates the PDF, rasterizes each Night screen for the Word figures, and creates the Word document from the same Markdown. The PDF is vector artwork and its cover records the SHA-256 of the complete source. The Word document includes the current design figures and descriptive labels. These are mockups, not screenshots.

To generate the mockup PDF alone without Poppler, run:

```sh
python scripts/generate-mockups.py --source docs/product-specification.md --output /path/to/mockups.pdf
```

For a text-only Word specification, omit the figures:

```sh
python scripts/generate-specification.py --source docs/product-specification.md --output /path/to/specification.docx
```

The scripts fail on invalid or missing required mockup information. Do not treat a successful command as visual approval: render the Word document and PDF to page images and inspect every page for readability, spacing and accurate statuses. Run the documentation generator tests with `python -m unittest discover -s tests/docs`.

The optional `brand_logos` entries in the Markdown theme bind the local Night/Day horizontal PNGs to exact SHA256 hashes. Update those hashes when the selected identity changes. The generator refuses an unexpected path, absent image or mismatched digest; all other screen text/palettes still come from the Markdown blocks.

## Windows Word Rendering

Generating OOXML is not visual verification. The current document renderer supports native Windows LibreOffice discovered on PATH, as well as the configured rendering runtime; LibreOffice does not have to be bundled inside the app installer. Use the document workflow's `render_docx.py` to obtain page images, inspect every page and fix pagination before publishing the generated Word edition. LibreOffice is a documentation-generation dependency, not a karaoke playback dependency.

## Verified 0.5.0 Planning Edition

On 14 November 2026 the initial 0.5.0 deliverables were generated from the frozen canonical Markdown at source `8d4c003` and published in the project's sibling `planning` folder. The **38-page Word specification** was rendered successfully using official native LibreOffice 26.8.3.1; all final page images were visually inspected at full resolution. The **45-page Night/Day mockup PDF**, covering 21 screen families, also passed full-page visual review. The current identity, status labels, captions, pagination and blacklist-dialog buttons were checked after corrections. Nine documentation-generator tests passed.

| File | SHA256 |
| --- | --- |
| `docs/product-specification.md` | `84028ec685c18c17965862bb6b1902387df14d214808693ecf51a00833908de6` |
| `TPV_Karaoke_Product_Specification_Current.docx` | `7191b9c456cac1645c5c47e10d6f4e033f588170a62fd0e825fece6aa10a646b` |
| `TPV_Karaoke_Mockups_Dark_and_Light_Current.pdf` | `c37cc9a7a00a1bdfb1c9f808d55b951f6555ae63d2a45c41d2781c3d4b04018c` |

The generated `release/Proper-Karaoke-Booth-0.5.0-planning-verification.json` retains the source/artifact hashes and review counts. Older versioned planning files are preserved as historical editions. This verification describes the generated documents; it does not establish that planned application features are implemented or physical show devices have passed testing.

### Native KaraFun Research Revision

The later 14 November revision at `d657c17` makes native KaraFun account/playback investigation the primary path and identifies the external KHost bridge as interim. The current Word and PDF were regenerated from that canonical Markdown; the application binaries remain 0.5.0 with no runtime change. Page counts remain 38 and 45. Word pages 15–17 and the PDF cover were reviewed at full resolution; all other final page images are byte-identical to the previously reviewed pages. The unchanged mockup screens do not claim that native KaraFun playback is implemented.

| Current file | SHA256 |
| --- | --- |
| `docs/product-specification.md` | `0b71cee7616ec3c8254c1dd68b79eb07bc75c7f78720802549cf3d71ab529220` |
| `TPV_Karaoke_Product_Specification_Current.docx` | `4f209b2bc1b6f264e4c91fe58e718722a9af61390409e8d477fd4d99b56e34cc` |
| `TPV_Karaoke_Mockups_Dark_and_Light_Current.pdf` | `64911ed2de3afcbda0b1fe1a9ea233ae2de8e8877f29acc57c84d2d16f095380` |

The separate `release/Proper-Karaoke-Booth-0.5.0-native-research-planning-verification.json` preserves this later source/artifact relationship. The initial delivery receipt remains historical evidence rather than being overwritten.
