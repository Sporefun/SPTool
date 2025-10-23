
import { state } from './state.js';
import { loadFiles } from './dataLoader.js';
import { initMap, fitWorld, loadBgImage, loadBgUrl } from './map.js';
import { initList } from './ui/list.js';
import { initFilters } from './ui/filters.js';
import * as Loot from './modules/loot.js';

const qs = (id)=>document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  // Initialize app UI and map immediately (map container is present)
  initMap();
  initList();
  initFilters();

  const overlay = qs('overlay');
  const homeFile = qs('homeFile');
  const startBtn = qs('homeStart');

  startBtn.addEventListener('click', async () => {
    const files = homeFile.files;
    if (!files || files.length === 0){
      alert('Sélectionne au moins un fichier .ljson');
      return;
    }
    await loadFiles(files);
    const sel = document.querySelector('input[name="mapsel"]:checked')?.value || 'chernarus';
    if (sel === 'chernarus'){
      loadBgUrl('maps/chernarus.png');
    }
    fitWorld();
    qs('meta').textContent = `${state.worldName} • ${state.items.length} items • worldSize ${state.worldSize}`;
    overlay.style.display = 'none';
  });

  // In-app controls remain as-is
  qs('file').addEventListener('change', async ev => {
    if (!ev.target.files || ev.target.files.length === 0) return;
    await loadFiles(ev.target.files);
    qs('meta').textContent = `${state.worldName} • ${state.items.length} items • worldSize ${state.worldSize}`;
    fitWorld();
  });
  qs('bgimg').addEventListener('change', ev => {
    if (!ev.target.files || ev.target.files.length === 0) return;
    loadBgImage(ev.target.files[0]);
  });
  qs('fit').addEventListener('click', fitWorld);
  qs('clear').addEventListener('click', () => window.location.reload());

  document.querySelectorAll('#tabs .tab').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.remove('active'));
      el.classList.add('active');
      const mod = el.dataset.mod;
      if (mod === 'loot'){ Loot.activate(); }
    });
  });
});
