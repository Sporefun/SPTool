(function(){
  // ----- State -----
  const state = {
    worldName: "unknown",
    worldSize: 15360,

    items: [],

    // timeline
    frames: [],          // [{ts:"...", items:[...]}, ...] trié
    tsIndex: new Map(),
    currentFrame: 0,
    playing: false,
    speed: 1,

    // filtres
    filtered: [],
    classes: new Set(),
    classAllow: new Set(),

    // carte
    markerById: new Map()
  };

  // ----- Utils -----
  function escapeHtml(s){ return (s||'').toString().replace(/[&<>\"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function hpColor(p){ if (p<30) return '#ef4444'; if (p<60) return '#f59e0b'; return '#22c55e'; }
  function toLatLng(x,z){ return [z, x]; } // Chernarus: lat=z, lng=x
  function itemHtml(it){
    return `<strong>${escapeHtml(it.name||'')}</strong><br>ID: ${it.id}<br>${escapeHtml(it.class||'')}<br>HP: ${it.hp_percent}%<br>x:${it.pos.x.toFixed(1)} y:${it.pos.y.toFixed(1)} z:${it.pos.z.toFixed(1)}`;
  }
  function debounce(fn, ms){
    let t=null;
    return function(){ if (t) clearTimeout(t); const args=arguments; t=setTimeout(()=>fn.apply(this,args), ms); };
  }

  // ----- Carte -----
  let map, layerGroup, bgOverlay, rendererCanvas = L.canvas({padding:0.5}), sharedPopup;
  let lastFrameIndex = -1; // pour purge inter-frame

  function initMap(){
    if (map) return;
    map = L.map('map', { crs: L.CRS.Simple, preferCanvas: true, minZoom: -2, scrollWheelZoom: true, dragging: true });
    layerGroup = L.layerGroup().addTo(map);
    sharedPopup = L.popup({ closeButton: false, autoPan: true });
    fitWorld();
    window.addEventListener('resize', ()=> map.invalidateSize());
  }
  function fitWorld(){
    if (!map) return;
    const b = [[0,0],[state.worldSize, state.worldSize]];
    map.setMaxBounds(b); map.fitBounds(b);
  }
  function loadBgUrl(url){
    if (!map) return;
    const b = [[0,0],[state.worldSize, state.worldSize]];
    if (bgOverlay) map.removeLayer(bgOverlay);
    bgOverlay = L.imageOverlay(url, b).addTo(map);
    map.fitBounds(b);
  }

  // Rendu diff dans le frame courant
  function renderMarkersDiff(){
    const want = new Map(); // id -> item filtré
    for (let i=0;i<state.filtered.length;i++){ const it=state.filtered[i]; want.set(it.id, it); }

    // remove absents
    for (const [id, mk] of Array.from(state.markerById.entries())){
      if (!want.has(id)){
        layerGroup.removeLayer(mk);
        state.markerById.delete(id);
      }
    }

    // add manquants
    const toAdd = [];
    for (const [id, it] of want.entries()){
      if (!state.markerById.has(id)) toAdd.push(it);
    }
    let i = 0;
    const CHUNK = 500;
    function step(){
      const end = Math.min(i+CHUNK, toAdd.length);
      while (i<end){
        const it = toAdd[i];
        const ll = toLatLng(it.pos.x, it.pos.z);
        const mk = L.circleMarker(ll, { renderer: rendererCanvas, radius:3, weight:1, color: hpColor(it.hp_percent), fillOpacity:0.7 });
        mk._sp_it = it;
        mk.on('click', ()=>{
          const ll2 = mk.getLatLng();
          sharedPopup.setLatLng(ll2).setContent(itemHtml(mk._sp_it)).openOn(map);
        });
        mk.addTo(layerGroup);
        state.markerById.set(it.id, mk);
        i++;
      }
      if (i < toAdd.length) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }

  function focusById(id, zoom=0){
    const frameItems = state.frames.length ? state.frames[state.currentFrame].items : state.items;
    const it = frameItems.find(x=>x.id===id);
    if (!it) return;
    const ll = L.latLng(toLatLng(it.pos.x, it.pos.z));
    map.setView(ll, zoom, {animate:true});
    if (sharedPopup){ sharedPopup.setLatLng(ll).setContent(itemHtml(it)).openOn(map); }
  }

  // ----- Données & parsing -----
  async function loadFiles(files){
    let all = [];
    for (const f of files){
      const text = await f.text();
      all = all.concat(parseLjson(text));
    }
    if (all.length>0){
      const a0 = all[0];
      if (a0.world) state.worldName = a0.world;
      if (a0.worldSize) state.worldSize = +a0.worldSize;
    }
    state.items = all;

    // frames par ts
    const byTs = new Map();
    for (let i=0;i<all.length;i++){
      const o = all[i];
      const ts = o.ts || "0000-00-00T00:00:00";
      if (!byTs.has(ts)) byTs.set(ts, []);
      byTs.get(ts).push(o);
    }
    const tsList = Array.from(byTs.keys()).sort();
    state.frames = tsList.map(ts => ({ ts, items: byTs.get(ts) }));
    state.tsIndex.clear();
    for (let i=0;i<state.frames.length;i++) state.tsIndex.set(state.frames[i].ts, i);
    state.currentFrame = 0;
    lastFrameIndex = -1;

    // classes
    state.classes = new Set(all.map(o=>o.class).filter(Boolean));
    state.classAllow = new Set(state.classes);

    buildFilters();
    buildPlayer();
    applyFilters();
  }

  function parseLjson(text){
    const lines = text.split(/\r?\n/);
    const out = [];
    for (let i=0;i<lines.length;i++){
      const ln = lines[i].trim();
      if (!ln) continue;
      try{
        const o = JSON.parse(ln);
        if (o.type === "item" && o.pos) out.push(o);
      }catch{}
    }
    return out;
  }

  // ----- Filtres -----
  function applyFilters(){
    // si frame a changé, on RECRÉE le layerGroup → supprime 100% des résidus
    if (state.currentFrame !== lastFrameIndex){
      if (layerGroup) map.removeLayer(layerGroup);
      layerGroup = L.layerGroup().addTo(map);
      state.markerById.clear();
      lastFrameIndex = state.currentFrame;
    }

    const q = document.getElementById('search').value.trim().toLowerCase();
    const frameItems = state.frames.length ? state.frames[state.currentFrame].items : state.items;

    let arr = frameItems.filter(it => state.classAllow.has(it.class));
    if (q){
      arr = arr.filter(it =>
        (it.name||'').toLowerCase().includes(q) ||
        (it.class||'').toLowerCase().includes(q) ||
        String(it.id).includes(q)
      );
    }
    state.filtered = arr;
    renderList();
    renderMarkersDiff();
    updateStats();
    updatePlayerTs();
  }

  // ----- UI: liste + filtres -----
  function buildFilters(){
    const host = document.getElementById('loot-filters');
    host.innerHTML = "";
    const classes = Array.from(state.classes).sort((a,b)=>a.localeCompare(b));
    const group = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = "Loot • Classes";
    group.appendChild(title);
    for (let i=0;i<classes.length;i++){
      const cls = classes[i];
      const div = document.createElement('label');
      div.className = 'checkbox';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = state.classAllow.has(cls);
      cb.addEventListener('change', e=>{
        if (e.target.checked) state.classAllow.add(cls);
        else state.classAllow.delete(cls);
        applyFilters();
      });
      const span = document.createElement('span'); span.textContent = cls;
      div.appendChild(cb); div.appendChild(span);
      group.appendChild(div);
    }
    host.appendChild(group);
  }

  function renderList(){
    const cont = document.getElementById('list');
    cont.innerHTML = "";
    const frag = document.createDocumentFragment();
    for (let i=0;i<state.filtered.length;i++){
      const it = state.filtered[i];
      const el = document.createElement('div');
      el.className = 'card'; el.style.cursor = 'pointer';
      el.innerHTML = `
        <div class="title">${escapeHtml(it.name||'')}</div>
        <div class="sub">ID: ${it.id} • ${escapeHtml(it.class||'')}</div>
        <div class="badges">
          <span class="badge">${escapeHtml(state.worldName)}</span>
          <span class="badge">x:${it.pos.x.toFixed(1)} z:${it.pos.z.toFixed(1)}</span>
          <span class="badge">${it.hp_percent}% HP</span>
        </div>
        <div class="hpbar"><div class="hpfill" style="width:${it.hp_percent}%"></div></div>`;
      el.addEventListener('click', ()=> focusById(it.id, 0));
      frag.appendChild(el);
    }
    cont.appendChild(frag);
  }

  function updateStats(){
    const totalNow = state.frames.length ? state.frames[state.currentFrame].items.length : state.items.length;
    const ts = state.frames.length ? state.frames[state.currentFrame].ts : "—";
    document.getElementById('stats').textContent = `${state.filtered.length} items filtrés • ${totalNow} à ${ts} • ${state.worldName}`;
  }

  // ----- Lecteur -----
  function buildPlayer(){
    const r = document.getElementById('pl_range');
    const bPlay = document.getElementById('pl_play');
    const bPause = document.getElementById('pl_pause');
    const spd = document.getElementById('pl_speed');
    if (!r || !bPlay || !bPause || !spd) return;

    r.min = 0;
    r.max = state.frames.length ? state.frames.length-1 : 0;
    r.value = state.currentFrame;

    r.oninput = ()=>{ state.currentFrame = parseInt(r.value,10)||0; applyFilters(); };
    bPlay.onclick = ()=>{ state.playing = true; loop(); };
    bPause.onclick = ()=>{ state.playing = false; };
    spd.onchange = ()=>{ state.speed = parseFloat(spd.value)||1; };

    updatePlayerTs();
  }
  function updatePlayerTs(){
    const el = document.getElementById('pl_ts');
    const r = document.getElementById('pl_range');
    if (!el || !r) return;
    el.textContent = state.frames.length ? state.frames[state.currentFrame].ts : "—";
    r.max = state.frames.length ? state.frames.length-1 : 0;
    r.value = state.currentFrame;
  }
  function loop(){
    if (!state.playing) return;
    state.currentFrame = state.currentFrame + 1;
    if (state.currentFrame >= state.frames.length) state.currentFrame = 0;
    applyFilters();
    const delay = Math.max(100, Math.floor(500 / state.speed)); // 1×=500ms, 2×=250ms, 5×=100ms…
    setTimeout(loop, delay);
  }

  // ----- Wiring -----
  window.addEventListener('DOMContentLoaded', () => {
    // masque le lecteur tant que l'overlay est visible
    document.body.classList.add('overlay-open');

    initMap();

    // Overlay boot
    const homeBtn = document.getElementById('homeStart');
    if (homeBtn){
      homeBtn.addEventListener('click', async ()=>{
        const files = document.getElementById('homeFile').files;
        if (!files || files.length===0){ alert('Sélectionne au moins un fichier .ljson'); return; }
        await loadFiles(files);
        const sel = document.querySelector('input[name="mapsel"]:checked')?.value || 'chernarus';
        if (sel === 'chernarus'){ loadBgUrl('maps/chernarus.png'); }
        const ov = document.getElementById('overlay');
        if (ov){ ov.style.display = 'none'; document.body.classList.remove('overlay-open'); }
        fitWorld();
        document.getElementById('meta').textContent = `${state.worldName} • ${state.items.length} lignes • worldSize ${state.worldSize}`;
        applyFilters();
      });
    }

    // In-app controls
    document.getElementById('file').addEventListener('change', async ev => {
      if (!ev.target.files || ev.target.files.length === 0) return;
      await loadFiles(ev.target.files);
      document.getElementById('meta').textContent = `${state.worldName} • ${state.items.length} lignes • worldSize ${state.worldSize}`;
      fitWorld(); applyFilters();
    });
    document.getElementById('bgimg').addEventListener('change', ev => {
      if (!ev.target.files || ev.target.files.length === 0) return;
      const url = URL.createObjectURL(ev.target.files[0]);
      loadBgUrl(url);
    });
    document.getElementById('fit').addEventListener('click', fitWorld);
    document.getElementById('clear').addEventListener('click', () => window.location.reload());

    // Recherche avec debounce
    document.getElementById('search').addEventListener('input', debounce(applyFilters, 120));

    document.getElementById('selectAll').addEventListener('click', ()=>{
      state.classAllow = new Set(state.classes); buildFilters(); applyFilters();
    });
    document.getElementById('unselectAll').addEventListener('click', ()=>{
      state.classAllow = new Set(); buildFilters(); applyFilters();
    });
  });
})();
