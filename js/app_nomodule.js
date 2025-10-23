(function(){
  // ----- State -----
  const state = {
    worldName: "unknown",
    worldSize: 15360,

    items: [],

    // timeline avec reconstruction d'état
    frames: [],          // [{ts:"...", items:[...complet...], changes:N}, ...]
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
    
    // Clustering de markers pour les performances
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

    // Si changement de frame, tout recréer
    if (state.currentFrame !== lastFrameIndex){
      if (markerCluster) {
        markerCluster.clearLayers();
      } else if (layerGroup) {
        layerGroup.clearLayers();
      }
      state.markerById.clear();
      lastFrameIndex = state.currentFrame;
    }

    const want = new Map();
    for (let i=0; i<state.filtered.length; i++){ 
      const it = state.filtered[i]; 
      want.set(it.id, it); 
    }

    // Supprimer les markers absents
    const toRemove = [];
    for (const [id, mk] of Array.from(state.markerById.entries())){
      if (!want.has(id)){
        toRemove.push({id, mk});
      }
    }
    for (const {id, mk} of toRemove) {
      if (markerCluster) {
        markerCluster.removeLayer(mk);
      } else if (layerGroup) {
        layerGroup.removeLayer(mk);
      }
      state.markerById.delete(id);
    }

    // Ajouter les markers manquants par batch
    const toAdd = [];
    for (const [id, it] of want.entries()){
      if (!state.markerById.has(id)) toAdd.push(it);
    }

    let i = 0;
    const CHUNK = 500;
    
    function step(){
      const end = Math.min(i + CHUNK, toAdd.length);
      const batch = [];
      
      while (i < end){
        const it = toAdd[i];
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
        i++;
      }
      
      // Ajouter le batch en une fois
      if (markerCluster) {
        markerCluster.addLayers(batch);
      } else if (layerGroup) {
        batch.forEach(mk => mk.addTo(layerGroup));
      }
      
      if (i < toAdd.length) {
        requestAnimationFrame(step);
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

  // ----- RECONSTRUCTION D'ÉTAT PAR FRAME -----
  function buildFramesWithFullState(allItems){
    console.log('[Timeline] Construction des frames avec état complet...');
    
    // 1. Grouper par timestamp
    const byTs = new Map();
    for (let i = 0; i < allItems.length; i++){
      const item = allItems[i];
      const ts = item.ts || "0000-00-00T00:00:00";
      if (!byTs.has(ts)) byTs.set(ts, []);
      byTs.get(ts).push(item);
    }
    
    // 2. Trier les timestamps
    const tsList = Array.from(byTs.keys()).sort();
    console.log('[Timeline] ' + tsList.length + ' timestamps trouvés');
    
    // 3. Reconstruire l'état complet pour chaque frame
    const frames = [];
    const itemsState = new Map(); // id -> dernier état connu
    
    for (let t = 0; t < tsList.length; t++){
      const ts = tsList[t];
      const frameChanges = byTs.get(ts);
      
      // Appliquer les changements de cette frame
      for (let i = 0; i < frameChanges.length; i++){
        const item = frameChanges[i];
        
        if (item.type === "item_remove") {
          // Supprimer l'item de l'état
          itemsState.delete(item.id);
        } else if (item.type === "item") {
          // Ajouter ou mettre à jour l'item
          itemsState.set(item.id, item);
        }
      }
      
      // Créer une snapshot complète de l'état actuel
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

  // ----- Données & parsing -----
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

    // Construction des frames avec état complet
    state.frames = buildFramesWithFullState(all);
    
    // Index des timestamps
    state.tsIndex.clear();
    for (let i = 0; i < state.frames.length; i++) {
      state.tsIndex.set(state.frames[i].ts, i);
    }
    
    state.currentFrame = 0;
    lastFrameIndex = -1;

    // Classes uniques
    const classSet = new Set();
    for (let i = 0; i < all.length; i++){
      if (all[i].class) classSet.add(all[i].class);
    }
    state.classes = classSet;
    state.classAllow = new Set(state.classes);

    buildFilters();
    buildPlayer();
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

  // ----- Filtres -----
  function applyFilters(){
    // Si frame a changé, on recrée tout
    if (state.currentFrame !== lastFrameIndex){
      if (markerCluster) {
        markerCluster.clearLayers();
      } else if (layerGroup) {
        layerGroup.clearLayers();
      }
      state.markerById.clear();
      lastFrameIndex = state.currentFrame;
    }

    const q = document.getElementById('search').value.trim().toLowerCase();
    const frameItems = state.frames.length > 0 ? state.frames[state.currentFrame].items : state.items;

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

  // ----- UI: liste virtualisée simple -----
  let listScrollTop = 0;
  const ITEM_HEIGHT = 110; // hauteur approximative d'une card
  const BUFFER = 5; // items avant/après viewport

  function renderList(){
    const cont = document.getElementById('list');
    const currentScroll = cont.scrollTop;
    
    cont.innerHTML = "";
    
    if (state.filtered.length === 0) {
      cont.innerHTML = '<div class="small" style="padding:10px">Aucun item</div>';
      return;
    }
    
    // Calcul du viewport
    const containerHeight = cont.clientHeight;
    const totalHeight = state.filtered.length * ITEM_HEIGHT;
    const startIndex = Math.max(0, Math.floor(currentScroll / ITEM_HEIGHT) - BUFFER);
    const endIndex = Math.min(state.filtered.length, Math.ceil((currentScroll + containerHeight) / ITEM_HEIGHT) + BUFFER);
    
    // Container pour le scroll virtuel
    const wrapper = document.createElement('div');
    wrapper.style.height = totalHeight + 'px';
    wrapper.style.position = 'relative';
    
    const frag = document.createDocumentFragment();
    
    for (let i = startIndex; i < endIndex; i++){
      const it = state.filtered[i];
      const el = document.createElement('div');
      el.className = 'card';
      el.style.cursor = 'pointer';
      el.style.position = 'absolute';
      el.style.top = (i * ITEM_HEIGHT) + 'px';
      el.style.left = '0';
      el.style.right = '0';
      
      el.innerHTML = `
        <div class="title">${escapeHtml(it.name||'')}</div>
        <div class="sub">ID: ${it.id} • ${escapeHtml(it.class||'')}</div>
        <div class="badges">
          <span class="badge">${escapeHtml(state.worldName)}</span>
          <span class="badge">x:${it.pos.x.toFixed(1)} z:${it.pos.z.toFixed(1)}</span>
          <span class="badge">${it.hp_percent}% HP</span>
        </div>
        <div class="hpbar"><div class="hpfill" style="width:${it.hp_percent}%; background:${hpColor(it.hp_percent)}"></div></div>`;
      
      el.addEventListener('click', (function(id){ 
        return function(){ focusById(id, 0); }; 
      })(it.id));
      
      frag.appendChild(el);
    }
    
    wrapper.appendChild(frag);
    cont.appendChild(wrapper);
    cont.scrollTop = currentScroll;
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

  // ----- Filtres UI -----
  function buildFilters(){
    const host = document.getElementById('loot-filters');
    host.innerHTML = "";
    const classes = Array.from(state.classes).sort((a,b) => a.localeCompare(b));
    const group = document.createElement('div');
    const title = document.createElement('h3');
    title.textContent = "Loot • Classes";
    group.appendChild(title);
    
    for (let i = 0; i < classes.length; i++){
      const cls = classes[i];
      const div = document.createElement('label');
      div.className = 'checkbox';
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
      
      const span = document.createElement('span'); 
      span.textContent = cls;
      div.appendChild(cb); 
      div.appendChild(span);
      group.appendChild(div);
    }
    host.appendChild(group);
  }

  // ----- Lecteur -----
  function buildPlayer(){
    const r = document.getElementById('pl_range');
    const bPlay = document.getElementById('pl_play');
    const bPause = document.getElementById('pl_pause');
    const spd = document.getElementById('pl_speed');
    if (!r || !bPlay || !bPause || !spd) return;

    r.min = 0;
    r.max = state.frames.length > 0 ? state.frames.length - 1 : 0;
    r.value = state.currentFrame;

    r.oninput = function(){
      state.currentFrame = parseInt(r.value, 10) || 0;
      applyFilters();
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
    
    const frame = state.frames.length > 0 ? state.frames[state.currentFrame] : null;
    el.textContent = frame ? frame.ts + ' (' + frame.totalItems + ' items)' : "—";
    r.max = state.frames.length > 0 ? state.frames.length - 1 : 0;
    r.value = state.currentFrame;
  }

  function loop(){
    if (!state.playing) return;
    state.currentFrame = state.currentFrame + 1;
    if (state.currentFrame >= state.frames.length) state.currentFrame = 0;
    applyFilters();
    const delay = Math.max(100, Math.floor(500 / state.speed));
    setTimeout(loop, delay);
  }

  // ----- Scroll virtualisé sur la liste -----
  function setupListScroll(){
    const cont = document.getElementById('list');
    if (!cont) return;
    cont.addEventListener('scroll', debounce(renderList, 50));
  }

  // ----- Wiring -----
  window.addEventListener('DOMContentLoaded', function(){
    document.body.classList.add('overlay-open');

    initMap();
    setupListScroll();

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

    // In-app controls
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

    // Recherche avec debounce
    document.getElementById('search').addEventListener('input', debounce(applyFilters, 120));

    document.getElementById('selectAll').addEventListener('click', function(){
      state.classAllow = new Set(state.classes); 
      buildFilters(); 
      applyFilters();
    });
    
    document.getElementById('unselectAll').addEventListener('click', function(){
      state.classAllow = new Set(); 
      buildFilters(); 
      applyFilters();
    });
  });
})();