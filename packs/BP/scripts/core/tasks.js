import { system, world } from "@minecraft/server";
import { DEFAULT_MAX_TASKS, WP_STORAGE_ID, WP_TASK_ID } from "./config.js";
import { getJobDef, workingJobs } from "./registry.js";
import { isProtected, workArea } from "./village.js";
import { dist2h, key, safeBlock, storageStand } from "./blocks.js";

/**
 * @typedef {import("./registry.js").Task} Task
 * @typedef {import("./registry.js").Pos} Pos
 */

/** @type {Map<number, Task>} */
export const tasks = new Map();
/** 既に仕事として登録済みのブロック（重複登録防止） */
const claimed = new Set();
let nextTaskId = 1;

/** 演出用エンティティ（倒木など）のID。これ以外の演出用エンティティは片付ける */
export const activeProps = new Set();

/** 倉庫マーカーのエンティティID */
let storageWpId = /** @type {string | undefined} */ (undefined);

// ---------------------------------------------------------------
// 仕事の検索
// ---------------------------------------------------------------

let scanning = false;
/** 次に検索してよい tick（見つからなかったときは間隔をあける） */
let nextScanTick = 0;

/** すぐに次の検索をしてよいことにする（職業を変えたときなど） */
export function resetScanWait() {
  nextScanTick = 0;
}

/**
 * 村の周り（職業ごとの仕事場）を少しずつ調べて、各職業の仕事を登録する
 * @param {import("./village.js").VillageData} village
 * @param {Set<string>} activeJobs 村人が就いている職業
 */
export function requestScan(village, activeJobs) {
  if (scanning || system.currentTick < nextScanTick) return;
  const wanted = workingJobs().filter(
    (j) => j.scan && activeJobs.has(j.id) && countTasks(j.id) < (j.maxTasks ?? DEFAULT_MAX_TASKS),
  );
  if (wanted.length === 0) return;
  // 同じ範囲で働く職業をまとめる（範囲ごとに1回だけ調べる）
  /** @type {Map<string, { area: import("./village.js").Area, jobs: import("./registry.js").JobDef[] }>} */
  const regions = new Map();
  for (const j of wanted) {
    const area = workArea(village, j.id);
    const k = `${area.x},${area.z},${area.r}`;
    const r = regions.get(k) ?? { area, jobs: [] };
    r.jobs.push(j);
    regions.set(k, r);
  }
  scanning = true;
  system.runJob(scanJob(village, [...regions.values()]));
}

/**
 * @param {import("./village.js").VillageData} village
 * @param {{ area: import("./village.js").Area, jobs: import("./registry.js").JobDef[] }[]} regions
 * @returns {Generator<void, void, void>}
 */
function* scanJob(village, regions) {
  const before = tasks.size;
  try {
    const dim = world.getDimension(village.dim);
    let n = 0;
    for (const { area, jobs: regionJobs } of regions) {
      // 中心に近い場所から順番に調べる
      const cols = [];
      for (let dx = -area.r; dx <= area.r; dx++) {
        for (let dz = -area.r; dz <= area.r; dz++) {
          const d = dx * dx + dz * dz;
          if (d <= area.r * area.r) cols.push({ dx, dz, d });
        }
      }
      cols.sort((a, b) => a.d - b.d);
      for (const col of cols) {
        const jobs = regionJobs.filter((j) => countTasks(j.id) < (j.maxTasks ?? DEFAULT_MAX_TASKS));
        if (jobs.length === 0) break;
        const x = area.x + col.dx;
        const z = area.z + col.dz;
        if (++n % 24 === 0) yield;
        // 立ち入り禁止エリアは調べない
        if (isProtected(village, x, z)) continue;
        try {
          if (!dim.isChunkLoaded({ x, y: area.y, z })) continue;
          let top = dim.getTopmostBlock({ x, z });
          // 雪が積もっていたら、その下を見る
          for (let i = 0; i < 2 && top && top.typeId === "minecraft:snow_layer"; i++) {
            top = safeBlock(dim, { x, y: top.y - 1, z });
          }
          if (!top) continue;
          for (const job of jobs) {
            /** @type {import("./registry.js").AddTask} */
            const add = (stand, blocks, data) => {
              // 立ち入り禁止エリアにかかるブロックは除く
              const ok = blocks.filter((b) => !isProtected(village, b.x, b.z));
              addTask(job.id, dim, stand, ok, data ?? {});
            };
            job.scan?.(dim, top, add, (p) => claimed.has(key(p)));
          }
        } catch (e) {
          // 読み込み中の場所などは無視
        }
      }
    }
  } finally {
    scanning = false;
    // 何も見つからなければ30秒休む
    nextScanTick = system.currentTick + (tasks.size > before ? 40 : 600);
  }
}

