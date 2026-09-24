import { ItemStack, world } from "@minecraft/server";
import {
  ARRIVE_DISTANCE,
  JOBS,
  LEVEL_XP,
  STUCK_SECONDS,
  VIEW_DISTANCE,
  VILLAGER_ID,
  VILLAGER_NAMES,
  carryCapacity,
  workInterval,
} from "./config.js";
import { addStat, getVillage } from "./village.js";
import {
  CROPS,
  canStand,
  dist2h,
  isLog,
  nearestTask,
  refreshStorageMarker,
  removeTask,
  replant,
  safeBlock,
  tasks,
  unclaim,
} from "./tasks.js";

/**
 * @typedef {import("@minecraft/server").Entity} Entity
 * @typedef {{x:number,y:number,z:number}} Pos
 * @typedef {"idle"|"to_task"|"working"|"to_storage"|"depositing"} Mode
 * @typedef {{
 *   mode: Mode,
 *   event: string,
 *   taskId: number | undefined,
 *   anchor: Pos,
 *   anchorTick: number,
 *   nextWork: number,
 *   status: string
 * }} State
 */

/** 村人ごとの一時的な状態（ワールドを開き直すとリセットされる） */
/** @type {Map<string, State>} */
const states = new Map();

// ---------------------------------------------------------------
// 村人の保存データ
// ---------------------------------------------------------------

/** @param {Entity} e */
export function getName(e) {
  const n = e.getDynamicProperty("blockai:name");
  return typeof n === "string" ? n : "名無し";
}

/** @param {Entity} e */
export function getJob(e) {
  const j = e.getDynamicProperty("blockai:job");
  return typeof j === "string" && j in JOBS ? /** @type {keyof typeof JOBS} */ (j) : "none";
}

/** @param {Entity} e */
export function getXp(e) {
  const x = e.getDynamicProperty("blockai:xp");
  return typeof x === "number" ? x : 0;
}

/** @param {number} xp */
export function levelOf(xp) {
  let lv = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) lv = i + 1;
  return lv;
}

/**
 * @param {Entity} e
 * @returns {Record<string, number>}
 */
