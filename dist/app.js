const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const catalog=[{id:'hab',name:'Habitat Ares',type:'Start / life support',time:0,x:240,y:520,detail:'Your home away from Earth. Suit checks and life-support resupply.'},{id:'ridge',name:'Lookout ridge',type:'Terrain survey',time:15,x:340,y:410,detail:'Survey the delta approach and document exposed rock layers.'},{id:'delta',name:'Delta outcrop',type:'Sediment sampling',time:25,x:475,y:320,detail:'Ancient sediments. New possibilities.'},{id:'basalt',name:'Basalt garden',type:'Rock composition',time:20,x:590,y:390,detail:'Compare volcanic rocks with nearby sedimentary deposits.'},{id:'clay',name:'Clay-bearing basin',type:'Mineral spectroscopy',time:30,x:420,y:190,detail:'Search for mineral signatures associated with ancient water.'},{id:'rim',name:'Crater overlook',type:'Panoramic imaging',time:20,x:700,y:470,detail:'Capture a panoramic record of the crater floor.'}];
let state={ids:['hab','ridge','delta','basalt'],mode:'balanced',selected:'delta',layers:['contours','hazards']};
try{const saved=JSON.parse(localStorage.getItem('ares-plan'));if(Array.isArray(saved?.custom)) catalog.push(...saved.custom.filter(p=>/^custom-[a-f0-9-]+$/.test(p.id)));if(saved&&Array.isArray(saved.ids)&&saved.ids.every(id=>catalog.some(p=>p.id===id))&&saved.ids[0]==='hab'&&['balanced','safe','science'].includes(saved.mode)&&Array.isArray(saved.layers))state={...state,...saved}}catch{}
let zoom=1;const ns='http://www.w3.org/2000/svg';
function svg(tag,attrs){const el=document.createElementNS(ns,tag);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el}
// Deterministic illustrative contour geometry, not measured elevation.
for(let i=0;i<65;i++){let d='';for(let j=0;j<=160;j++){const a=j/160*Math.PI*2,r=35+i*9,w=Math.sin(a*5+i*.09)*15+Math.cos(a*3)*22+Math.sin(a*9)*7;const x=765+Math.cos(a)*(r+w)*1.2,y=180+Math.sin(a)*(r+w)*.8;d+=(j?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)}$('#contours').append(svg('path',{d:d+'Z',fill:'none',stroke:i%5===0?'#d7c79f':'#b9a783','stroke-opacity':i%5===0?'.31':'.16','stroke-width':i%5===0?'1.3':'.65'}))}
function save(){try{localStorage.setItem('ares-plan',JSON.stringify(state))}catch{ $('.planner-foot').textContent='Storage unavailable • export to keep your plan'}}
function stats(){const extra=state.ids.slice(4).reduce((a,id)=>a+catalog.find(p=>p.id===id).time,0),mods={balanced:[2.4,135,12,35,'High'],safe:[2.8,155,8,30,'Medium'],science:[3.1,175,16,24,'Very high']}[state.mode];return {distance:(mods[0]+Math.max(0,state.ids.length-4)*.65).toFixed(1),minutes:mods[1]+extra+Math.max(0,state.ids.length-4)*15,slope:mods[2],reserve:Math.max(8,mods[3]-Math.max(0,state.ids.length-4)*9),value:mods[4]}}
function render(){const points=state.ids.map(id=>catalog.find(p=>p.id===id));$('#waypoints').innerHTML=points.map((p,i)=>`<div class="waypoint-row"><div class="waypoint ${state.selected===p.id?'active':''}" role="button" tabindex="0" data-id="${p.id}" aria-label="Inspect ${escapeWaypointText(p.name)}"><span class="number">${i===0?'⌂':String(i).padStart(2,'0')}</span><div><strong>${escapeWaypointText(p.name)}</strong><p>${escapeWaypointText(p.type)}</p></div><span class="duration">${i===0?'BASE':p.time+' min'}</span></div>${i ? `<button type="button" class="waypoint-delete" data-delete-waypoint="${p.id}" aria-label="Delete ${escapeWaypointText(p.name)}" title="Delete waypoint"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg></button>` : ""}</div>`).join('');$('#stopCount').textContent=String(points.length).padStart(2,'0')+' STOPS';$('#pins').replaceChildren();points.forEach((p,i)=>{const g=svg('g',{class:'pin',role:'button',tabindex:0,'aria-label':p.name,'data-id':p.id,transform:`translate(${p.x} ${p.y})`});g.append(svg('circle',{r:24,fill:'#d4f394','fill-opacity':'.08'}));g.append(svg('circle',{r:13,fill:state.selected===p.id?'#d4f394':'#263322',stroke:'#d4f394','stroke-width':1.5}));const t=svg('text',{'text-anchor':'middle',y:4,fill:state.selected===p.id?'#24321b':'#d4f394','font-size':11,'font-family':'monospace'});t.textContent=i===0?'⌂':String(i).padStart(2,'0');g.append(t);const symbol=svg('g',{transform:`scale(1 ${700 / $("#terrain").viewBox.baseVal.height})`});symbol.append(...g.children);g.append(symbol);$('#pins').append(g)});let path=points.map((p,i)=>(i?'L':'M')+p.x+' '+p.y).join(' ');if(state.mode==='safe')path=points.map((p,i)=>i?`L${p.x-35} ${p.y+45}L${p.x} ${p.y}`:`M${p.x} ${p.y}`).join(' ');$('#routeLine').setAttribute('d',path);const p=catalog.find(p=>p.id===state.selected)||points[0];$('#targetCard').innerHTML=`<button type="button" class="target-close" aria-label="Close waypoint details">&times;</button><button type="button" class="target-close target-edit" style="right:34px" aria-label="Edit waypoint" title="Edit waypoint">&#x270E;</button><div class="eyebrow">${p.id==='hab'?'MISSION BASE':'SCIENCE WAYPOINT '+String(points.indexOf(p)).padStart(2,'0')}</div><h3>${escapeWaypointText(p.name)}</h3><p>${escapeWaypointText(p.detail)}</p><div><span class="dot"></span> ${p.id==='hab'?'Life support hub':'High science value'} <span>+ ${p.time} min</span></div>`;const s=stats();$('#distance').innerHTML=s.distance+' <small>km</small>';$('#duration').textContent=Math.floor(s.minutes/60)+'h '+s.minutes%60+'m';$('#value').textContent=s.value+' ↗';$('#slope').innerHTML=s.slope+' <small>°</small>';$('#advisoryTitle').textContent=s.reserve<25?'Review your reserves.':'Room to explore.';$('#advisoryText').textContent=`Illustrative model: ${s.reserve}% oxygen reserve after this traverse. ${s.reserve<25?'Consider fewer stops or a shorter route.':'Return leg to habitat included in estimate.'}`;$$('[data-mode]').forEach(b=>b.classList.toggle('selected',b.dataset.mode===state.mode));$$('[data-layer]').forEach(b=>{const active=state.layers.includes(b.dataset.layer);b.classList.toggle('active',active);b.setAttribute('aria-pressed',active);document.getElementById(b.dataset.layer).style.display=active?'':'none';document.getElementById(b.dataset.layer).removeAttribute('hidden')});$$('[data-id]').forEach(b=>{const select=()=>{state.selected=b.dataset.id;render();waypointCard.hidden=false;fitWaypointCard();save()};b.onclick=select;b.onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select()}}});save();if(typeof refreshMissionRouteDisplay==="function")refreshMissionRouteDisplay();else {$("#routeLine").setAttribute("d","");for(const id of ["distance","duration","slope"])document.getElementById(id).textContent="—";$("#advisoryTitle").textContent="Route not calculated";$("#advisoryText").textContent="Arrange your waypoints, then click Calculate route."}}
$$('[data-layer]').forEach(b=>b.onclick=()=>{const id=b.dataset.layer;state.layers=state.layers.includes(id)?state.layers.filter(x=>x!==id):[...state.layers,id];render()});$$('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;render()});
function notify(message){$('#toast').textContent=message;$('#toast').classList.add('show');setTimeout(()=>$('#toast').classList.remove('show'),3000)}
function modal(html){const dialog = $("#modal"); $("#modalContent").innerHTML = html; if (!dialog.open) dialog.showModal()}$('.close').onclick=()=>$('#modal').close();$('#modal').onclick=e=>{if(e.target===$('#modal'))$('#modal').close()};
const defaultBriefing = {
  title: "Follow the water.\nFind the story.",
  overview: "Explore an ancient delta in Jezero Crater. Your crew will survey the terrain, sample sedimentary rocks, and compare mineral signatures that could reveal the history of water on Mars.",
  objectives: [
    "Inspect science waypoints on the map.",
    "Toggle topography, hazards, minerals, and thermal layers.",
    "Compare route strategies and reserve estimates.",
    "Preview your traverse and export your mission plan."
  ].join("\n")
};
let missionBriefing = defaultBriefing;
try {
  const saved = JSON.parse(localStorage.getItem("spacebyte-briefing"));
  if (saved && Object.keys(defaultBriefing).every(key => typeof saved[key] === "string")) missionBriefing = saved;
} catch {}

function briefing() {
  const objectives = missionBriefing.objectives.split("\n").map(line => line.trim()).filter(Boolean);
  modal(`<div class="eyebrow">RedHorizon / Mission briefing</div>
    <h2 class="briefing-text">${escapeWaypointText(missionBriefing.title)}</h2>
    <p class="briefing-text">${escapeWaypointText(missionBriefing.overview)}</p>
    ${objectives.length ? `<ol>${objectives.map(line => `<li>${escapeWaypointText(line)}</li>`).join("")}</ol>` : ""}
    <p>This is an interactive concept prototype. The terrain, routes, telemetry, and reserve calculations are illustrative, not validated navigation or astronaut-safety data.</p>
    <button type="button" class="quiet" id="editBriefing">✎ Edit briefing</button>`);
  $("#editBriefing").onclick = editBriefing;
}

function editBriefing() {
  modal(`<h2>Edit mission briefing</h2>
    <form class="waypoint-editor briefing-editor">
      <label>Title <textarea name="title" rows="2" maxlength="120" required></textarea></label>
      <label>Overview <textarea name="overview" rows="4" maxlength="2000" required></textarea></label>
      <label>Objectives (one per line) <textarea name="objectives" rows="5" maxlength="2000"></textarea></label>
      <button type="submit" class="primary">Save briefing</button>
      <button type="button" class="quiet" id="cancelBriefing">Cancel</button>
    </form>`);
  const form = $(".briefing-editor");
  for (const key of Object.keys(defaultBriefing)) form.elements[key].value = missionBriefing[key];
  form.elements.title.focus();
  function showSavedBriefing() {
    briefing();
    $("#editBriefing").focus();
  }
  $("#cancelBriefing").onclick = showSavedBriefing;
  form.onsubmit = event => {
    event.preventDefault();
    const changes = Object.fromEntries([...new FormData(form)].map(([key, value]) => [key, value.trim()]));
    if (!changes.title || !changes.overview) {
      notify("Enter a title and overview.");
      return;
    }
    missionBriefing = changes;
    try {
      localStorage.setItem("spacebyte-briefing", JSON.stringify(changes));
      notify("Mission briefing saved");
    } catch {
      notify("Briefing updated for this session. Device storage is unavailable.");
    }
    showSavedBriefing();
  };
}
$('#briefing').onclick=briefing;
function showScienceTargets(focusId) {
  const row = (point, added) => `
    <li class="science-target-row">
      <div><strong>${escapeWaypointText(point.name)}</strong>
        <small>${escapeWaypointText(point.type)} · ${point.time} min</small></div>
      <button type="button" class="quiet science-target-action" data-science-id="${point.id}"
        aria-label="${added ? "Remove" : "Add"} ${escapeWaypointText(point.name)}"
        ${added ? 'title="Remove from mission"' : ''}>${added ? "&times;" : "Add"}</button>
    </li>`;
  const selected = state.ids.slice(1).map(id => catalog.find(point => point.id === id));
  const available = catalog.filter(point => !state.ids.includes(point.id));
  const content = `<h2>Science targets</h2>
    <h3>In your mission</h3>
    ${selected.length ? `<ul class="science-target-list">${selected.map(point => row(point, true)).join("")}</ul>` : "<p>No science targets added.</p>"}
    <h3>Available targets</h3>
    ${available.length ? `<ul class="science-target-list">${available.map(point => row(point, false)).join("")}</ul>` : "<p>No additional preset targets.</p>"}
    <button type="button" class="primary" id="newScienceTarget">Add custom target</button>`;
  const dialog = $("#modal");
  if (dialog.open) $("#modalContent").innerHTML = content;
  else modal(content);

  const actions = [...dialog.querySelectorAll("[data-science-id]")];
  actions.forEach(button => {
    button.onclick = () => {
      const id = button.dataset.scienceId;
      if (state.ids.includes(id)) deleteWaypoint(id);
      else {
        state.ids.push(id);
        state.selected = id;
        render();
        notify("Science target added");
      }
      showScienceTargets(id);
    };
  });
  const create = $("#newScienceTarget");
  create.onclick = () => editWaypoint(undefined, showScienceTargets);
  if (focusId) (actions.find(button => button.dataset.scienceId === focusId) || create).focus();
}
$("#add").onclick = $("#scienceNav").onclick = () => showScienceTargets();
let panX = 0;
let panY = 0;

function updateMapTransform() {
  const map = $("#map");
  const frameHeight = $("#terrain").viewBox.baseVal.height;
  const fit = Math.min(map.clientWidth / 1000, map.clientHeight / frameHeight);
  const boundX = Math.max(0, (1000 * fit * zoom - map.clientWidth) / 2);
  const boundY = Math.max(0, (frameHeight * fit * zoom - map.clientHeight) / 2);
  panX = Math.max(-boundX, Math.min(panX, boundX));
  panY = Math.max(-boundY, Math.min(panY, boundY));
  $("#mapWorld").style.transform = `translate(${fit ? panX / fit : 0}px, ${fit ? panY / fit * 700 / frameHeight : 0}px) scale(${zoom})`;
  map.classList.toggle("map-zoomed", zoom > 1);
  $("#scaleLabel").textContent = Math.round(500 / zoom) + " m";
}

function setZoom(value) {
  zoom = Math.min(3, Math.max(1, value));
  updateMapTransform();
}

$("#zoomIn").onclick = () => setZoom(zoom + .2);
$("#zoomOut").onclick = () => setZoom(zoom - .2);
$("#resetMap").onclick = () => {
  panX = panY = 0;
  setZoom(1);
};
$('#sources').onclick=()=>modal('<div class="eyebrow">DATA TRANSPARENCY</div><h2>A foundation for exploration.</h2><p>The Jezero DEM provides elevation and slope. Minerals shows published CRISM-derived classes from the western rim. Thermal inertia uses the Edwards and Buz THEMIS mosaic. Mission telemetry is simulated.</p><p>Explore primary mission resources:</p><ul><li><a href="https://mars.nasa.gov/mars2020/" target="_blank" rel="noopener">NASA Mars 2020 / Perseverance</a></li><li><a href="https://trek.nasa.gov/mars/" target="_blank" rel="noopener">NASA Mars Trek</a></li><li><a href="https://pds.nasa.gov/" target="_blank" rel="noopener">NASA Planetary Data System</a></li></ul><p>A production implementation would ingest georeferenced elevation and imagery, attach provenance and timestamps to every layer, and validate route and life-support models.</p>');
$('#export').onclick=()=>{const s=stats(),plan={project:'ARES / Field Atlas',mission:'004',region:'Jezero Crater',dataStatus:'SIMULATED — not for operational navigation',strategy:state.mode,waypoints:state.ids.map(id=>catalog.find(p=>p.id===id)),estimates:s,demRoute:typeof missionDemSummary==="undefined"?null:missionDemSummary,layers:state.layers,exportedAt:new Date().toISOString()};const url=URL.createObjectURL(new Blob([JSON.stringify(plan,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='ares-mission-004.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);notify('Mission plan exported')};
const waypointCard = document.getElementById("targetCard");
const waypointMap = document.getElementById("map");
function escapeWaypointText(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
}

function applyWaypointEdits() {
  for (const point of catalog) Object.assign(point, state.edits?.[point.id]);
}

function deleteWaypoint(id) {
  const index = state.ids.indexOf(id);
  if (index < 1) return;
  state.ids.splice(index, 1);
  if (id.startsWith("custom-")) {
    state.custom = (state.custom || []).filter(point => point.id !== id);
    const catalogIndex = catalog.findIndex(point => point.id === id);
    if (catalogIndex !== -1) catalog.splice(catalogIndex, 1);
    if (state.edits) delete state.edits[id];
  }
  state.selected = state.ids[Math.min(index, state.ids.length - 1)];
  render();
  notify("Waypoint removed");
}

function editWaypoint(id, afterSave) {
  if (!id && (typeof grid === "undefined" || !grid)) {
    notify("Wait for the Jezero terrain to load before adding a custom stop.");
    return;
  }
  const point = catalog.find(entry => entry.id === id);
  const index = state.ids.indexOf(id);
  modal(`<h2>${point ? "Edit waypoint" : "Add custom waypoint"}</h2>
    <form class="waypoint-editor">
      <label>Name <input name="name" maxlength="60" required></label>
      <label>Activity <input name="activity" maxlength="60" required></label>
      <label>Minutes <input name="minutes" type="number" min="0" max="1440" required></label>
      <p>Drag its marker on the map to change its location.</p>
      <button class="primary">Save waypoint</button>
      ${index > 1 ? '<button type="button" class="quiet" data-step="-1">Move earlier</button>' : ''}
      ${index > 0 && index < state.ids.length - 1 ? '<button type="button" class="quiet" data-step="1">Move later</button>' : ''}
      ${index > 0 ? '<button type="button" class="quiet" id="removeWaypoint">Remove stop</button>' : ''}
    </form>`);
  const editor = $(".waypoint-editor");
  editor.elements.name.value = point?.name || "";
  editor.elements.activity.value = point?.type || "Science survey";
  editor.elements.minutes.value = point?.time ?? 15;
  editor.onsubmit = event => {
    event.preventDefault();
    const name = editor.elements.name.value.trim();
    const type = editor.elements.activity.value.trim();
    if (!name || !type) return;
    const edits = {name, type, time: editor.elements.minutes.valueAsNumber};
    if (point) {
      state.edits ||= {};
      state.edits[id] = {...state.edits[id], ...edits};
      Object.assign(point, edits);
    } else {
      const anchor = catalog.find(entry => entry.id === state.selected) || catalog[0];
      const custom = {id: "custom-" + crypto.randomUUID(), ...edits, detail: "Custom mission stop.",
        x: Math.min(999, anchor.x + 25), y: anchor.y};
      catalog.push(custom);
      (state.custom ||= []).push(custom);
      state.edits ||= {}; state.edits[custom.id] = {x: custom.x, y: custom.y};
      state.ids.push(custom.id);
      state.selected = custom.id;
    }
    if (!afterSave) $("#modal").close();
    render();
    waypointCard.hidden = false;
    afterSave?.(state.selected);
  };
  editor.querySelectorAll("[data-step]").forEach(button => {
    button.onclick = () => {
      const other = index + Number(button.dataset.step);
      [state.ids[index], state.ids[other]] = [state.ids[other], state.ids[index]];
      $("#modal").close();
      render();
    };
  });
  const remove = $("#removeWaypoint");
  if (remove) remove.onclick = () => {
    $("#modal").close();
    deleteWaypoint(id);
  };
}

$("#editWaypoint").onclick = () => editWaypoint(state.selected);
$("#waypoints").addEventListener("click", event => {
  const button = event.target.closest("[data-delete-waypoint]");
  if (!button) return;
  deleteWaypoint(button.dataset.deleteWaypoint);
  document.querySelector("#waypoints .waypoint.active")?.focus({preventScroll: true});
});
$("#customWaypoint").onclick = () => editWaypoint();

let pinDrag;
waypointMap.addEventListener("pointerdown", event => {
  const pin = event.target.closest(".pin");
  if (!pin || event.button !== 0 || pinDrag || typeof grid === "undefined" || !grid) return;
  pinDrag = {pin, pointer: event.pointerId, x: event.clientX, y: event.clientY};
  pin.setPointerCapture(event.pointerId);
});
waypointMap.addEventListener("pointermove", event => {
  if (pinDrag?.pointer !== event.pointerId) return;
  if (!pinDrag.position && Math.hypot(event.clientX - pinDrag.x, event.clientY - pinDrag.y) < 4) return;
  const inverse = $("#mapWorld").getScreenCTM()?.inverse();
  if (!inverse) return;
  const {x, y} = new DOMPoint(event.clientX, event.clientY).matrixTransform(inverse);
  pinDrag.position = {x: Math.max(0, Math.min(999.99, x)), y: Math.max(0, Math.min(699.99, y))};
  pinDrag.pin.classList.add("pin-dragging");
  pinDrag.pin.setAttribute("transform", `translate(${pinDrag.position.x} ${pinDrag.position.y})`);
});
function finishPinDrag(event) {
  if (pinDrag?.pointer !== event.pointerId) return;
  const {pin, position} = pinDrag;
  pinDrag = undefined;
  pin.classList.remove("pin-dragging");
  if (!position) return;
  const id = pin.dataset.id;
  const point = catalog.find(entry => entry.id === id);
  if (event.type === "pointerup") {
    state.edits ||= {};
    state.edits[id] = {...state.edits[id], ...position};
    Object.assign(point, position);
    state.selected = id;
    waypointCard.hidden = false;
  }
  render();
}
waypointMap.addEventListener("pointerup", finishPinDrag);
waypointMap.addEventListener("pointercancel", finishPinDrag);
waypointMap.addEventListener("lostpointercapture", finishPinDrag);
let waypointDrag;

function fitWaypointCard(left = waypointCard.offsetLeft, top = waypointCard.offsetTop) {
  if (!waypointCard.offsetWidth) return;
  waypointCard.style.left = Math.max(0, Math.min(left, waypointMap.clientWidth - waypointCard.offsetWidth)) + "px";
  waypointCard.style.top = Math.max(0, Math.min(top, waypointMap.clientHeight - waypointCard.offsetHeight)) + "px";
}

waypointCard.addEventListener("click", event => {
  if (event.target.closest(".target-edit")) {
    const point = catalog.find(entry => entry.id === state.selected) || catalog[0];
    const form = document.createElement("form");
    form.className = "waypoint-editor";
    form.innerHTML = '<label>Name <input name="name" maxlength="60" required></label><label>Activity <input name="activity" maxlength="60" required></label><label>Minutes <input name="minutes" type="number" min="0" max="1440" required></label><label>Description <input name="detail" maxlength="240"></label>';
    const {name, activity, minutes, detail} = form.elements;
    name.value = point.name;
    activity.value = point.type;
    minutes.value = point.time;
    detail.value = point.detail;
    const edit = event.target.closest(".target-edit");
    edit.textContent = "💾";
    edit.title = "Save waypoint";
    edit.setAttribute("aria-label", "Save waypoint");
    edit.classList.remove("target-edit", "target-close");
    edit.classList.add("target-save");
    edit.onclick = () => form.requestSubmit();
    waypointCard.querySelector("h3").replaceWith(form);
    waypointCard.querySelector(":scope > p")?.remove();
    waypointCard.lastElementChild.hidden = true;
    form.onsubmit = submitEvent => {
      submitEvent.preventDefault();
      if (!name.value.trim() || !activity.value.trim()) return;
      const edits = {name: name.value.trim(), type: activity.value.trim(),
        time: minutes.valueAsNumber, detail: detail.value.trim()};
      state.edits ||= {};
      state.edits[point.id] = {...state.edits[point.id], ...edits};
      Object.assign(point, edits);
      render();
      fitWaypointCard();
      waypointCard.querySelector(".target-edit")?.focus();
    };
    fitWaypointCard();
    name.focus();
    name.setSelectionRange(name.value.length, name.value.length);
    return;
  }
  if (waypointCard.querySelector(".waypoint-editor") && event.target.closest(".target-close")) render();
  if (!event.target.closest(".target-close")) return;
  waypointCard.hidden = true;
  document.querySelector(`.waypoint[data-id="${state.selected}"]`)?.focus({preventScroll: true});
});

waypointCard.addEventListener("pointerdown", event => {
  if (waypointDrag || event.button !== 0 || event.target.closest("button, form")) return;
  waypointDrag = {
    id: event.pointerId,
    x: event.clientX - waypointCard.offsetLeft,
    y: event.clientY - waypointCard.offsetTop
  };
  waypointCard.setPointerCapture(event.pointerId);
});
waypointCard.addEventListener("pointermove", event => {
  if (waypointDrag?.id === event.pointerId) {
    fitWaypointCard(event.clientX - waypointDrag.x, event.clientY - waypointDrag.y);
  }
});
waypointCard.addEventListener("lostpointercapture", () => { waypointDrag = undefined; });
new ResizeObserver(() => fitWaypointCard()).observe(waypointMap);

const mapPointers = new Map();
let lastTap;

function mapGesture() {
  const [first, second] = mapPointers.values();
  if (!second) return first;
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2,
    span: Math.hypot(first.x - second.x, first.y - second.y)
  };
}

waypointMap.addEventListener("pointerdown", event => {
  if (event.button !== 0 || event.target.closest("button, .pin, .target-card")) return;
  mapPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
  waypointMap.setPointerCapture(event.pointerId);
  if (event.pointerType !== "touch") return;
  if (mapPointers.size > 1) {
    lastTap = undefined;
    return;
  }
  if (lastTap && event.timeStamp - lastTap.time < 320 &&
      Math.hypot(event.clientX - lastTap.x, event.clientY - lastTap.y) < 28) {
    setZoom(zoom + .5);
    lastTap = undefined;
  } else {
    lastTap = {time: event.timeStamp, x: event.clientX, y: event.clientY};
  }
});

waypointMap.addEventListener("pointermove", event => {
  if (!mapPointers.has(event.pointerId)) return;
  const before = mapGesture();
  mapPointers.set(event.pointerId, {x: event.clientX, y: event.clientY});
  const after = mapGesture();
  if (lastTap && Math.hypot(after.x - lastTap.x, after.y - lastTap.y) > 12) lastTap = undefined;
  if (before.span && after.span) zoom = Math.min(3, Math.max(1, zoom * after.span / before.span));
  if (zoom > 1) {
    panX += after.x - before.x;
    panY += after.y - before.y;
  }
  updateMapTransform();
});

waypointMap.addEventListener("lostpointercapture", event => mapPointers.delete(event.pointerId));
new ResizeObserver(updateMapTransform).observe(waypointMap);

const fullscreenButton = $("#fullscreenMap");
const missionFullscreenTools = document.createElement("div");
missionFullscreenTools.className = "dem-fullscreen-tools mission-fullscreen-tools";
missionFullscreenTools.hidden = true;
waypointMap.append(missionFullscreenTools);
const missionControls = [
  waypointMap.nextElementSibling,
  $("#calculateMission"),
  $("#stopMission").parentElement,
  $("#advisoryText").closest(".advisory")
];
const missionControlLocations = missionControls.map(control => {
  const placeholder = document.createComment("Mission control location");
  control.before(placeholder);
  return placeholder;
});

function syncMapFullscreen() {
  const expanded = document.fullscreenElement === waypointMap || waypointMap.classList.contains("map-expanded");
  fullscreenButton.setAttribute("aria-pressed", String(expanded));
  fullscreenButton.setAttribute("aria-label", expanded ? "Exit fullscreen map" : "Fullscreen map");
  fullscreenButton.title = expanded ? "Exit fullscreen (Esc)" : "Fullscreen map";
  if (expanded === !missionFullscreenTools.hidden) return;
  missionFullscreenTools.hidden = !expanded;
  missionControls.forEach((control, index) => {
    if (expanded) missionFullscreenTools.append(control);
    else missionControlLocations[index].after(control);
  });
}

fullscreenButton.onclick = async () => {
  if (document.fullscreenElement === waypointMap) {
    await document.exitFullscreen();
  } else if (waypointMap.classList.contains("map-expanded")) {
    waypointMap.classList.remove("map-expanded");
  } else {
    try {
      await waypointMap.requestFullscreen();
    } catch {
      waypointMap.classList.add("map-expanded");
    }
  }
  syncMapFullscreen();
};
document.addEventListener("fullscreenchange", syncMapFullscreen);
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && waypointMap.classList.contains("map-expanded")) {
    waypointMap.classList.remove("map-expanded");
    syncMapFullscreen();
    fullscreenButton.focus({preventScroll: true});
  }
});
render();
