"""Align the published CRISM-only mineral classes to the Jezero DEM."""
import csv
import io
from pathlib import Path
import sys
from zipfile import ZipFile

import numpy as np
import rasterio
from rasterio.io import MemoryFile
from rasterio.warp import reproject, Resampling

root = Path(__file__).resolve().parent
prefix = "jezero_rim_maps_v1/01_geologic_map/"
with ZipFile(sys.argv[1]) as archive, rasterio.open(root / "data" / "M20_JezeroCrater_CTXDEM_20m.tif") as dem:
    classes = list(csv.DictReader(io.StringIO(archive.read(prefix + "class_dictionary.csv").decode())))
    with MemoryFile(archive.read(prefix + "geologic_map_CRISM_only.tif")) as memory, memory.open() as minerals:
        aligned = np.zeros(dem.shape, dtype=np.uint8)
        reproject(rasterio.band(minerals, 1), aligned, dst_transform=dem.transform,
                  dst_crs=dem.crs, dst_nodata=0, resampling=Resampling.nearest)
    rgba = np.zeros((4, *dem.shape), dtype=np.uint8)
    for row in classes:
        code = int(row["value"])
        if code == 1:  # Bulk rim is a geologic unit rather than a mineral detection.
            continue
        selected = aligned == code
        rgba[:, selected] = np.array([int(row[key]) for key in ("red", "green", "blue")] + [215])[:, None]
        print(row["display_name"], int(selected.sum()))
    if not rgba[3].any():
        raise ValueError("The mineral data did not overlap the Jezero DEM.")
    from rasterio.enums import ColorInterp
    with rasterio.open(root / "dist" / "jezero-minerals.png", "w", driver="PNG",
                       width=dem.width, height=dem.height, count=4, dtype="uint8") as output:
        output.colorinterp = (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
        output.write(rgba)
