import { system, world } from "@minecraft/server";
import { MAX_CROP_TASKS, MAX_TREE_TASKS, WORK_RADIUS, WP_IDS } from "./config.js";

/**
 * @typedef {{x:number,y:number,z:number}} Pos
 * @typedef {{
 *   id: number,
 *   kind: "tree" | "crop",
 *   dim: string,
 *   stand: Pos,
 *   blocks: Pos[],
 *   bases: Pos[],
 *   wpId: string | undefined
 * }} Task
 */

/** @type {Map<number, Task>} */
export const tasks = new Map();
/** 既に仕事として登録済みのブロック（重複登録防止） */
const claimed = new Set();
let nextTaskId = 1;

/** 倉庫マーカーのエンティティID */
let storageWpId = /** @type {string | undefined} */ (undefined);

const SOIL = new Set([
  "minecraft:dirt",
  "minecraft:grass_block",
  "minecraft:podzol",
  "minecraft:coarse_dirt",
  "minecraft:mycelium",
  "minecraft:moss_block",
  "minecraft:rooted_dirt",
  "minecraft:mud",
  "minecraft:muddy_mangrove_roots",
  "minecraft:dirt_with_roots",
]);

/** 収穫できる作物: 収穫物と種 */
export const CROPS = {
  "minecraft:wheat": { item: "minecraft:wheat", min: 1, max: 1, seed: "minecraft:wheat_seeds" },
  "minecraft:carrots": { item: "minecraft:carrot", min: 2, max: 4, seed: undefined },
  "minecraft:potatoes": { item: "minecraft:potato", min: 2, max: 4, seed: undefined },
  "minecraft:beetroot": { item: "minecraft:beetroot", min: 1, max: 1, seed: "minecraft:beetroot_seeds" },
};

const SAPLINGS = {
  "minecraft:oak_log": "minecraft:oak_sapling",
  "minecraft:spruce_log": "minecraft:spruce_sapling",
  "minecraft:birch_log": "minecraft:birch_sapling",
  "minecraft:jungle_log": "minecraft:jungle_sapling",
  "minecraft:acacia_log": "minecraft:acacia_sapling",
  "minecraft:dark_oak_log": "minecraft:dark_oak_sapling",
  "minecraft:cherry_log": "minecraft:cherry_sapling",
  "minecraft:mangrove_log": "minecraft:mangrove_propagule",
  "minecraft:pale_oak_log": "minecraft:pale_oak_sapling",
};

/** @param {Pos} p */
export const key = (p) => `${p.x},${p.y},${p.z}`;

/** @param {string} id */
export function isLog(id) {
  return id.endsWith("_log") && !id.includes("stripped");
}

/** @param {string} id */
function isLeaves(id) {
  return id.endsWith("_leaves") || id === "minecraft:azalea_leaves_flowered";
}

/** @param {string} id */
function isPassable(id) {
  return (
    id === "minecraft:air" ||
    isLeaves(id) ||
    id === "minecraft:vine" ||
    id === "minecraft:snow_layer" ||
    id.endsWith("_propagule") ||
    id === "minecraft:bee_nest" ||
    id === "minecraft:cocoa"
  );
}

/**
 * ブロックを安全に取得（未ロードなら undefined）
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Pos} p
 */
export function safeBlock(dim, p) {
  try {
    if (!dim.isChunkLoaded(p)) return undefined;
    return dim.getBlock(p);
  } catch (e) {
    return undefined;
  }
}

/** @param {import("@minecraft/server").Block} b */
function isMatureCrop(b) {
  if (!(b.typeId in CROPS)) return false;
  const g = b.permutation.getState("growth");
  return typeof g === "number" && g >= 7;
}

// ---------------------------------------------------------------
// 仕事の検索（木・畑）
// ---------------------------------------------------------------

let scanning = false;
/** 次に検索してよい tick（見つからなかったときは間隔をあける） */
let nextScanTick = 0;

/**
 * 村の周囲を少しずつ調べて、木や実った作物を仕事として登録する
 * @param {import("./village.js").VillageData} village
 * @param {{tree:boolean, crop:boolean}} want
 */
