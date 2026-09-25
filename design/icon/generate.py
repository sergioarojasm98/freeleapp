"""Generate the Freeleapp app icon sources.

Outputs (next to this script):
  - freeleapp-flat.svg           Flat icon on the macOS grid (824 pt body in a 1024 pt canvas)
  - Freeleapp-<variant>.icon/    Icon Composer packages (Liquid Glass) for macOS 26+

Requires: pip install cairosvg pillow (only for the optional PNG preview).
"""
import json
import math
import pathlib
import shutil

OUT = pathlib.Path(__file__).parent

# Approved layout (variant C3): three clouds of equal width in the 824 pt icon body
CLOUD_WIDTH = 420
GREY = (412, 456)
BLUE = (546, 612)
WHITE = (612, 414)

COLORS = {
    "white": ("#ffffff", "#dfe5ec"),
    "grey": ("#9aa1ab", "#7a818b"),
    "blue": ("#a9d4ff", "#5ea9ee"),
}
BACKGROUND = ("#30343c", "#15171b")


def _intersections(c1, r1, c2, r2):
    (x1, y1), (x2, y2) = c1, c2
    d = math.hypot(x2 - x1, y2 - y1)
    a = (r1 ** 2 - r2 ** 2 + d ** 2) / (2 * d)
    h = math.sqrt(max(r1 ** 2 - a ** 2, 0))
    xm, ym = x1 + a * (x2 - x1) / d, y1 + a * (y2 - y1) / d
    return [(xm + h * (y2 - y1) / d, ym - h * (x2 - x1) / d), (xm - h * (y2 - y1) / d, ym + h * (x2 - x1) / d)]


def _arc(center, radius, start, end):
    """Clockwise SVG arc around center from start to end."""
    a0 = math.atan2(start[1] - center[1], start[0] - center[0])
    a1 = math.atan2(end[1] - center[1], end[0] - center[0])
    large = 1 if (a1 - a0) % (2 * math.pi) > math.pi else 0
    return f"A {radius:.2f} {radius:.2f} 0 {large} 1 {end[0]:.2f} {end[1]:.2f}"


def cloud_path(box_center, width, scale=1.0, origin=(512, 512)):
    """Flat-based cloud (small left bump, big top bump, medium right bump) centered on its bounding box.

    `scale` maps the icon-body layout to the full-bleed Icon Composer canvas around `origin`.
    """
    w = width * scale
    bx = origin[0] + (box_center[0] - origin[0]) * scale
    by = origin[1] + (box_center[1] - origin[1]) * scale
    cx, base = bx - 0.01 * w, by + 0.37 * w
    r1, r2, r3 = 0.20 * w, 0.30 * w, 0.235 * w
    c1, c2, c3 = (cx - 0.28 * w, base - r1), (cx - 0.02 * w, base - 0.44 * w), (cx + 0.265 * w, base - r3)
    p12 = min(_intersections(c1, r1, c2, r2), key=lambda p: p[1])
    p23 = min(_intersections(c2, r2, c3, r3), key=lambda p: p[1])
    start, end = (c1[0], base), (c3[0], base)
    return f"M {start[0]:.2f} {start[1]:.2f} {_arc(c1, r1, start, p12)} {_arc(c2, r2, p12, p23)} {_arc(c3, r3, p23, end)} Z"


def _gradient(gid, top, bottom):
    return (
        f'<linearGradient id="{gid}" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{top}"/><stop offset="1" stop-color="{bottom}"/></linearGradient>'
    )


def flat_svg():
    """Flat icon: rounded body, subtle rim, three clouds with soft shadows."""
    defs = "".join(_gradient(k, *v) for k, v in COLORS.items()) + _gradient("bg", *BACKGROUND)
    defs += (
        '<linearGradient id="rim" x1="0" y1="0" x2="0" y2="1">'
        '<stop offset="0" stop-color="#fff" stop-opacity="0.22"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.04"/>'
        '<stop offset="1" stop-color="#fff" stop-opacity="0.10"/></linearGradient>'
        '<filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">'
        '<feDropShadow dx="0" dy="14" stdDeviation="18" flood-color="#000" flood-opacity="0.35"/></filter>'
    )
    clouds = (
        f'<path d="{cloud_path(WHITE, CLOUD_WIDTH)}" fill="url(#white)"/>'
        f'<path d="{cloud_path(GREY, CLOUD_WIDTH)}" fill="url(#grey)" filter="url(#shadow)"/>'
        f'<path d="{cloud_path(BLUE, CLOUD_WIDTH)}" fill="url(#blue)" filter="url(#shadow)"/>'
    )
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
        f"<defs>{defs}</defs>"
        '<rect x="100" y="100" width="824" height="824" rx="185" fill="url(#bg)"/>'
        '<rect x="101.5" y="101.5" width="821" height="821" rx="183.5" fill="none" stroke="url(#rim)" stroke-width="3"/>'
        f"{clouds}</svg>\n"
    )


def layer_svg(name, center):
    """One cloud on the full-bleed 1024 pt Icon Composer canvas (the system applies the icon shape)."""
    top, bottom = COLORS[name]
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">'
        f"<defs>{_gradient('g', top, bottom)}</defs>"
        f'<path d="{cloud_path(center, CLOUD_WIDTH, scale=1024 / 824)}" fill="url(#g)"/></svg>\n'
    )


def _srgb(hex_color):
    r, g, b = (int(hex_color[i : i + 2], 16) / 255 for i in (1, 3, 5))
    return f"extended-srgb:{r:.5f},{g:.5f},{b:.5f},1.00000"


