import { state, bus } from './state.js';
import { escapeHtml } from './utils.js';

let map, layerGroup, bgOverlay;
let markerById = new Map();

function toLatLng(x,z){
  const y = state.worldSize - z;
  return [y, x];
}

export function initMap(){
  if (map) return;
  map = L.map('map', {
    crs: L.CRS.Simple,
    preferCanvas: true,
    minZoom: -2,
    scrollWheelZoom: true,
    dragging: true
  });
  layerGroup = L.layerGroup().addTo(map);
  fitWorld();
  bus.on('data:loaded', renderMarkers);
  bus.on('data:filtered', renderMarkers);
  window.addEventListener('resize', () => map.invalidateSize());
}

export function fitWorld(){
  if (!map) return;
  const bounds = [[0,0],[state.worldSize, state.worldSize]];
  map.setMaxBounds(bounds);
  map.fitBounds(bounds);
}

export function renderMarkers(){
  if (!map) return;
  layerGroup.clearLayers();
  markerById.clear();

  const items = state.filteredItems;
  for (let i=0;i<items.length;i++){
    const it = items[i];
    const ll = toLatLng(it.pos.x, it.pos.z);
    const color = hpColor(it.hp_percent);
    const mk = L.circleMarker(ll, { radius: 3, weight: 1, color: color, fillOpacity: 0.7 });
    mk.bindPopup(`<strong>${escapeHtml(it.name||'')}</strong><br>ID: ${it.id}<br>${escapeHtml(it.class||'')}<br>HP: ${it.hp_percent}%<br>x:${it.pos.x.toFixed(1)} y:${it.pos.y.toFixed(1)} z:${it.pos.z.toFixed(1)}`);
    mk.addTo(layerGroup);
    markerById.set(it.id, mk);
  }
}

export function focusById(id, zoom=0){
  if (!map) return;
  const mk = markerById.get(id);
  if (!mk) return;
  const ll = mk.getLatLng();
  map.setView(ll, zoom, { animate: true });
  mk.openPopup();
}

export function loadBgImage(file){
  const url = URL.createObjectURL(file);
  const bounds = [[0,0],[state.worldSize, state.worldSize]];
  if (bgOverlay) map.removeLayer(bgOverlay);
  bgOverlay = L.imageOverlay(url, bounds).addTo(map);
  map.fitBounds(bounds);
}

function hpColor(p){
  if (p < 30) return '#ef4444';
  if (p < 60) return '#f59e0b';
  return '#22c55e';
}
