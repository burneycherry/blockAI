import { world } from "@minecraft/server";

const KEY = "blockai:village";

/**
 * @typedef {{x:number,y:number,z:number}} Pos
 * @typedef {{
 *   dim: string,
 *   center: Pos,
 *   storage: Pos | null,
 *   mayor: string,
 *   founded: number,
 *   stats: Record<string, number>
 * }} VillageData
 */

/** @type {VillageData | null | undefined} */
let cache;

/** @returns {VillageData | null} */
export function getVillage() {
  if (cache !== undefined) return cache;
  const raw = world.getDynamicProperty(KEY);
  cache = null;
  if (typeof raw === "string") {
    try {
      cache = JSON.parse(raw);
    } catch (e) {
      cache = null;
    }
  }
  return cache ?? null;
}

/** @param {VillageData | null} data */
export function saveVillage(data) {
  cache = data;
  world.setDynamicProperty(KEY, data ? JSON.stringify(data) : undefined);
}

/**
 * @param {string} dim
 * @param {Pos} center
 * @param {string} mayor
 */
export function foundVillage(dim, center, mayor) {
  const old = getVillage();
  /** @type {VillageData} */
  const data = {
    dim,
    center: floorPos(center),
    storage: old && old.dim === dim ? old.storage : null,
    mayor,
    founded: old ? old.founded : Date.now(),
    stats: old ? old.stats : {},
  };
  saveVillage(data);
  return data;
}

/** @param {Pos | null} pos */
export function setStorage(pos) {
  const v = getVillage();
  if (!v) return;
  v.storage = pos ? floorPos(pos) : null;
  saveVillage(v);
}

/**
 * 納品された数を記録する
 * @param {string} itemId
 * @param {number} amount
 */
export function addStat(itemId, amount) {
  const v = getVillage();
  if (!v) return;
  v.stats[itemId] = (v.stats[itemId] || 0) + amount;
  saveVillage(v);
}

/** @param {Pos} p */
export function floorPos(p) {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}