export function getCarry(e) {
  const raw = e.getDynamicProperty("blockai:carry");
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

/**
 * @param {Entity} e
 * @param {Record<string, number>} carry
 */
function setCarry(e, carry) {
  const keys = Object.keys(carry).filter((k) => carry[k] > 0);
  if (keys.length === 0) {
    e.setDynamicProperty("blockai:carry", undefined);
    return;
  }
  /** @type {Record<string, number>} */
  const clean = {};
  for (const k of keys) clean[k] = carry[k];
  e.setDynamicProperty("blockai:carry", JSON.stringify(clean));
}

/** @param {Record<string, number>} carry */
export function carryTotal(carry) {
  let n = 0;
  for (const k in carry) n += carry[k];
  return n;
}

/**
 * 新しい村人の初期設定
 * @param {Entity} e
 */
export function initVillager(e) {
  if (typeof e.getDynamicProperty("blockai:name") === "string") return;
  const used = new Set(getAllVillagers().map(getName));
  const free = VILLAGER_NAMES.filter((n) => !used.has(n));
  const pool = free.length > 0 ? free : VILLAGER_NAMES;
  e.setDynamicProperty("blockai:name", pool[Math.floor(Math.random() * pool.length)]);
  e.setDynamicProperty("blockai:job", "none");
  e.setDynamicProperty("blockai:xp", 0);
  applyLooks(e);
  updateNameTag(e, "");
}

/**
 * @param {Entity} e
 * @param {keyof typeof JOBS} job
 */
export function setJob(e, job) {
  e.setDynamicProperty("blockai:job", job);
  applyLooks(e);
  const st = states.get(e.id);
  if (st) {
    releaseTask(st);
    st.mode = "idle";
  }
  updateNameTag(e, "");
}

/**
 * @param {Entity} e
 * @param {string} name
 */
export function setName(e, name) {
  e.setDynamicProperty("blockai:name", name);
  updateNameTag(e, states.get(e.id)?.status ?? "");
}

/** 職業とレベルを見た目に反映 @param {Entity} e */
function applyLooks(e) {
  try {
    e.setProperty("blockai:job", JOBS[getJob(e)].skin);
    e.setProperty("blockai:tier", Math.min(4, levelOf(getXp(e)) - 1));
  } catch (err) {
    // 読み込み直後などは失敗することがある
  }
}

/**
 * @param {Entity} e
 * @param {string} status
 */
function updateNameTag(e, status) {
  const job = JOBS[getJob(e)];
  const lv = levelOf(getXp(e));
  const head = `§e${getName(e)}§r §7[${job.name} Lv${lv}]§r`;
  const tag = status ? `${head}\n§f${status}` : head;
  if (e.nameTag !== tag) e.nameTag = tag;
}

export function getAllVillagers() {
  /** @type {Entity[]} */
  const list = [];
  for (const dimId of ["minecraft:overworld", "minecraft:nether", "minecraft:the_end"]) {
    try {
      list.push(...world.getDimension(dimId).getEntities({ type: VILLAGER_ID }));
    } catch (err) {
      // 無視
    }
  }
  return list;
}

/** @param {Entity} e */
export function getStatus(e) {
  return states.get(e.id)?.status ?? "";
}

// ---------------------------------------------------------------
// 行動の制御
// ---------------------------------------------------------------

/**
 * @param {Entity} e
 * @param {State} st
 * @param {Mode} mode
 * @param {number} tick
 */
function setMode(e, st, mode, tick) {
  st.mode = mode;
  const ev = {
    idle: "blockai:mode_idle",
    to_task: "", // 職業によって決まる
    working: "blockai:mode_work",
    to_storage: "blockai:mode_to_storage",
    depositing: "blockai:mode_work",
  }[mode];
  let event = ev;
  if (mode === "to_task") {
    event = getJob(e) === "lumberjack" ? "blockai:mode_to_tree" : "blockai:mode_to_crop";
  }
  if (st.event !== event) {
    st.event = event;
    e.triggerEvent(event);
  }
  st.anchor = { x: e.location.x, y: e.location.y, z: e.location.z };
  st.anchorTick = tick;
}

/** @param {State} st */
function releaseTask(st) {
  st.taskId = undefined;
}

/**
 * プレイヤーの近くか（見えている可能性があるか）
 * @param {Entity} e
 */
function isWatched(e) {
  const players = e.dimension.getPlayers({ location: e.location, maxDistance: VIEW_DISTANCE });
  return players.length > 0;
}

/**
 * @param {Entity} e
 * @param {Pos} p ブロック座標
 */
function warpTo(e, p) {
  try {
    e.teleport({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 }, { dimension: e.dimension });
  } catch (err) {
    // 未ロードなど
  }
}

/**
 * 倉庫の横で立てる場所
 * @param {import("@minecraft/server").Dimension} dim
 * @param {Pos} s
 */
function storageStand(dim, s) {
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (const dy of [0, -1, 1]) {
      const p = { x: s.x + dx, y: s.y + dy, z: s.z + dz };
      if (canStand(dim, p)) return p;
    }
  }
  return { x: s.x, y: s.y + 1, z: s.z };
}

/**
 * 仕事の種類
 * @param {Entity} e
 * @returns {"tree"|"crop"|undefined}
 */
function taskKind(e) {
  const job = getJob(e);
  if (job === "lumberjack") return "tree";
  if (job === "farmer") return "crop";
  return undefined;
}

/**
 * 全村人の1ステップ（0.5秒ごと）
 * @param {number} tick
 */
export function tickVillagers(tick) {
  const village = getVillage();
  const alive = new Set();
  for (const e of getAllVillagers()) {
    alive.add(e.id);
    let st = states.get(e.id);
    if (!st) {
      st = {
        mode: "idle",
        event: "",
        taskId: undefined,
        anchor: { x: e.location.x, y: e.location.y, z: e.location.z },
        anchorTick: tick,
        nextWork: 0,
        status: "",
      };
      states.set(e.id, st);
      initVillager(e);
      applyLooks(e);
      setMode(e, st, "idle", tick);
    }
    try {
      step(e, st, village, tick);
    } catch (err) {
      console.warn(`[blockAI] villager step error: ${err}`);
    }
    updateNameTag(e, st.status);
  }
  for (const id of [...states.keys()]) if (!alive.has(id)) states.delete(id);
}

/**
 * @param {Entity} e
 * @param {State} st
 * @param {import("./village.js").VillageData | null} village
 * @param {number} tick
 */
