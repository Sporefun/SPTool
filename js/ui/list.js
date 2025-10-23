import { state, bus } from '../state.js';
import { escapeHtml } from '../utils.js';
import { focusById } from '../map.js';

function hpClass(p){ if (p<30) return 'danger'; if (p<60) return 'warn'; return ''; }

export function initList(){
  bus.on('data:filtered', render);
  bus.on('data:loaded', render);
}

function render(){
  const cont = document.getElementById('list');
  const items = state.filteredItems;
  cont.innerHTML = "";
  const frag = document.createDocumentFragment();
  for (let i=0;i<items.length;i++){
    const it = items[i];
    const el = document.createElement('div');
    el.className = 'card';
    el.tabIndex = 0;
    el.innerHTML = `
      <div class="title">${escapeHtml(it.name||'')}</div>
      <div class="sub">ID: ${it.id} • ${escapeHtml(it.class||'')}</div>
      <div class="badges">
        <span class="badge">${escapeHtml(state.worldName)}</span>
        <span class="badge">x:${it.pos.x.toFixed(1)} z:${it.pos.z.toFixed(1)}</span>
        <span class="badge">${it.hp_percent}% HP</span>
      </div>
      <div class="hpbar"><div class="hpfill ${hpClass(it.hp_percent)}" style="width:${it.hp_percent}%"></div></div>
    `;
    el.addEventListener('click', ()=> focusById(it.id, 0));
    el.addEventListener('keydown', (e)=>{ if (e.key === 'Enter') focusById(it.id, 0); });
    frag.appendChild(el);
  }
  cont.appendChild(frag);
  document.getElementById('stats').textContent =
    `${items.length} items filtrés • ${state.items.length} au total • ${state.worldName}`;
}
