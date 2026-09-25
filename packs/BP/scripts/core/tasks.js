import { system, world } from "@minecraft/server";
import { DEFAULT_MAX_TASKS, WP_TASK_ID } from "./config.js";
import { getJobDef, workingJobs } from "./registry.js";
import { isProtected, workArea } from "./village.js";
import { dist2h, key, safeBlock } from "./blocks.js";

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

/** ベッドの目印（夜だけ置く）のエンティティID */
const homeWpIds = new Set();

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
        scanColumn(village, dim, jobs, x, z, area.y);
      }
    }
  } finally {
    scanning = false;
    // 何も見つからなければ10秒休む（木が育ったらすぐ気づけるように、長くしすぎない）
    nextScanTick = system.currentTick + (tasks.size > before ? 40 : 200);
  }
}

/**
 * 1列を調べて、職業ごとの仕事を登録する
 * @param {import("./village.js").VillageData} village
 * @param {import("@minecraft/server").Dimension} dim
 * @param {import("./registry.js").JobDef[]} jobs
 * @param {number} x
 * @param {number} z
 * @param {number} y 読み込み確認に使う高さ
 */
function scanColumn(village, dim, jobs, x, z, y) {
  // 立ち入り禁止エリアは調べない
  if (isProtected(village, x, z)) return;
  try {
    if (!dim.isChunkLoaded({ x, y, z })) return;
    let top = dim.getTopmostBlock({ x, z });
    // 雪が積もっていたら、その下を見る
    for (let i = 0; i < 2 && top && top.typeId === "minecraft:snow_layer"; i++) {
      top = safeBlock(dim, { x, y: top.y - 1, z });
    }
    if (!top) return;
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

/** 近くを探すときに、仕事の上限を超えて足してよい数 */
const NEAR_EXTRA = 3;

/**
 * 村人のすぐ近くを調べて仕事を足す（1本切り終えたら、隣の木から切るように）
 * @param {import("./village.js").VillageData} village
 * @param {import("./registry.js").JobDef} job
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Pos} from
 * @param {number} [r]
 */
export function scanNear(village, job, dim, from, r = 8) {
  if (!job.scan || dim.id !== village.dim) return;
  const limit = (job.maxTasks ?? DEFAULT_MAX_TASKS) + NEAR_EXTRA;
  const area = workArea(village, job.id);
  const cx = Math.floor(from.x);
  const cz = Math.floor(from.z);
  const cols = [];
  for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) if (dx * dx + dz * dz <= r * r) cols.push({ dx, dz, d: dx * dx + dz * dz });
  cols.sort((a, b) => a.d - b.d);
  for (const c of cols) {
    if (countTasks(job.id) >= limit) return;
    const x = cx + c.dx;
    const z = cz + c.dz;
    // 仕事場の外は探さない
    if ((x - area.x) ** 2 + (z - area.z) ** 2 > area.r * area.r) continue;
    scanColumn(village, dim, [job], x, z, Math.floor(from.y));
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

/**
 * 管理していないマーカー（再起動前の残りなど）を消し、消えたマーカーは出し直す
 */
export function cleanupMarkers() {
  const valid = new Set();
  for (const id of homeWpIds) valid.add(id);
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

// ---------------------------------------------------------------
// ベッドの目印（夜に村人が歩いて向かう）
// ---------------------------------------------------------------

/**
 * @param {import("@minecraft/server").Dimension} dim
 * @param {{x:number,y:number,z:number}} loc エンティティを置く位置
 * @returns {string | undefined}
 */
export function spawnHomeMarker(dim, loc) {
  try {
    if (!dim.isChunkLoaded(loc)) return undefined;
    const wp = dim.spawnEntity(WP_TASK_ID, loc);
    wp.triggerEvent("blockai:home");
    homeWpIds.add(wp.id);
    return wp.id;
  } catch (e) {
    return undefined;
  }
}

/** @param {string | undefined} id */
export function removeHomeMarker(id) {
  if (!id) return;
  homeWpIds.delete(id);
  removeEntityById(id);
}
