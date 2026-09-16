#!/usr/bin/env python3
"""Generate the app's icons from the GIAP brand mark.

Run from the repo root:   python3 scripts/make-icons.py

Outputs (all committed, so nobody has to run this):
    assets/images/icon.png                       1024 master: white mark on the plate
    assets/images/android-icon-foreground.png    adaptive foreground, mark only
    assets/images/android-icon-background.png    adaptive background, flat plate
    assets/images/android-icon-monochrome.png    themed-icon silhouette
    assets/images/splash-icon.png                launch screen mark
    assets/images/favicon.png                    web

Everything derives from the brand mark in assets/brand/, which is the same
artwork the Pond's desktop icon uses. It ships in two variants: goose-logo.png
is dark ink for light grounds, goose-logo-dark.png is white ink for dark ones.
Per the Pond's DESIGN.md section 8 the logo is never stretched, skewed,
rotated, recoloured outside the palette, or given effects -- so it is only ever
scaled proportionally and placed on a ground.

Before this, every icon in the app was an Expo scaffold default: the stock blue
chevron with its construction guides, and the grid-and-circles placeholder on
the launch screen. The app had shipped unbranded.
"""

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:
    sys.exit("This script needs Pillow: python3 -m pip install Pillow")

ROOT = Path(__file__).resolve().parent.parent
MARK_ON_DARK = ROOT / "assets/brand/goose-logo-dark.png"
OUT = ROOT / "assets/images"

# The plate colour, taken from the Pond's own app icon rather than from this
# app's design tokens.
#
# The tokens in constants/colors.ts are tuned against the app's own chrome. An
# icon sits against a launcher, a recents card and a settings list instead, so
# it is tuned against the operating system's. Reusing the value the desktop
# icon already uses also keeps the two halves of the product looking like one
# product on a machine that has both.
GROUND = (0x1C, 0x1C, 0x1E, 255)

MASTER = 1024

# How much of the plate's width the mark occupies, for the plated icon. Matches
# the desktop icon's ratio so the two read as the same artwork at a glance.
MARK_WIDTH_RATIO = 0.60

# The adaptive foreground is smaller, and this is the part that is easy to get
# wrong.
#
# Android composites foreground over background on a canvas where only the
# centre 66% is guaranteed to survive: launchers mask to a circle, a squircle or
# a rounded square of their own choosing, and anything outside that inner region
# is cropped. At 0.60 the goose's head and the water beneath it would be clipped
# on a circular mask.
#
# 0.42 keeps the whole mark inside the safe circle with room for the parallax
# some launchers apply when the icon is dragged.
ADAPTIVE_MARK_RATIO = 0.42


def trimmed_mark(source: Path) -> Image.Image:
    """The brand mark cropped to its own ink, so placement is predictable.

    The source is a 500x500 canvas with the mark occupying roughly the middle
    third. Cropping to the alpha bounding box removes that padding without
    touching the artwork.
    """
    im = Image.open(source).convert("RGBA")
    box = im.getchannel("A").getbbox()
    if box is None:
        sys.exit(f"{source} has no visible pixels")
    return im.crop(box)


def scaled(mark: Image.Image, target_width: int) -> Image.Image:
    """Proportional scale to a target width. Never distorts."""
    ratio = target_width / mark.width
    return mark.resize(
        (target_width, max(1, round(mark.height * ratio))), Image.LANCZOS
    )


def centred(mark: Image.Image, canvas: Image.Image) -> Image.Image:
    """Place the mark in the optical centre of the canvas."""
    x = (canvas.width - mark.width) // 2
    y = (canvas.height - mark.height) // 2
    canvas.alpha_composite(mark, (x, y))
    return canvas


def plated(mark: Image.Image, size: int, ratio: float) -> Image.Image:
    """The mark on an opaque plate, full bleed.

    No rounded corners are drawn. iOS masks the icon itself, and Android's
    legacy icon path does too -- drawing our own corner radius on top of theirs
    is what produces a rounded square inside a rounded square.
    """
    canvas = Image.new("RGBA", (size, size), GROUND)
    return centred(scaled(mark, round(size * ratio)), canvas)


def transparent(mark: Image.Image, size: int, ratio: float) -> Image.Image:
    """The mark alone, centred on transparency."""
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    return centred(scaled(mark, round(size * ratio)), canvas)


def monochrome(mark: Image.Image, size: int, ratio: float) -> Image.Image:
    """A single-colour silhouette for Android 13+ themed icons.

    Flattening the purple beak into the silhouette is not a recolour of the
    logo: Android discards colour from this layer entirely and re-tints the
    alpha to the user's wallpaper palette. Supplying colour here produces a
    flat block, the same way a macOS template image does.
    """
    silhouette = transparent(mark, size, ratio)
    alpha = silhouette.getchannel("A")
    out = Image.new("RGBA", silhouette.size, (255, 255, 255, 0))
    out.putalpha(alpha)
    return out


def main() -> None:
    if not MARK_ON_DARK.exists():
        sys.exit(f"missing brand mark: {MARK_ON_DARK}")
    OUT.mkdir(parents=True, exist_ok=True)
    mark = trimmed_mark(MARK_ON_DARK)

    written = []

    def save(image: Image.Image, name: str) -> None:
        path = OUT / name
        image.save(path)
        written.append(f"{name}  {image.width}x{image.height}")

    save(plated(mark, MASTER, MARK_WIDTH_RATIO), "icon.png")
    save(transparent(mark, MASTER, ADAPTIVE_MARK_RATIO), "android-icon-foreground.png")
    save(Image.new("RGBA", (MASTER, MASTER), GROUND), "android-icon-background.png")
    save(monochrome(mark, MASTER, ADAPTIVE_MARK_RATIO), "android-icon-monochrome.png")
    # The launch screen draws this over the plate colour set in app.json, so the
    # mark ships without a ground of its own.
    save(transparent(mark, MASTER, 0.72), "splash-icon.png")
    save(plated(mark, 48, MARK_WIDTH_RATIO), "favicon.png")

    print("wrote:")
    for line in written:
        print(f"  {line}")


if __name__ == "__main__":
    main()
