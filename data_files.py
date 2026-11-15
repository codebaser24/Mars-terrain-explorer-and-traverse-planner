"""Local GeoTIFF inventory, alignment and cached atlas builds."""
from concurrent.futures import ThreadPoolExecutor
import hashlib
from functools import lru_cache
import json
from math import sqrt
from pathlib import Path
import re
import shutil
import uuid

ROOT = Path(__file__).resolve().parent
BUILDS = ROOT / "builds"
LIMIT = 4 * 1024**3
JOBS = {}
WORKER = ThreadPoolExecutor(max_workers=1)
KINDS = {"elevation", "thermal", "mineral", "imagery", "unknown"}
UNITS = {"m": 1, "meter": 1, "metre": 1, "meters": 1, "metres": 1,
         "km": 1000, "cm": .01, "mm": .001, "ft": .3048, "feet": .3048,
         "foot": .3048, "kilometer": 1000, "kilometre": 1000}


def active():
    pointer = BUILDS / "active.json"
    return json.loads(pointer.read_text()) if pointer.exists() else None


def files():
    return {p.relative_to(ROOT).as_posix(): p for folder in [ROOT, ROOT / "data", ROOT / "data" / "optimized"]
            for p in sorted(folder.glob("*")) if p.is_file() and not p.is_symlink()
            and p.suffix.lower() in (".tif", ".tiff")}


def sidecar(path):
    return path.with_name(path.name + ".layers.json")


def inspect(path, verify=False, metadata_path=None):
    import rasterio
    info = {"name": path.name, "size": path.stat().st_size, "bands": [], "status": "Ready"}
    try:
        companion = sidecar(metadata_path or path)
        declarations = json.loads(companion.read_text()).get("bands", {}) if companion.exists() else {}
        with rasterio.open(path) as src:
            if src.driver != "GTiff":
                raise ValueError("File is not a GeoTIFF")
            info.update(width=src.width, height=src.height, projected=bool(src.crs and src.crs.is_projected),
                        crs=src.crs.to_wkt() if src.crs else None, bounds=list(src.bounds))
            if info["projected"]:
                factor = src.crs.linear_units_factor[1]
                info["pixel"] = [abs(v) * factor for v in src.res]
            for index in src.indexes:
                tags = {k.lower(): v for k, v in {**src.tags(), **src.tags(index)}.items()}
                units = str(src.units[index - 1] or tags.get("units") or tags.get("unittype") or "").strip().lower()
                text = " ".join([src.descriptions[index - 1] or "", *tags.values(), units]).lower()
                color = src.colorinterp[index - 1].name
                kind = "unknown"
                for evidence in [text, (metadata_path or path).stem.lower()]:
                    if re.search(r"thermal|inertia|temperature|kelvin", evidence) or units == "k":
                        kind = "thermal"
                    elif re.search(r"mineral|crism|olivine|pyroxene", evidence):
                        kind = "mineral"
                    elif re.search(r"elevation|altitude|topograph|(?:^|[^a-z])(?:dem|dtm)(?:[^a-z]|$)|ctxdem", evidence) or units in UNITS:
                        kind = "elevation"
                    elif re.search(r"imagery|ortho|reflectance", evidence):
                        kind = "imagery"
                    if kind != "unknown":
                        break
                if kind == "unknown" and color in ("red", "green", "blue", "alpha", "palette"):
                    kind = "imagery"
                declared = declarations.get(str(index), {})
                if isinstance(declared, str):
                    declared = {"kind": declared}
                kind = declared.get("kind", kind)
                if kind not in KINDS:
                    raise ValueError("Invalid band kind in companion file")
                units = declared.get("units", units).strip().lower()
                info["bands"].append(dict(index=index, kind=kind, units=units, color=color))
            if verify:
                for index in src.indexes:
                    for _, window in src.block_windows(index):
                        src.read(index, window=window)
    except Exception as exc:
        info["status"] = f"Incomplete or damaged: {str(exc)[:180]}"
    return info


