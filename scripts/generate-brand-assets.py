"""Render the approved Velvet Script vectors; never install fonts or alter originals.

Requires CairoSVG and Pillow. The committed exports are sufficient to build the app.
Use --output-root <directory> for an isolated render/verification outside the checkout.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "assets" / "branding" / "source"
PALETTE = {"purple": "#601CE9", "cyan": "#0EB7FF", "ink": "#19102D", "cream": "#FFFFF3"}
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256, 512, 1024)
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
SVG_NS = "http://www.w3.org/2000/svg"


def generate(output_root: Path) -> dict:
    brand = output_root / "assets" / "branding"
    written: set[Path] = set()

    def write(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        written.add(path)

    def render(path: Path, svg: bytes, width: int, height: int | None = None) -> None:
        write(path, cairosvg.svg2png(bytestring=svg, output_width=width, output_height=height or width))

    for theme in ("dark", "light"):
        icon = (SOURCE / f"icon-{theme}.svg").read_bytes()
        write(brand / f"icon-{theme}.svg", icon)
        for size in SIZES:
            render(brand / "png" / theme / f"icon-{size}.png", icon, size)
        for stem, height in (("logo", 588), ("wordmark", 410)):
            source = (SOURCE / f"{stem}-{theme}.svg").read_bytes()
            write(brand / f"{stem}-{theme}.svg", source)
            render(brand / f"{stem}-{theme}.png", source, 1600, height)

        # Explicit ICO entries retain the exact renders at small sizes; no runtime
        # resize or embedded font is needed by Windows or the NSIS installer.
        entries = [(size, (brand / "png" / theme / f"icon-{size}.png").read_bytes()) for size in ICO_SIZES]
        offset = 6 + 16 * len(entries)
        header = struct.pack("<HHH", 0, 1, len(entries))
        directory = b""
        payload = b""
        for size, data in entries:
            directory += struct.pack("<BBBBHHII", 0 if size == 256 else size, 0 if size == 256 else size,
                                     0, 0, 1, 32, len(data), offset)
            payload += data
            offset += len(data)
        write(brand / f"app-{theme}.ico", header + directory + payload)

        # Modern ICNS PNG chunks: 16/32/64/128/256/512/1024 physical pixels.
        chunks = []
        for code, size in ((b"icp4", 16), (b"icp5", 32), (b"icp6", 64), (b"ic07", 128),
                           (b"ic08", 256), (b"ic09", 512), (b"ic10", 1024)):
            data = (brand / "png" / theme / f"icon-{size}.png").read_bytes()
            chunks.append(code + struct.pack(">I", len(data) + 8) + data)
        body = b"".join(chunks)
        write(brand / f"app-{theme}.icns", b"icns" + struct.pack(">I", len(body) + 8) + body)

        # Apple/mobile stores require a full opaque square and apply their own
        # corner mask. Do not ship the desktop tile's transparent outer corners.
        image = Image.open(io.BytesIO((brand / "png" / theme / "icon-1024.png").read_bytes())).convert("RGBA")
        opaque = Image.new("RGBA", (1024, 1024), PALETTE["ink" if theme == "dark" else "cream"])
        opaque.alpha_composite(image)
        stream = io.BytesIO()
        opaque.convert("RGB").save(stream, format="PNG")
        write(brand / "mobile" / f"icon-{theme}.png", stream.getvalue())

    write(brand / "app.ico", (brand / "app-dark.ico").read_bytes())
    write(brand / "app.icns", (brand / "app-dark.icns").read_bytes())
    write(brand / "app.png", (brand / "png" / "dark" / "icon-1024.png").read_bytes())
    for size in (16, 24, 32, 48, 64, 96, 128, 256, 512, 1024):
        write(brand / "linux" / f"{size}x{size}.png", (brand / "png" / "dark" / f"icon-{size}.png").read_bytes())

    icon = (SOURCE / "icon-dark.svg").read_bytes()
    write(brand / "web" / "favicon.svg", icon)
    write(brand / "web" / "favicon.ico", (brand / "app.ico").read_bytes())
    for size in (32, 180, 192, 512):
        render(brand / "web" / f"icon-{size}.png", icon, size)

    # Android's adaptive foreground keeps the complete mark inside the central
    # 66% safe zone; the launcher independently supplies the ink background.
    tree = ET.fromstring(icon)
    ET.register_namespace("", SVG_NS)
    children = list(tree)
    tile = next(element for element in children if element.tag == f"{{{SVG_NS}}}rect")
    tree.remove(tile)
    group = ET.Element(f"{{{SVG_NS}}}g", {"transform": "translate(43.52 43.52) scale(.66)"})
    for child in list(tree):
        if child.tag != f"{{{SVG_NS}}}title":
            tree.remove(child)
            group.append(child)
    tree.append(group)
    adaptive = ET.tostring(tree, encoding="utf-8")
    write(brand / "mobile" / "adaptive-foreground.svg", adaptive)
    render(brand / "mobile" / "adaptive-foreground.png", adaptive, 1024)

    mobile = output_root / "mobile" / "assets"
    for name, data in (("icon.png", (brand / "mobile" / "icon-dark.png").read_bytes()),
                       ("adaptive-icon.png", (brand / "mobile" / "adaptive-foreground.png").read_bytes()),
                       ("favicon.png", (brand / "web" / "icon-32.png").read_bytes())):
        write(mobile / name, data)

    # Source-of-truth records are deliberately separate from app versioning: one
    # approved identity is shared by the booth, singer client and later releases.
    manifest = {"id": "velvet-script", "name": "Velvet Script", "approvedOn": "2026-11-12",
                "defaultTheme": "dark", "palette": PALETTE,
                "files": {str(path.relative_to(output_root)).replace("\\", "/"): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in sorted(written)}}
    write(brand / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
    return {"output": str(brand), "files": len(written), "identity": manifest["id"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=REPO)
    args = parser.parse_args()
    print(json.dumps(generate(args.output_root.resolve()), indent=2))
