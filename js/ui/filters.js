
import { state, bus } from '../state.js';
import { applyFilters } from '../dataLoader.js';

export function initFilters(){
  bus.on('data:loaded', build);
  bus.on('data:cleared', build);
  document.getElementById('search').addEventListener('input', (e)=>{
    state.filter.text = e.target.value;
    applyFilters();
  });
  document.getElementById('selectAll').addEventListener('click', ()=>{
    state.filter.classAllow = new Set(state.classes);
    syncCheckboxes(true);
    applyFilters();
  });
  document.getElementById('unselectAll').addEventListener('click', ()=>{
    state.filter.classAllow = new Set();
    syncCheckboxes(false);
    applyFilters();
  });
}

function build(){
  const host = document.getElementById('loot-filters');
  host.innerHTML = "";
  if (state.classes.size === 0){
    host.innerHTML = `<div class="small">Charge un fichier .ljson</div>`;
    return;
  }
  const classes = Array.from(state.classes).sort((a,b)=>a.localeCompare(b));
  const group = document.createElement('div');
  group.className = 'section';
  const title = document.createElement('h3');
  title.textContent = "Loot • Classes";
  group.appendChild(title);
  for (let i=0;i<classes.length;i++){
    const cls = classes[i];
    const id = 'cls_' + i;
    const div = document.createElement('label');
    div.className = 'checkbox';
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.id = id;
    cb.checked = state.filter.classAllow.has(cls);
    cb.dataset.cls = cls;
    cb.addEventListener('change', (e)=>{
      const c = e.target.dataset.cls;
      if (e.target.checked) state.filter.classAllow.add(c);
      else state.filter.classAllow.delete(c);
      applyFilters();
    });
    const span = document.createElement('span');
    span.textContent = cls;
    div.appendChild(cb);
    div.appendChild(span);
    group.appendChild(div);
  }
  host.appendChild(group);
}

function syncCheckboxes(val){
  const host = document.getElementById('loot-filters');
  const cbs = host.querySelectorAll('input[type=checkbox]');
  cbs.forEach(cb=>cb.checked = val);
}