export function requestScan(village, want) {
  if (scanning || system.currentTick < nextScanTick) return;
  const treeCount = countTasks("tree");
  const cropCount = countTasks("crop");
  const needTree = want.tree && treeCount < MAX_TREE_TASKS;
  const needCrop = want.crop && cropCount < MAX_CROP_TASKS;
  if (!needTree && !needCrop) return;
  scanning = true;
  system.runJob(scanJob(village, needTree, needCrop));
}

/**
 * @param {import("./village.js").VillageData} village
 * @param {boolean} needTree
 * @param {boolean} needCrop
 * @returns {Generator<void, void, void>}
 */
function* scanJob(village, needTree, needCrop) {
  const before = tasks.size;
  try {
    const dim = world.getDimension(village.dim);
    const c = village.center;
    // 中心に近い場所から順番に調べる
    const cols = [];
    for (let dx = -WORK_RADIUS; dx <= WORK_RADIUS; dx++) {
      for (let dz = -WORK_RADIUS; dz <= WORK_RADIUS; dz++) {
        const d = dx * dx + dz * dz;
        if (d <= WORK_RADIUS * WORK_RADIUS) cols.push({ dx, dz, d });
      }
    }
    cols.sort((a, b) => a.d - b.d);
    let n = 0;
    for (const col of cols) {
      if (needTree && countTasks("tree") >= MAX_TREE_TASKS) needTree = false;
      if (needCrop && countTasks("crop") >= MAX_CROP_TASKS) needCrop = false;
      if (!needTree && !needCrop) break;
      const x = c.x + col.dx;
      const z = c.z + col.dz;
      try {
        if (dim.isChunkLoaded({ x, y: c.y, z })) {
          const top = dim.getTopmostBlock({ x, z });
          if (top) {
            if (needTree && (isLeaves(top.typeId) || isLog(top.typeId))) {
              findTree(dim, top);
            } else if (needCrop && isMatureCrop(top)) {
              findCrops(dim, top);
            }
          }
        }
      } catch (e) {
        // 読み込み中の場所などは無視
      }
      if (++n % 24 === 0) yield;
    }
  } finally {
    scanning = false;
    // 何も見つからなければ30秒休む
    nextScanTick = system.currentTick + (tasks.size > before ? 40 : 600);
  }
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {import("@minecraft/server").Block} top
 */
function findTree(dim, top) {
  const { x, z } = top;
  // 上から下へ幹の根元を探す
  let base = /** @type {Pos | undefined} */ (undefined);
  for (let y = top.y; y > top.y - 40; y--) {
    const b = safeBlock(dim, { x, y, z });
    if (!b) return;
    if (isLog(b.typeId)) {
      const below = safeBlock(dim, { x, y: y - 1, z });
      if (below && SOIL.has(below.typeId)) {
        base = { x, y, z };
        break;
      }
      continue;
    }
    if (!isPassable(b.typeId)) return;
  }
  if (!base || claimed.has(key(base))) return;

  // 幹をたどって木全体の原木を集める
  const logs = [];
  const seen = new Set([key(base)]);
  const queue = [base];
  let naturalLeaves = 0;
  let playerLeaves = 0;
  while (queue.length > 0 && logs.length < 200) {
    const p = /** @type {Pos} */ (queue.shift());
    logs.push(p);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = 0; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue;
          const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
          if (Math.abs(q.x - base.x) > 6 || Math.abs(q.z - base.z) > 6) continue;
          const k = key(q);
          if (seen.has(k)) continue;
          seen.add(k);
          const b = safeBlock(dim, q);
          if (!b) continue;
          if (isLog(b.typeId)) {
            if (claimed.has(k)) return; // 他の仕事と重なっている
            queue.push(q);
          } else if (isLeaves(b.typeId)) {
            if (b.permutation.getState("persistent_bit") === true) playerLeaves++;
            else naturalLeaves++;
          }
        }
      }
    }
  }
  // 自然の葉がついていない＝建物の柱などの可能性があるので切らない
  if (naturalLeaves < 3 || playerLeaves > naturalLeaves) return;

  const minY = Math.min(...logs.map((p) => p.y));
  const bases = logs.filter((p) => {
    if (p.y !== minY) return false;
    const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
    return !!below && SOIL.has(below.typeId);
  });
  // 上から切っていく
  logs.sort((a, b) => a.y - b.y);
  addTask("tree", dim, standPosNear(dim, base), logs, bases);
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {import("@minecraft/server").Block} first
 */
