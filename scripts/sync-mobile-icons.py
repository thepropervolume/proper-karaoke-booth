"""Export approved text-free branding to native density/store and PWA icon slots."""
from pathlib import Path
from PIL import Image
import hashlib
import json

REPO = Path(__file__).resolve().parents[1]
def sync(root=REPO):
    written = []
    def save(image, path):
        image.save(path)
        written.append(path)
    brand = root / "assets/branding/mobile"
    tile = Image.open(brand / "icon-dark.png").convert("RGB")
    foreground = Image.open(brand / "adaptive-foreground.png").convert("RGBA")
    for size in (192, 512):
        path = root / "mobile/web-public" / f"icon-{size}.png"
        path.parent.mkdir(parents=True, exist_ok=True)
        save(tile.resize((size, size), Image.Resampling.LANCZOS), path)
    ios = root / "mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"
    if ios.parent.exists():
        save(tile, ios)
    for density, size in (("mdpi",48),("hdpi",72),("xhdpi",96),("xxhdpi",144),("xxxhdpi",192)):
        target = root / "mobile/android/app/src/main/res" / f"mipmap-{density}"
        if not target.exists():
            continue
        for name in ("ic_launcher.png", "ic_launcher_round.png"):
            save(tile.resize((size,size), Image.Resampling.LANCZOS), target/name)
        edge = round(size * 108 / 48)
        save(foreground.resize((edge,edge), Image.Resampling.LANCZOS), target/"ic_launcher_foreground.png")
    return written
if __name__ == "__main__":
    written = sync()
    manifest_path = REPO/"assets/branding/manifest.json"
    manifest = json.loads(manifest_path.read_text())
    for path in written:
        manifest["files"][path.relative_to(REPO).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    manifest["files"] = dict(sorted(manifest["files"].items()))
    manifest_path.write_text(json.dumps(manifest, indent=2)+"\n")
