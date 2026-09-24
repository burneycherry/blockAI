import { ItemStack, world } from "@minecraft/server";
import {
  ARRIVE_DISTANCE,
  LEVEL_XP,
  badgeTier,
  STUCK_SECONDS,
  VIEW_DISTANCE,
  VILLAGER_ID,
  VILLAGER_NAMES,
  carryCapacity,
  workInterval,
} from "./config.js";
import { addStat, getVillage, workArea } from "./village.js";
import { nearestTask, refreshStorageMarker, removeTask, resetScanWait, tasks } from "./tasks.js";
import { dist2h, safeBlock, storageStand } from "./blocks.js";
import { getJobDef, skillLevel } from "./registry.js";

/**
 * @typedef {import("@minecraft/server").Entity} Entity
 * @typedef {{x:number,y:number,z:number}} Pos
 * @typedef {"idle"|"to_task"|"working"|"to_storage"|"depositing"} Mode
 * @typedef {{
 *   mode: Mode,
 *   event: string,
 *   taskId: number | undefined,
 *   bestDist: number,
 *   supplyAfter: number,
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

/**
 * 職業の定義（登録されていない職業なら無職）
 * @param {Entity} e
 */
export function getJob(e) {
  const j = e.getDynamicProperty("blockai:job");
  return getJobDef(typeof j === "string" ? j : "none");
}

/**
 * 職業ごとの経験値（職業を変えても、元の職業に戻れば続きから）
 * @param {Entity} e
 * @param {string} [jobId] 省略時は今の職業
 */
export function getXp(e, jobId) {
  const id = jobId ?? getJob(e).id;
  migrateXp(e);
  const x = e.getDynamicProperty(`blockai:xp:${id}`);
  return typeof x === "number" ? x : 0;
}

/**
 * v0.5 までの共通の経験値を、今の職業の経験値に移す
 * @param {Entity} e
 */
function migrateXp(e) {
  const old = e.getDynamicProperty("blockai:xp");
  if (typeof old !== "number") return;
  const j = e.getDynamicProperty("blockai:job");
  const id = typeof j === "string" ? j : "none";
  if (old > 0 && typeof e.getDynamicProperty(`blockai:xp:${id}`) !== "number") {
    e.setDynamicProperty(`blockai:xp:${id}`, old);
  }
  e.setDynamicProperty("blockai:xp", undefined);
}

/**
 * 経験値のある職業の一覧
 * @param {Entity} e
 * @returns {{ jobId: string, xp: number }[]}
 */
export function jobHistory(e) {
  migrateXp(e);
  const list = [];
  for (const id of e.getDynamicPropertyIds()) {
    if (!id.startsWith("blockai:xp:")) continue;
    const xp = e.getDynamicProperty(id);
    if (typeof xp === "number" && xp > 0) list.push({ jobId: id.slice("blockai:xp:".length), xp });
  }
  return list;
}

/**
 * 作業の設定（職業ごと）
 * @param {Entity} e
 * @param {import("./registry.js").JobDef} job
 * @param {string} optId
 */
export function getOption(e, job, optId) {
  const v = e.getDynamicProperty(`blockai:opt:${job.id}:${optId}`);
  if (typeof v === "boolean") return v;
  return job.options?.find((o) => o.id === optId)?.default ?? false;
}

/**
 * @param {Entity} e
 * @param {import("./registry.js").JobDef} job
 * @param {string} optId
 * @param {boolean} value
 */