function findCrops(dim, first) {
  if (claimed.has(key(first))) return;
  const blocks = [];
  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const p = { x: first.x + dx, y: first.y, z: first.z + dz };
      if (claimed.has(key(p))) continue;
      const b = safeBlock(dim, p);
      if (b && isMatureCrop(b)) blocks.push(p);
    }
  }
  if (blocks.length === 0) return;
  // 近い順に収穫する（配列の末尾から取り出す）
  blocks.sort((a, b) => dist2(b, first) - dist2(a, first));
  addTask("crop", dim, { x: first.x, y: first.y, z: first.z }, blocks, []);
}

/**
 * 木の根元の横で、村人が立てる場所を探す
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Pos} base
 */
function standPosNear(dim, base) {
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  for (const [dx, dz] of dirs) {
    for (const dy of [0, 1, -1]) {
      const p = { x: base.x + dx, y: base.y + dy, z: base.z + dz };
      if (canStand(dim, p)) return p;
    }
  }
  return { x: base.x, y: base.y, z: base.z };
}

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Pos} p
 */
export function canStand(dim, p) {
  const feet = safeBlock(dim, p);
  const head = safeBlock(dim, { x: p.x, y: p.y + 1, z: p.z });
  const floor = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
  if (!feet || !head || !floor) return false;
  return feet.isAir && head.isAir && !floor.isAir && !floor.isLiquid;
}

/**
 * @param {"tree"|"crop"} kind
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Pos} stand
 * @param {Pos[]} blocks
 * @param {Pos[]} bases
 */
function addTask(kind, dim, stand, blocks, bases) {
  /** @type {Task} */
  const task = { id: nextTaskId++, kind, dim: dim.id, stand, blocks, bases, wpId: undefined };
  for (const b of blocks) claimed.add(key(b));
  try {
    const wp = dim.spawnEntity(WP_IDS[kind], { x: stand.x + 0.5, y: stand.y, z: stand.z + 0.5 });
    task.wpId = wp.id;
  } catch (e) {
    // マーカーが出せなくても、ワープで作業できるので続行
  }
  tasks.set(task.id, task);
}

/** @param {number} id */
export function removeTask(id) {
  const task = tasks.get(id);
  if (!task) return;
  for (const b of task.blocks) claimed.delete(key(b));
  removeEntityById(task.wpId);
  tasks.delete(id);
}

/**
 * 仕事の中から1ブロック分取り出したとき、登録を外す
 * @param {Pos} p
 */
export function unclaim(p) {
  claimed.delete(key(p));
}

/** @param {"tree"|"crop"} kind */
export function countTasks(kind) {
  let n = 0;
  for (const t of tasks.values()) if (t.kind === kind) n++;
  return n;
}

/**
 * 一番近い仕事を返す
 * @param {"tree"|"crop"} kind
 * @param {string} dimId
 * @param {Pos} from
 * @param {number} [maxDist]
 */
