"""Build the archived Sol 48 conditions snapshot from the MEDA ATS CSV."""
import csv
import json
from datetime import datetime
from math import acos, asin, cos, degrees, radians, sin, tan
from pathlib import Path
import sys

SOURCE = ("https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/"
          "data_calibrated_env/sol_0000_0089/sol_0048/")
MARS24 = "https://www.giss.nasa.gov/tools/mars24/help/algorithm.html"


def seconds(clock):
    hour, minute, second = map(float, clock.split(":"))
    return hour * 3600 + minute * 60 + second


def sunset_minutes():
    # Approximate the selected morning sample's epoch using the Sol 48
    # product start time plus the selected sample's local clock offset.
    epoch = datetime.fromisoformat("2021-04-08T12:04:27.892+00:00").timestamp()
    days = (epoch + seconds(observation["LMST"][6:]) * 1.0274912517 + 69.184) / 86400 - 10957.5
    anomaly = radians(19.3871 + .52402073 * days)
    perturbations = [(0.0071, 2.2353, 49.409), (.0057, 2.7543, 168.173),
                     (.0039, 1.1177, 191.837), (.0037, 15.7866, 21.736),
                     (.0021, 2.1354, 15.704), (.002, 2.4694, 95.528),
                     (.0018, 32.8493, 49.095)]
    center = sum(a * cos(radians(.985626 * days / period + phase))
                 for a, period, phase in perturbations)
    center += sum(amplitude * sin(i * anomaly) for i, amplitude in enumerate(
        (10.691 + 3e-7 * days, .623, .050, .005, .0005), 1))
    ls = radians(270.3871 + .524038496 * days + center)
    declination = asin(.42565 * sin(ls)) + radians(.25) * sin(ls)
    return round(720 + 4 * degrees(acos(-tan(radians(18.47)) * tan(declination))))


source = Path(sys.argv[1])
with source.open(newline="") as data:
    candidates = (row for row in csv.DictReader(data)
                  if row["LMST"].startswith("00048M")
                  and 130 < float(row["ATS_LOCAL_TEMP1"]) < 300)
    observation = min(candidates, key=lambda row: abs(seconds(row["LMST"][6:]) - seconds("09:42:00")))

local_time = observation["LTST"].split()[-1]
sunset = sunset_minutes()
snapshot = {
    "sol": 48, "ltst": local_time, "lmst": observation["LMST"][6:],
    "temperatureC": round(float(observation["ATS_LOCAL_TEMP1"]) - 273.15, 1),
    "temperatureSource": SOURCE + source.name,
    "windSource": "https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0000_0089/sol_0048/",
    "daylightMinutes": max(0, sunset - round(seconds(local_time) / 60)),
    "sunset": f"{sunset // 60:02}:{sunset % 60:02}",
    "daylightSource": MARS24,
}
Path(__file__).with_name("dist").joinpath("conditions.json").write_text(json.dumps(snapshot, indent=2) + "\n")
