async function showArchivedConditions() {
  const stamp = document.getElementById("conditions-stamp");
  try {
    const response = await fetch("conditions.json");
    if (!response.ok) throw new Error("Snapshot unavailable");
    const data = await response.json();
    stamp.textContent = `Archived · Sol ${String(data.sol).padStart(3, "0")} · ${data.ltst} LTST`;
    document.getElementById("archived-temp").textContent = `${data.temperatureC} °C`;
    const ats = document.getElementById("ats-source");
    ats.href = data.temperatureSource;
    ats.title = `Calibrated sensor 1 reading at ${data.lmst} LMST`;
    document.getElementById("archived-daylight").textContent =
      `${Math.floor(data.daylightMinutes / 60)}h ${data.daylightMinutes % 60}m`;
    const daylight = document.getElementById("daylight-source");
    daylight.href = data.daylightSource;
    daylight.textContent = `Calculated sunset ${data.sunset} LTST`;
    daylight.title = "Flat-horizon estimate at 18.47° N, expressed in local Mars hours";
  } catch {
    stamp.textContent = "Archived conditions unavailable";
  }
}

showArchivedConditions();
