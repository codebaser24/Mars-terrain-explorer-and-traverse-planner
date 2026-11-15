const dataTab = document.getElementById("files-view");
const dataPanel = document.getElementById("files-panel");
const selectedFiles = new Set();
let activeData, inventoryRows = [], previewVersion = 0, busyData = false;
const dataStatus = dataPanel.querySelector("[role=status]");
const loadFiles = document.getElementById("load-files");

async function optimizeFile(row, button) {
  if (busyData) return;
  const scale = Math.min(1, Math.sqrt(20_000_000 / (row.width * row.height)), 8192 / Math.max(row.width, row.height));
  const width = Math.max(1, Math.floor(row.width * scale));
  const height = Math.max(1, Math.floor(row.height * scale));
  const pixel = row.pixel ? ` New pixel size: ${(row.pixel[0] * row.width / width).toFixed(1)} × ${(row.pixel[1] * row.height / height).toFixed(1)} m.` : "";
  if (!window.confirm(`Optimize ${row.name} from ${row.width} × ${row.height} to ${width} × ${height} pixels?${pixel} The optimized file will replace this entry. The original will be moved to data/cleared for recovery.`)) return;
  busyData = true;
  button.disabled = loadFiles.disabled = true;
  button.textContent = "0%";
  try {
    const response = await fetch("/api/data/optimize", {
      method: "POST", headers: {"Content-Type": "application/json"}, body: JSON.stringify({id: row.id})
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    while (true) {
      const job = await dataRequest("/job/" + data.job);
      button.textContent = `${job.percent || 0}%`;
      dataStatus.textContent = job.step;
      if (job.status === "error") throw new Error(job.step);
      if (job.status === "done") {
        selectedFiles.delete(row.id);
        selectedFiles.add(job.file);
        dataStatus.textContent = `Selected ${job.file}. Original backed up at ${job.backup}. Click Load selected files to use the replacement.`;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  } catch (error) {
    dataStatus.textContent = error.message;
  } finally {
    busyData = false;
    await refreshData();
  }
}

async function dataRequest(path, selection) {
  const response = await fetch("/api/data" + path, selection ? {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({selection: [...selection]})
  } : {});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error);
  return body;
}

function dataTable(target, rows) {
  target.replaceChildren();
  rows.forEach(values => {
    const row = target.insertRow();
    values.forEach(value => {
      const cell = row.insertCell();
      if (value instanceof Node) cell.append(value);
      else cell.textContent = value;
    });
  });
}

const pixels = row => row.pixel ? [...new Set(row.pixel.map(value => Number(value.toFixed(2))))].join(" × ") + " m" : "—";
const footprintColors = ["#d4f394", "#69b7ff", "#efad74", "#c5a2ff"];
const footprintColor = (row, index) => row.role === "Reference grid" ? "#69b7ff" : footprintColors[index % footprintColors.length];

function dataText(tag, value, className = "") {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = value;
  return node;
}

function drawFootprints(plan) {
  const diagram = document.getElementById("alignment-diagram");
  diagram.replaceChildren();
  const rows = plan.files.filter(row => row.footprint);
  if (!rows.length) return;
  const left = Math.min(...rows.map(row => row.footprint[0]));
  const bottom = Math.min(...rows.map(row => row.footprint[1]));
  const right = Math.max(...rows.map(row => row.footprint[2]));
  const top = Math.max(...rows.map(row => row.footprint[3]));
  const padding = Math.max(right-left, top-bottom) * .04;
  diagram.setAttribute("viewBox", `${-padding} ${-padding} ${right-left+2*padding} ${top-bottom+2*padding}`);
  rows.forEach((row, index) => {
    const [x,y,east,north] = row.footprint;
    const reference = row.role === "Reference grid";
    const rect = svg("rect", {x:x-left,y:top-north,width:east-x,height:north-y,
      fill:footprintColor(row, plan.files.indexOf(row)), "fill-opacity":".14",
      stroke:footprintColor(row, plan.files.indexOf(row)), "stroke-width":"1.5", "vector-effect":"non-scaling-stroke"});
    const title = svg("title", {});
    title.textContent = row.id;
    rect.append(title);
    diagram.append(rect);
    if (reference) {
      const outline = rect.cloneNode(false);
      outline.setAttribute("fill", "none");
      outline.setAttribute("stroke", "white");
      outline.setAttribute("stroke-dasharray", "5 4");
      diagram.append(outline);
    }
  });
}

async function updateAlignment() {
  const version = ++previewVersion;
  loadFiles.disabled = true;
  try {
    const plan = await dataRequest("/preview", selectedFiles);
    if (version !== previewVersion) return;
    dataTable(document.getElementById("alignment-rows"), plan.files.map((row, index) => {
      const label = dataText("strong", row.id, "footprint-file");
      const swatch = dataText("span", "", "footprint-swatch");
      swatch.style.backgroundColor = footprintColor(row, index);
      label.prepend(swatch);
      return [
      label, dataText("span", row.reason ? `${row.role} · ${row.reason}` : row.role,
        row.role === "Reference grid" ? "data-chip reference-role" : "data-chip alignment-role"),
      row.role === "Not loaded" ? pixels(row) : `${pixels(row)} → ${pixels(plan.reference)}`,
      row.role === "Not loaded" ? "—" : `${row.overlap}% of grid · ${row.fileOverlap}% of file`
    ]; }));
    drawFootprints(plan);
    document.getElementById("reference-summary").textContent = plan.reference
      ? `Reference grid: ${plan.reference.id} (${plan.reference.width} × ${plan.reference.height} px, ${pixels(plan.reference)} pixels). Files are aligned using their geographic coordinates.`
      : "Select files to preview their alignment.";
    document.getElementById("alignment-note").textContent = plan.reasons.length
      ? "Not enough data available for routing. " + plan.reasons.join(" ")
      : plan.routeBand.assumedMetres ? "Elevation units are unspecified. Metres are assumed." : "";
    const same = JSON.stringify([...selectedFiles].sort()) === JSON.stringify(activeData?.selection);
    if (!busyData) document.getElementById("load-note").textContent = same ? "This selection is already loaded." : "";
    const oversized = plan.reference && plan.reference.width * plan.reference.height > 100_000_000;
    if (oversized && !busyData) document.getElementById("load-note").textContent = "Optimize the reference GeoTIFF before loading.";
    loadFiles.disabled = busyData || !plan.reference || same || oversized;
  } catch (error) {
    if (version === previewVersion) dataStatus.textContent = error.message;
  }
}

async function refreshData() {
  try {
    const data = await dataRequest("");
    activeData = data.active;
    inventoryRows = data.files;
    document.getElementById("file-count").textContent = `${inventoryRows.length} ${inventoryRows.length === 1 ? "file" : "files"} found`;
    for (const id of selectedFiles) {
      if (!inventoryRows.some(row => row.id === id && ["Ready", "Loaded"].includes(row.status))) selectedFiles.delete(id);
    }
    if (!selectedFiles.size && !dataPanel.dataset.initialized) {
      activeData?.selection.forEach(id => selectedFiles.add(id));
    }
    dataPanel.dataset.initialized = "true";
    dataTable(document.getElementById("inventory-rows"), inventoryRows.map(row => {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.setAttribute("aria-label", row.id);
      check.disabled = busyData || !["Ready", "Loaded"].includes(row.status);
      if (!["Ready", "Loaded"].includes(row.status)) selectedFiles.delete(row.id);
      check.checked = selectedFiles.has(row.id);
      check.onchange = () => {
        if (check.checked) selectedFiles.add(row.id);
        else selectedFiles.delete(row.id);
        updateAlignment();
      };
      const chips = document.createElement("div");
      for (const kind of new Set(row.bands.map(band => band.kind))) {
        const chip = document.createElement("span");
        chip.className = "data-chip chip-" + kind;
        chip.textContent = kind;
        chips.append(chip);
      }
      const file = document.createElement("div");
      file.append(dataText("strong", row.name, check.disabled && !busyData ? "file-muted" : ""),
        dataText("small", `${row.folder} · ${(row.size / 1000000).toFixed(1)} MB`, "file-meta"));
      const location = dataText("button", "", "quiet file-location");
      location.type = "button";
      location.title = "Open file location";
      location.setAttribute("aria-label", "Open file location for " + row.name);
      location.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="M3 19V6a1 1 0 0 1 1-1h5l3 3h8a1 1 0 0 1 1 1v2M3 19h17l2-8H6z" stroke-linecap="round" stroke-linejoin="round"/></svg>';
      location.onclick = async () => {
        location.disabled = true;
        dataStatus.textContent = "";
        try {
          const response = await fetch("/api/data/open-location", {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({id: row.id})
          });
          if (!response.ok) {
            const body = await response.json();
            throw new Error(body.folder ? `${body.error} ${body.folder}` : body.error || "Could not open File Explorer.");
          }
        } catch (error) {
          dataStatus.textContent = error.message;
        } finally {
          location.disabled = false;
        }
      };
      file.className = "file-location-row";
      const nameAndFolder = document.createElement("div");
      nameAndFolder.append(...file.children);
      file.append(location, nameAndFolder);
      const status = dataText("span", row.status, row.status === "Loaded" ? "file-loaded" :
        row.status === "Ready" ? "" : "file-error");
      const clear = dataText("button", "Clear", "quiet");
      clear.type = "button";
      clear.disabled = busyData || row.status !== "Loaded";
      clear.setAttribute("aria-label", "Unload " + row.name);
      const move = dataText("button", "×", "quiet");
      move.type = "button";
      move.disabled = busyData;
      move.title = "Move to data/cleared";
      move.setAttribute("aria-label", "Move " + row.name + " to cleared folder");
      async function perform(action) {
        if (busyData) return;
        busyData = true;
        clear.disabled = move.disabled = true;
        loadFiles.disabled = true;
        if (action === "clear") clear.textContent = "0%";
        try {
          const response = await fetch("/api/data/" + action, {
            method: "POST", headers: {"Content-Type": "application/json"},
            body: JSON.stringify({id: row.id})
          });
          const body = await response.json();
          if (!response.ok) throw new Error(body.error);
          selectedFiles.delete(row.id);
          if (body.job) {
            await finishDataBuild(body.job, clear);
            return;
          }
          dataStatus.textContent = `Moved to ${body.movedTo}.` +
            (row.status === "Loaded" ? " Load a new selection to update the current map build." : "");
        } catch (error) {
          dataStatus.textContent = error.message;
        } finally {
          busyData = false;
          await refreshData();
        }
      }
      clear.onclick = () => perform("clear");
      move.onclick = () => {
        if (window.confirm(`Move ${row.name} to data/cleared? You can recover it from that folder.`)) perform("move");
      };
      const actions = dataText("div", "", "waypoint-actions");
      actions.append(clear, move);
      if (row.width * row.height > 100_000_000 && ["Ready", "Loaded"].includes(row.status)) {
        const warning = dataText("span", "⚠ Oversized", "file-error");
        warning.title = "This raster exceeds the atlas grid limit";
        status.append(document.createElement("br"), warning);
        const optimize = dataText("button", "Optimize", "quiet");
        optimize.type = "button";
        optimize.disabled = busyData;
        optimize.onclick = () => optimizeFile(row, optimize);
        actions.prepend(optimize);
      }
      return [check, file, chips, row.width ? `${row.width} × ${row.height}` : "—", pixels(row), status, actions];
    }));
    const loaded = document.getElementById("loaded-data");
    loaded.replaceChildren();
    for (const row of activeData?.files || []) {
      const li = document.createElement("li");
      li.append(dataText("strong", row.id), document.createTextNode(" — " +
        (row.role === "Reference grid" ? "Reference grid: kept at its own pixels" :
          `Reprojected onto the reference grid · outline covers ${row.overlap}% of the grid`)));
      for (const band of row.bands) {
        const routing = activeData.routeBand?.file === row.id && activeData.routeBand.index === band.index;
        li.append(dataText("div", `${band.kind[0].toUpperCase() + band.kind.slice(1)} · ${routing
          ? "used for route calculations" + (activeData.routeBand.assumedMetres ? " (metres assumed)" : "")
          : "shown only, not used in route calculations"}`, routing ? "file-loaded loaded-band" : "loaded-band"));
      }
      loaded.append(li);
    }
    if (!activeData) loaded.textContent = "No custom selection loaded.";
    await updateAlignment();
  } catch (error) {
    dataStatus.textContent = error.message;
  }
}

document.getElementById("refresh-files").onclick = refreshData;
document.getElementById("browse-files").onchange = async event => {
  busyData = true;
  loadFiles.disabled = true;
  const errors = [];
  for (const file of event.target.files) {
    try {
      if (!/\.tiff?$/i.test(file.name) || file.size > 4 * 1024**3) throw new Error("Choose a GeoTIFF up to 4 GB");
      const id = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", "/api/data/upload");
        xhr.responseType = "json";
        xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
        xhr.upload.onprogress = e => dataStatus.textContent = e.lengthComputable
          ? `Copying ${file.name} · ${Math.floor(e.loaded/e.total*100)}%` : `Copying ${file.name}`;
        xhr.upload.onload = () => dataStatus.textContent = `Verifying ${file.name}…`;
        xhr.onload = () => xhr.status === 201 ? resolve(xhr.response.id) : reject(new Error(xhr.response?.error || "Upload failed"));
        xhr.onerror = () => reject(new Error("Upload connection failed"));
        xhr.send(file);
      });
      selectedFiles.add(id);
    } catch (error) {
      errors.push(`${file.name}: ${error.message}`);
    }
  }
  event.target.value = "";
  busyData = false;
  dataStatus.textContent = errors.join(" · ") || "GeoTIFFs copied and selected.";
  await refreshData();
};

async function finishDataBuild(job, clearButton = null) {
    while (true) {
      const progress = await dataRequest("/job/" + job);
      dataStatus.textContent = progress.step;
      const note = clearButton || document.getElementById("load-note");
      const percent = progress.status === "done" ? 100 : progress.percent ?? 0;
      note.textContent = clearButton ? `${percent}%` :
        progress.status === "done" ? "100%" : `${percent}% · ${progress.step}`;
      if (progress.status === "done") {
        await new Promise(resolve => setTimeout(resolve, 650));
        note.textContent = clearButton ? "Clear" : "";
        history.replaceState(null, "", "#files-panel");
        location.reload();
        return;
      }
      if (progress.status === "error") {
        note.textContent = clearButton ? "Clear" : "";
        throw new Error(progress.step);
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
}

loadFiles.onclick = async () => {
  busyData = true;
  loadFiles.disabled = true;
  document.getElementById("load-note").textContent = "0% · Starting build";
  try {
    const {job} = await dataRequest("/build", selectedFiles);
    await finishDataBuild(job);
  } catch (error) {
    dataStatus.textContent = error.message;
    busyData = false;
    updateAlignment();
  }
};
