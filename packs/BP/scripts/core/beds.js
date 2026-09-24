// 夜の寝床（村のベッドを探して、村人に1つずつ割り当てる）
import { BlockVolume, system, world } from "@minecraft/server";
import { NIGHT_END, NIGHT_START } from "./config.js";
import { key, safeBlock } from "./blocks.js";
import { removeHomeMarker, spawnHomeMarker } from "./tasks.js";

/**
 * @typedef {{x:number,y:number,z:number}} Pos
 * @typedef {{ key: string, head: Pos, foot: Pos, mid: Pos, wpId: string | undefined }} Bed
 */

/** ベッドを探す範囲（村の中心から） */
const BED_RADIUS = 32;

/** 夜か（村人が休む時間） */
export function isNight() {
  const t = world.getTimeOfDay();
  return t >= NIGHT_START && t < NIGHT_END;
}

/** @type {Bed[]} */
let beds = [];
/** 日が変わったら探し直す */
let bedsDay = -1;
/** 最後に探した時刻（空きが無いときに、置かれたばかりのベッドを見つけるため探し直す） */
let lastScan = -10000;
/** 村人ID → ベッド */
/** @type {Map<string, Bed>} */
const assigned = new Map();

/**
 * 村の周りのベッドを探す
 * @param {import("./village.js").VillageData} village
 */
function scanBeds(village) {
  /** @type {Bed[]} */
  const found = [];
  try {
    const dim = world.getDimension(village.dim);
    const c = village.center;
    const vol = new BlockVolume(
      { x: c.x - BED_RADIUS, y: c.y - 10, z: c.z - BED_RADIUS },
      { x: c.x + BED_RADIUS, y: c.y + 14, z: c.z + BED_RADIUS },
    );
    const list = dim.getBlocks(vol, { includeTypes: ["minecraft:bed"] }, true);
    for (const p of list.getBlockLocationIterator()) {
      const b = safeBlock(dim, p);
      if (!b || b.permutation.getState("head_piece_bit") !== true) continue;
      // 頭側の隣にある足側を探す
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const f = safeBlock(dim, { x: p.x + dx, y: p.y, z: p.z + dz });
        if (f?.typeId === "minecraft:bed" && f.permutation.getState("head_piece_bit") !== true) {
          const foot = { x: f.x, y: f.y, z: f.z };
          const head = { x: p.x, y: p.y, z: p.z };
          found.push({
            key: key(head),
            head,
            foot,
            mid: { x: (head.x + foot.x) / 2 + 0.5, y: head.y + 0.5625, z: (head.z + foot.z) / 2 + 0.5 },
            wpId: undefined,
          });
          break;
        }
      }
    }
  } catch (err) {
    console.warn(`[blockAI] bed scan: ${err}`);
  }
  const s = village.storage ?? village.center;
  found.sort((a, b) => dist2(a.head, s) - dist2(b.head, s));
  return found;
}

/** @param {Pos} a @param {Pos} b */
function dist2(a, b) {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
}

/**
 * ベッドがまだ使えるか（壊されていない・普通の村人やプレイヤーが寝ていない）
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Bed} bed
 */
export function bedUsable(dim, bed) {
  const b = safeBlock(dim, bed.head);
  if (!b || b.typeId !== "minecraft:bed") return false;
  if (b.permutation.getState("occupied_bit") === true) return false;
  return true;
}

/**
 * 村人にベッドを割り当てる。空きが無ければ undefined
 * @param {import("@minecraft/server").Entity} e
 * @param {import("./village.js").VillageData} village
 */
export function assignBed(e, village) {
  const day = world.getDay();
  if (bedsDay !== day) {
    releaseAllBeds();
    beds = scanBeds(village);
    bedsDay = day;
    lastScan = system.currentTick;
  }
  const mine = assigned.get(e.id);
  if (mine && bedUsable(e.dimension, mine)) return mine;
  if (mine) releaseBed(e.id);
  const found = pickBed(e);
  if (found || system.currentTick - lastScan < 200) return found;
  // 空きが無ければ、新しく置かれたベッドが無いか探し直す（10秒に1回まで）
  beds = scanBeds(village);
  lastScan = system.currentTick;
  return pickBed(e);
}

/** @param {import("@minecraft/server").Entity} e */
function pickBed(e) {
  const taken = new Set([...assigned.values()].map((b) => b.key));
  for (const bed of beds) {
    if (taken.has(bed.key) || !bedUsable(e.dimension, bed)) continue;
    // 普通の村人が近くにいるベッドは、その村人の物として避ける
    try {
      const near = e.dimension.getEntities({ type: "minecraft:villager_v2", location: bed.mid, maxDistance: 1.5 });
      if (near.length > 0) continue;
    } catch (err) {
      // 無視
    }
    assigned.set(e.id, bed);
    return bed;
  }
  return undefined;
}

/**
 * 歩いて向かう目印を置く（見られているときだけ使う）
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Bed} bed
 */
export function markBed(dim, bed) {
  if (!bed.wpId) bed.wpId = spawnHomeMarker(dim, bed.mid);
}

/** @param {Bed} bed */
export function unmarkBed(bed) {
  removeHomeMarker(bed.wpId);
  bed.wpId = undefined;
}

/** @param {string} villagerId */
export function releaseBed(villagerId) {
  const bed = assigned.get(villagerId);
  if (bed) unmarkBed(bed);
  assigned.delete(villagerId);
}

function releaseAllBeds() {
  for (const id of [...assigned.keys()]) releaseBed(id);
}