function step(e, st, village, tick) {
  const kind = taskKind(e);
  if (!village || village.dim !== e.dimension.id) {
    setMode(e, st, "idle", tick);
    st.status = village ? "村から遠く離れている" : "村がまだありません";
    return;
  }
  if (!kind) {
    setMode(e, st, "idle", tick);
    st.status = getJob(e) === "none" ? "のんびり中" : "（この職業は準備中）";
    return;
  }

  const level = levelOf(getXp(e));
  const cap = carryCapacity(level);
  const carry = getCarry(e);
  const total = carryTotal(carry);

  switch (st.mode) {
    case "idle":
      decide(e, st, village, tick, kind, total, cap);
      return;

    case "to_task": {
      const task = nearestTask(kind, e.dimension.id, e.location);
      if (!task) {
        decide(e, st, village, tick, kind, total, cap);
        return;
      }
      const near = nearestTask(kind, e.dimension.id, e.location, ARRIVE_DISTANCE);
      if (near) {
        st.taskId = near.id;
        setMode(e, st, "working", tick);
        st.nextWork = tick + 10;
        st.status = kind === "tree" ? "伐採中" : "収穫中";
        return;
      }
      st.status = kind === "tree" ? "木を切りに向かっている" : "畑に向かっている";
      // 見られていない、または立ち往生しているならワープ
      if (!isWatched(e) || stuck(e, st, tick)) {
        warpTo(e, task.stand);
      }
      return;
    }

    case "working": {
      const task = st.taskId !== undefined ? tasks.get(st.taskId) : undefined;
      if (!task || task.blocks.length === 0) {
        if (task) removeTask(task.id);
        releaseTask(st);
        decide(e, st, village, tick, kind, total, cap);
        return;
      }
      if (total >= cap) {
        releaseTask(st);
        goStorage(e, st, village, tick);
        return;
      }
      if (tick < st.nextWork) return;
      const watched = isWatched(e);
      // 見られていなければ、まとめて一気に作業する
      let units = watched ? 1 : cap - total;
      let got = 0;
      while (units > 0 && task.blocks.length > 0) {
        if (doWorkUnit(e, task, carry, watched)) {
          got++;
          units--;
        }
      }
      setCarry(e, carry);
      if (got > 0) gainXp(e, got);
      st.nextWork = tick + workInterval(level);
      st.status = `${kind === "tree" ? "伐採中" : "収穫中"} (${carryTotal(carry)}/${cap})`;
      return;
    }

    case "to_storage": {
      if (!village.storage) {
        setMode(e, st, "idle", tick);
        st.status = "§c倉庫がありません";
        return;
      }
      const s = village.storage;
      const d2 = dist2h({ x: s.x, y: s.y, z: s.z }, e.location, true);
      if (d2 <= ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
        setMode(e, st, "depositing", tick);
        st.nextWork = tick + 10;
        st.status = "倉庫にしまっている";
        return;
      }
      st.status = `倉庫へ運んでいる (${total})`;
      if (!isWatched(e) || stuck(e, st, tick)) {
        warpTo(e, storageStand(e.dimension, s));
      }
      return;
    }

    case "depositing": {
      if (tick < st.nextWork) return;
      const result = deposit(e, village, carry);
      setCarry(e, carry);
      refreshStorageMarker(village);
      if (result === "missing") {
        setMode(e, st, "idle", tick);
        st.status = "§c倉庫のチェストが無い！";
        notifyMayor("§c[blockAI] 倉庫のチェストが見つかりません。村長の杖で登録し直してください。", tick);
        return;
      }
      if (result === "full") {
        setMode(e, st, "idle", tick);
        st.status = "§c倉庫がいっぱい！";
        notifyMayor(`§c[blockAI] ${getName(e)}「倉庫がいっぱいで入りません！」`, tick);
        return;
      }
      setMode(e, st, "idle", tick);
      decide(e, st, village, tick, kind, 0, cap);
      return;
    }
  }
}

/**
 * 次に何をするか決める
 * @param {Entity} e
 * @param {State} st
 * @param {import("./village.js").VillageData} village
 * @param {number} tick
 * @param {"tree"|"crop"} kind
 * @param {number} total
 * @param {number} cap
 */
function decide(e, st, village, tick, kind, total, cap) {
  if (total >= cap) {
    goStorage(e, st, village, tick);
    return;
  }
  const task = nearestTask(kind, e.dimension.id, e.location);
  if (task) {
    setMode(e, st, "to_task", tick);
    return;
  }
  if (total > 0 && village.storage) {
    goStorage(e, st, village, tick);
    return;
  }
  setMode(e, st, "idle", tick);
  st.status = kind === "tree" ? "切れる木を探している" : "実った作物を待っている";
  // 村から離れすぎていたら戻る
  const c = village.center;
  const d2 = dist2h(c, e.location, true);
  if (d2 > 40 * 40 && !isWatched(e)) warpTo(e, c);
}

/**
 * @param {Entity} e
 * @param {State} st
 * @param {import("./village.js").VillageData} village
 * @param {number} tick
 */
function goStorage(e, st, village, tick) {
  if (!village.storage) {
    setMode(e, st, "idle", tick);
    st.status = "§c倉庫がありません（村長の杖で登録してね）";
    return;
  }
  setMode(e, st, "to_storage", tick);
}

