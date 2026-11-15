"""Serve the atlas and compute slope-constrained routes over a DEM grid."""
from functools import lru_cache
from array import array
from heapq import heappop, heappush
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from math import atan2, degrees, hypot, isfinite
import mmap
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlsplit
import data_files

ROOT = Path(__file__).resolve().parent
PROFILES = {"balanced": (18, 2), "low-exposure": (10, 6), "shortest": (22, 0)}


@lru_cache(maxsize=1)
def terrain():
    return json.loads((ROOT / "data" / "terrain.json").read_text())


@lru_cache(maxsize=1)
def full_metadata():
    return json.loads((ROOT / "dist" / "jezero-full.json").read_text())


@lru_cache(maxsize=1)
def full_terrain():
    metadata = full_metadata()
    with (ROOT / "data" / "jezero-full.f32").open("rb") as source:
        data = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
    if len(data) != metadata["width"] * metadata["height"] * 4:
        data.close()
        raise ValueError("Full DEM elevation file has an unexpected size.")
    return {**metadata, "elevation": memoryview(data).cast("f")}


class SearchLimitReached(ValueError):
    pass


@lru_cache(maxsize=1)
def thermal_grid():
    metadata = full_metadata()
    with (ROOT / "data" / "jezero-thermal.f32").open("rb") as source:
        data = mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ)
    if len(data) != metadata["width"] * metadata["height"] * 4:
        data.close()
        raise ValueError("Thermal data dimensions do not match the DEM.")
    return memoryview(data).cast("f")


def find_route(grid, start, goal, profile, extended=False, thermal=None, telemetry=False):
    width, height = grid["width"], grid["height"]
    elevations = grid["elevation"]
    dx, dy = grid["dx"], grid["dy"]
    limit, penalty = PROFILES[profile]

    def elevation(point):
        x, y = point
        if not (0 <= x < width and 0 <= y < height):
            return None
        value = elevations[y * width + x]
        return value if value is not None and isfinite(value) else None

    def distance(a, b):
        return hypot((a[0] - b[0]) * dx, (a[1] - b[1]) * dy)

    if elevation(start) is None or elevation(goal) is None:
        raise ValueError("Choose two points within valid DEM coverage.")
    goal_height = elevation(goal)
    diagonal = hypot(dx, dy)

    def remaining(point, height):
        x = abs(point[0] - goal[0])
        y = abs(point[1] - goal[1])
        paired = min(x, y)
        return paired * diagonal + (x - paired) * dx + (y - paired) * dy + penalty * abs(height - goal_height)

    queue = [(remaining(start, elevation(start)), 0, start)]
    # Compact storage keeps a full-raster search within a predictable memory budget.
    costs = array("d", [float("inf")]) * (width * height) if extended else {}
    previous = array("i", [-1]) * (width * height) if extended else {}

    def key(point):
        return point[1] * width + point[0] if extended else point

    costs[key(start)] = 0
    expanded = 0
    while queue:
        _, cost, current = heappop(queue)
        current_key = key(current)
        if cost != costs[current_key]:
            continue
        if current == goal:
            path = [goal]
            while path[-1] != start:
                parent = previous[key(path[-1])]
                path.append((parent % width, parent // width) if extended else parent)
            path.reverse()
            steps = [(distance(a, b), elevation(b) - elevation(a)) for a, b in zip(path, path[1:])]
            route = dict(path=path, distanceM=round(sum(run for run, _ in steps)),
                        ascentM=round(sum(max(0, rise) for _, rise in steps)),
                        maxSlopeDeg=round(max((degrees(atan2(abs(rise), run)) for run, rise in steps), default=0), 1))
            if telemetry:
                route["elevationM"] = [round(elevation(point), 3) for point in path]
            return route
        expanded += 1
        if not extended and expanded > 3_000_000:
            raise SearchLimitReached("Search limit reached. An extended search may take longer.")
        x, y = current
        current_height = elevation(current)
        for ox, oy in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)):
            neighbor = (x + ox, y + oy)
            target = elevation(neighbor)
            if target is None or (ox and oy and (elevation((x + ox, y)) is None or elevation((x, y + oy)) is None)):
                continue
            run = distance(current, neighbor)
            grade = abs(target - current_height) / run
            if degrees(atan2(grade, 1)) > limit:
                continue
            candidate = cost + run * (1 + penalty * grade)
            if thermal is not None:
                inertia = thermal[neighbor[1] * width + neighbor[0]]
                # Penalize higher inertia, reaching the full penalty at 400.
                # Apply the same maximum penalty where coverage is missing.
                factor = max(0, min(1, (inertia - 200) / 200)) if isfinite(inertia) and inertia > 0 else 1
                candidate += run * 0.5 * factor
            neighbor_key = key(neighbor)
            best = costs[neighbor_key] if extended else costs.get(neighbor_key, float("inf"))
            if candidate < best:
                costs[neighbor_key] = candidate
                previous[neighbor_key] = current_key
                heappush(queue, (candidate + remaining(neighbor, target), candidate, neighbor))
    raise ValueError("No route meets the slope limit between these points.")


