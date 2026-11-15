function downloadMission(blob, suffix) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "spacebyte-mission-004" + suffix;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportPlan() {
  return {
    project: "SpaceByte", mission: "004", strategy: state.mode,
    source: atlasBuild?.source ?? null,
    waypoints: state.ids.map(id => ({...catalog.find(point => point.id === id)})),
    coordinateSystem: "Map coordinates normalized to a 1000 × 700 grid",
    layers: [...state.layers, ...(!document.getElementById("elevation-color")?.hasAttribute("hidden") &&
      atlasLayer("elevation-color") ? ["elevation-color"] : [])],
    route: missionDemSummary,
    exportedAt: new Date().toISOString()
  };
}

async function renderMissionSheet(plan, relief) {
  if (!atlasBuild) throw new Error("Load atlas data before exporting a map.");
  const build = atlasBuild;
  const routePoints = (plan.route?.legs || []).flatMap(leg => leg.path);
  const samples = routePoints.filter((_, index) => index % Math.max(1, Math.ceil(routePoints.length / 1000)) === 0);
  if (routePoints.length && samples.at(-1) !== routePoints.at(-1)) samples.push(routePoints.at(-1));
  const pins = plan.waypoints.map(p => [Math.floor(p.x / 1000 * build.width), Math.floor(p.y / 700 * build.height)]);
  const dem = build.routeBand ? await request("/api/export-elevation", {
    method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({build: build.key, mesh: relief, points: [...pins, ...samples]})
  }) : {mesh: [], profile: []};
  if (relief && !dem.mesh.length) throw new Error("Load an elevation grid for 3D relief.");
  const archived = await fetch("conditions.json").then(response => response.ok ? response.json() : null).catch(() => null);
  const sheet = document.createElement("canvas");
  sheet.width = 2160;
  const mapBottom = Math.max(1230, 410 + plan.waypoints.length * 65);
  sheet.height = mapBottom + 215;
  const ink = sheet.getContext("2d");
  const lime = "#d4f394";
  const panel = (x,y,w,h) => {
    ink.fillStyle = "#151c18"; ink.fillRect(x,y,w,h);
    ink.strokeStyle = "#445144"; ink.strokeRect(x,y,w,h);
  };
  const label = (text,x,y,size=20,color="#edf3e8",max=Infinity) => {
    ink.fillStyle = color; ink.font = `${size >= 24 ? "bold " : ""}${size}px sans-serif`;
    ink.fillText(text,x,y,max);
  };
  panel(0,0,sheet.width,sheet.height);
  label("SPACEBYTE  /  MARS SURFACE OPERATIONS  /  MISSION 004", 42, 49, 18, lime);
  label(relief ? "3D TOPOGRAPHIC & TRAVERSE RELIEF SHEET" : "2D SURFACE TRAVERSE & TERRAIN MAP",42,99,40);
  panel(42,125,1520,mapBottom-125);
  panel(1584,125,534,mapBottom-125);
  for(let x=65;x<1562;x+=54) paintLine([[x,126],[x,mapBottom]],"#26332b",1);
  for(let y=140;y<mapBottom;y+=54) paintLine([[43,y],[1561,y]],"#26332b",1);

  function paintLine(points,color,width) {
    if (!points.length) return;
    ink.beginPath();
    points.forEach(([x,y],i) => i ? ink.lineTo(x,y) : ink.moveTo(x,y));
    ink.strokeStyle=color; ink.lineWidth=width; ink.stroke();
  }

  const range = build.elevationRange || [];
  const normalize = z => Math.max(0, Math.min(1, ((z ?? range[0])-range[0])/Math.max(1,range[1]-range[0])));
  const colors = [[34,57,76],[57,111,115],[145,161,119],[199,160,108],[245,224,179]];
  const fit = Math.min(1430/build.width, 985/build.height);
  const w = build.width*fit, h = build.height*fit, left = 802-w/2, top=160;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 512;
  const tileInk = tile.getContext("2d");
  const urls = [build.base];
  if (plan.layers.includes("elevation-color") || relief) urls.push(atlasLayer("elevation-color"));
  for(const layer of plan.layers) urls.push(atlasLayer(layer));
  for(const src of new Set(urls.filter(Boolean))) {
    const image = new Image(); image.src = src; await image.decode();
    const extent = build.layers.find(layer => layer.url === src)?.extent;
    if (extent) {
      const [x, y, width, height] = extent;
      tileInk.drawImage(image, x / build.width * 512, y / build.height * 512,
        width / build.width * 512, height / build.height * 512);
    } else tileInk.drawImage(image, 0, 0, 512, 512);
  }
  const texture = tileInk.getImageData(0,0,512,512).data;
  const project = (x,y,z) => relief
    ? [802+(x-y)*680, 215+(x+y)*393-normalize(z)*155]
    : [left+x*w,top+y*h];
  if (relief) {
    const n=dem.side-1;
    for(let diagonal=0;diagonal<2*n-1;diagonal++) {
      for(let y=Math.max(0,diagonal-n+1);y<=Math.min(n-1,diagonal);y++) {
        const x=diagonal-y, i=y*dem.side+x;
        const z=[dem.mesh[i],dem.mesh[i+1],dem.mesh[i+dem.side+1],dem.mesh[i+dem.side]];
        if(z.some(value=>value===null)) continue;
        const tex=(Math.round(y/n*511)*512+Math.round(x/n*511))*4;
        const vertices=[[x,y],[x+1,y],[x+1,y+1],[x,y+1]].map(([a,b],j)=>project(a/n,b/n,z[j]));
        ink.beginPath();
        vertices.forEach(([a,b],j)=>j ? ink.lineTo(a,b) : ink.moveTo(a,b));
        ink.closePath();
        ink.fillStyle=`rgb(${texture[tex]},${texture[tex+1]},${texture[tex+2]})`;
        ink.fill(); ink.strokeStyle=ink.fillStyle; ink.lineWidth=.75; ink.stroke();
      }
    }
  } else {
    ink.imageSmoothingEnabled=true;
    // Draw the source rasters at sheet resolution rather than enlarging the mesh texture.
    for(const src of new Set(urls.filter(Boolean))) {
      const image=new Image(); image.src=src; await image.decode();
      ink.drawImage(image,left,top,w,h);
    }
    for(let i=1;i<8;i++) {
      paintLine([[left+i*w/8,top],[left+i*w/8,top+h]],"#ffffff30",1);
      paintLine([[left,top+i*h/8],[left+w,top+i*h/8]],"#ffffff30",1);
    }
    if(build.dx) {
      const km=10**Math.floor(Math.log10(build.width*build.dx/4000));
      paintLine([[left,top+h+17],[left+km*1000/build.dx/build.width*w,top+h+17]],lime,4);
      label(km+" km",left,top+h+41,18,lime);
    }
  }
  label(relief ? "↖ N" : "↑ N",1460,176,25,lime);
  if(range.length && (relief || plan.layers.includes("elevation-color"))) {
    panel(58,147,270,91);
    label("ELEVATION (m)",73,172,17,lime);
    const ramp=ink.createLinearGradient(73,0,310,0);
    colors.forEach((color,i)=>ramp.addColorStop(i/4,`rgb(${color.join(",")})`));
    ink.fillStyle=ramp; ink.fillRect(73,185,237,12);
    label(Math.round(range[0])+" m",73,221,16);
    label(Math.round(range[1])+" m",242,221,16);
  }
  const routeZ=dem.profile.slice(pins.length);
  let segment=[];
  const segments=[];
  samples.forEach(([x,y],i)=>{
    if (relief && routeZ[i] == null) {
      if(segment.length) segments.push(segment);
      segment=[]; return;
    }
    segment.push(project((x+.5)/build.width,(y+.5)/build.height,routeZ[i]));
  });
  if(segment.length) segments.push(segment);
  for(const points of segments) { paintLine(points,"#102018",9); paintLine(points,lime,4); }
  for(let i=0;i<pins.length;i++) {
    const [x,y]=pins[i], z=dem.profile[i];
    if(relief && z==null) continue;
    const [a,b]=project((x+.5)/build.width,(y+.5)/build.height,z);
    ink.beginPath(); ink.arc(a,b,14,0,Math.PI*2); ink.fillStyle=lime; ink.fill();
    label(String(i).padStart(2,"0"),a-9,b+5,14,"#152016");
    panel(Math.min(a+18,1295),b-33,244,27);
    label(plan.waypoints[i].name,Math.min(a+25,1302),b-14,17,"#edf3e8",223);
  }
  if(relief) {
    const y=mapBottom-151;
    panel(58,y,1488,134);
    label("TRAVERSE ELEVATION PROFILE",74,y+26,17,lime);
    const valid=routeZ.filter(Number.isFinite);
    if(valid.length) {
      const min=Math.min(...valid), max=Math.max(...valid);
      const lengths=[0];
      for(let i=1;i<samples.length;i++) lengths.push(lengths.at(-1)+Math.hypot(
        (samples[i][0]-samples[i-1][0])*build.dx,(samples[i][1]-samples[i-1][1])*build.dy));
      paintLine(routeZ.flatMap((z,i)=>z==null?[]:[[180+lengths[i]/Math.max(1,lengths.at(-1))*1340,
        y+103-(z-min)/Math.max(1,max-min)*60]]),lime,2);
      label(Math.round(max)+" m",74,y+50,15); label(Math.round(min)+" m",74,y+105,15);
      label("0 km",180,y+124,14); label((plan.route.distanceM/1000).toFixed(1)+" km",1440,y+124,14);
    } else label("Calculate the mission route to include an elevation profile.",74,y+75);
  }
  label("TRAVERSE PARAMETERS",1610,166,19,lime);
  const route=plan.route, estimate=route?.estimate;
  const minutes=Math.round(estimate?.durationMinutes || 0);
  const metrics=[
    ["DISTANCE",route ? (route.distanceM/1000).toFixed(2)+" km" : "—"],
    ["MAX. SLOPE",route ? route.maxSlopeDeg+"°" : "—"],
    ["EST. DURATION",estimate ? `${Math.floor(minutes/60)}h ${minutes%60}m` : "—"],
    ["TOTAL ASCENT",route ? route.ascentM+" m" : "—"],
    ["EST. O₂ / PERSON",estimate ? "≈ "+estimate.oxygenKgPerPerson.toFixed(2)+" kg" : "—"],
    ["PROFILE",plan.strategy]
  ];
  metrics.forEach(([key,value],i)=>{
    const x=1610+(i%2)*245,y=207+Math.floor(i/2)*62;
    label(key,x,y,14,"#a8b8a9"); label(value,x,y+27,23);
  });
  label("WAYPOINT MANIFEST",1610,416,19,lime);
  plan.waypoints.forEach((point,i)=>{
    const y=434+i*63;
    panel(1608,y,486,54);
    label(String(i).padStart(2,"0")+"  "+point.name,1622,y+23,21,"#edf3e8",450);
    label(point.type+" · "+point.time+" min",1622,y+44,16,"#a8b8a9",450);
  });
  panel(42,mapBottom+20,2076,150);
  label("ARCHIVED SURFACE CONDITIONS",65,mapBottom+53,18,lime);
  label(archived ? `Sol ${archived.sol} · ${archived.ltst} LTST · Air ${archived.temperatureC} °C · Calculated sunset ${archived.sunset} LTST` : "Archive unavailable",65,mapBottom+83);
  label("Wind and local radiation dose unavailable · Layers: "+(plan.layers.join(", ") || "base terrain"),65,mapBottom+112,17,"#a8b8a9",1350);
  label("SOURCE: "+plan.source,65,mapBottom+142,16,"#a8b8a9",1350);
  label(relief ? "ISOMETRIC DEM RELIEF" : "NORTH-UP DEM GRID",1515,mapBottom+58,21,lime);
  label(plan.exportedAt,1515,mapBottom+88,17);
  label("Simulation planning sheet",1515,mapBottom+119,17,"#a8b8a9");
  const blob = await new Promise(resolve => sheet.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("Could not generate the map image.");
  return blob;
}
document.getElementById("export").onclick = () => {
  modal(`<div class="eyebrow">SPACEBYTE / MISSION 004 EXPORT</div>
    <h2>Select Map Projection</h2>
    <p>Choose a map sheet or download the mission data.</p>
    <button class="choice" data-export="2d"><strong>2D Cartographic Orbital Map (PNG)</strong><br>Top-down map with waypoints, route, scale and mission manifest.</button>
    <button class="choice" data-export="relief"><strong>Oblique Terrain Relief (PNG)</strong><br>Angled view with DEM elevation colors and shaded relief.</button>
    <button class="choice" data-export="json"><strong>Raw Telemetry Data (JSON)</strong><br>Mission waypoints, active layers and calculated route metrics.</button>
    <p id="export-status" role="status"></p>`);
  const buttons = [...document.querySelectorAll("#modalContent [data-export]")];
  buttons.forEach(button => button.onclick = async () => {
    const status = document.getElementById("export-status");
    buttons.forEach(item => item.disabled = true);
    status.textContent = "Preparing download…";
    try {
      const plan = exportPlan();
      const format = button.dataset.export;
      if (format === "json") downloadMission(new Blob([JSON.stringify(plan, null, 2)], {type: "application/json"}), ".json");
      else downloadMission(await renderMissionSheet(plan, format === "relief"), "-" + format + ".png");
      status.textContent = "Download ready.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      buttons.forEach(item => item.disabled = false);
    }
  });
};