/**
 * 一定時間ほとんど動いていなければ true
 * @param {Entity} e
 * @param {State} st
 * @param {number} tick
 */
function stuck(e, st, tick) {
  const p = e.location;
  const dx = p.x - st.anchor.x;
  const dy = p.y - st.anchor.y;
  const dz = p.z - st.anchor.z;
  if (dx * dx + dy * dy + dz * dz > 1.5 * 1.5) {
    st.anchor = { x: p.x, y: p.y, z: p.z };
    st.anchorTick = tick;
    return false;
  }
  if (tick - st.anchorTick > STUCK_SECONDS * 20) {
    st.anchorTick = tick;
    return true;
  }
  return false;
}

/**
 * 1ブロック分の作業をする。成功したら true
 * @param {Entity} e
 * @param {import("./tasks.js").Task} task
 * @param {Record<string, number>} carry
 * @param {boolean} watched
 */
function doWorkUnit(e, task, carry, watched) {
  const p = /** @type {Pos} */ (task.blocks.pop());
  unclaim(p);
  const dim = e.dimension;
  const b = safeBlock(dim, p);
  if (!b) return false;
  const center = { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };

  if (task.kind === "tree") {
    if (!isLog(b.typeId)) return false;
    const logType = b.typeId;
    b.setType("minecraft:air");
    carry[logType] = (carry[logType] || 0) + 1;
    if (watched) {
      dim.playSound("dig.wood", center);
      lookAt(e, center);
    }
    if (task.blocks.length === 0) replant(task, logType);
    return true;
  }

  const crop = CROPS[/** @type {keyof typeof CROPS} */ (b.typeId)];
  if (!crop) return false;
  const g = b.permutation.getState("growth");
  if (typeof g !== "number" || g < 7) return false;
  // 収穫して、すぐに植え直す
  b.setPermutation(b.permutation.withState("growth", 0));
  const n = crop.min + Math.floor(Math.random() * (crop.max - crop.min + 1));
  carry[crop.item] = (carry[crop.item] || 0) + n;
  if (crop.seed && Math.random() < 0.5) carry[crop.seed] = (carry[crop.seed] || 0) + 1;
  if (watched) {
    dim.playSound("dig.grass", center);
    lookAt(e, center);
  }
  return true;
}

/**
 * @param {Entity} e
 * @param {Pos} target
 */
function lookAt(e, target) {
  try {
    e.teleport(e.location, { facingLocation: target });
  } catch (err) {
    // 無視
  }
}

/**
 * @param {Entity} e
 * @param {number} amount
 */
function gainXp(e, amount) {
  const before = levelOf(getXp(e));
  const xp = getXp(e) + amount;
  e.setDynamicProperty("blockai:xp", xp);
  const after = levelOf(xp);
  if (after > before) {
    applyLooks(e);
    try {
      e.dimension.spawnParticle("minecraft:villager_happy", {
        x: e.location.x,
        y: e.location.y + 2,
        z: e.location.z,
      });
      e.dimension.playSound("random.levelup", e.location);
    } catch (err) {
      // 無視
    }
    notifyMayor(`§a[blockAI] ${getName(e)} が ${JOBS[getJob(e)].name} Lv${after} になりました！`, -1);
  }
}

/**
 * 倉庫（チェスト等）に荷物を入れる
 * @param {Entity} e
 * @param {import("./village.js").VillageData} village
 * @param {Record<string, number>} carry
 * @returns {"ok" | "full" | "missing"}
 */
function deposit(e, village, carry) {
  const s = /** @type {Pos} */ (village.storage);
  const block = safeBlock(e.dimension, s);
  const container = block?.getComponent("minecraft:inventory")?.container;
  if (!container) return "missing";
  let left = 0;
  for (const id of Object.keys(carry)) {
    let count = carry[id];
    while (count > 0) {
      const stack = new ItemStack(id, Math.min(count, 64));
      const n = stack.amount;
      const rest = container.addItem(stack);
      const put = n - (rest ? rest.amount : 0);
      count -= put;
      if (put > 0) addStat(id, put);
      if (rest) break;
    }
    carry[id] = count;
    left += count;
  }
  e.dimension.playSound("random.chestclosed", { x: s.x + 0.5, y: s.y + 0.5, z: s.z + 0.5 });
  return left > 0 ? "full" : "ok";
}

let lastNotify = -1000;
/**
 * 村長（全プレイヤー）へお知らせ
 * @param {string} msg
 * @param {number} tick -1 なら連続防止なし
 */
function notifyMayor(msg, tick) {
  if (tick >= 0) {
    if (tick - lastNotify < 20 * 30) return;
    lastNotify = tick;
  }
  world.sendMessage(msg);
}
