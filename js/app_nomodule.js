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

    // filtres
    filtered: [],
    classes: new Set(),
    classAllow: new Set(),
    searchText: "",

    // carte
    markerById: new Map(),

    // panneau de détails
    detailsOpen: false,
    detailsClass: ""
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

    state.frames = buildFramesWithFullState(all);
    
    state.tsIndex.clear();
    for (let i = 0; i < state.frames.length; i++) {
      state.tsIndex.set(state.frames[i].ts, i);
    }
    
    state.currentFrame = 0;
    lastFrameIndex = -1;

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
    if (state.currentFrame !== lastFrameIndex){
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

    // Filtrer UNIQUEMENT pour la carte (selon classAllow)
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
  }

  // ----- UI: liste avec compteurs et bouton détails -----
  function renderList(){
    const cont = document.getElementById('list');
    cont.innerHTML = "";
    
    const frameItems = state.frames.length > 0 ? state.frames[state.currentFrame].items : state.items;
    
    if (frameItems.length === 0) {
      cont.innerHTML = '<div class="small" style="padding:10px">Aucun item</div>';
      return;
    }
    
    // Compter par classe (TOUTES les classes, pas seulement cochées)
    const classCounts = new Map();
    for (let i = 0; i < frameItems.length; i++){
      const it = frameItems[i];
      const cls = it.class;
      if (!classCounts.has(cls)) {
        classCounts.set(cls, 0);
      }
      classCounts.set(cls, classCounts.get(cls) + 1);
    }
    
    // Filtrer par recherche
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

  // ----- Panneau de détails -----
  function openDetails(className){
    state.detailsOpen = true;
    state.detailsClass = className;
    
    const frameItems = state.frames.length > 0 ? state.frames[state.currentFrame].items : state.items;
    const classItems = frameItems.filter(it => it.class === className);
    
    const cont = document.getElementById('list');
    cont.innerHTML = "";
    
    // Header avec bouton retour
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
    
    // Liste des items
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
    
    // Footer avec bouton fermer
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

  // ----- Filtres UI -----
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

    // Recherche
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
  });
})();