/**
 * @param {string} jobId
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Pos} stand
 * @param {Pos[]} blocks
 * @param {Record<string, any>} data
 */
function addTask(jobId, dim, stand, blocks, data) {
  if (blocks.length === 0 || blocks.some((b) => claimed.has(key(b)))) return;
  /** @type {Task} */
  const task = { id: nextTaskId++, jobId, dim: dim.id, stand, blocks, data, wpId: undefined };
  for (const b of blocks) claimed.add(key(b));
  task.wpId = spawnMarker(task);
  tasks.set(task.id, task);
}

/**
 * 仕事の目的地マーカーを出す。村人はこれを追いかけて歩く
 * @param {Task} task
 */
function spawnMarker(task) {
  const slot = getJobDef(task.jobId).slot;
  if (slot === undefined) return undefined;
  try {
    const dim = world.getDimension(task.dim);
    if (!dim.isChunkLoaded(task.stand)) return undefined;
    const wp = dim.spawnEntity(WP_TASK_ID, { x: task.stand.x + 0.5, y: task.stand.y, z: task.stand.z + 0.5 });
    wp.triggerEvent(`blockai:slot_${slot}`);
    return wp.id;
  } catch (e) {
    // マーカーが出せなくても、ワープで作業できるので続行
    return undefined;
  }
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
 * 仕事から1ブロック分を取り出す
 * @param {Task} task
 */
export function takeBlock(task) {
  const p = task.blocks.pop();
  if (p) claimed.delete(key(p));
  return p;
}

/**
 * 条件に合うブロックをまとめて取り出す（範囲作業の特技などで使う）
 * @param {Task} task
 * @param {(p: Pos) => boolean} pred
 */
export function takeBlocksWhere(task, pred) {
  const taken = task.blocks.filter(pred);
  task.blocks = task.blocks.filter((p) => !pred(p));
  for (const p of taken) claimed.delete(key(p));
  return taken;
}

/** @param {string} jobId */
export function countTasks(jobId) {
  let n = 0;
  for (const t of tasks.values()) if (t.jobId === jobId) n++;
  return n;
}

/**
 * 一番近い仕事を返す
 * @param {string} jobId
 * @param {string} dimId
 * @param {Pos} from
 * @param {number} [maxDist]
 */
export function nearestTask(jobId, dimId, from, maxDist = Infinity) {
  let best = /** @type {Task | undefined} */ (undefined);
  let bestD = maxDist * maxDist;
  for (const t of tasks.values()) {
    if (t.jobId !== jobId || t.dim !== dimId || t.blocks.length === 0) continue;
    const d = dist2h(t.stand, from, true);
    if (d <= bestD) {
      best = t;
      bestD = d;
    }
  }
  return best;
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
    // チェストの上に置くとチェストを開けにくくなるので、横の立ち位置に置く
    const st = storageStand(dim, s);
    const wp = dim.spawnEntity(WP_STORAGE_ID, { x: st.x + 0.5, y: st.y, z: st.z + 0.5 });
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
 * 管理していないマーカー（再起動前の残りなど）を消し、消えたマーカーは出し直す
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
  for (const t of tasks.values()) {
    if (t.wpId && world.getEntity(t.wpId)) continue;
    t.wpId = spawnMarker(t);
  }
  // 再起動などで残った演出用エンティティ（倒れた木など）を消す
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    try {
      for (const e of world.getDimension(dimId).getEntities({ families: ["blockai_prop"] })) {
        if (!activeProps.has(e.id)) e.remove();
      }
    } catch (e) {
      // 無視
    }
  }
}

/**
 * その職業の仕事を破棄する（仕事場を変えたときなど）
 * @param {string} jobId
 */
export function clearJobTasks(jobId) {
  for (const t of [...tasks.values()]) if (t.jobId === jobId) removeTask(t.id);
  nextScanTick = 0;
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