export function setOption(e, job, optId, value) {
  e.setDynamicProperty(`blockai:opt:${job.id}:${optId}`, value);
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

/**
 * 道具袋（倉庫から持ち出した材料。倉庫には戻さない）
 * @param {Entity} e
 * @returns {Record<string, number>}
 */
export function getBag(e) {
  const raw = e.getDynamicProperty("blockai:bag");
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

/**
 * @param {Entity} e
 * @param {Record<string, number>} bag
 */
function setBag(e, bag) {
  /** @type {Record<string, number>} */
  const clean = {};
  for (const k of Object.keys(bag)) if (bag[k] > 0) clean[k] = bag[k];
  e.setDynamicProperty("blockai:bag", Object.keys(clean).length > 0 ? JSON.stringify(clean) : undefined);
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
  applyLooks(e);
  updateNameTag(e, "");
}

/**
 * @param {Entity} e
 * @param {string} jobId
 */
export function setJob(e, jobId) {
  e.setDynamicProperty("blockai:job", jobId);
  resetScanWait();
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
    e.setProperty("blockai:job", getJob(e).skin);
    e.setProperty("blockai:tier", badgeTier(levelOf(getXp(e))));
  } catch (err) {
    // 読み込み直後などは失敗することがある
  }
}

/**
 * @param {Entity} e
 * @param {string} status
 */
function updateNameTag(e, status) {
  const job = getJob(e);
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
    // 職業ごとの枠のマーカーを追いかける
    event = `blockai:mode_to_slot_${getJob(e).slot ?? 0}`;
  }
  if (st.event !== event) {
    st.event = event;
    e.triggerEvent(event);
  }
  st.bestDist = Infinity;
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
    if (isWatched(e)) {
      // 見えているときは、ワープしたことが分かるように演出する
      e.dimension.spawnParticle("minecraft:villager_happy", { x: e.location.x, y: e.location.y + 1, z: e.location.z });
      e.dimension.playSound("mob.endermen.portal", e.location, { volume: 0.4, pitch: 1.5 });
    }
    e.teleport({ x: p.x + 0.5, y: p.y, z: p.z + 0.5 }, { dimension: e.dimension });
  } catch (err) {
    // 未ロードなど
  }
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
        bestDist: Infinity,
        anchorTick: tick,
        supplyAfter: 0,
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
  const job = getJob(e);
  if (!village || village.dim !== e.dimension.id) {
    setMode(e, st, "idle", tick);
    st.status = village ? "村から遠く離れている" : "村がまだありません";
    return;
  }
  if (!job.work || !job.status) {
    setMode(e, st, "idle", tick);
    st.status = "のんびり中";
    return;
  }
  const status = job.status;

  const level = levelOf(getXp(e));
  const cap = carryCapacity(level);
  const carry = getCarry(e);
  const total = carryTotal(carry);

  switch (st.mode) {
    case "idle":
      decide(e, st, village, tick, job, total, cap);
      return;

    case "to_task": {
      const task = nearestTask(job.id, e.dimension.id, e.location);
      if (!task) {
        decide(e, st, village, tick, job, total, cap);
        return;
      }
      const near = nearestTask(job.id, e.dimension.id, e.location, ARRIVE_DISTANCE);
      if (near) {
        st.taskId = near.id;
        setMode(e, st, "working", tick);
        st.nextWork = tick + 10;
        st.status = status.working;
        return;
      }
      st.status = status.going;
      // 見られていない、または立ち往生しているならワープ
      if (!isWatched(e) || stuck(e, st, tick, task.stand)) {
        warpTo(e, task.stand);
      }
      return;
    }

    case "working": {
      const task = st.taskId !== undefined ? tasks.get(st.taskId) : undefined;
      if (!task || task.blocks.length === 0) {
        if (task) removeTask(task.id);
        releaseTask(st);
        decide(e, st, village, tick, job, total, cap);
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
      const bag = getBag(e);
      let delay = workInterval(level);
      /** @type {import("./registry.js").WorkContext} */
      const ctx = {
        e,
        task,
        carry,
        bag,
        watched,
        level,
        opt: (id) => getOption(e, job, id),
        skill: (id) => !!village.testMode || level >= skillLevel(job, id),
        wait: (ticks) => {
          delay = Math.max(delay, ticks);
        },
      };
      while (units > 0 && task.blocks.length > 0) {
        const r = job.work(ctx);
        const n = r === true ? 1 : typeof r === "number" ? r : 0;
        if (n > 0) {
          got += n;
          units -= n;
        }
      }
      setCarry(e, carry);
      setBag(e, bag);
      if (got > 0) gainXp(e, got);
      st.nextWork = tick + delay;
      st.status = `${status.working} (${carryTotal(carry)}/${cap})`;
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
      st.status = total > 0 ? `倉庫へ運んでいる (${total})` : "倉庫へ材料を取りに行っている";
      if (!isWatched(e) || stuck(e, st, tick, s)) {
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
      decide(e, st, village, tick, job, 0, cap);
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
 * @param {import("./registry.js").JobDef} job
 * @param {number} total
 * @param {number} cap
 */
function decide(e, st, village, tick, job, total, cap) {
  if (total >= cap) {
    goStorage(e, st, village, tick);
    return;
  }
  // 材料（種など）が足りなければ倉庫へ取りに行く。倉庫にも無ければしばらく諦める
  if (village.storage && tick >= st.supplyAfter && job.needsSupply?.(e, getBag(e), (id) => getOption(e, job, id))) {
    st.supplyAfter = tick + 20 * 60;
    goStorage(e, st, village, tick);
    return;
  }
  const task = nearestTask(job.id, e.dimension.id, e.location);
  if (task) {
    setMode(e, st, "to_task", tick);
    return;
  }
  if (total > 0 && village.storage) {
    goStorage(e, st, village, tick);
    return;
  }
  setMode(e, st, "idle", tick);
  st.status = job.status?.waiting ?? "";
  // 仕事場から離れすぎていたら戻る
  const area = workArea(village, job.id);
  const d2 = dist2h(area, e.location, true);
  if (d2 > (area.r + 8) * (area.r + 8) && !isWatched(e)) warpTo(e, area);
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
 * 目的地に近づけていなければ true（穴に落ちた・壁に阻まれた等）
 * その場でうろうろしていても、目的地との距離が縮まらなければ立ち往生とみなす
 * @param {Entity} e
 * @param {State} st
 * @param {number} tick
 * @param {Pos} target ブロック座標
 */
function stuck(e, st, tick, target) {
  const d = Math.sqrt(dist2h(target, e.location, true));
  if (d < st.bestDist - 1) {
    st.bestDist = d;
    st.anchorTick = tick;
    return false;
  }
  if (tick - st.anchorTick > STUCK_SECONDS * 20) {
    st.anchorTick = tick;
    st.bestDist = Infinity;
    return true;
  }
  return false;
}

/**
 * @param {Entity} e
 * @param {number} amount
 */
function gainXp(e, amount) {
  const jobId = getJob(e).id;
  const before = levelOf(getXp(e, jobId));
  const xp = getXp(e, jobId) + amount;
  e.setDynamicProperty(`blockai:xp:${jobId}`, xp);
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
    notifyMayor(`§a[blockAI] ${getName(e)} が ${getJob(e).name} Lv${after} になりました！`, -1);
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
  // 職業ごとに、倉庫から材料を持ち出す（農家の種など）
  const job = getJob(e);
  if (job.onStorage) {
    const bag = getBag(e);
    try {
      job.onStorage(e, container, bag, (id) => getOption(e, job, id));
    } catch (err) {
      console.warn(`[blockAI] onStorage error: ${err}`);
    }
    setBag(e, bag);
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