export function nearestTask(kind, dimId, from, maxDist = Infinity) {
  let best = /** @type {Task | undefined} */ (undefined);
  let bestD = maxDist * maxDist;
  for (const t of tasks.values()) {
    if (t.kind !== kind || t.dim !== dimId || t.blocks.length === 0) continue;
    const d = dist2h(t.stand, from, true);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
}

/**
 * 切り終わった木の根元に苗木を植える
 * @param {Task} task
 * @param {string} logType
 */
export function replant(task, logType) {
  const sapling = SAPLINGS[/** @type {keyof typeof SAPLINGS} */ (logType)];
  if (!sapling) return;
  const dim = world.getDimension(task.dim);
  // 2x2 の木（ダークオークなど）は4本、それ以外は1本
  const bases = sapling === "minecraft:dark_oak_sapling" || sapling === "minecraft:pale_oak_sapling"
    ? task.bases.slice(0, 4)
    : task.bases.slice(0, 1);
  for (const p of bases) {
    const b = safeBlock(dim, p);
    const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
    if (b && below && b.isAir && SOIL.has(below.typeId)) {
      try {
        b.setType(sapling);
      } catch (e) {
        // 植えられない場合は諦める
      }
    }
  }
}

// ---------------------------------------------------------------
// 倉庫マーカー
// ---------------------------------------------------------------

/**
 * 倉庫の位置にマーカーがあるようにする
 * @param {import("./village.js").VillageData} village
 */
export function ensureStorageMarker(village) {
  if (!village.storage) {
    removeEntityById(storageWpId);
    storageWpId = undefined;
    return;
  }
  const e = storageWpId ? world.getEntity(storageWpId) : undefined;
  if (e && e.isValid) return;
  const dim = world.getDimension(village.dim);
  const s = village.storage;
  if (!dim.isChunkLoaded(s)) return;
  try {
    const wp = dim.spawnEntity(WP_IDS.storage, { x: s.x + 0.5, y: s.y + 1, z: s.z + 0.5 });
    storageWpId = wp.id;
  } catch (e2) {
    storageWpId = undefined;
  }
}

/**
 * 倉庫マーカーを作り直す（村人の追いかけ対象をリセットするため）
 * @param {import("./village.js").VillageData} village
 */
export function refreshStorageMarker(village) {
  removeEntityById(storageWpId);
  storageWpId = undefined;
  ensureStorageMarker(village);
}

/**
 * 管理していないマーカー（再起動前の残りなど）を消す
 */
export function cleanupMarkers() {
  const valid = new Set();
  if (storageWpId) valid.add(storageWpId);
  for (const t of tasks.values()) if (t.wpId) valid.add(t.wpId);
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    let list = [];
    try {
      list = world.getDimension(dimId).getEntities({ families: ["blockai_wp"] });
    } catch (e) {
      continue;
    }
    for (const e of list) {
      if (!valid.has(e.id)) {
        try {
          e.remove();
        } catch (e2) {
          // 無視
        }
      }
    }
  }
  // マーカーが消えてしまった仕事は作り直す
  for (const t of tasks.values()) {
    if (t.wpId && world.getEntity(t.wpId)) continue;
    try {
      const dim = world.getDimension(t.dim);
      if (!dim.isChunkLoaded(t.stand)) continue;
      const wp = dim.spawnEntity(WP_IDS[t.kind], { x: t.stand.x + 0.5, y: t.stand.y, z: t.stand.z + 0.5 });
      t.wpId = wp.id;
    } catch (e) {
      // 次の機会に再挑戦
    }
  }
}

/** すべての仕事を破棄する（村の移動時など） */
export function clearAllTasks() {
  for (const id of [...tasks.keys()]) removeTask(id);
  claimed.clear();
}

/** @param {string | undefined} id */
function removeEntityById(id) {
  if (!id) return;
  try {
    const e = world.getEntity(id);
    if (e && e.isValid) e.remove();
  } catch (e) {
    // 無視
  }
}

/**
 * @param {Pos} a
 * @param {Pos} b
 */
function dist2(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

/**
 * 水平距離の2乗（高さの差は少しだけ考慮）
 * @param {Pos} a
 * @param {Pos} b
 * @param {boolean} [blockCenter] a がブロック座標なら true
 */
export function dist2h(a, b, blockCenter = false) {
  const off = blockCenter ? 0.5 : 0;
  const dx = a.x + off - b.x;
  const dz = a.z + off - b.z;
  const dy = (a.y - b.y) * 0.5;
  return dx * dx + dy * dy + dz * dz;
}
