const cockpit = document.createElement("section");
cockpit.className = "mission-cockpit";
cockpit.innerHTML = `
  <header><h2>Astronaut Mission Cockpit</h2><span class="eyebrow">Simulated</span></header>
  <details class="cockpit-panel" open>
    <summary>Mission Parameters</summary>
    <p>Adjust resource assumptions to update the forecast without recalculating your route.</p>
    <form class="cockpit-inputs"></form>
    <p class="cockpit-reference">The default breathing oxygen rate of 0.075 kg per astronaut per hour uses an EVA metabolic estimate at 293 W per crewmember and a respiratory quotient of 0.90. Other defaults are editable simulation assumptions.
      <a href="https://ntrs.nasa.gov/api/citations/20150002905/downloads/20150002905.pdf" target="_blank" rel="noopener">NASA Life Support Baseline Values and Assumptions, Table 4.77 ↗</a>
    </p>
    <button type="button" class="quiet cockpit-reset">Restore demo defaults</button>
  </details>
  <div class="cockpit-gauges">
    <div><span>Vehicle Battery</span><strong id="cockpit-battery"></strong><progress aria-label="Starting battery" max="100"></progress></div>
    <div><span>Suit Oxygen</span><strong id="cockpit-oxygen"></strong><progress aria-label="Starting oxygen" max="100"></progress></div>
    <div><span>Solar Input</span><strong id="cockpit-solar"></strong><span>Entered solar power</span></div>
  </div>
  <details class="cockpit-panel">
    <summary>Mission Forecast</summary>
    <div class="cockpit-results" role="status"></div>
    <details class="cockpit-method"><summary>Calculation method</summary><ul></ul></details>
  </details>
  <p class="cockpit-disclaimer">Planning simulation · no live telemetry or operational guidance.</p>`;
document.querySelector("#mission-panel .map-column").append(cockpit);

const cockpitFields = [
  ["battery", "Starting battery (%)", 82, 0, 100],
  ["capacity", "Battery capacity (kWh)", 2.5, .001],
  ["drive", "Driving use (kWh/km)", .085, 0],
  ["climb", "Climbing use (kWh/m)", .00015, 0],
  ["oxygen", "Starting oxygen (%)", 91, 0, 100],
  ["oxygenCapacity", "Oxygen capacity (kg per astronaut)", 1, .001],
  ["oxygenRate", "Oxygen use (kg/h per astronaut)", .075, 0],
  ["speed", "Travel speed (km/h)", 8, .001],
  ["science", "Science activity (hours)", .5, 0],
  ["contingency", "Contingency (hours)", .5, 0],
  ["solar", "Solar input (W)", 120, 0],
  ["efficiency", "Solar collection efficiency (%)", 70, 0, 100],
  ["reserve", "Low reserve warning (%)", 20, 0, 100]
];
const cockpitForm = cockpit.querySelector("form");
let savedCockpit = {};
try { savedCockpit = JSON.parse(localStorage.getItem("spacebyte-cockpit")) || {}; } catch {}

for (const [id, title, initial, minimum, maximum] of cockpitFields) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  label.textContent = title;
  input.name = id;
  input.type = "number";
  input.required = true;
  input.step = "any";
  input.min = minimum;
  if (maximum !== undefined) input.max = maximum;
  input.defaultValue = initial;
  if (Number.isFinite(savedCockpit[id])) {
    input.value = savedCockpit[id];
    if (!input.validity.valid) input.value = initial;
  }
  label.append(input);
  cockpitForm.append(label);
}

function forecastResources(p, route) {
  const distance = route.distanceM / 1000;
  const travel = distance / p.speed;
  const hours = travel + p.science + p.contingency;
  const batteryUsed = distance * p.drive + route.ascentM * p.climb;
  const oxygenUsed = hours * p.oxygenRate;
  return {
    distance, travel, hours, batteryUsed, oxygenUsed,
    batteryAfter: p.battery - 100 * batteryUsed / p.capacity,
    oxygenAfter: p.oxygen - 100 * oxygenUsed / p.oxygenCapacity,
    solarKwh: p.solar / 1000 * p.efficiency / 100 * hours
  };
}

function updateCockpit() {
  const results = cockpit.querySelector(".cockpit-results");
  const method = cockpit.querySelector(".cockpit-method ul");
  method.replaceChildren();
  results.replaceChildren();
  const p = Object.fromEntries(cockpitFields.map(([id]) => [id, cockpitForm.elements[id].valueAsNumber]));
  for (const [id, value, unit] of [["battery", p.battery, "%"], ["oxygen", p.oxygen, "%"], ["solar", p.solar, " W"]]) {
    const output = document.getElementById("cockpit-" + id);
    const progress = output.parentElement.querySelector("progress");
    output.textContent = Number.isFinite(value) ? value + unit : "—";
    if (progress) progress.value = Number.isFinite(value) ? value : 0;
  }
  if (!cockpitForm.checkValidity()) {
    results.textContent = "Enter valid values in Mission Parameters.";
    return;
  }
  try { localStorage.setItem("spacebyte-cockpit", JSON.stringify(p)); } catch {}
  const route = missionDemSummary;
  const f = route && forecastResources(p, route);
  const formulas = [
    "Duration = round-trip distance ÷ travel speed + science time + contingency.",
    "Battery use = distance × driving use + total ascent × climbing use.",
    "Oxygen use per astronaut = mission duration × oxygen use per hour.",
    "Solar energy = solar input ÷ 1,000 × collection efficiency × duration. Reported separately from battery charge."
  ];
  if (f) formulas.push(
    `Travel: ${f.distance.toFixed(2)} km ÷ ${p.speed} km/h = ${f.travel.toFixed(2)} h. Science time comes from the input above.`,
    `Battery: ${p.battery}% − (${f.batteryUsed.toFixed(3)} kWh ÷ ${p.capacity} kWh × 100). Oxygen: ${p.oxygen}% − (${f.oxygenUsed.toFixed(3)} kg ÷ ${p.oxygenCapacity} kg × 100).`
  );
  for (const text of formulas) {
    const item = document.createElement("li");
    item.textContent = text;
    method.append(item);
  }
  if (!f) {
    results.textContent = "Calculate a mission route to forecast resources.";
    return;
  }
  const rows = [
    ["Battery after journey", Math.max(0, f.batteryAfter).toFixed(1) + "%"],
    ["Oxygen after mission", Math.max(0, f.oxygenAfter).toFixed(1) + "%"],
    ["Solar energy harvested", f.solarKwh.toFixed(2) + " kWh"],
    ["Mission duration", f.hours.toFixed(2) + " h"]
  ];
  for (const [title, value] of rows) {
    const row = document.createElement("div");
    const metric = document.createElement("strong");
    metric.textContent = value;
    row.append(title, metric);
    results.append(row);
  }
  const warnings = [["Battery", f.batteryAfter], ["Oxygen", f.oxygenAfter]]
    .flatMap(([name, remaining]) => remaining <= 0 ? [name + " depleted"] :
      remaining < p.reserve ? [name + " below " + p.reserve + "% reserve"] : []);
  if (warnings.length) {
    const warning = document.createElement("p");
    warning.className = "cockpit-warning";
    warning.textContent = "Simulation warning: " + warnings.join(" · ");
    results.append(warning);
  }
}

cockpitForm.addEventListener("submit", event => event.preventDefault());
cockpitForm.addEventListener("input", updateCockpit);
cockpit.querySelector(".cockpit-reset").onclick = () => {
  cockpitForm.reset();
  updateCockpit();
};
new MutationObserver(updateCockpit).observe(document.getElementById("advisoryText"), {childList: true});
updateCockpit();
