"""Align the Edwards and Buz THEMIS thermal inertia mosaic to the Jezero DEM."""
from pathlib import Path
import sys

import numpy as np
import rasterio
from rasterio.enums import ColorInterp
from rasterio.warp import reproject, Resampling

root = Path(__file__).resolve().parent
with rasterio.open(sys.argv[1]) as source, rasterio.open(root / "data" / "M20_JezeroCrater_CTXDEM_20m.tif") as dem:
    aligned = np.zeros(dem.shape, dtype=np.float32)
    reproject(rasterio.band(source, 1), aligned, src_nodata=0, dst_nodata=0,
              dst_crs=dem.crs, dst_transform=dem.transform, resampling=Resampling.nearest)
    valid = np.isfinite(aligned) & (aligned > 0)
    if not valid.any():
        raise ValueError("Thermal data does not overlap the Jezero DEM")
    aligned.astype("<f4").tofile(root / "data" / "jezero-thermal.f32")
    rgba = np.zeros((4, *dem.shape), dtype=np.uint8)
    bins = [(200, (91, 116, 213)), (300, (62, 191, 200)),
            (400, (244, 205, 100)), (np.inf, (238, 111, 77))]
    low = 0
    for high, color in bins:
        mask = valid & (aligned >= low) & (aligned < high)
        rgba[:, mask] = np.array([*color, 200])[:, None]
        low = high
    print(f"Aligned {valid.sum():,} cells, {aligned[valid].min():.1f}–{aligned[valid].max():.1f} thermal inertia")
    with rasterio.open(root / "dist" / "jezero-thermal.png", "w", driver="PNG",
                       width=dem.width, height=dem.height, count=4, dtype="uint8") as output:
        output.colorinterp = (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
        output.write(rgba)