class Handler(SimpleHTTPRequestHandler):
    timeout = 15

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

    def log_request(self, code="-", size="-"):
        # Keep routine traffic off the console so an unattended server cannot
        # stall while writing request logs.
        pass

    def translate_path(self, path):
        match = re.fullmatch(r"/builds/([a-f0-9]{20})/([a-z0-9-]+\.png)", urlsplit(path).path)
        if match:
            return str(data_files.BUILDS / match[1] / match[2])
        if path == "/api/dem-source":
            return str(ROOT / "data" / "M20_JezeroCrater_CTXDEM_20m.tif")
        return super().translate_path(path)

    def respond(self, status, payload):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith("/api/data"):
            try:
                if self.path == "/api/data":
                    return self.respond(200, {"files": data_files.inventory(), "active": data_files.active()})
                if self.path == "/api/data/active":
                    return self.respond(200, {"active": data_files.active()})
                if self.path.startswith("/api/data/job/"):
                    job = data_files.JOBS.get(self.path.rsplit("/", 1)[-1])
                    return self.respond(200 if job else 404, job or {"error": "Build not found"})
            except Exception as error:
                return self.respond(500, {"error": str(error)})
        if self.path != "/api/terrain":
            return super().do_GET()
        try:
            self.respond(200, terrain())
        except FileNotFoundError:
            self.respond(503, {"error": "DEM unavailable. Run the preparation command in the README."})

    def do_POST(self):
        if self.path == "/api/viewshed":
            import base64
            import numpy as np
            from visibility import viewshed
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 1024:
                    raise ValueError("Invalid visibility request.")
                payload = json.loads(self.rfile.read(length))
                build = data_files.active()
                if not build or not build["routeBand"] or build["key"] != payload["build"]:
                    raise ValueError("Load a matching elevation grid first.")
                x, y = payload["cell"]
                if type(x) is not int or type(y) is not int:
                    raise ValueError("Invalid habitat coordinates.")
                grid = np.memmap(data_files.BUILDS / build["key"] / "elevation.f32",
                                 dtype="<f4", mode="r", shape=(build["height"], build["width"]))
                png, bounds, percent, step = viewshed(grid, x, y, build["dx"], build["dy"])
                return self.respond(200, {"image": base64.b64encode(png).decode(),
                                          "bounds": bounds, "percent": percent, "step": step})
            except (OSError, TypeError, KeyError, ValueError) as error:
                return self.respond(400, {"error": str(error)})
        if self.path == "/api/export-elevation":
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 100000:
                    raise ValueError("Invalid elevation sample request.")
                payload = json.loads(self.rfile.read(size))
                build = data_files.active()
                if not build or not build["routeBand"] or build["key"] != payload["build"]:
                    raise ValueError("Load the matching elevation grid first.")
                width, height = build["width"], build["height"]
                points = payload["points"]
                if len(points) > 2000:
                    raise ValueError("Too many profile samples.")
                with (data_files.BUILDS / build["key"] / "elevation.f32").open("rb") as source:
                    with mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as mapped:
                        with memoryview(mapped).cast("f") as values:
                            def sample(x, y):
                                if not (0 <= x < width and 0 <= y < height):
                                    return None
                                value = values[y * width + x]
                                return round(value, 1) if isfinite(value) else None

                            side = 150
                            mesh = [sample(round(x * (width - 1) / (side - 1)), round(y * (height - 1) / (side - 1)))
                                    for y in range(side) for x in range(side)] if payload.get("mesh") else []
                            profile = [sample(x, y) for x, y in points]
                return self.respond(200, {"side": side, "mesh": mesh, "profile": profile})
            except (OSError, TypeError, KeyError, ValueError) as error:
                return self.respond(400, {"error": str(error)})
        if self.path.startswith("/api/data/"):
            try:
                origin = self.headers.get("Origin")
                if origin and urlsplit(origin).netloc != self.headers.get("Host"):
                    return self.respond(403, {"error": "Use the local dashboard to manage data."})
                length = int(self.headers.get("Content-Length", "0"))
                if self.path == "/api/data/upload":
                    name = unquote(self.headers.get("X-File-Name", ""))
                    return self.respond(201, {"id": data_files.upload(self.rfile, length, name)})
                if not 0 < length <= 65536:
                    raise ValueError("Invalid selection size.")
                payload = json.loads(self.rfile.read(length))
                if self.path == "/api/data/open-location":
                    host = self.headers.get("Host", "")
                    local_hosts = {f"{name}:{self.server.server_port}" for name in ("127.0.0.1", "localhost")}
                    if host not in local_hosts or origin != f"http://{host}" or self.headers.get_content_type() != "application/json":
                        return self.respond(403, {"error": "Open file locations from the local dashboard."})
                    path = data_files.files().get(payload["id"])
                    if path is None or not path.is_file() or not path.resolve().is_relative_to(ROOT):
                        return self.respond(404, {"error": "File no longer available. Refresh the Data files list."})
                    if os.name != "nt":
                        return self.respond(501, {"error": "Opening file locations requires Windows File Explorer."})
                    folder = str(path.parent)
                    try:
                        explorer = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "explorer.exe"
                        # Explorer expects the quoted path immediately after /select,.
                        command = subprocess.list2cmdline([str(explorer)]) + f' /select,"{path}"'
                        subprocess.Popen(command, executable=str(explorer))
                    except OSError:
                        return self.respond(503, {
                            "error": "Windows could not open File Explorer. Paste this folder path into Explorer.",
                            "folder": folder,
                        })
                    return self.respond(200, {"opened": True})
                if self.path == "/api/data/clear":
                    return self.respond(202, {"job": data_files.unload_file(payload["id"])})
                if self.path == "/api/data/move":
                    return self.respond(200, {"movedTo": data_files.clear_file(payload["id"])})
                if self.path == "/api/data/optimize":
                    return self.respond(202, {"job": data_files.start_optimization(payload["id"])})
                selection = payload["selection"]
                if self.path == "/api/data/preview":
                    return self.respond(200, data_files.preview(selection))
                if self.path == "/api/data/build":
                    return self.respond(202, {"job": data_files.start_build(selection)})
                return self.respond(404, {"error": "Unknown endpoint"})
            except Exception as error:
                return self.respond(400, {"error": str(error)})
        if self.path != "/api/route":
            return self.respond(404, {"error": "Unknown endpoint"})
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 4096:
                raise ValueError("Invalid request size.")
            payload = json.loads(self.rfile.read(length))
            start, goal, profile = payload["start"], payload["goal"], payload["profile"]
            if profile not in PROFILES or any(
                not isinstance(point, list) or len(point) != 2 or any(type(n) is not int for n in point)
                for point in (start, goal)
            ):
                raise ValueError("Provide integer grid coordinates and a valid route profile.")
            coverage = payload.get("coverage", "crop")
            if coverage not in ("crop", "full"):
                raise ValueError("Invalid DEM coverage.")
            selected = data_files.active()
            if selected:
                if payload.get("build") != selected["key"]:
                    return self.respond(409, {"error": "Atlas data changed. Reload the dashboard."})
                if not selected["routeBand"]:
                    return self.respond(422, {"error": "Not enough data available. " + " ".join(selected["reasons"])})
                with (data_files.BUILDS / selected["key"] / "elevation.f32").open("rb") as source:
                    with mmap.mmap(source.fileno(), 0, access=mmap.ACCESS_READ) as mapped:
                        with memoryview(mapped).cast("f") as values:
                            route = find_route({**selected, "elevation": values}, tuple(start), tuple(goal),
                                               profile, extended=payload.get("extended") is True,
                                               telemetry=payload.get("telemetry") is True)
                return self.respond(200, {**route, "source": selected["source"],
                                          "band": selected["routeBand"]["index"]})
            grid = full_terrain() if coverage == "full" else terrain()
            use_thermal = payload.get("useThermal") is True
            if use_thermal and coverage != "full":
                raise ValueError("Thermal routing requires full DEM coverage.")
            try:
                thermal = thermal_grid() if use_thermal else None
            except FileNotFoundError:
                return self.respond(503, {"error": "Thermal grid unavailable. Run prepare_thermal.py to generate it."})
            self.respond(200, find_route(grid, tuple(start), tuple(goal), profile,
                                         extended=coverage == "full" and payload.get("extended") is True,
                                         thermal=thermal))
        except SearchLimitReached as error:
            self.respond(422, {"error": str(error), "code": "search_limit"})
        except FileNotFoundError:
            self.respond(503, {"error": "DEM unavailable."})
        except (ValueError, TypeError, KeyError) as error:
            self.respond(400, {"error": str(error)})


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=4173)
    args = parser.parse_args()
    selected = data_files.active()
    if selected and selected.get("routeBand") and not selected.get("elevationRange"):
        data_files.activate(selected)
    print(f"ARES atlas: http://127.0.0.1:{args.port}/", flush=True)
    ThreadingHTTPServer(("127.0.0.1", args.port), Handler).serve_forever()
