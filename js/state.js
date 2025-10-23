
class Bus extends EventTarget{
  on(t,cb){ this.addEventListener(t, cb); }
  off(t,cb){ this.removeEventListener(t, cb); }
  emit(t, detail){ this.dispatchEvent(new CustomEvent(t,{detail})); }
}
export const bus = new Bus();

export const state = {
  worldName: "unknown",
  worldSize: 15360,
  items: [],
  filteredItems: [],
  classes: new Set(),
  activeModule: "loot",
  filter: { text: "", classAllow: new Set() }
};
