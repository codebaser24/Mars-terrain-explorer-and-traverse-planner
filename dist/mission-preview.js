(() => {
  const map = document.getElementById("map");
  const world = document.getElementById("mapWorld");
  const routeLine = document.getElementById("routeLine");
  const startButton = document.getElementById("start");
  const panel = document.createElement("section");
  panel.className = "mission-playback";
  panel.hidden = true;
  panel.setAttribute("aria-label", "Mission playback");
  panel.innerHTML = `
    <div class="playback-toolbar">
      <strong>EVA-01 · Crew telemetry</strong>
      <span class="playback-leg"></span>
      <span class="playback-key"><i></i> Completed <i></i> Remaining</span>
      <button type="button" class="quiet" data-action="voice" aria-pressed="true">Voice on</button>
      <button type="button" class="primary" data-action="play">▶ Play</button>
      <button type="button" class="quiet" data-action="speed" aria-label="Playback speed">1×</button>
      <button type="button" class="quiet playback-close" data-action="end" aria-label="Close mission playback" title="Close mission playback">&times;</button>
    </div>
    <dl class="playback-metrics"></dl>
    <div class="playback-progress"><progress aria-label="Mission progress" max="100" value="0"></progress><span>0%</span></div>
    <p class="playback-complete" role="status" hidden></p>`;
  map.after(panel);
  const marker = document.createElement("div");
  marker.className = "playback-marker";
  marker.hidden = true;
  marker.setAttribute("aria-hidden", "true");
  marker.innerHTML = '<div class="playback-astronaut"><b class="suit-pack"></b><b class="suit-arm"></b><b class="suit-leg"></b><b class="suit-leg"></b><b class="suit-body"></b><b class="suit-helmet"></b></div><span></span>';
  map.append(marker);
  const caption = marker.querySelector("span");
  const layer = svg("g", {"aria-hidden": "true", "pointer-events": "none"});
  routeLine.after(layer);

  const button = action => panel.querySelector(`[data-action="${action}"]`);
  const metrics = panel.querySelector("dl");
  const bar = panel.querySelector("progress");
  const completion = panel.querySelector(".playback-complete");
  const legLabel = panel.querySelector(".playback-leg");
  const metricValues = ["DEM grid X / Y", "Elevation", "Terrain slope", "Cumulative ascent", "Leg distance"].map(label => {
    const group = document.createElement("div");
    const term = document.createElement("dt");
    const value = document.createElement("dd");
    term.textContent = label;
    group.append(term, value);
    metrics.append(group);
    return value;
  });
  const speech = window.speechSynthesis;
  const voiceButton = button("voice");
  voiceButton.disabled = !speech;
  if (!speech) voiceButton.textContent = "Voice unavailable";
  let voiceEnabled = Boolean(speech);
  let utterance;
  let run;
  let frame;
  const speeds = [1, 2, 4];
  let speedIndex = 0;

  function speak(message) {
    if (!voiceEnabled) return;
    speech.cancel();
    utterance = new SpeechSynthesisUtterance(message);
    utterance.lang = "en-US";
    const voices = speech.getVoices().filter(voice => voice.lang.startsWith("en"));
    utterance.voice = voices.find(voice => /\b(male|david|mark|guy|ryan|davis|tony|narrator|alex|daniel|fred|james|aaron|oliver|george)\b/i.test(voice.name)) || null;
    speech.speak(utterance);
  }

  function prepareLeg(leg, from, to) {
    let distance = 0;
    let ascent = 0;
    let length = 0;
    const points = leg.path.map(([x, y], index) => {
      const previous = leg.path[index - 1];
      const z = leg.elevationM?.[index];
      let slope = index ? null : 0;
      if (previous) {
        const dx = x - previous[0], dy = y - previous[1];
        const step = Math.hypot(dx * grid.dx, dy * grid.dy);
        distance += step;
        length += Math.hypot(dx / grid.width * 1000, dy / grid.height * 700);
        if (Number.isFinite(z)) {
          const rise = z - leg.elevationM[index - 1];
          ascent += Math.max(0, rise);
          slope = Math.atan2(Math.abs(rise), step) * 180 / Math.PI;
        }
      }
      return {x: (x + .5) / grid.width * 1000, y: (y + .5) / grid.height * 700, z, slope, distance, ascent, length};
    });
    const path = points.map((point, index) => `${index ? "L" : "M"}${point.x} ${point.y}`).join(" ");
    const base = {d: path, fill: "none", "stroke-width": 2, "vector-effect": "non-scaling-stroke"};
    const remaining = svg("path", {...base, stroke: "#67cde9", "stroke-dasharray": "4 5"});
    const completed = svg("path", {...base, stroke: "#57e38e", "stroke-linecap": "round", visibility: "hidden"});
    layer.prepend(remaining);
    layer.append(completed);
    return {from, to, leg, points, distance, length, completed};
  }

  function sample(points, distance) {
    let low = 1, high = points.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (points[mid].distance < distance) low = mid + 1;
      else high = mid;
    }
    const a = points[low - 1], b = points[low] || a;
    const t = b.distance > a.distance ? (distance - a.distance) / (b.distance - a.distance) : 0;
    const mix = key => a[key] + (b[key] - a[key]) * t;
    return {x: mix("x"), y: mix("y"), z: mix("z"), ascent: mix("ascent"), length: mix("length"), slope: b.slope, a, b};
  }

  function draw() {
    const leg = run.legs[run.index];
    const fraction = Math.min(1, run.elapsed / leg.duration);
    const position = sample(leg.points, leg.distance * fraction);
    if (position.length > 0) {
      leg.completed.setAttribute("visibility", "visible");
      leg.completed.setAttribute("stroke-dasharray", fraction === 1 ? "none" : `${position.length} ${leg.length + 1}`);
    }
    const matrix = world.getScreenCTM();
    if (matrix) {
      const point = new DOMPoint(position.x, position.y).matrixTransform(matrix);
      const rect = map.getBoundingClientRect();
      const direction = new DOMPoint(position.b.x - position.a.x, position.b.y - position.a.y, 0, 0).matrixTransform(matrix);
      marker.style.left = `${point.x - rect.left - map.clientLeft}px`;
      marker.style.top = `${point.y - rect.top - map.clientTop}px`;
      if (direction.x || direction.y) marker.style.setProperty("--facing", direction.x < 0 ? "-1" : "1");
    }
    marker.classList.toggle("is-walking", run.playing && run.arrival === null);
    marker.classList.toggle("is-working", run.playing && run.arrival !== null && run.index < run.legs.length - 1);
    const km = value => (value / 1000).toFixed(2);
    const values = [
      `${Math.floor(position.x / 1000 * grid.width)} / ${Math.floor(position.y / 700 * grid.height)}`,
      Number.isFinite(position.z) ? `${Math.round(position.z)} m` : "—",
      position.slope === null ? "—" : `${position.slope.toFixed(1)}°`,
      `${Math.round(run.ascent + (Number.isFinite(position.z) ? position.ascent : leg.leg.ascentM * fraction))} / ${run.route.ascentM} m`,
      `${km(leg.distance * fraction)} / ${km(leg.distance)} km`
    ];
    for (const [index, value] of values.entries()) {
      if (metricValues[index].textContent !== value) metricValues[index].textContent = value;
    }
    const progress = run.totalDistance ? (run.distance + leg.distance * fraction) / run.totalDistance : (run.index + fraction) / run.legs.length;
    bar.value = progress * 100;
    bar.nextElementSibling.textContent = `${Math.floor(progress * 100)}%`;
  }

  function setPlaying(playing) {
    run.playing = playing;
    run.lastFrame = null;
    button("play").textContent = playing ? "Ⅱ Pause" : "▶ Play";
  }

  function showLeg() {
    const leg = run.legs[run.index];
    legLabel.textContent = `${leg.from} → ${leg.to}`;
  }

  function finish() {
    setPlaying(false);
    run.finished = true;
    button("play").textContent = "↻ Replay";
    bar.value = 100;
    bar.nextElementSibling.textContent = "100%";
    const {route} = run;
    const minutes = Math.round(route.estimate.durationMinutes);
    completion.textContent = `Mission complete · Returned to ${run.legs.at(-1).to}. ${(route.distanceM / 1000).toFixed(2)} km · ${route.ascentM} m ascent · ${route.maxSlopeDeg}° max slope · Estimated ${Math.floor(minutes / 60)}h ${minutes % 60}m · ${route.estimate.oxygenKgPerPerson.toFixed(2)} kg oxygen per astronaut.`;
    completion.hidden = false;
    speak(`Mission complete. Returned to ${run.legs.at(-1).to}.`);
  }

  function tick(now) {
    if (!run) return;
    const leg = run.legs[run.index];
    if (run.playing) {
      const delta = run.lastFrame === null ? 0 : Math.min(now - run.lastFrame, 50);
      run.lastFrame = now;
      run.elapsed += delta * speeds[speedIndex];
      if (run.elapsed >= leg.duration && run.arrival === null) {
        run.arrival = 0;
        caption.textContent = leg.to;
        if (run.index < run.legs.length - 1) speak(`Arriving at ${leg.to}.`);
      }
      if (run.arrival !== null) run.arrival += delta;
      if (run.arrival >= 1350) {
        if (run.index === run.legs.length - 1) finish();
        else {
          leg.completed.setAttribute("stroke-dasharray", "none");
          run.ascent += leg.leg.ascentM;
          run.distance += leg.distance;
          run.index++;
          run.elapsed = 0;
          run.arrival = null;
          caption.textContent = "";
          showLeg();
        }
      }
    }
    draw();
    frame = requestAnimationFrame(tick);
  }

  function closePreview() {
    if (!run) return;
    cancelAnimationFrame(frame);
    speech?.cancel();
    utterance = null;
    map.classList.remove("is-playing-mission");
    panel.hidden = marker.hidden = true;
    layer.replaceChildren();
    run = null;
  }

  function openPreview(play = false) {
    if (!missionDemSummary?.legs.length) return;
    closePreview();
    const route = missionDemSummary;
    const names = state.ids.map(id => catalog.find(point => point.id === id).name);
    const legs = route.legs.map((leg, index) => prepareLeg(leg, names[index], names[index + 1] || names[0]));
    const totalDistance = legs.reduce((total, leg) => total + leg.distance, 0);
    for (const leg of legs) leg.duration = 1400 + (totalDistance ? 22000 * leg.distance / totalDistance : 0);
    run = {route, legs, totalDistance, index: 0, distance: 0, ascent: 0, elapsed: 0, arrival: null};
    setPlaying(play);
    caption.textContent = names[0];
    if (play) speak(`Departing ${names[0]}.`);
    map.classList.add("is-playing-mission");
    panel.hidden = marker.hidden = false;
    completion.hidden = true;
    showLeg();
    draw();
    frame = requestAnimationFrame(tick);
  }

  startButton.onclick = () => {
    openPreview();
    map.scrollIntoView({block: "start"});
    button("play").focus({preventScroll: true});
  };
  button("play").onclick = () => {
    if (run.finished) {
      openPreview(true);
      return;
    }
    setPlaying(!run.playing);
    if (!run.playing) speech?.cancel();
    else if (run.index === 0 && run.elapsed === 0) speak(`Departing ${run.legs[0].from}.`);
    if (run.arrival === null) caption.textContent = "";
  };
  button("speed").onclick = () => {
    speedIndex = (speedIndex + 1) % speeds.length;
    button("speed").textContent = `${speeds[speedIndex]}×`;
  };
  voiceButton.onclick = () => {
    voiceEnabled = !voiceEnabled;
    voiceButton.textContent = voiceEnabled ? "Voice on" : "Voice off";
    voiceButton.setAttribute("aria-pressed", String(voiceEnabled));
    if (!voiceEnabled) speech.cancel();
  };
  button("end").onclick = () => {
    closePreview();
    startButton.focus();
  };
  function syncRoute() {
    startButton.disabled = !missionDemSummary?.legs.length;
    if (run && run.route !== missionDemSummary) closePreview();
  }
  new MutationObserver(syncRoute).observe(document.getElementById("advisoryText"), {childList: true});
  new MutationObserver(() => {
    if (document.getElementById("mission-panel").hidden) closePreview();
  }).observe(document.getElementById("mission-panel"), {attributes: true, attributeFilter: ["hidden"]});
  syncRoute();
})();