def _layer(name):
    return {"glass": True, "image-name": f"cloud-{name}.svg", "name": f"cloud-{name}"}


GLASS = {
    "lighting": "individual",
    "specular": True,
    "shadow": {"kind": "neutral", "opacity": 0.5},
    "translucency": {"enabled": True, "value": 0.4},
}

VARIANTS = {
    # Top-most first: blue in front, white at the back
    "single-group": [{**GLASS, "layers": [_layer("blue"), _layer("grey"), _layer("white")]}],
    "per-cloud-groups": [{**GLASS, "layers": [_layer(n)]} for n in ("blue", "grey", "white")],
}


# Variant shipped in the app: separate glass groups let the front cloud show the others through it
APP_ICON_VARIANT = "per-cloud-groups"


def icon_package(variant, groups):
    pkg = OUT / f"Freeleapp-{variant}.icon"
    shutil.rmtree(pkg, ignore_errors=True)
    (pkg / "Assets").mkdir(parents=True)
    for name, center in (("white", WHITE), ("grey", GREY), ("blue", BLUE)):
        (pkg / "Assets" / f"cloud-{name}.svg").write_text(layer_svg(name, center))
    doc = {
        "fill": {"linear-gradient": [_srgb(BACKGROUND[0]), _srgb(BACKGROUND[1])]},
        "groups": groups,
        "supported-platforms": {"squares": "shared"},
    }
    (pkg / "icon.json").write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n")


def _silhouette(render):
    """Alpha mask for monochrome uses: the two back clouds merged, the front cloud cut out by a gap.

    Separating all three clouds turns into noise at 16 px; two planes still read as layered clouds.
    """
    from PIL import ImageChops

    def shape(center, gap=0):
        stroke = f' stroke="#000" stroke-width="{gap * 2}" stroke-linejoin="round"' if gap else ""
        return render(f'<path d="{cloud_path(center, CLOUD_WIDTH)}" fill="#000"{stroke}/>').getchannel("A")

    back = ImageChops.lighter(shape(WHITE), shape(GREY))
    return ImageChops.lighter(ImageChops.subtract(back, shape(BLUE, gap=34)), shape(BLUE))


def export_app_assets(desktop_app):
    """Render every raster icon the desktop app ships, keeping upstream file names and sizes."""
    import io

    import cairosvg
    from PIL import Image

    def render(svg, width, height=None):
        png = cairosvg.svg2png(bytestring=svg.encode(), output_width=width, output_height=height or width)
        return Image.open(io.BytesIO(png)).convert("RGBA")

    def render_shape(inner):
        return render(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">{inner}</svg>', 1024)

    silhouette = _silhouette(render_shape).crop((190, 170, 870, 790))  # tight box around the clouds

    full = render(flat_svg(), 1024)
    body = full.crop((100, 100, 924, 924))  # upstream PNGs are the rounded body without the grid margin
    icons = desktop_app / "src/assets/icons"
    images = desktop_app / "src/assets/images"
    electron_images = desktop_app / "electron/assets/images"
    ico_sizes = [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]

    full.save(icons / "icon.png")
    full.save(icons / "1024x1024.png")
    full.save(icons / "icon.icns")
    full.save(icons / "icon.ico", sizes=ico_sizes)
    for folder in (images, electron_images):
        body.save(folder / "Leapp.png")
        full.save(folder / "Leapp.icns")
        full.save(folder / "Leapp.ico", sizes=ico_sizes)
    # macOS 26+ Liquid Glass icon, compiled to Assets.car with actool by CI (see desktop-app-build.yml)
    target = desktop_app / "build/Freeleapp.icon"
    shutil.rmtree(target, ignore_errors=True)
    shutil.copytree(OUT / f"Freeleapp-{APP_ICON_VARIANT}.icon", target)
    body.resize((384, 384), Image.LANCZOS).save(images / "Leapp-rounded.png")
    for scale, suffix in ((1, ""), (2, "@2x")):
        size = 16 * scale
        body.resize((size, size), Image.LANCZOS).save(images / f"LeappMini{suffix}.png")
        tmpl = Image.new("RGBA", silhouette.size, (0, 0, 0, 255))
        tmpl.putalpha(silhouette)
        tmpl.thumbnail((size, size), Image.LANCZOS)
        canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        canvas.paste(tmpl, ((size - tmpl.width) // 2, (size - tmpl.height) // 2), tmpl)
        canvas.save(images / f"LeappTemplate{suffix}.png")
    for scale, suffix in ((1, ""), (2, "@2x")):
        bg = Image.new("RGBA", (540 * scale, 380 * scale), "#f6f8fb")
        mark = Image.new("RGBA", silhouette.size, (139, 146, 156, 255))
        mark.putalpha(silhouette.point(lambda a: a * 18 // 255))
        mark = mark.resize((int(silhouette.width * 0.34 * scale), int(silhouette.height * 0.34 * scale)), Image.LANCZOS)
        bg.paste(mark, ((bg.width - mark.width) // 2, int(40 * scale)), mark)
        bg.save(icons / f"background{suffix}.png")


if __name__ == "__main__":
    import sys

    (OUT / "freeleapp-flat.svg").write_text(flat_svg())
    for variant, groups in VARIANTS.items():
        icon_package(variant, groups)
    try:
        import cairosvg

        cairosvg.svg2png(url=str(OUT / "freeleapp-flat.svg"), write_to=str(OUT / "freeleapp-flat.png"), output_width=1024)
    except ImportError:
        pass
    if "--app-assets" in sys.argv:
        export_app_assets(OUT.parent.parent / "packages/desktop-app")
    print("generated", sorted(p.name for p in OUT.iterdir()))
