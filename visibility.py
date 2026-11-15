"""Sample terrain horizons around the mission habitat."""
import struct
import zlib


def viewshed(grid, x, y, dx, dy):
    import numpy as np

    height, width = grid.shape
    if not (0 <= x < width and 0 <= y < height) or not np.isfinite(grid[y, x]):
        raise ValueError("Move the selected waypoint onto valid elevation data.")
    radius = 15000
    # Bound the display cost for finer DEMs. Each radial sample uses the nearest DEM cell.
    step = max(15, min(dx, dy) / 2)
    count = int(np.ceil(radius / step))
    rays = int(np.ceil(2 * np.pi * radius / step))
    distances = np.arange(1, count + 1) * step
    left, right = max(0, x - int(radius / dx)), min(width, x + int(radius / dx) + 1)
    top, bottom = max(0, y - int(radius / dy)), min(height, y + int(radius / dy) + 1)
    rgba = np.zeros((bottom - top, right - left, 4), dtype=np.uint8)
    observer = float(grid[y, x]) + 3
    for first in range(0, rays, 128):
        angles = np.arange(first, min(first + 128, rays))[:, None] * (2 * np.pi / rays)
        xx = x + np.rint(np.cos(angles) * distances / dx).astype(int)
        yy = y + np.rint(np.sin(angles) * distances / dy).astype(int)
        actual = np.hypot((xx - x) * dx, (yy - y) * dy)
        covered = (xx >= left) & (xx < right) & (yy >= top) & (yy < bottom) & (actual <= radius)
        terrain = grid[yy.clip(0, height - 1), xx.clip(0, width - 1)]
        valid = covered & np.isfinite(terrain) & (actual > 0)
        run = np.maximum(actual, 1)
        # Approximate Mars with a sphere of mean radius 3,389.5 km.
        slope = (terrain - observer - actual ** 2 / (2 * 3389500)) / run
        horizon = np.maximum.accumulate(np.where(valid, slope, -np.inf), axis=1)
        prior = np.concatenate((np.full((len(angles), 1), -np.inf), horizon[:, :-1]), axis=1)
        known = ~np.maximum.accumulate((~covered | ~np.isfinite(terrain)), axis=1)
        valid &= known
        visible = valid & (slope + 2 / run >= prior)
        np.maximum.at(rgba[:, :, 3], (yy[valid] - top, xx[valid] - left), 118)
        # Preserve visible cells where adjacent sampled rays share a cell.
        np.maximum.at(rgba[:, :, 3], (yy[visible] - top, xx[visible] - left), 185)
    rgba[rgba[:, :, 3] == 118] = (32, 23, 57, 118)
    rgba[rgba[:, :, 3] == 185] = (56, 190, 232, 185)
    rgba[y - top, x - left] = (56, 190, 232, 185)
    visible_percent = 100 * np.count_nonzero(rgba[:, :, 3] == 185) / np.count_nonzero(rgba[:, :, 3])

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    header = struct.pack(">IIBBBBB", right - left, bottom - top, 8, 6, 0, 0, 0)
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header)
           + chunk(b"IDAT", zlib.compress(b"".join(b"\0" + row.tobytes() for row in rgba)))
           + chunk(b"IEND", b""))
    return png, [left, top, right - left, bottom - top], round(visible_percent, 1), step
