
import { state, bus } from './state.js';

export async function loadFiles(files){
  let all = [];
  for (const f of files){
    const text = await f.text();
    const arr = parseLjson(text);
    all = all.concat(arr);
  }
  if (all.length > 0){
    const last = all[all.length-1];
    if (last.world) state.worldName = last.world;
    if (last.worldSize) state.worldSize = +last.worldSize;
  }
  state.items = all.filter(o=>o.type==="item");
  const cls = new Set();
  for (const it of state.items){ if (it.class) cls.add(it.class); }
  state.classes = cls;
  state.filter.classAllow = new Set(cls);
  applyFilters();
  bus.emit('data:loaded', {});
}

export function clearData(){
  state.items = [];
  state.filteredItems = [];
  state.classes = new Set();
  state.filter.classAllow = new Set();
  bus.emit('data:cleared', {});
}

export function applyFilters(){
  const q = state.filter.text.toLowerCase();
  let out = state.items.filter(it => state.filter.classAllow.has(it.class));
  if (q){
    out = out.filter(it => 
      (it.name||'').toLowerCase().includes(q) ||
      (it.class||'').toLowerCase().includes(q) ||
      String(it.id).includes(q)
    );
  }
  state.filteredItems = out;
  bus.emit('data:filtered', {});
}

function parseLjson(text){
  const lines = text.split(/\r?\n/);
  const out = [];
  let ws = null, wn = null;
  for (let i=0;i<lines.length;i++){
    const ln = lines[i].trim();
    if (!ln) continue;
    try{
      const o = JSON.parse(ln);
      if (o.worldSize) ws = o.worldSize;
      if (o.world) wn = o.world;
      if (o.type === "item" && o.pos && typeof o.id !== "undefined") out.push(o);
    }catch(e){}
  }
  if (ws) out.push({type:"meta", worldSize: ws, world: wn});
  return out;
}
