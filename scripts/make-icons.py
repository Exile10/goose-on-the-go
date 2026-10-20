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
    assets/images/notification-icon.png          Android notification small icon

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

import math
import sys
from pathlib import Path

try:
    from PIL import Image, ImageDraw, ImageFilter
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


# The notification small icon: 96 px is xxxhdpi for Android's 24dp, and
# expo-notifications scales it to the other densities at prebuild.
NOTIFICATION_SIZE = 96
# Android's 2dp padding at xxxhdpi.
NOTIFICATION_PADDING = 8
# Drawn this many times larger, then reduced, for smooth edges.
NOTIFICATION_SUPERSAMPLE = 8
# The brand mark's water starts here (500 px canvas); above it is the G and the beak.
WATERLINE = 308
# Stroke growth in source pixels: the G's 27 px stroke becomes about 38 px.
BOLDEN = 11


def notification_silhouette(source: Path) -> Image.Image:
    """A bold white silhouette of the mark for the status bar.

    Android draws a notification's small icon from its alpha alone, white, at
    24dp. The full mark there is a faint thin "G": its ripples and the gap
    between head and beak are hairlines at that size, and the themed-icon
    silhouette above sits inside a 66% safe zone. So this one is simplified,
    the only icon here that is: the G and beak, their strokes thickened (which
    also joins the beak to the head), on one bold wave in place of the ripples,
    filling the canvas to the padding. The OS forces the white; it is not a
    recolour of the logo.
    """
    alpha = Image.open(source).convert("RGBA").getchannel("A")
    ink = alpha.point(lambda v: 255 if v > 128 else 0)
    goose = ink.crop((0, 0, ink.width, WATERLINE)).filter(ImageFilter.MaxFilter(BOLDEN))
    goose = goose.crop(goose.getbbox())

    work = NOTIFICATION_SIZE * NOTIFICATION_SUPERSAMPLE
    live = work - 2 * NOTIFICATION_PADDING * NOTIFICATION_SUPERSAMPLE
    gap = round(live * 0.06)
    wave_height = round(live * 0.17)
    goose_height = live - gap - wave_height
    goose = goose.resize(
        (round(goose.width * goose_height / goose.height), goose_height), Image.LANCZOS
    )

    canvas = Image.new("L", (work, work), 0)
    top = NOTIFICATION_PADDING * NOTIFICATION_SUPERSAMPLE
    canvas.paste(255, ((work - goose.width) // 2, top), goose)

    # One wave, a sine of one and a half periods, a little wider than the G,
    # drawn as a round pen swept along it so its ends are round and it has no
    # seams. The pen's radius stays inside the padding at both ends.
    stroke = round(live * 0.10)
    radius = stroke / 2
    wave_width = min(live - stroke, round(goose.width * 1.25))
    amplitude = (wave_height - stroke) / 2
    left = (work - wave_width) / 2
    middle = top + goose_height + gap + wave_height / 2
    draw = ImageDraw.Draw(canvas)
    for x in range(wave_width + 1):
        cx = left + x
        cy = middle + amplitude * math.sin(x / wave_width * 3 * math.pi)
        draw.ellipse((cx - radius, cy - radius, cx + radius, cy + radius), fill=255)

    out = Image.new("RGBA", (NOTIFICATION_SIZE, NOTIFICATION_SIZE), (255, 255, 255, 0))
    out.putalpha(canvas.resize((NOTIFICATION_SIZE, NOTIFICATION_SIZE), Image.LANCZOS))
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
    # Wired in app.json as expo-notifications' `icon`.
    save(notification_silhouette(MARK_ON_DARK), "notification-icon.png")

    print("wrote:")
    for line in written:
        print(f"  {line}")


if __name__ == "__main__":
    main()
