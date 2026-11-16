# ARES / Field Atlas

ARES is an educational Mars traverse planner for Jezero Crater. Load a georeferenced elevation raster, explore terrain and slope hazards, and compare routes between science waypoints. The project combines a browser dashboard with a local Python backend.

## Run locally

You need Python 3.11 or newer and a modern browser. From the project folder, run:

```sh
python -m venv .venv
```

Activate the environment on Windows PowerShell:

```powershell
.\.venv\Scripts\Activate.ps1
```

On macOS or Linux, run `source .venv/bin/activate`. Then install the dependencies and start the server:

```sh
python -m pip install -r requirements.txt
python server.py
```

Open [http://127.0.0.1:4173/](http://127.0.0.1:4173/). If that port is in use, run `python server.py --port 4174` and open the address printed in the terminal. The dashboard and its API are served together. The full app needs the Python backend.

## Try a Jezero traverse

1. Download the required elevation GeoTIFF from [Jezero data downloads](#jezero-data-downloads). Add the optional mineral and thermal layers if you want to explore them.
2. Open **Data files**, select the GeoTIFFs you want to use, and load them into the atlas. Wait for the build to finish. The app caches the processed terrain under `builds/`.
3. In **DEM routing**, choose a start and destination on the map or enter raster column and row coordinates. Run the route to see distance, ascent, and maximum slope.
4. In **Mission simulation**, edit science stops, calculate the traverse, and preview or export the mission.

Raster preparation scripts at the project root regenerate the bundled Jezero previews and archived conditions. The dashboard's GeoTIFF workflow builds the routing grid directly.

### Jezero data downloads

Save the GeoTIFFs in `data/` at the project root using the filenames below. You can also add the GeoTIFFs through the **Data files** tab.

| File in `data/` | Direct download | Instructions |
| --- | --- | --- |
| `M20_JezeroCrater_CTXDEM_20m.tif` | [Download the USGS elevation GeoTIFF](https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/mars2020_trn/CTX/ScienceInvestigationMaps_JPL/M20_JezeroCrater_CTXDEM_20m.tif) | Required for the Jezero routing demo. Keep the original filename (about 90 MB). |
| `jezero-crism-minerals.tif` | [Download the Zenodo CRISM archive](https://zenodo.org/records/22257754/files/jezero_rim_maps_v1_core.zip?download=1) | Optional. Extract `jezero_rim_maps_v1/01_geologic_map/geologic_map_CRISM_only.tif` and rename it to `jezero-crism-minerals.tif`. |
| `jezero-thermal-source.tif` | [Download the Edwards and Buz THEMIS GeoTIFF](https://zenodo.org/records/4931348/files/Jezero_Thermal_Inertia_v1.tiff?download=1) | Optional. Rename `Jezero_Thermal_Inertia_v1.tiff` to `jezero-thermal-source.tif`. |
<img width="2357" height="1377" alt="image" src="https://github.com/user-attachments/assets/1c51ddc5-a8a8-4c1e-94e8-47df4eda5704" />


## How it works

- The browser interface uses HTML, CSS, and JavaScript with no frontend build step.
- Rasterio and NumPy inspect GeoTIFFs, align compatible layers to a reference grid, and generate visual overlays.
- The route engine uses A* over eight neighboring cells, with elevation-derived slope limits and profile-specific costs. It avoids missing elevation cells.
- The elevation band selected during import controls route costs. Alignment preview uses raster bounding boxes to estimate overlap.

For your own data, use a north-up projected elevation GeoTIFF with linear units. If the band metadata is ambiguous, place a sidecar next to the raster. For example, name the following file `example.tif.layers.json` for `example.tif`:

```json
{
  "bands": {
    "1": {"kind": "elevation", "units": "m"},
    "2": {"kind": "mineral"}
  }
}
```

## Data and limitations

- The bundled Jezero terrain preview is derived from the [USGS Mars 2020 Science Investigation CTX DEM Mosaic](https://astrogeology.usgs.gov/search/map/mars_2020_science_investigation_ctx_dem_mosaic), with 20 m elevation samples.
- The bundled overlays include CRISM-derived mineral classes and thermal inertia from the [Edwards and Buz THEMIS mosaic](https://experts.nau.edu/en/datasets/themis-derived-thermal-inertia-of-jezero-crater-mars/).
- The surface conditions panel uses [archived Perseverance MEDA observations](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/) and a daylight estimate based on the [NASA Mars24 algorithm](https://www.giss.nasa.gov/tools/mars24/help/algorithm.html).
- Mission playback and life-support estimates are illustrative. The terrain model cannot resolve obstacles smaller than its raster cells.

## Team

- **Vindeepa** — Project lead and co-developer
- **Gihan** — Co-developer
- **Vishmi** — Co-developer
- **Lahiru** — Co-developer
- **Nethsara** — Co-developer
- **Wasitha** — Co-developer
