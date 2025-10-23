
import { state } from './state.js';
import { loadFiles } from './dataLoader.js';
import { initMap, fitWorld, loadBgImage, loadBgUrl } from './map.js';
import { initList } from './ui/list.js';
import { initFilters } from './ui/filters.js';
import * as Loot from './modules/loot.js';

const q = (id)=>document.getElementById(id);

window.addEventListener('DOMContentLoaded', () => {
  // Init core UI pieces
  initMap();
  initList();
  initFilters();

  const overlay = q('overlay');
  const homeFile = q('homeFile');
  const startBtn = q('homeStart');

  startBtn.addEventListener('click', async () => {
    try{
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
      q('meta').textContent = `${state.worldName} • ${state.items.length} items • worldSize ${state.worldSize}`;
      overlay.style.display = 'none';
    }catch(e){
      console.error('app_boot start error', e);
      alert('Erreur au démarrage. Voir console.');
    }
  });

  // In-app controls
  q('file').addEventListener('change', async ev => {
    if (!ev.target.files || ev.target.files.length === 0) return;
    await loadFiles(ev.target.files);
    q('meta').textContent = `${state.worldName} • ${state.items.length} items • worldSize ${state.worldSize}`;
    fitWorld();
  });
  q('bgimg').addEventListener('change', ev => {
    if (!ev.target.files || ev.target.files.length === 0) return;
    loadBgImage(ev.target.files[0]);
  });
  q('fit').addEventListener('click', fitWorld);
  q('clear').addEventListener('click', () => window.location.reload());

  document.querySelectorAll('#tabs .tab').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.remove('active'));
      el.classList.add('active');
      const mod = el.dataset.mod;
      if (mod === 'loot'){ Loot.activate(); }
    });
  });
});