def inventory():
    loaded = {row["id"] for row in (active() or {}).get("files", [])}
    result = []
    for name, path in files().items():
        stamp = path.stat().st_mtime_ns
        companion = sidecar(path)
        info = dict(cached_inspect(path, stamp, companion.stat().st_mtime_ns if companion.exists() else 0))
        if name in loaded and info["status"] == "Ready":
            info["status"] = "Loaded"
        result.append(dict(info, id=name, folder=name.rsplit("/", 1)[0] + "/" if "/" in name else "Project folder"))
    return result


@lru_cache(maxsize=128)
def cached_inspect(path, stamp, companion_stamp):
    return inspect(path, verify=True)


def preview(selection):
    import rasterio
    from rasterio.warp import transform_bounds
    rows = [row for row in inventory() if row["id"] in selection]
    ready = [row for row in rows if row["status"] in ("Ready", "Loaded")]
    candidates = [row for row in ready if any(b["kind"] == "elevation" for b in row["bands"])]
    reference = min(candidates or [row for row in ready if row["projected"]] or ready,
                    key=lambda row: max(row.get("pixel", [float("inf")])), default=None)
    route_band = None
    reasons = []
    for row in rows:
        row.update(role="Not loaded", reason=row["status"], overlap=0, fileOverlap=0)
        if not reference or row not in ready:
            continue
        if row is reference:
            row.update(role="Reference grid", reason="", overlap=100, fileOverlap=100, footprint=row["bounds"])
            continue
        if not row["crs"] or not reference["crs"]:
            row["reason"] = "Missing coordinate reference system"
            continue
        try:
            bounds = transform_bounds(row["crs"], reference["crs"], *row["bounds"], densify_pts=21)
            if not all(abs(v) < float("inf") for v in bounds):
                raise ValueError("Invalid transformed footprint")
        except Exception:
            row["reason"] = "Different planetary body or incompatible projection"
            continue
        a, b, c, d = reference["bounds"]
        x, y, u, v = bounds
        area = max(0, min(c, u) - max(a, x)) * max(0, min(d, v) - max(b, y))
        row["footprint"] = list(bounds)
        if area:
            row.update(role="Reprojected onto reference", reason="",
                       overlap=round(100 * area / ((c-a)*(d-b)), 2),
                       fileOverlap=round(100 * area / ((u-x)*(v-y)), 2))
        else:
            row["reason"] = "No overlap with reference area"
    if reference:
        with rasterio.open(files()[reference["id"]]) as src:
            if not reference.get("pixel") or src.transform.b or src.transform.d:
                reasons.append("A north-up projected grid with length units is needed.")
    else:
        reasons.append("Select at least one readable GeoTIFF.")
    elevations = [(row, band) for row in rows if row["role"] != "Not loaded"
                  for band in row["bands"] if band["kind"] == "elevation"]
    usable = [(row, band) for row, band in elevations if band["units"] in UNITS or not band["units"]]
    if not elevations:
        reasons.append("An elevation band is needed.")
    elif not usable:
        reasons.append("Elevation units must be convertible to metres.")
    if usable and not reasons:
        row, band = min(usable, key=lambda entry: entry[0] is not reference)
        route_band = dict(file=row["id"], index=band["index"], factor=UNITS.get(band["units"], 1),
                          assumedMetres=not band["units"])
    return dict(files=rows, reference=reference, routeBand=route_band, reasons=reasons)


def unload_file(file_id):
    current = active()
    loaded = [row["id"] for row in current["files"]] if current else []
    if file_id not in loaded:
        raise ValueError("This file is not loaded.")
    job_id = uuid.uuid4().hex
    job = JOBS[job_id] = {"status": "running", "step": "Unloading file"}

    def unload():
        try:
            if active() != current:
                raise ValueError("The loaded selection changed. Refresh and try again.")
            remaining = [item for item in loaded if item != file_id and item in files()]
            if remaining:
                build_selection(remaining, job)
            else:
                (BUILDS / "active.json").unlink(missing_ok=True)
                job.update(status="done", step="No files loaded")
        except Exception as error:
            job.update(status="error", step=str(error))

    WORKER.submit(unload)
    return job_id


