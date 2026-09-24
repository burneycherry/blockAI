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
 *   stats: Record<string, number>,
 *   testMode?: boolean,
 *   keepLoaded?: boolean,
 *   jobAreas?: Record<string, Area>,
 *   protect?: (Area & { name: string })[],
 *   revive?: boolean
 * }} VillageData
 *
 * @typedef {{ x: number, y: number, z: number, r: number }} Area
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
    testMode: old ? old.testMode : false,
    keepLoaded: old ? old.keepLoaded : true,
    jobAreas: old ? old.jobAreas : {},
    protect: old ? old.protect : [],
    revive: old ? old.revive : true,
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
  const before = villageLevel(v).level;
  v.stats[itemId] = (v.stats[itemId] || 0) + amount;
  saveVillage(v);
  const after = villageLevel(v);
  if (after.level > before) {
    world.sendMessage(`§a[blockAI] 村が レベル${after.level} になりました！ 仕事の範囲が 半径${after.radius} に広がりました。`);
  }
}

/** @param {Pos} p */
export function floorPos(p) {
  return { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) };
}

/**
 * テストモード（特技をレベルに関係なく使える）
 * @param {boolean} on
 */
export function setTestMode(on) {
  const v = getVillage();
  if (!v) return;
  v.testMode = on;
  saveVillage(v);
}

// ---------------------------------------------------------------
// 村のレベル（倉庫に届いた数で上がり、仕事の範囲が広がる）
// ---------------------------------------------------------------

/** 村レベルごとに必要な納品数と、仕事の範囲（半径） */
export const VILLAGE_LEVELS = [
  { need: 0, radius: 32 },
  { need: 500, radius: 40 },
  { need: 2000, radius: 48 },
  { need: 5000, radius: 56 },
  { need: 10000, radius: 64 },
];

/** @param {VillageData} v */
export function villageLevel(v) {
  let total = 0;
  for (const k in v.stats) total += v.stats[k];
  let lv = 1;
  for (let i = 0; i < VILLAGE_LEVELS.length; i++) if (total >= VILLAGE_LEVELS[i].need) lv = i + 1;
  const next = VILLAGE_LEVELS[lv];
  return { level: lv, radius: VILLAGE_LEVELS[lv - 1].radius, total, next: next ? next.need : undefined };
}

// ---------------------------------------------------------------
// 職業ごとの仕事場
// ---------------------------------------------------------------

/**
 * @param {string} jobId
 * @param {Area | undefined} area undefined なら村全体に戻す
 */
export function setJobArea(jobId, area) {
  const v = getVillage();
  if (!v) return;
  v.jobAreas = v.jobAreas ?? {};
  if (area) v.jobAreas[jobId] = { x: Math.floor(area.x), y: Math.floor(area.y), z: Math.floor(area.z), r: area.r };
  else delete v.jobAreas[jobId];
  saveVillage(v);
}

/**
 * その職業が働く範囲（仕事場が無ければ村全体）
 * @param {VillageData} v
 * @param {string} jobId
 * @returns {Area}
 */
export function workArea(v, jobId) {
  const a = v.jobAreas?.[jobId];
  if (a) return a;
  return { ...v.center, r: villageLevel(v).radius };
}

// ---------------------------------------------------------------
// 立ち入り禁止エリア
// ---------------------------------------------------------------

/**
 * @param {string} name
 * @param {Area} area
 */
export function addProtect(name, area) {
  const v = getVillage();
  if (!v) return;
  v.protect = v.protect ?? [];
  v.protect.push({ name, x: Math.floor(area.x), y: Math.floor(area.y), z: Math.floor(area.z), r: area.r });
  saveVillage(v);
}

/** @param {number} index */
export function removeProtect(index) {
  const v = getVillage();
  if (!v || !v.protect) return;
  v.protect.splice(index, 1);
  saveVillage(v);
}

/**
 * 立ち入り禁止エリアの中か（高さは見ない）
 * @param {VillageData} v
 * @param {number} x
 * @param {number} z
 */
export function isProtected(v, x, z) {
  for (const a of v.protect ?? []) {
    const dx = x - a.x;
    const dz = z - a.z;
    if (dx * dx + dz * dz <= a.r * a.r) return true;
  }
  return false;
}

/** @param {boolean} on */
export function setKeepLoaded(on) {
  const v = getVillage();
  if (!v) return;
  v.keepLoaded = on;
  saveVillage(v);
}

/**
 * 村人が倒れたとき、翌朝に戻ってくるか（false なら死んだら終わり）
 * @param {VillageData | null} v
 */
export function reviveOn(v) {
  return v?.revive !== false;
}

/** @param {boolean} on */
export function setRevive(on) {
  const v = getVillage();
  if (!v) return;
  v.revive = on;
  saveVillage(v);
}
