#!/usr/bin/env python3
"""
App-icon generator — zero dependencies (stdlib zlib + struct only).

This machine has no PIL / rsvg / ImageMagick, and the PWA needs real
raster icons (Android's install prompt refuses SVG-only manifests, and
iOS needs a PNG apple-touch-icon). So we rasterize the mark ourselves.

The mark: a warm near-black tile carrying an ascending polyline with a
filled dot at its apex — "wealth over time". Drawn by evaluating, per
sub-pixel, the distance to the nearest polyline segment; SS×SS
supersampling then box-downsamples, which gives clean antialiasing
without any geometry library.

Rerun after changing the palette or geometry:
    python3 assets/icons/generate-icons.py
"""

import struct
import zlib
from pathlib import Path

OUT = Path(__file__).resolve().parent

# ─── Palette (mirrors css/variables.css) ────────────────────────────
BG = (0x16, 0x16, 0x1A)        # warm near-black tile
INK = (0xF4, 0xF1, 0xEA)       # warm paper — the curve
DOT = (0x35, 0xC7, 0x7E)       # growth green — the apex dot

SS = 4                          # supersampling factor per axis


def _rounded_rect_alpha(x, y, w, h, r):
    """Coverage of a rounded rectangle at point (x, y), 0.0 or 1.0.

    Antialiasing comes from supersampling the caller, not from this
    function, so a hard in/out test is all we need."""
    if x < 0 or y < 0 or x > w or y > h:
        return False
    # Corner circles: only the four corner boxes need a radius test.
    cx = r if x < r else (w - r if x > w - r else x)
    cy = r if y < r else (h - r if y > h - r else y)
    if cx == x and cy == y:
        return True
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def _dist_to_segment(px, py, ax, ay, bx, by):
    vx, vy = bx - ax, by - ay
    wx, wy = px - ax, py - ay
    seg_len2 = vx * vx + vy * vy
    t = 0.0 if seg_len2 == 0 else max(0.0, min(1.0, (wx * vx + wy * vy) / seg_len2))
    dx, dy = ax + t * vx - px, ay + t * vy - py
    return (dx * dx + dy * dy) ** 0.5


def render(size, *, maskable=False, opaque=False):
    """Return raw RGBA bytes for one square icon.

    maskable — Android adaptive icons crop to a circle inscribed in the
               square, so the mark shrinks into the safe zone and the
               background goes full-bleed (no rounded corners).
    opaque   — apple-touch-icon must have no alpha; iOS applies its own
               mask, so we ship a full square.
    """
    # Mark box: the region the curve is allowed to occupy, as a
    # fraction of the tile. Maskable keeps everything inside the
    # 80%-diameter safe circle.
    inset = 0.30 if maskable else 0.22
    radius = 0.0 if (maskable or opaque) else size * 0.2237  # iOS squircle-ish

    mx0, my0 = size * inset, size * inset
    span = size * (1 - 2 * inset)

    # Polyline in mark-box-relative coords (0..1, y down).
    pts_rel = [(0.00, 0.86), (0.30, 0.50), (0.55, 0.66), (1.00, 0.10)]
    pts = [(mx0 + rx * span, my0 + ry * span) for rx, ry in pts_rel]
    segments = list(zip(pts, pts[1:]))

    stroke = span * 0.115 / 2      # half-thickness
    dot_c = pts[-1]
    dot_r = span * 0.125

    rows = []
    inv = 1.0 / (SS * SS)
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc_bg = acc_ink = acc_dot = 0
            for sy in range(SS):
                y = py + (sy + 0.5) / SS
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    if not _rounded_rect_alpha(x, y, size, size, radius):
                        continue
                    acc_bg += 1
                    ddx, ddy = x - dot_c[0], y - dot_c[1]
                    if ddx * ddx + ddy * ddy <= dot_r * dot_r:
                        acc_dot += 1
                    elif any(_dist_to_segment(x, y, a[0], a[1], b[0], b[1]) <= stroke
                            for a, b in segments):
                        acc_ink += 1
            cov_bg = acc_bg * inv
            if cov_bg == 0:
                row += bytes((0, 0, 0, 0))
                continue
            # Composite ink + dot over the tile, then apply tile coverage
            # as the pixel's alpha (that's what rounds the corners).
            w_ink, w_dot = acc_ink * inv, acc_dot * inv
            w_bg = max(0.0, cov_bg - w_ink - w_dot)
            total = w_bg + w_ink + w_dot
            r = (BG[0] * w_bg + INK[0] * w_ink + DOT[0] * w_dot) / total
            g = (BG[1] * w_bg + INK[1] * w_ink + DOT[1] * w_dot) / total
            b = (BG[2] * w_bg + INK[2] * w_ink + DOT[2] * w_dot) / total
            a = 255 if opaque else round(cov_bg * 255)
            row += bytes((round(r), round(g), round(b), a))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    raw = b''.join(b'\x00' + r for r in rows)          # filter byte 0 per scanline

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n'
    png += chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 9))
    png += chunk(b'IEND', b'')
    path.write_bytes(png)
    print(f'  {path.name:<28} {size}×{size}  {len(png):>7,} bytes')


TARGETS = [
    ('icon-192.png',          192, {}),
    ('icon-512.png',          512, {}),
    ('icon-maskable-192.png', 192, {'maskable': True}),
    ('icon-maskable-512.png', 512, {'maskable': True}),
    ('apple-touch-icon.png',  180, {'opaque': True}),
    ('favicon-32.png',         32, {}),
]

if __name__ == '__main__':
    print('Rendering app icons…')
    for name, size, opts in TARGETS:
        write_png(OUT / name, size, render(size, **opts))
    print('Done.')
