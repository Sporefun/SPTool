(function(){
  // ----- State -----
  const state = {
    worldName: "unknown",
    worldSize: 15360,

    items: [],

    // timeline avec reconstruction d'état
    frames: [],
    tsIndex: new Map(),
    currentFrame: 0,
    playing: false,
    speed: 1,

    // filtres loot
    filtered: [],
    classes: new Set(),
    classAllow: new Set(),
    searchText: "",

    // carte
    markerById: new Map(),

    // panneau de détails
    detailsOpen: false,
    detailsClass: "",

    // MODULE VEHICULES - AJOUT
    activeModule: "loot",
    vehicles: [],
    vehicleActions: [],
    vehicleFrames: [],
    vehicleFiltered: [],
    vehicleTypes: new Set(),
    vehicleTypeAllow: new Set(),
    vehiclePlayers: new Set(),
    vehiclePlayerAllow: new Set(),
    vehicleActionTypes: new Set(),
    vehicleActionAllow: new Set()
  };

  // ----- Utils -----
  function escapeHtml(s){ return (s||'').toString().replace(/[&<>\"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
  function hpColor(p){ if (p<30) return '#ef4444'; if (p<60) return '#f59e0b'; return '#22c55e'; }
  function toLatLng(x,z){ return [z, x]; }
  function itemHtml(it){
    return `<strong>${escapeHtml(it.name||'')}</strong><br>ID: ${it.id}<br>${escapeHtml(it.class||'')}<br>HP: ${it.hp_percent}%<br>x:${it.pos.x.toFixed(1)} y:${it.pos.y.toFixed(1)} z:${it.pos.z.toFixed(1)}`;
  }
  function debounce(fn, ms){
    let t=null;
    return function(){ if (t) clearTimeout(t); const args=arguments; t=setTimeout(()=>fn.apply(this,args), ms); };
  }

  // ----- Carte avec clustering -----
  let map, layerGroup, bgOverlay, markerCluster, sharedPopup;
  let lastFrameIndex = -1;

  function initMap(){
    if (map) return;
    map = L.map('map', { 
      crs: L.CRS.Simple, 
      preferCanvas: true, 
      minZoom: -2, 
      maxZoom: 4,
      scrollWheelZoom: true, 
      dragging: true 
    });
    
    if (typeof L.markerClusterGroup !== 'undefined') {
      markerCluster = L.markerClusterGroup({
        maxClusterRadius: 80,
        spiderfyOnMaxZoom: true,
        disableClusteringAtZoom: 3,
        chunkedLoading: true,
        chunkInterval: 50,
        chunkDelay: 50
      });
      map.addLayer(markerCluster);
    } else {
      layerGroup = L.layerGroup().addTo(map);
    }
    
    sharedPopup = L.popup({ closeButton: false, autoPan: true });
    fitWorld();
    window.addEventListener('resize', ()=> map.invalidateSize());
  }

  function fitWorld(){
    if (!map) return;
    const b = [[0,0],[state.worldSize, state.worldSize]];
    map.setMaxBounds(b); 
    map.fitBounds(b);
  }

  function loadBgUrl(url){
    if (!map) return;
    const b = [[0,0],[state.worldSize, state.worldSize]];
    if (bgOverlay) map.removeLayer(bgOverlay);
    bgOverlay = L.imageOverlay(url, b).addTo(map);
    bgOverlay.setZIndex(0);
    map.fitBounds(b);
  }

  // Rendu optimisé avec batching
  function renderMarkersDiff(){
    const target = markerCluster || layerGroup;
    if (!target) return;

    console.log('[Render] Starting render. Current markers:', state.markerById.size, 'Want:', state.filtered.length);

    const want = new Map();
    for (let i=0; i<state.filtered.length; i++){ 
      const it = state.filtered[i]; 
      want.set(it.id, it); 
    }

    const toRemove = [];
    for (const [id, mk] of Array.from(state.markerById.entries())){
      if (!want.has(id)){
        toRemove.push({id, mk});
      }
    }
    
    console.log('[Render] Removing', toRemove.length, 'markers');
    
    for (let i = 0; i < toRemove.length; i++) {
      const item = toRemove[i];
      if (markerCluster) {
        markerCluster.removeLayer(item.mk);
      } else if (layerGroup) {
        layerGroup.removeLayer(item.mk);
      }
      state.markerById.delete(item.id);
    }

    const toAdd = [];
    for (const [id, it] of want.entries()){
      if (!state.markerById.has(id)) toAdd.push(it);
    }

    console.log('[Render] Adding', toAdd.length, 'markers');

    if (toAdd.length === 0) {
      console.log('[Render] Nothing to add, done. Total markers:', state.markerById.size);
      return;
    }

    let idx = 0;
    const CHUNK = 500;
    
    function step(){
      const end = Math.min(idx + CHUNK, toAdd.length);
      const batch = [];
      
      while (idx < end){
        const it = toAdd[idx];
        const ll = toLatLng(it.pos.x, it.pos.z);
        const mk = L.circleMarker(ll, { 
          radius: 3, 
          weight: 1, 
          color: hpColor(it.hp_percent), 
          fillOpacity: 0.7 
        });
        
        mk._sp_it = it;
        mk.on('click', ()=>{
          const ll2 = mk.getLatLng();
          sharedPopup.setLatLng(ll2).setContent(itemHtml(mk._sp_it)).openOn(map);
        });
        
        batch.push(mk);
        state.markerById.set(it.id, mk);
        idx++;
      }
      
      if (markerCluster) {
        markerCluster.addLayers(batch);
      } else if (layerGroup) {
        batch.forEach(mk => mk.addTo(layerGroup));
      }
      
      if (idx < toAdd.length) {
        requestAnimationFrame(step);
      } else {
        console.log('[Render] Done adding markers. Total:', state.markerById.size);
      }
    }
    
    requestAnimationFrame(step);
  }

  function focusById(id, zoom){
    if (zoom === undefined) zoom = 0;
    const frameItems = state.frames.length > 0 ? state.frames[state.currentFrame].items : state.items;
    const it = frameItems.find(x => x.id === id);
    if (!it) return;
    const ll = L.latLng(toLatLng(it.pos.x, it.pos.z));
    map.setView(ll, zoom, {animate: true});
    if (sharedPopup){ 
      sharedPopup.setLatLng(ll).setContent(itemHtml(it)).openOn(map); 
    }
  }

  // ----- RECONSTRUCTION D'ÉTAT PAR FRAME (LOOT) -----
  function buildFramesWithFullState(allItems){
    console.log('[Timeline] Construction des frames avec état complet...');
    console.log('[Timeline] Input items:', allItems.length);
    
    const byTs = new Map();
    for (let i = 0; i < allItems.length; i++){
      const item = allItems[i];
      const ts = item.ts || "0000-00-00T00:00:00";
      if (!byTs.has(ts)) byTs.set(ts, []);
      byTs.get(ts).push(item);
    }
    
    const tsList = Array.from(byTs.keys()).sort();
    console.log('[Timeline] ' + tsList.length + ' timestamps trouvés');
    
    const frames = [];
    const itemsState = new Map();
    
    for (let t = 0; t < tsList.length; t++){
      const ts = tsList[t];
      const frameChanges = byTs.get(ts);
      
      for (let i = 0; i < frameChanges.length; i++){
        const item = frameChanges[i];
        
        if (item.type === "item_remove") {
          itemsState.delete(item.id);
        } else if (item.type === "item") {
          itemsState.set(item.id, item);
        }
      }
      
      const frameItems = Array.from(itemsState.values());
      
      frames.push({ 
        ts: ts, 
        items: frameItems,
        changes: frameChanges.length,
        totalItems: frameItems.length
      });
      
      if (t % 10 === 0 || t === tsList.length - 1) {
        console.log('[Timeline] Frame ' + t + '/' + tsList.length + ' : ' + frameItems.length + ' items');
      }
    }
    
    console.log('[Timeline] Reconstruction terminée : ' + frames.length + ' frames');
    return frames;
  }

  // ----- Données & parsing (LOOT) -----
  async function loadFiles(files){
    console.log('[Load] Chargement de ' + files.length + ' fichier(s)...');
    
    let all = [];
    for (let f = 0; f < files.length; f++){
      const file = files[f];
      const text = await file.text();
      all = all.concat(parseLjson(text));
    }
    
    if (all.length > 0){
      const a0 = all[0];
      if (a0.world) state.worldName = a0.world;
      if (a0.worldSize) state.worldSize = parseInt(a0.worldSize, 10);
    }
    
    console.log('[Load] ' + all.length + ' lignes parsées');
    state.items = all;

    state.frames = buildFramesWithFullState(all);
    
    state.tsIndex.clear();
    for (let i = 0; i < state.frames.length; i++) {
      state.tsIndex.set(state.frames[i].ts, i);
    }
    
    state.currentFrame = 0;
    
    console.log('[Load] Clearing map before reload');
    if (markerCluster) {
      markerCluster.clearLayers();
    } else if (layerGroup) {
      layerGroup.clearLayers();
    }
    state.markerById.clear();
    lastFrameIndex = -1;

    const classSet = new Set();
    for (let i = 0; i < all.length; i++){
      if (all[i].class) classSet.add(all[i].class);
    }
    state.classes = classSet;
    state.classAllow = new Set(state.classes);

    buildFilters();
    buildPlayer();
    
    console.log('[Load] Calling applyFilters');
    applyFilters();
    
    console.log('[Load] Chargement terminé');
  }

  function parseLjson(text){
    const lines = text.split(/\r?\n/);
    const out = [];
    
    for (let i = 0; i < lines.length; i++){
      const ln = lines[i].trim();
      if (!ln) continue;
      try{
        const o = JSON.parse(ln);
        if (o.type === "item" && o.pos) {
          out.push(o);
        } else if (o.type === "item_remove" && o.id) {
          out.push(o);
        }
      } catch(e) {
        console.warn('[Parse] Ligne invalide ignorée:', ln.substring(0, 50));
      }
    }
    
    return out;
  }

  // ----- Filtres (LOOT) -----
  let applyFiltersTimeout = null;
  
  function applyFilters(){
    if (applyFiltersTimeout) {
      clearTimeout(applyFiltersTimeout);
    }
    
    applyFiltersTimeout = setTimeout(function(){
      applyFiltersNow();
      applyFiltersTimeout = null;
    }, 10);
  }
  
  function applyFiltersNow(){
    console.log('[Filters] === START applyFilters ===');
    
    if (lastFrameIndex !== state.currentFrame){
      console.log('[Filters] CLEARING ALL MARKERS');
      if (markerCluster) {
        markerCluster.clearLayers();
      } else if (layerGroup) {
        layerGroup.clearLayers();
      }
      state.markerById.clear();
      lastFrameIndex = state.currentFrame;
    }

    const q = state.searchText.toLowerCase();
    const frameItems = state.frames.length > 0 ? state.frames[state.currentFrame].items : state.items;

    let arrForMap = frameItems.filter(it => state.classAllow.has(it.class));
    
    if (q){
      arrForMap = arrForMap.filter(it =>
        (it.name||'').toLowerCase().includes(q) ||
        (it.class||'').toLowerCase().includes(q) ||
        String(it.id).includes(q)
      );
    }
    
    state.filtered = arrForMap;
    
    if (!state.detailsOpen) {
      renderList();
    }
    
    renderMarkersDiff();
    updateStats();
    updatePlayerTs();
    
    console.log('[Filters] === END applyFilters ===');
  }

  // ----- UI: liste avec compteurs et bouton détails (LOOT) -----
  function renderList(){
    const cont = document.getElementById('list');
    cont.innerHTML = "";
    
    const frameItems = state.frames.length > 0 ? state.frames[state.currentFrame].items : state.items;
    
    if (frameItems.length === 0) {
      cont.innerHTML = '<div class="small" style="padding:10px">Aucun item</div>';
      return;
    }
    
    const classCounts = new Map();
    for (let i = 0; i < frameItems.length; i++){
      const it = frameItems[i];
      const cls = it.class;
      if (!classCounts.has(cls)) {
        classCounts.set(cls, 0);
      }
      classCounts.set(cls, classCounts.get(cls) + 1);
    }
    
    const q = state.searchText.toLowerCase();
    let classesToShow = Array.from(classCounts.keys()).sort((a,b) => a.localeCompare(b));
    
    if (q) {
      classesToShow = classesToShow.filter(cls => cls.toLowerCase().includes(q));
    }
    
    const frag = document.createDocumentFragment();
    
    for (let i = 0; i < classesToShow.length; i++){
      const cls = classesToShow[i];
      const count = classCounts.get(cls);
      
      const el = document.createElement('div');
      el.className = 'class-row';
      el.style.cssText = 'display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid var(--border);';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.classAllow.has(cls);
      cb.addEventListener('change', (function(c){
        return function(e){
          if (e.target.checked) {
            state.classAllow.add(c);
          } else {
            state.classAllow.delete(c);
          }
          applyFilters();
        };
      })(cls));
      
      const label = document.createElement('span');
      label.textContent = cls + ' (' + count + ')';
      label.style.flex = '1';
      label.style.cursor = 'pointer';
      label.addEventListener('click', function(){
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change'));
      });
      
      const detailBtn = document.createElement('button');
      detailBtn.textContent = 'Détails';
      detailBtn.style.cssText = 'padding:4px 8px;font-size:11px;';
      detailBtn.addEventListener('click', (function(c){
        return function(){
          openDetails(c);
        };
      })(cls));
      
      el.appendChild(cb);
      el.appendChild(label);
      el.appendChild(detailBtn);
      frag.appendChild(el);
    }
    
    cont.appendChild(frag);
  }

  // ----- Panneau de détails (LOOT) -----
  function openDetails(className){
    state.detailsOpen = true;
    state.detailsClass = className;
    
    const frameItems = state.frames.length > 0 ? state.frames[state.currentFrame].items : state.items;
    const classItems = frameItems.filter(it => it.class === className);
    
    const cont = document.getElementById('list');
    cont.innerHTML = "";
    
    const header = document.createElement('div');
    header.style.cssText = 'padding:10px;border-bottom:2px solid var(--border);background:var(--card);position:sticky;top:0;z-index:10;';
    
    const backBtn = document.createElement('button');
    backBtn.textContent = '← Retour';
    backBtn.style.cssText = 'margin-bottom:8px;';
    backBtn.addEventListener('click', closeDetails);
    
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;font-size:14px;';
    title.textContent = className + ' - ' + classItems.length + ' items';
    
    header.appendChild(backBtn);
    header.appendChild(title);
    cont.appendChild(header);
    
    const itemsList = document.createElement('div');
    itemsList.style.cssText = 'padding:10px;';
    
    for (let i = 0; i < classItems.length; i++){
      const it = classItems[i];
      
      const card = document.createElement('div');
      card.className = 'card';
      card.style.cssText = 'margin-bottom:10px;cursor:pointer;';
      
      card.innerHTML = `
        <div style="font-weight:600;margin-bottom:4px;font-size:11px;color:var(--muted);">ID: ${it.id}</div>
        <div class="sub">HP: ${it.hp_percent}%</div>
        <div class="hpbar"><div class="hpfill" style="width:${it.hp_percent}%;background:${hpColor(it.hp_percent)}"></div></div>
        <div class="sub" style="margin-top:4px;">x:${it.pos.x.toFixed(1)} y:${it.pos.y.toFixed(1)} z:${it.pos.z.toFixed(1)}</div>
      `;
      
      card.addEventListener('click', (function(id){
        return function(){
          focusById(id, 2);
        };
      })(it.id));
      
      itemsList.appendChild(card);
    }
    
    cont.appendChild(itemsList);
    
    const footer = document.createElement('div');
    footer.style.cssText = 'padding:10px;border-top:1px solid var(--border);background:var(--card);position:sticky;bottom:0;';
    
    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Fermer';
    closeBtn.style.cssText = 'width:100%;';
    closeBtn.addEventListener('click', closeDetails);
    
    footer.appendChild(closeBtn);
    cont.appendChild(footer);
  }

  function closeDetails(){
    state.detailsOpen = false;
    state.detailsClass = "";
    renderList();
  }

  function updateStats(){
    const frame = state.frames.length > 0 ? state.frames[state.currentFrame] : null;
    const totalNow = frame ? frame.totalItems : state.items.length;
    const ts = frame ? frame.ts : "—";
    const changes = frame ? frame.changes : 0;
    
    document.getElementById('stats').textContent = 
      state.filtered.length + ' items filtrés • ' + 
      totalNow + ' total • ' + 
      changes + ' changements • ' + 
      ts + ' • ' + 
      state.worldName;
  }

  // ----- Filtres UI (LOOT) -----
  function buildFilters(){
    const host = document.getElementById('loot-filters');
    host.innerHTML = "";
    
    const title = document.createElement('h3');
    title.textContent = "Classes d'items";
    title.style.cssText = 'margin:0 0 8px 0;font-size:14px;';
    host.appendChild(title);
    
    const hint = document.createElement('div');
    hint.className = 'small';
    hint.textContent = 'Utilisez la recherche pour filtrer par nom de classe';
    host.appendChild(hint);
  }

  // ----- Lecteur -----
  function buildPlayer(){
    const r = document.getElementById('pl_range');
    const bPlay = document.getElementById('pl_play');
    const bPause = document.getElementById('pl_pause');
    const spd = document.getElementById('pl_speed');
    if (!r || !bPlay || !bPause || !spd) return;

    const maxFrames = state.activeModule === "loot" ? 
      (state.frames.length > 0 ? state.frames.length - 1 : 0) :
      (state.vehicleFrames.length > 0 ? state.vehicleFrames.length - 1 : 0);

    r.min = 0;
    r.max = maxFrames;
    r.value = state.currentFrame;

    r.oninput = function(){
      state.currentFrame = parseInt(r.value, 10) || 0;
      if (state.activeModule === "loot") {
        applyFilters();
      } else {
        applyVehicleFilters();
      }
    };
    
    bPlay.onclick = function(){
      state.playing = true;
      loop();
    };
    
    bPause.onclick = function(){
      state.playing = false;
    };
    
    spd.onchange = function(){
      state.speed = parseFloat(spd.value) || 1;
    };

    updatePlayerTs();
  }

  function updatePlayerTs(){
    const el = document.getElementById('pl_ts');
    const r = document.getElementById('pl_range');
    if (!el || !r) return;
    
    if (state.activeModule === "loot") {
      const frame = state.frames.length > 0 ? state.frames[state.currentFrame] : null;
      el.textContent = frame ? frame.ts + ' (' + frame.totalItems + ' items)' : "—";
      r.max = state.frames.length > 0 ? state.frames.length - 1 : 0;
    } else {
      const frame = state.vehicleFrames.length > 0 ? state.vehicleFrames[state.currentFrame] : null;
      el.textContent = frame ? frame.ts + ' (' + frame.totalVehicles + ' véhicules)' : "—";
      r.max = state.vehicleFrames.length > 0 ? state.vehicleFrames.length - 1 : 0;
    }
    
    r.value = state.currentFrame;
  }

  function loop(){
    if (!state.playing) return;
    
    const maxFrames = state.activeModule === "loot" ? state.frames.length : state.vehicleFrames.length;
    
    state.currentFrame = state.currentFrame + 1;
    if (state.currentFrame >= maxFrames) state.currentFrame = 0;
    
    if (state.activeModule === "loot") {
      applyFilters();
    } else {
      applyVehicleFilters();
    }
    
    const delay = Math.max(100, Math.floor(500 / state.speed));
    setTimeout(loop, delay);
  }

  // ==================== MODULE VEHICULES ====================

  function switchToVehiclesModule() {
    console.log('[Module] Switching to vehicles');
    state.activeModule = "vehicles";
    document.getElementById('sidebar').style.display = 'none';
    document.getElementById('vehicle-sidebar').style.display = '';
    
    if (markerCluster) {
      markerCluster.clearLayers();
    } else if (layerGroup) {
      layerGroup.clearLayers();
    }
    state.markerById.clear();
    lastFrameIndex = -1;
    
    if (state.vehicles.length > 0) {
      buildVehicleFilters();
      applyVehicleFilters();
    }
  }

  function switchToLootModule() {
    console.log('[Module] Switching to loot');
    state.activeModule = "loot";
    document.getElementById('sidebar').style.display = '';
    document.getElementById('vehicle-sidebar').style.display = 'none';
    
    if (markerCluster) {
      markerCluster.clearLayers();
    } else if (layerGroup) {
      layerGroup.clearLayers();
    }
    state.markerById.clear();
    lastFrameIndex = -1;
    
    applyFilters();
  }

  async function loadVehicleFiles(files) {
    console.log('[Vehicle] Loading', files.length, 'file(s)...');
    
    let allVehicles = [];
    let allActions = [];
    
    for (let f = 0; f < files.length; f++) {
      const file = files[f];
      const text = await file.text();
      const parsed = parseVehicleLjson(text);
      allVehicles = allVehicles.concat(parsed.vehicles);
      allActions = allActions.concat(parsed.actions);
    }
    
    console.log('[Vehicle] Parsed:', allVehicles.length, 'vehicles,', allActions.length, 'actions');
    
    state.vehicles = allVehicles;
    state.vehicleActions = allActions;
    
    state.vehicleFrames = buildVehicleFrames(allVehicles, allActions);
    
    const types = new Set();
    const players = new Set();
    const actionTypes = new Set();
    
    for (let i = 0; i < allVehicles.length; i++) {
      if (allVehicles[i].vehicle_type) types.add(allVehicles[i].vehicle_type);
    }
    
    for (let i = 0; i < allActions.length; i++) {
      if (allActions[i].player_name) players.add(allActions[i].player_name);
      if (allActions[i].action) actionTypes.add(allActions[i].action);
    }
    
    state.vehicleTypes = types;
    state.vehicleTypeAllow = new Set(types);
    state.vehiclePlayers = players;
    state.vehiclePlayerAllow = new Set();
    state.vehicleActionTypes = actionTypes;
    state.vehicleActionAllow = new Set(actionTypes);
    
    console.log('[Vehicle] Types:', types.size, 'Players:', players.size, 'Actions:', actionTypes.size);
    
    if (allVehicles.length > 0 && allVehicles[0].world) {
      state.worldName = allVehicles[0].world;
      state.worldSize = allVehicles[0].worldSize || 15360;
    }
    
    buildVehicleFilters();
    buildPlayer();
    applyVehicleFilters();
  }

  function parseVehicleLjson(text) {
    const lines = text.split(/\r?\n/);
    const vehicles = [];
    const actions = [];
    
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim();
      if (!ln) continue;
      try {
        const o = JSON.parse(ln);
        if (o.type === "vehicle" && o.pos) {
          vehicles.push(o);
        } else if (o.type === "vehicle_action") {
          actions.push(o);
        }
      } catch (e) {
        console.warn('[VehicleParse] Invalid line:', ln.substring(0, 50));
      }
    }
    
    return { vehicles, actions };
  }

  function buildVehicleFrames(vehicles, actions) {
    console.log('[VehicleTimeline] Building frames...');
    
    const all = vehicles.concat(actions);
    
    const byTs = new Map();
    for (let i = 0; i < all.length; i++) {
      const item = all[i];
      const ts = item.ts || "0000-00-00T00:00:00";
      if (!byTs.has(ts)) byTs.set(ts, []);
      byTs.get(ts).push(item);
    }
    
    const tsList = Array.from(byTs.keys()).sort();
    const frames = [];
    const vehicleState = new Map();
    const actionHistory = [];
    
    for (let t = 0; t < tsList.length; t++) {
      const ts = tsList[t];
      const frameItems = byTs.get(ts);
      
      for (let i = 0; i < frameItems.length; i++) {
        const item = frameItems[i];
        if (item.type === "vehicle") {
          vehicleState.set(item.id, item);
        } else if (item.type === "vehicle_action") {
          actionHistory.push(item);
        }
      }
      
      frames.push({
        ts: ts,
        vehicles: Array.from(vehicleState.values()),
        actions: actionHistory.slice(),
        totalVehicles: vehicleState.size,
        totalActions: actionHistory.length
      });
    }
console.log('[VehicleTimeline] Built', frames.length, 'frames');
    return frames;
  }

  function applyVehicleFilters() {
    console.log('[VehicleFilter] Applying filters...');
    
    if (lastFrameIndex !== state.currentFrame) {
      if (markerCluster) {
        markerCluster.clearLayers();
      } else if (layerGroup) {
        layerGroup.clearLayers();
      }
      state.markerById.clear();
      lastFrameIndex = state.currentFrame;
    }
    
    const frame = state.vehicleFrames.length > 0 ? state.vehicleFrames[state.currentFrame] : { vehicles: state.vehicles, actions: state.vehicleActions };
    
    let filteredVehicles = frame.vehicles.filter(v => state.vehicleTypeAllow.has(v.vehicle_type));
    
    let filteredActions = frame.actions.filter(a => {
      if (!state.vehicleActionAllow.has(a.action)) return false;
      
      if (state.vehiclePlayerAllow.size > 0) {
        if (!state.vehiclePlayerAllow.has(a.player_name)) return false;
      }
      
      const concernedVehicle = filteredVehicles.find(v => v.id === a.vehicle_id);
      return concernedVehicle !== undefined;
    });
    
    state.vehicleFiltered = filteredVehicles;
    
    console.log('[VehicleFilter] Filtered:', filteredVehicles.length, 'vehicles,', filteredActions.length, 'actions');
    
    renderVehicleList(filteredVehicles, filteredActions);
    renderVehicleMarkers(filteredVehicles);
    updateVehicleStats(filteredVehicles, filteredActions);
    updatePlayerTs();
  }

  function renderVehicleMarkers(vehicles) {
    const batch = [];
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const ll = toLatLng(v.pos.x, v.pos.z);
      
      let color = '#3b82f6';
      if (v.hp_percent < 30) color = '#ef4444';
      else if (v.hp_percent < 60) color = '#f59e0b';
      else color = '#22c55e';
      
      const mk = L.circleMarker(ll, {
        radius: 5,
        weight: 2,
        color: color,
        fillOpacity: 0.8
      });
      
      mk._sp_vehicle = v;
      mk.on('click', () => {
        const popup = `
          <strong>${escapeHtml(v.vehicle_type)}</strong><br>
          ID: ${v.id}<br>
          HP: ${v.hp_percent}%<br>
          Fuel: ${Math.round(v.fuel_percent || 0)}%<br>
          Position: x:${v.pos.x.toFixed(1)} z:${v.pos.z.toFixed(1)}<br>
          Attached: ${v.attached ? v.attached.length : 0}<br>
          Cargo: ${v.cargo ? v.cargo.length : 0}
        `;
        sharedPopup.setLatLng(mk.getLatLng()).setContent(popup).openOn(map);
      });
      
      batch.push(mk);
      state.markerById.set(v.id, mk);
    }
    
    if (markerCluster) {
      markerCluster.addLayers(batch);
    } else if (layerGroup) {
      batch.forEach(mk => mk.addTo(layerGroup));
    }
  }

  function renderVehicleList(vehicles, actions) {
    const cont = document.getElementById('vehicle-list');
    cont.innerHTML = "";
    
    const byType = new Map();
    for (let i = 0; i < vehicles.length; i++) {
      const v = vehicles[i];
      const type = v.vehicle_type;
      if (!byType.has(type)) byType.set(type, []);
      byType.get(type).push(v);
    }
    
    const types = Array.from(byType.keys()).sort();
    
    for (let t = 0; t < types.length; t++) {
      const type = types[t];
      const typeVehicles = byType.get(type);
      
      const section = document.createElement('div');
      section.style.cssText = 'margin-bottom:20px;';
      
      const header = document.createElement('div');
      header.style.cssText = 'font-weight:600;font-size:14px;margin-bottom:8px;padding:8px;background:var(--card);border-radius:8px;';
      header.textContent = type + ' (' + typeVehicles.length + ')';
      section.appendChild(header);
      
      for (let i = 0; i < typeVehicles.length; i++) {
        const v = typeVehicles[i];
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = 'margin-bottom:8px;cursor:pointer;';
        
        const fuelPercent = v.fuel_percent || 0;
        const fuelColor = fuelPercent > 50 ? '#22c55e' : (fuelPercent > 20 ? '#f59e0b' : '#ef4444');
        
        card.innerHTML = `
          <div style="font-weight:600;margin-bottom:4px;font-size:11px;">ID: ${v.id}</div>
          <div class="sub">HP: ${v.hp_percent}% | Fuel: ${Math.round(fuelPercent)}%</div>
          <div style="display:flex;gap:4px;margin-top:4px;">
            <div class="hpbar" style="flex:1;"><div class="hpfill" style="width:${v.hp_percent}%;background:${hpColor(v.hp_percent)}"></div></div>
            <div class="hpbar" style="flex:1;"><div class="hpfill" style="width:${fuelPercent}%;background:${fuelColor}"></div></div>
          </div>
          <div class="sub" style="margin-top:4px;">
            x:${v.pos.x.toFixed(1)} z:${v.pos.z.toFixed(1)}<br>
            Attached: ${v.attached ? v.attached.length : 0} | Cargo: ${v.cargo ? v.cargo.length : 0}
          </div>
        `;
        
        card.addEventListener('click', (function(vehicleId){
          return function(){
            focusVehicleById(vehicleId);
          };
        })(v.id));
        
        section.appendChild(card);
      }
      
      cont.appendChild(section);
    }
    
    if (actions.length > 0 && (state.vehiclePlayerAllow.size > 0 || state.vehicleActionAllow.size < state.vehicleActionTypes.size)) {
      const actionsSection = document.createElement('div');
      actionsSection.style.cssText = 'margin-top:20px;padding:10px;background:var(--card);border-radius:8px;';
      
      const actionsTitle = document.createElement('div');
      actionsTitle.style.cssText = 'font-weight:600;margin-bottom:8px;';
      actionsTitle.textContent = 'Actions filtrées (' + actions.length + ')';
      actionsSection.appendChild(actionsTitle);
      
      for (let i = 0; i < Math.min(actions.length, 50); i++) {
        const a = actions[i];
        const actionCard = document.createElement('div');
        actionCard.style.cssText = 'font-size:11px;padding:4px;border-bottom:1px solid var(--border);';
        actionCard.innerHTML = `
          <strong>${escapeHtml(a.player_name)}</strong> 
          <span style="color:var(--accent);">${a.action}</span> 
          ${escapeHtml(a.vehicle_type)} 
          ${a.detail ? '(' + escapeHtml(a.detail) + ')' : ''}
          <span style="color:var(--muted);font-size:10px;">${a.ts}</span>
        `;
        actionsSection.appendChild(actionCard);
      }
      
      if (actions.length > 50) {
        const more = document.createElement('div');
        more.style.cssText = 'font-size:11px;color:var(--muted);padding:4px;';
        more.textContent = '... et ' + (actions.length - 50) + ' autres actions';
        actionsSection.appendChild(more);
      }
      
      cont.appendChild(actionsSection);
    }
  }

  function focusVehicleById(vehicleId) {
    const mk = state.markerById.get(vehicleId);
    if (!mk) return;
    const ll = mk.getLatLng();
    map.setView(ll, 2, {animate: true});
    mk.openPopup();
  }

  function updateVehicleStats(vehicles, actions) {
    const el = document.getElementById('vehicle-stats');
    if (!el) return;
    
    const frame = state.vehicleFrames.length > 0 ? state.vehicleFrames[state.currentFrame] : null;
    const ts = frame ? frame.ts : "—";
    
    el.textContent = vehicles.length + ' véhicules • ' + actions.length + ' actions • ' + ts;
  }

  function buildVehicleFilters() {
    const cont = document.getElementById('vehicle-filters');
    cont.innerHTML = "";
    
    const typeSection = document.createElement('div');
    typeSection.className = 'section';
    
    const typeTitle = document.createElement('h3');
    typeTitle.textContent = 'Types de véhicules';
    typeSection.appendChild(typeTitle);
    
    const types = Array.from(state.vehicleTypes).sort();
    for (let i = 0; i < types.length; i++) {
      const type = types[i];
      const label = document.createElement('label');
      label.className = 'checkbox';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.vehicleTypeAllow.has(type);
      cb.addEventListener('change', (function(t){
        return function(e){
          if (e.target.checked) {
            state.vehicleTypeAllow.add(t);
          } else {
            state.vehicleTypeAllow.delete(t);
          }
          applyVehicleFilters();
        };
      })(type));
      
      const span = document.createElement('span');
      span.textContent = type;
      
      label.appendChild(cb);
      label.appendChild(span);
      typeSection.appendChild(label);
    }
    
    cont.appendChild(typeSection);
    
    const playerSection = document.createElement('div');
    playerSection.className = 'section';
    
    const playerTitle = document.createElement('h3');
    playerTitle.textContent = 'Joueurs (actions)';
    playerSection.appendChild(playerTitle);
    
    const playerHint = document.createElement('div');
    playerHint.className = 'small';
    playerHint.textContent = 'Cochez pour filtrer les actions par joueur';
    playerHint.style.marginBottom = '8px';
    playerSection.appendChild(playerHint);
    
    const players = Array.from(state.vehiclePlayers).sort();
    for (let i = 0; i < players.length; i++) {
      const player = players[i];
      const label = document.createElement('label');
      label.className = 'checkbox';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.vehiclePlayerAllow.has(player);
      cb.addEventListener('change', (function(p){
        return function(e){
          if (e.target.checked) {
            state.vehiclePlayerAllow.add(p);
          } else {
            state.vehiclePlayerAllow.delete(p);
          }
          applyVehicleFilters();
        };
      })(player));
      
      const span = document.createElement('span');
      span.textContent = player;
      
      label.appendChild(cb);
      label.appendChild(span);
      playerSection.appendChild(label);
    }
    
    cont.appendChild(playerSection);
    
    const actionSection = document.createElement('div');
    actionSection.className = 'section';
    
    const actionTitle = document.createElement('h3');
    actionTitle.textContent = 'Types d\'actions';
    actionSection.appendChild(actionTitle);
    
    const actionTypes = Array.from(state.vehicleActionTypes).sort();
    for (let i = 0; i < actionTypes.length; i++) {
      const actType = actionTypes[i];
      const label = document.createElement('label');
      label.className = 'checkbox';
      
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = state.vehicleActionAllow.has(actType);
      cb.addEventListener('change', (function(at){
        return function(e){
          if (e.target.checked) {
            state.vehicleActionAllow.add(at);
          } else {
            state.vehicleActionAllow.delete(at);
          }
          applyVehicleFilters();
        };
      })(actType));
      
      const span = document.createElement('span');
      span.textContent = actType;
      
      label.appendChild(cb);
      label.appendChild(span);
      actionSection.appendChild(label);
    }
    
    cont.appendChild(actionSection);
    
    const btnSection = document.createElement('div');
    btnSection.className = 'section';
    
    const selectAllVeh = document.createElement('button');
    selectAllVeh.textContent = 'Tout cocher';
    selectAllVeh.addEventListener('click', function(){
      state.vehicleTypeAllow = new Set(state.vehicleTypes);
      buildVehicleFilters();
      applyVehicleFilters();
    });
    
    const unselectAllVeh = document.createElement('button');
    unselectAllVeh.textContent = 'Tout décocher';
    unselectAllVeh.style.marginLeft = '4px';
    unselectAllVeh.addEventListener('click', function(){
      state.vehicleTypeAllow = new Set();
      buildVehicleFilters();
      applyVehicleFilters();
    });
    
    btnSection.appendChild(selectAllVeh);
    btnSection.appendChild(unselectAllVeh);
    cont.appendChild(btnSection);
  }

  // ----- Wiring -----
  window.addEventListener('DOMContentLoaded', function(){
    document.body.classList.add('overlay-open');

    initMap();

    // Overlay boot
    const homeBtn = document.getElementById('homeStart');
    if (homeBtn){
      homeBtn.addEventListener('click', async function(){
        const files = document.getElementById('homeFile').files;
        if (!files || files.length === 0){ 
          alert('Sélectionne au moins un fichier .ljson'); 
          return; 
        }
        
        await loadFiles(files);
        
        const sel = document.querySelector('input[name="mapsel"]:checked');
        const selValue = sel ? sel.value : 'chernarus';
        if (selValue === 'chernarus'){ 
          loadBgUrl('maps/chernarus.png'); 
        }
        
        const ov = document.getElementById('overlay');
        if (ov){ 
          ov.style.display = 'none'; 
          document.body.classList.remove('overlay-open'); 
        }
        
        fitWorld();
        document.getElementById('meta').textContent = state.worldName + ' • ' + state.items.length + ' lignes • worldSize ' + state.worldSize;
        applyFilters();
      });
    }

    // In-app controls (LOOT)
    document.getElementById('file').addEventListener('change', async function(ev){
      if (!ev.target.files || ev.target.files.length === 0) return;
      await loadFiles(ev.target.files);
      document.getElementById('meta').textContent = state.worldName + ' • ' + state.items.length + ' lignes • worldSize ' + state.worldSize;
      fitWorld(); 
      applyFilters();
    });
    
    document.getElementById('bgimg').addEventListener('change', function(ev){
      if (!ev.target.files || ev.target.files.length === 0) return;
      const url = URL.createObjectURL(ev.target.files[0]);
      loadBgUrl(url);
    });
    
    document.getElementById('fit').addEventListener('click', fitWorld);
    
    document.getElementById('clear').addEventListener('click', function(){
      window.location.reload();
    });

    // Recherche (LOOT)
    document.getElementById('search').addEventListener('input', debounce(function(e){
      state.searchText = e.target.value;
      if (state.detailsOpen) {
        closeDetails();
      }
      applyFilters();
    }, 120));

    document.getElementById('selectAll').addEventListener('click', function(){
      state.classAllow = new Set(state.classes);
      applyFilters();
    });
    
    document.getElementById('unselectAll').addEventListener('click', function(){
      state.classAllow = new Set();
      applyFilters();
    });

    // MODULE VEHICULES
    const vehicleFileInput = document.getElementById('vehicle-file');
    if (vehicleFileInput) {
      vehicleFileInput.addEventListener('change', async function(ev){
        if (!ev.target.files || ev.target.files.length === 0) return;
        await loadVehicleFiles(ev.target.files);
        document.getElementById('meta').textContent = state.worldName + ' • ' + state.vehicles.length + ' véhicules • worldSize ' + state.worldSize;
        fitWorld();
      });
    }

    // Tabs
    document.querySelectorAll('#tabs .tab').forEach(el => {
      el.addEventListener('click', () => {
        document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.remove('active'));
        el.classList.add('active');
        const mod = el.dataset.mod;
        if (mod === 'loot') {
          switchToLootModule();
        } else if (mod === 'vehicles') {
          switchToVehiclesModule();
        }
      });
    });
  });
})();