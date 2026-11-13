"""Render the approved Microphone Play vectors without fonts or source changes.

Requires CairoSVG and Pillow. The committed exports are sufficient to build the app.
Use --output-root <directory> for an isolated render/verification outside the checkout.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import struct
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image

REPO = Path(__file__).resolve().parents[1]
SOURCE = REPO / "assets" / "branding" / "source"
PALETTE = {"orange": "#F68713", "pink": "#ED0D63", "navy": "#131457",
           "silver": "#E9E9E9", "shade": "#969696", "paper": "#FFFFFF"}
DEFAULT_THEME = "light"
SIZES = (16, 20, 24, 32, 40, 48, 64, 96, 128, 192, 256, 512, 1024)
ICO_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
SVG_NS = "http://www.w3.org/2000/svg"


def view_box(svg: bytes) -> tuple[float, float, float, float]:
    """Keep rendered aspect ratios tied to the outlined SVG masters."""
    values = tuple(float(value) for value in ET.fromstring(svg).attrib["viewBox"].replace(",", " ").split())
    if len(values) != 4 or not all(math.isfinite(value) for value in values) or values[2] <= 0 or values[3] <= 0:
        raise ValueError("Brand SVG must have a finite, positive viewBox")
    return values


def generate(output_root: Path) -> dict:
    brand = output_root / "assets" / "branding"
    written: set[Path] = set()

    def write(path: Path, data: bytes) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        written.add(path)

    def render(path: Path, svg: bytes, width: int, height: int | None = None) -> None:
        if height is None:
            _, _, source_width, source_height = view_box(svg)
            height = max(1, round(width * source_height / source_width))
        write(path, cairosvg.svg2png(bytestring=svg, output_width=width, output_height=height))

    def installer_bitmap(path: Path, svg: bytes, width: int, height: int, padding: int) -> None:
        _, _, source_width, source_height = view_box(svg)
        scale = min((width - 2 * padding) / source_width, (height - 2 * padding) / source_height)
        fitted_width = max(1, min(width - 2 * padding, round(source_width * scale)))
        fitted_height = max(1, min(height - 2 * padding, round(source_height * scale)))
        image = Image.open(io.BytesIO(cairosvg.svg2png(
            bytestring=svg, output_width=fitted_width, output_height=fitted_height))).convert("RGBA")
        background = Image.new("RGBA", (width, height), PALETTE["paper"])
        background.alpha_composite(image, ((width - fitted_width) // 2, (height - fitted_height) // 2))
        stream = io.BytesIO()
        background.convert("RGB").save(stream, format="BMP")
        write(path, stream.getvalue())

    for theme in ("dark", "light"):
        icon = (SOURCE / f"icon-{theme}.svg").read_bytes()
        if view_box(icon) != (0, 0, 256, 256):
            raise ValueError("Brand icon master must use viewBox 0 0 256 256")
        write(brand / f"icon-{theme}.svg", icon)
        for size in SIZES:
            render(brand / "png" / theme / f"icon-{size}.png", icon, size)
        for stem in ("logo", "wordmark"):
            source = (SOURCE / f"{stem}-{theme}.svg").read_bytes()
            write(brand / f"{stem}-{theme}.svg", source)
            render(brand / f"{stem}-{theme}.png", source, 1600)

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
        opaque = Image.new("RGBA", (1024, 1024), PALETTE["navy" if theme == "dark" else "paper"])
        opaque.alpha_composite(image)
        stream = io.BytesIO()
        opaque.convert("RGB").save(stream, format="PNG")
        write(brand / "mobile" / f"icon-{theme}.png", stream.getvalue())

    write(brand / "app.ico", (brand / f"app-{DEFAULT_THEME}.ico").read_bytes())
    write(brand / "app.icns", (brand / f"app-{DEFAULT_THEME}.icns").read_bytes())
    write(brand / "app.png", (brand / "png" / DEFAULT_THEME / "icon-1024.png").read_bytes())
    for size in (16, 24, 32, 48, 64, 96, 128, 256, 512, 1024):
        write(brand / "linux" / f"{size}x{size}.png", (brand / "png" / DEFAULT_THEME / f"icon-{size}.png").read_bytes())

    icon = (SOURCE / f"icon-{DEFAULT_THEME}.svg").read_bytes()
    write(brand / "web" / "favicon.svg", icon)
    write(brand / "web" / "favicon.ico", (brand / "app.ico").read_bytes())
    for size in (32, 180, 192, 512):
        render(brand / "web" / f"icon-{size}.png", icon, size)

    # Android's adaptive foreground keeps the complete mark inside the central
    # 66% safe zone; the launcher independently supplies the paper background.
    tree = ET.fromstring(icon)
    ET.register_namespace("", SVG_NS)
    children = list(tree)
    tiles = [element for element in children if element.tag == f"{{{SVG_NS}}}rect"]
    if len(tiles) != 1:
        raise ValueError("Brand icon must have exactly one top-level tile rectangle")
    tile = tiles[0]
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
    for name, data in (("icon.png", (brand / "mobile" / f"icon-{DEFAULT_THEME}.png").read_bytes()),
                       ("adaptive-icon.png", (brand / "mobile" / "adaptive-foreground.png").read_bytes()),
                       ("favicon.png", (brand / "web" / "icon-32.png").read_bytes())):
        write(mobile / name, data)

    installer_bitmap(brand / "installer-header.bmp", (SOURCE / "logo-light.svg").read_bytes(), 150, 57, 6)
    installer_bitmap(brand / "installer-sidebar.bmp", (SOURCE / "wordmark-light.svg").read_bytes(), 164, 314, 10)
    write(brand / "installer.nsh", b"!macro customWelcomePage\n  !insertmacro MUI_PAGE_WELCOME\n!macroend\n")

    # Source-of-truth records are deliberately separate from app versioning: one
    # approved identity is shared by the booth, singer client and later releases.
    manifest = {"id": "mic-play", "name": "Microphone Play", "approvedOn": "2026-11-13",
                "defaultTheme": DEFAULT_THEME, "palette": PALETTE,
                "files": {str(path.relative_to(output_root)).replace("\\", "/"): hashlib.sha256(path.read_bytes()).hexdigest()
                          for path in sorted(written)}}
    write(brand / "manifest.json", (json.dumps(manifest, indent=2) + "\n").encode())
    return {"output": str(brand), "files": len(written), "identity": manifest["id"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-root", type=Path, default=REPO)
    args = parser.parse_args()
    print(json.dumps(generate(args.output_root.resolve()), indent=2))