def clear_file(file_id):
    source = files().get(file_id)
    if source is None:
        raise ValueError("GeoTIFF not found in the inventory.")
    recovery = ROOT / "data" / "cleared" / uuid.uuid4().hex[:8]
    recovery.mkdir(parents=True)
    destination = recovery / source.name
    source.rename(destination)
    try:
        companion = sidecar(source)
        if companion.exists():
            companion.rename(recovery / companion.name)
    except OSError:
        destination.rename(source)
        raise
    return destination.relative_to(ROOT).as_posix()


def optimize_dimensions(width, height):
    # Leave room for alignment arrays, color overlays and browser rendering.
    scale = min(1, sqrt(20_000_000 / (width * height)), 8192 / max(width, height))
    return max(1, int(width * scale)), max(1, int(height * scale))


def start_optimization(file_id):
    import rasterio
    source = files().get(file_id)
    if source is None:
        raise ValueError("GeoTIFF not found.")
    info = inventory()
    row = next(item for item in info if item["id"] == file_id)
    if row["status"] not in ("Ready", "Loaded"):
        raise ValueError(row["status"])
    width, height = optimize_dimensions(row["width"], row["height"])
    job_id = uuid.uuid4().hex
    job = JOBS[job_id] = {"status": "running", "step": "Preparing optimized copy", "percent": 0}

    def optimize():
        from rasterio.enums import Resampling
        from rasterio.transform import Affine
        folder = ROOT / "data" / "optimized"
        temp = folder / (job_id + ".part")
        target = folder / source.name
        if target.exists() or target == source:
            target = folder / (source.stem + "-" + job_id[:8] + ".tif")
        published = False
        try:
            folder.mkdir(parents=True, exist_ok=True)
            with rasterio.open(source) as src:
                profile = src.profile.copy()
                for key in ("blockxsize", "blockysize", "photometric", "interleave"):
                    profile.pop(key, None)
                profile.update(width=width, height=height, tiled=True, blockxsize=256, blockysize=256,
                               compress="deflate", BIGTIFF="IF_SAFER",
                               transform=src.transform * Affine.scale(src.width / width, src.height / height))
                with rasterio.open(temp, "w", **profile) as dst:
                    dst.update_tags(**src.tags())
                    dst.colorinterp = src.colorinterp
                    dst.scales = src.scales
                    dst.offsets = src.offsets
                    for band in row["bands"]:
                        index = band["index"]
                        method = Resampling.nearest if band["kind"] in ("mineral", "unknown") or band["color"] == "palette" else Resampling.average
                        dst.write(src.read(index, out_shape=(height, width), resampling=method), index)
                        if band["color"] == "palette":
                            dst.write_colormap(index, src.colormap(index))
                        if src.descriptions[index-1]:
                            dst.set_band_description(index, src.descriptions[index-1])
                        if src.units[index-1]:
                            dst.set_band_unit(index, src.units[index-1])
                        dst.update_tags(index, **src.tags(index))
                        job.update(step=f"Optimizing band {index} of {src.count}", percent=90 * index // src.count)
                    from rasterio.enums import MaskFlags
                    if any(MaskFlags.per_dataset in flags and MaskFlags.alpha not in flags for flags in src.mask_flag_enums):
                        dst.write_mask(src.dataset_mask(out_shape=(height, width), resampling=Resampling.nearest))
            checked = inspect(temp, verify=True, metadata_path=target)
            if checked["status"] != "Ready":
                raise ValueError(checked["status"])
            sidecar(target).write_text(json.dumps({"bands": {str(b["index"]): {"kind": b["kind"], "units": b["units"]} for b in row["bands"]}}))
            temp.rename(target)
            published = True
            try:
                backup = clear_file(file_id)
            except Exception:
                target.unlink()
                published = False
                raise
            job.update(status="done", step="Replaced with optimized file", percent=100,
                       file=target.relative_to(ROOT).as_posix(), backup=backup)
        except Exception as error:
            job.update(status="error", step=str(error))
        finally:
            temp.unlink(missing_ok=True)
            if not published:
                sidecar(target).unlink(missing_ok=True)

    WORKER.submit(optimize)
    return job_id


def upload(stream, length, name):
    if not name or Path(name).name != name or "/" in name or "\\" in name or Path(name).suffix.lower() not in (".tif", ".tiff"):
        raise ValueError("Choose a .tif or .tiff file.")
    if not 0 < length <= LIMIT:
        raise ValueError("GeoTIFFs must be at most 4 GB.")
    folder = ROOT / "data"
    folder.mkdir(exist_ok=True)
    dest = folder / name
    if dest.exists():
        dest = folder / f"{Path(name).stem}-{uuid.uuid4().hex[:8]}{Path(name).suffix}"
    temp = folder / (uuid.uuid4().hex + ".part")
    try:
        with temp.open("wb") as target:
            while length:
                chunk = stream.read(min(length, 1024**2))
                if not chunk:
                    raise ValueError("Upload ended before the file was complete.")
                target.write(chunk)
                length -= len(chunk)
        checked = inspect(temp, verify=True, metadata_path=dest)
        if checked["status"] != "Ready":
            raise ValueError(checked["status"])
        temp.rename(dest)
        return dest.relative_to(ROOT).as_posix()
    finally:
        temp.unlink(missing_ok=True)


def activate(build):
    if build.get("routeBand") and not build.get("elevationRange"):
        import numpy as np
        folder = BUILDS / build["key"]
        elevation = np.memmap(folder / "elevation.f32", dtype="<f4", mode="r",
                              shape=(build["height"], build["width"]))
        build["elevationRange"] = write_elevation_colors(folder, elevation, build["dx"], build["dy"])
        (folder / "manifest.json").write_text(json.dumps(build))
    temp = BUILDS / "active.tmp"
    temp.write_text(json.dumps(build))
    temp.replace(BUILDS / "active.json")


def write_elevation_colors(folder, elevation, dx=20, dy=20):
    import numpy as np
    import rasterio
    from rasterio.enums import ColorInterp
    valid = np.isfinite(elevation)
    low, high = float(elevation[valid].min()), float(elevation[valid].max())
    normal = (elevation[valid] - low) / max(high - low, 1e-9)
    palette = [(34, 57, 76), (57, 111, 115), (145, 161, 119), (199, 160, 108), (245, 224, 179)]
    rgba = np.zeros((4, *elevation.shape), dtype=np.uint8)
    # Illuminate the measured surface from the northwest. Process strips to
    # avoid allocating several full-raster gradient arrays.
    shade = np.ones(elevation.shape, dtype=np.float32)
    for start in range(0, elevation.shape[0], 256):
        end = min(start + 256, elevation.shape[0])
        rows = np.arange(start, end)
        center = elevation[start:end]
        north = elevation[np.maximum(rows - 1, 0)]
        south = elevation[np.minimum(rows + 1, elevation.shape[0] - 1)]
        west = np.concatenate((center[:, :1], center[:, :-1]), axis=1)
        east = np.concatenate((center[:, 1:], center[:, -1:]), axis=1)
        gx = np.nan_to_num((east - west) / (2 * dx))
        gy = np.nan_to_num((south - north) / (2 * dy))
        light = (.7071 + .5 * (gx + gy)) / np.sqrt(1 + gx * gx + gy * gy)
        shade[start:end] = np.clip(1 + .65 * (light - .7071), .56, 1.17)
    brightness = shade[valid]
    for channel, colors in enumerate(zip(*palette)):
        rgba[channel, valid] = np.clip(
            np.interp(normal, np.linspace(0, 1, len(palette)), colors) * brightness, 0, 255)
    rgba[3, valid] = 255
    height, width = elevation.shape
    with rasterio.open(folder / "elevation-color.png", "w", driver="PNG",
                       width=width, height=height, count=4, dtype="uint8") as dst:
        dst.colorinterp = (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
        dst.write(rgba)
    return [low, high]


def build_selection(selection, job):
    import numpy as np
    import rasterio
    from rasterio.enums import ColorInterp
    from rasterio.warp import reproject, Resampling
    try:
        plan = preview(selection)
        job["percent"] = 10
        ref = plan["reference"]
        if not ref:
            raise ValueError("Select at least one readable GeoTIFF.")
        paths = files()
        loaded = [row for row in plan["files"] if row["role"] != "Not loaded"]
        signature = [(row["id"], paths[row["id"]].stat().st_mtime_ns,
                      paths[row["id"]].stat().st_size, row["bands"]) for row in loaded]
        key = hashlib.sha256(json.dumps([3, selection, signature], sort_keys=True).encode()).hexdigest()[:20]
        folder = BUILDS / key
        folder.mkdir(parents=True, exist_ok=True)
        manifest = folder / "manifest.json"
        if manifest.exists():
            cached = json.loads(manifest.read_text())
            activate(cached)
            job.update(status="done", step="Loaded cached build")
            return
        route = plan["routeBand"]
        height, width = ref["height"], ref["width"]
        if height * width > 100_000_000:
            raise ValueError("This reference grid exceeds 100 million pixels. Choose a smaller reference raster.")
        with rasterio.open(paths[ref["id"]]) as reference:
            transform, crs = reference.transform, reference.crs
        prefix = f"/builds/{key}/"
        layers = []
        base = None
        elevation = None

        def png(name, rgba):
            with rasterio.open(folder / name, "w", driver="PNG", width=width, height=height,
                               count=4, dtype="uint8") as dst:
                dst.colorinterp = (ColorInterp.red, ColorInterp.green, ColorInterp.blue, ColorInterp.alpha)
                dst.write(rgba)
            return prefix + name

        def colorize(values, kind):
            valid = np.isfinite(values)
            rgba = np.zeros((4, height, width), dtype=np.uint8)
            if not valid.any():
                return rgba
            low, high = np.percentile(values[valid], [2, 98])
            shade = np.clip((values[valid] - low) / max(high - low, 1e-9), 0, 1)
            rgba[3, valid] = 255
            if kind == "mineral":
                codes = values[valid].astype(np.int64)
                for channel, seed in enumerate((71, 131, 193)):
                    rgba[channel, valid] = 65 + (codes * seed) % 190
            elif kind == "thermal":
                rgba[:3, valid] = [60 + 190 * shade, 96 + 90 * shade, 222 - 175 * shade]
            else:
                rgba[:3, valid] = shade * 255
            return rgba

        total_bands = sum(len(row["bands"]) for row in loaded)
        completed_bands = 0
        for file_index, row in enumerate(loaded):
            job["step"] = f"Reading {row['name']}"
            with rasterio.open(paths[row["id"]]) as src:
                rgb = {}
                rgb_bands = {band["color"] for band in row["bands"] if band["kind"] == "imagery"}
                for band in row["bands"]:
                    job.update(step=f"Reading {row['name']} · band {band['index']}",
                               percent=10 + 65 * completed_bands // total_bands)
                    completed_bands += 1
                    kind, index = band["kind"], band["index"]
                    values = src.read(index, masked=True).astype("float32").filled(np.nan)
                    if row is not ref:
                        job["step"] = f"Reprojecting {row['name']} · band {index}"
                        aligned = np.full((height, width), np.nan, dtype=np.float32)
                        reproject(values, aligned, src_transform=src.transform, src_crs=src.crs,
                                  dst_transform=transform, dst_crs=crs, src_nodata=np.nan, dst_nodata=np.nan,
                                  resampling=Resampling.nearest if kind == "mineral" or src.colorinterp[index-1].name == "palette" else Resampling.bilinear)
                        values = aligned
                    routing = bool(route and route["file"] == row["id"] and route["index"] == index)
                    if routing:
                        elevation = values * route["factor"]
                        elevation.astype("<f4", copy=False).tofile(folder / "elevation.f32")
                    if kind == "imagery" and {"red", "green", "blue"} <= rgb_bands and band["color"] in ("red", "green", "blue", "alpha"):
                        rgb[band["color"]] = values
                        continue
                    url = png(f"band-{file_index}-{index}.png", colorize(values, kind))
                    if (base is None and row is ref) or routing:
                        base = url
                    layers.append(dict(id=f"band-{file_index}-{index}", kind=kind, url=url,
                                       file=row["id"], index=index, routing=routing))
                if rgb:
                    rgba = np.zeros((4, height, width), dtype=np.uint8)
                    valid = np.ones((height, width), dtype=bool)
                    for channel, color in enumerate(("red", "green", "blue")):
                        values = rgb[color]
                        valid &= np.isfinite(values)
                        rgba[channel] = np.clip(np.nan_to_num(values), 0, 255)
                    alpha = rgb.get("alpha")
                    rgba[3, valid] = np.clip(np.nan_to_num(alpha[valid]), 0, 255) if alpha is not None else 255
                    url = png(f"rgb-{file_index}.png", rgba)
                    if base is None and row is ref:
                        base = url
                    layers.append(dict(id=f"rgb-{file_index}", kind="imagery", url=url, file=row["id"], index="RGB"))
        if elevation is not None:
            job.update(step="Computing slope hazards", percent=75)
            dx, dy = ref["pixel"]
            grades = np.zeros_like(elevation)
            for oy, ox in ((0, 1), (1, -1), (1, 0), (1, 1)):
                a = np.s_[max(0,-oy):height-max(0,oy), max(0,-ox):width-max(0,ox)]
                b = np.s_[max(0,oy):height-max(0,-oy), max(0,ox):width-max(0,-ox)]
                grade = np.abs(elevation[a]-elevation[b]) / np.hypot(ox*dx, oy*dy)
                np.fmax(grades[a], grade, out=grades[a])
                np.fmax(grades[b], grade, out=grades[b])
            rgba = np.zeros((4, height, width), dtype=np.uint8)
            rgba[:, grades > np.tan(np.deg2rad(10))] = np.array([255,192,72,150])[:, None]
            rgba[:, grades > np.tan(np.deg2rad(18))] = np.array([255,81,69,200])[:, None]
            layers.append(dict(id="hazards", kind="hazards", url=png("hazards.png", rgba)))
            job.update(step="Drawing contours", percent=85)
            rgba.fill(0)
            bands = np.floor(elevation / 50)
            edges = np.zeros(bands.shape, dtype=bool)
            edges[:, 1:] |= np.isfinite(bands[:, 1:]) & np.isfinite(bands[:, :-1]) & (bands[:, 1:] != bands[:, :-1])
            edges[1:, :] |= np.isfinite(bands[1:, :]) & np.isfinite(bands[:-1, :]) & (bands[1:, :] != bands[:-1, :])
            rgba[:, edges] = np.array([228,212,172,145])[:, None]
            layers.append(dict(id="contours", kind="contours", url=png("contours.png", rgba)))
        if elevation is not None and not np.isfinite(elevation).any():
            raise ValueError("The selected elevation band has no valid values.")
        build = dict(key=key, files=loaded, selection=sorted(selection), layers=layers, base=base,
                     width=width, height=height, dx=(ref.get("pixel") or [None,None])[0],
                     dy=(ref.get("pixel") or [None,None])[1], routeBand=route, reasons=plan["reasons"],
                     source=route["file"] if route else ref["id"])
        if elevation is not None:
            job.update(step="Coloring elevation", percent=93)
            build["elevationRange"] = write_elevation_colors(folder, elevation, dx, dy)
        manifest.write_text(json.dumps(build))
        activate(build)
        job.update(status="done", step="Atlas data loaded", percent=100)
    except Exception as exc:
        job.update(status="error", step=str(exc))


def start_build(selection):
    if not isinstance(selection, list) or not selection or not all(isinstance(item, str) for item in selection):
        raise ValueError("Select one or more GeoTIFFs.")
    job_id = uuid.uuid4().hex
    job = JOBS[job_id] = {"status": "running", "step": "Reading inventory"}
    WORKER.submit(build_selection, sorted(set(selection)), job)
    return job_id
