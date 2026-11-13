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
