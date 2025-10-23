
import { state } from './state.js';
import { loadFiles, clearData, applyFilters } from './dataLoader.js';
import { initMap, fitWorld, loadBgImage } from './map.js';
import { initList } from './ui/list.js';
import { initFilters } from './ui/filters.js';
import * as Loot from './modules/loot.js';

window.addEventListener('DOMContentLoaded', () => {
  initMap();
  initList();
  initFilters();

  document.getElementById('file').addEventListener('change', async ev => {
    if (!ev.target.files || ev.target.files.length === 0) return;
    await loadFiles(ev.target.files);
    document.getElementById('meta').textContent = `${state.worldName} • ${state.items.length} items • worldSize ${state.worldSize}`;
    fitWorld();
  });

  document.getElementById('bgimg').addEventListener('change', ev => {
    if (!ev.target.files || ev.target.files.length === 0) return;
    loadBgImage(ev.target.files[0]);
  });

  document.getElementById('fit').addEventListener('click', fitWorld);
  document.getElementById('clear').addEventListener('click', () => {
    clearData();
    document.getElementById('meta').textContent = `Aucun fichier`;
  });

  document.querySelectorAll('#tabs .tab').forEach(el => {
    el.addEventListener('click', () => {
      document.querySelectorAll('#tabs .tab').forEach(t=>t.classList.remove('active'));
      el.classList.add('active');
      const mod = el.dataset.mod;
      if (mod === 'loot'){ Loot.activate(); }
      applyFilters();
    });
  });
});
