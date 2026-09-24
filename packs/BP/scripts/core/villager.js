import { world } from "@minecraft/server";
import {
  ARRIVE_DISTANCE,
  LEVEL_XP,
  badgeTier,
  STUCK_SECONDS,
  VIEW_DISTANCE,
  VILLAGER_ID,
  VILLAGER_NAMES,
  carryCapacity,
  maxHp,
  workInterval,
} from "./config.js";
import { CHARACTERS } from "./characters.js";
import { assignBed, bedUsable, isNight, markBed, releaseBed, unmarkBed } from "./beds.js";
import { addStat, getVillage, workArea } from "./village.js";
import { nearestTask, refreshStorageMarker, removeTask, resetScanWait, scanNear, tasks } from "./tasks.js";
import { canStand, dist2h, standPosNear } from "./blocks.js";
import { depositInto, hasStorage, nearestStorePoint, sourceOf, standFor } from "./storage.js";
import { getJobDef, skillLevel } from "./registry.js";

/**
 * @typedef {import("@minecraft/server").Entity} Entity
 * @typedef {{x:number,y:number,z:number}} Pos
 * @typedef {"idle"|"to_task"|"working"|"to_storage"|"depositing"|"to_bed"|"sleeping"|"to_rest"|"resting"} Mode
 * @typedef {{
 *   mode: Mode,
 *   event: string,
 *   taskId: number | undefined,
 *   bestDist: number,
 *   supplyAfter: number,
 *   anchorTick: number,
 *   nextWork: number,
 *   status: string,
 *   lastHurt: number,
 *   nextRegen: number,
 *   rested: boolean,
 *   bed: import("./beds.js").Bed | undefined,
 *   assisted: boolean
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
  const ch = pickFreeCharacter(e);
  e.setDynamicProperty("blockai:char", ch);
  const used = new Set(getAllVillagers().map(getName));
  const own = CHARACTERS[ch].name;
  const free = VILLAGER_NAMES.filter((n) => !used.has(n));
  const pool = free.length > 0 ? free : VILLAGER_NAMES;
  e.setDynamicProperty("blockai:name", used.has(own) ? pool[Math.floor(Math.random() * pool.length)] : own);
  e.setDynamicProperty("blockai:job", "none");
  applyLooks(e);
  updateNameTag(e, "");
}

/**
 * まだ誰も使っていないキャラクターを選ぶ（全員使っていれば重複あり）
 * @param {Entity} self
 */
function pickFreeCharacter(self) {
  const used = new Set();
  for (const v of getAllVillagers()) {
    if (v.id === self.id) continue;
    const c = v.getDynamicProperty("blockai:char");
    if (typeof c === "number") used.add(c);
  }
  const free = CHARACTERS.map((_, i) => i).filter((i) => !used.has(i));
  const pool = free.length > 0 ? free : CHARACTERS.map((_, i) => i);
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * 見た目のキャラクター番号
 * @param {Entity} e
 */
export function getCharacter(e) {
  let c = e.getDynamicProperty("blockai:char");
  if (typeof c !== "number" || !CHARACTERS[c]) {
    c = pickFreeCharacter(e);
    e.setDynamicProperty("blockai:char", c);
  }
  return c;
}

/**
 * 見た目を変える（名前がキャラクターの名前のままなら、名前も合わせる）
 * @param {Entity} e
 * @param {number} ch
 */
export function setCharacter(e, ch) {
  const old = CHARACTERS[getCharacter(e)];
  e.setDynamicProperty("blockai:char", ch);
  if (old && getName(e) === old.name) e.setDynamicProperty("blockai:name", CHARACTERS[ch].name);
  applyLooks(e);
  updateNameTag(e, states.get(e.id)?.status ?? "");
}

/**
 * 一番高い職業レベル（体力はこれで決まる）
 * @param {Entity} e
 */
export function bestLevel(e) {
  let lv = levelOf(getXp(e));
  for (const h of jobHistory(e)) lv = Math.max(lv, levelOf(h.xp));
  return lv;
}

/**
 * 今の体力と最大値
 * @param {Entity} e
 */
export function getHp(e) {
  const h = e.getComponent("minecraft:health");
  return { cur: Math.ceil(h?.currentValue ?? 0), max: Math.round(h?.effectiveMax ?? maxHp(bestLevel(e))) };
}

/**
 * @param {Entity} e
 * @param {number} amount Infinity なら全回復
 */
function heal(e, amount) {
  const h = e.getComponent("minecraft:health");
  if (!h) return;
  if (amount === Infinity) h.resetToMaxValue();
  else h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + amount));
}

/**
 * ダメージを受けた（しばらく回復しない。寝ていたら起きる）
 * @param {Entity} e
 * @param {number} tick
 */
export function noteHurt(e, tick) {
  const st = states.get(e.id);
  if (!st) return;
  st.lastHurt = tick;
  if (st.mode === "sleeping") wake(e, st, tick, false);
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

/** 職業・キャラクター・レベルを見た目と体力に反映 @param {Entity} e */
function applyLooks(e) {
  try {
    const ch = getCharacter(e);
    e.setProperty("blockai:job", getJob(e).skin);
    e.setProperty("blockai:tier", badgeTier(levelOf(getXp(e))));
    e.setProperty("blockai:char", ch);
    e.setProperty("blockai:build", CHARACTERS[ch].build);
    // 体力の最大値（一番高い職業レベルで決まる。段階が変わると全回復）
    const tier = bestLevel(e) - 1;
    if (e.getDynamicProperty("blockai:hp") !== tier) {
      e.triggerEvent(`blockai:hp_${tier}`);
      e.setDynamicProperty("blockai:hp", tier);
    }
  } catch (err) {
    // 読み込み直後などは失敗することがある
  }
}

/** 見た目と体力を反映し直す（復活したときなど） @param {Entity} e */
export function refreshLooks(e) {
  applyLooks(e);
  updateNameTag(e, "");
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
    to_bed: "blockai:mode_to_home",
    sleeping: "blockai:mode_sleep",
    to_rest: "blockai:mode_to_storage",
    resting: "blockai:mode_work",
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
  stopAssist(e, st);
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
        lastHurt: -1000,
        nextRegen: 0,
        rested: false,
        bed: undefined,
        assisted: false,
      };
      states.set(e.id, st);
      // 寝ている途中でワールドを閉じた場合に備えて、起きた姿勢に戻す
      try {
        e.setProperty("blockai:pose", 0);
      } catch (err) {
        // 無視
      }
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
  regen(e, st, tick);
  const level = levelOf(getXp(e));
  const cap = carryCapacity(level);
  const carry = getCarry(e);
  const total = carryTotal(carry);
  if (nightStep(e, st, village, tick, total)) return;

  if (!job.work || !job.status) {
    setMode(e, st, "idle", tick);
    st.status = "のんびり中";
    return;
  }
  const status = job.status;

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
      if (travel(e, st, tick, task.stand, task.stand)) warpTo(e, task.stand);
      return;
    }

    case "working": {
      const task = st.taskId !== undefined ? tasks.get(st.taskId) : undefined;
      if (!task || task.blocks.length === 0) {
        if (task) removeTask(task.id);
        releaseTask(st);
        // 終わった場所の近くに次の仕事が無いか探す（隣の木から切る）
        scanNear(village, job, e.dimension, e.location);
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
      if (got > 0 && watched) {
        try {
          e.playAnimation("animation.blockai.human.swing");
        } catch (err) {
          // 無視
        }
      }
      st.nextWork = tick + delay;
      st.status = `${status.working} (${carryTotal(carry)}/${cap})`;
      return;
    }

    case "to_storage": {
      const point = nearestStorePoint(village, e.location);
      if (!point) {
        setMode(e, st, "idle", tick);
        st.status = "§c倉庫がありません";
        return;
      }
      const s = point.pos;
      const d2 = dist2h(s, e.location, true);
      if (d2 <= ARRIVE_DISTANCE * ARRIVE_DISTANCE) {
        setMode(e, st, "depositing", tick);
        st.nextWork = tick + 10;
        st.status = "倉庫にしまっている";
        return;
      }
      st.status = total > 0 ? `倉庫へ運んでいる (${total})` : "倉庫へ材料を取りに行っている";
      const stand = standFor(e.dimension, point);
      if (travel(e, st, tick, s, stand)) warpTo(e, stand);
      return;
    }

    case "depositing": {
      if (tick < st.nextWork) return;
      const result = deposit(e, village, carry);
      setCarry(e, carry);
      refreshStorageMarker(village);
      if (result === "missing") {
        setMode(e, st, "idle", tick);
        st.status = "§c倉庫が無い！";
        notifyMayor("§c[blockAI] 倉庫が見つかりません。村長メニューから倉庫を置いてください。", tick);
        return;
      }
      if (result === "full") {
        setMode(e, st, "idle", tick);
        st.status = "§c倉庫がいっぱい！";
        notifyMayor(`§c[blockAI] ${getName(e)}「倉庫がいっぱいで入りません！」§7（村レベルが上がると広くなります）`, tick);
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
  // 夜は荷物をしまってから休む
  if (isNight()) {
    if (total > 0 && hasStorage(village)) goStorage(e, st, village, tick);
    else goRest(e, st, village, tick);
    return;
  }
  if (total >= cap) {
    goStorage(e, st, village, tick);
    return;
  }
  // 材料（種など）が足りなければ倉庫へ取りに行く。倉庫にも無ければしばらく諦める
  if (hasStorage(village) && tick >= st.supplyAfter && job.needsSupply?.(e, getBag(e), (id) => getOption(e, job, id))) {
    st.supplyAfter = tick + 20 * 60;
    goStorage(e, st, village, tick);
    return;
  }
  const task = nearestTask(job.id, e.dimension.id, e.location);
  if (task) {
    setMode(e, st, "to_task", tick);
    return;
  }
  if (total > 0 && hasStorage(village)) {
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
  if (!hasStorage(village)) {
    setMode(e, st, "idle", tick);
    st.status = "§c倉庫がありません（村長メニューで置いてね）";
    return;
  }
  setMode(e, st, "to_storage", tick);
}

// ---------------------------------------------------------------
// 移動（見られている間は歩く。自力で進めないときは手を引いて歩かせる）
// ---------------------------------------------------------------

/** 自力で進めないとき、この秒数で手引きに切り替える */
const ASSIST_AFTER = 4;
/** 手引きで歩く速さ（ブロック/tick） */
const ASSIST_SPEED = 0.14;

/** 手引き中の村人 → 目的地 */
/** @type {Map<string, Pos>} */
const assists = new Map();

/**
 * 目的地へ向かう1ステップ。ワープすべきときは true
 * @param {Entity} e
 * @param {State} st
 * @param {number} tick
 * @param {Pos} target 近づいたか測る場所（ブロック座標）
 * @param {Pos} dest 手引きで向かう立ち位置（ブロック座標）
 */
function travel(e, st, tick, target, dest) {
  if (!isWatched(e)) return true;
  if (!stuck(e, st, tick, target, st.assisted ? STUCK_SECONDS : ASSIST_AFTER)) return false;
  if (st.assisted) {
    stopAssist(e, st);
    return true;
  }
  st.assisted = true;
  st.bestDist = Infinity;
  assists.set(e.id, dest);
  return false;
}

/**
 * @param {Entity} e
 * @param {State} st
 */
function stopAssist(e, st) {
  assists.delete(e.id);
  st.assisted = false;
}

/** 手引き中の村人を1tick分歩かせる（毎tick呼ぶ） */
export function tickAssist() {
  for (const [id, dest] of assists) {
    const e = world.getEntity(id);
    if (!e || !e.isValid) {
      assists.delete(id);
      continue;
    }
    const loc = e.location;
    const tx = dest.x + 0.5;
    const tz = dest.z + 0.5;
    const d = Math.hypot(tx - loc.x, tz - loc.z);
    if (d < 1.0) {
      assists.delete(id);
      continue;
    }
    const step = Math.min(ASSIST_SPEED, d);
    const nx = loc.x + ((tx - loc.x) / d) * step;
    const nz = loc.z + ((tz - loc.z) / d) * step;
    const bx = Math.floor(nx);
    const bz = Math.floor(nz);
    const by = Math.floor(loc.y + 0.01);
    let ny;
    // 1段までなら登る・3段までなら下りる
    for (const dy of [0, 1, -1, -2, -3]) {
      if (canStand(e.dimension, { x: bx, y: by + dy, z: bz })) {
        ny = by + dy;
        break;
      }
    }
    if (ny === undefined) {
      // 壁などで進めない。しばらくすると stuck でワープする
      assists.delete(id);
      continue;
    }
    try {
      e.teleport({ x: nx, y: ny === by ? loc.y : ny, z: nz }, { facingLocation: { x: tx, y: ny + 1.6, z: tz } });
    } catch (err) {
      assists.delete(id);
    }
  }
}

// ---------------------------------------------------------------
// 夜・休む・体力の回復
// ---------------------------------------------------------------

const REST_MODES = new Set(["to_bed", "sleeping", "to_rest", "resting"]);

/**
 * 夜の行動。処理したら true
 * @param {Entity} e
 * @param {State} st
 * @param {import("./village.js").VillageData} village
 * @param {number} tick
 * @param {number} total 持ち物の数
 */
function nightStep(e, st, village, tick, total) {
  if (!isNight()) {
    if (REST_MODES.has(st.mode)) wake(e, st, tick, true);
    return false;
  }
  switch (st.mode) {
    case "idle":
    case "to_task":
    case "working":
      releaseTask(st);
      if (total > 0 && hasStorage(village)) goStorage(e, st, village, tick);
      else goRest(e, st, village, tick);
      return true;
    case "to_storage":
    case "depositing":
      // 荷物をしまい終わるまでは普段どおり（しまった後に decide で休みに行く）
      return false;
    case "to_bed": {
      const bed = st.bed;
      if (!bed || !bedUsable(e.dimension, bed)) {
        goRest(e, st, village, tick);
        return true;
      }
      st.status = "寝床へ向かっている";
      if (isWatched(e)) markBed(e.dimension, bed);
      const d2 = dist2h(bed.mid, e.location);
      if (d2 <= 1.8 * 1.8 || travel(e, st, tick, bed.foot, bed.foot)) sleepOn(e, st, bed, tick);
      return true;
    }
    case "sleeping": {
      const bed = st.bed;
      if (!bed || !bedUsable(e.dimension, bed)) {
        wake(e, st, tick, false);
        goRest(e, st, village, tick);
        return true;
      }
      st.status = "Zzz… 寝ている";
      // 押されてずれたり、向きが変わったりしたら寝床に戻す
      const yaw = bedYaw(bed);
      const turn = Math.abs(((e.getRotation().y - yaw + 540) % 360) - 180);
      if (dist2h(bed.mid, e.location) > 0.3 * 0.3 || Math.abs(e.location.y - bed.mid.y) > 0.4 || turn > 8) placeOnBed(e, bed);
      return true;
    }
    case "to_rest": {
      const point = nearestStorePoint(village, e.location);
      const s = point?.pos ?? village.center;
      st.status = "休みに戻っている";
      if (dist2h(s, e.location, true) <= 3.5 * 3.5 || !point) {
        setMode(e, st, "resting", tick);
        st.rested = true;
      } else if (travel(e, st, tick, s, standFor(e.dimension, point))) {
        warpTo(e, standFor(e.dimension, point));
        setMode(e, st, "resting", tick);
        st.rested = true;
      }
      return true;
    }
    case "resting":
      st.status = "休んでいる（ベッドが無い）";
      // 新しくベッドが置かれていないか、ときどき確かめる
      if (tick - st.anchorTick > 200) {
        st.anchorTick = tick;
        goRest(e, st, village, tick);
        if (/** @type {Mode} */ (st.mode) === "to_rest") setMode(e, st, "resting", tick);
      }
      return true;
  }
  return false;
}

/**
 * 寝床（空いているベッド）へ向かう。無ければ倉庫の前で休む
 * @param {Entity} e
 * @param {State} st
 * @param {import("./village.js").VillageData} village
 * @param {number} tick
 */
function goRest(e, st, village, tick) {
  const bed = assignBed(e, village);
  st.bed = bed;
  if (bed) {
    if (isWatched(e)) markBed(e.dimension, bed);
    setMode(e, st, "to_bed", tick);
    st.status = "寝床へ向かっている";
    return;
  }
  setMode(e, st, "to_rest", tick);
  st.status = "休みに戻っている";
}

/**
 * 寝るときの体の向き（度）。モデルは向いている方と逆側に頭が来るので、足側を向かせる
 * @param {import("./beds.js").Bed} bed
 */
function bedYaw(bed) {
  const dx = bed.foot.x - bed.head.x;
  const dz = bed.foot.z - bed.head.z;
  return (Math.atan2(-dx, dz) * 180) / Math.PI;
}

/**
 * @param {Entity} e
 * @param {import("./beds.js").Bed} bed
 */
function placeOnBed(e, bed) {
  try {
    e.teleport(bed.mid, { rotation: { x: 0, y: bedYaw(bed) } });
  } catch (err) {
    // 無視
  }
}

/**
 * @param {Entity} e
 * @param {State} st
 * @param {import("./beds.js").Bed} bed
 * @param {number} tick
 */
function sleepOn(e, st, bed, tick) {
  unmarkBed(bed);
  setMode(e, st, "sleeping", tick);
  placeOnBed(e, bed);
  try {
    e.setProperty("blockai:pose", 1);
  } catch (err) {
    // 無視
  }
  st.rested = true;
  st.status = "Zzz… 寝ている";
}

/**
 * 起きる。朝まで休んでいたら全回復
 * @param {Entity} e
 * @param {State} st
 * @param {number} tick
 * @param {boolean} morning
 */
function wake(e, st, tick, morning) {
  const bed = st.bed;
  try {
    if (e.getProperty("blockai:pose") === 1) {
      e.setProperty("blockai:pose", 0);
      if (bed) e.teleport(standPosNear(e.dimension, bed.foot));
    }
  } catch (err) {
    // 無視
  }
  if (morning && st.rested) heal(e, Infinity);
  st.rested = false;
  st.bed = undefined;
  releaseBed(e.id);
  setMode(e, st, "idle", tick);
  st.status = "";
}

/**
 * 休んでいる間は少しずつ回復する（しばらくダメージを受けていなければ）
 * @param {Entity} e
 * @param {State} st
 * @param {number} tick
 */
function regen(e, st, tick) {
  if (tick - st.lastHurt < 200 || tick < st.nextRegen) return;
  const calm = st.mode === "idle" || st.mode === "depositing" || st.mode === "resting" || st.mode === "sleeping";
  if (!calm) return;
  heal(e, 1);
  st.nextRegen = tick + (st.mode === "sleeping" ? 20 : 40);
}

/**
 * 目的地に近づけていなければ true（穴に落ちた・壁に阻まれた等）
 * その場でうろうろしていても、目的地との距離が縮まらなければ立ち往生とみなす
 * @param {Entity} e
 * @param {State} st
 * @param {number} tick
 * @param {Pos} target ブロック座標
 * @param {number} [seconds]
 */
function stuck(e, st, tick, target, seconds = STUCK_SECONDS) {
  const d = Math.sqrt(dist2h(target, e.location, true));
  if (d < st.bestDist - 1) {
    st.bestDist = d;
    st.anchorTick = tick;
    return false;
  }
  if (tick - st.anchorTick > seconds * 20) {
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
 * 一番近い倉庫に荷物を入れ、職業ごとに材料を持ち出す
 * @param {Entity} e
 * @param {import("./village.js").VillageData} village
 * @param {Record<string, number>} carry
 * @returns {"ok" | "full" | "missing"}
 */
function deposit(e, village, carry) {
  const point = nearestStorePoint(village, e.location);
  if (!point) return "missing";
  const result = depositInto(village, point, carry, (id, n) => addStat(id, n));
  if (result === "missing") return result;
  // 職業ごとに、倉庫から材料を持ち出す（農家の種など）
  const job = getJob(e);
  const source = job.onStorage ? sourceOf(village, point) : undefined;
  if (job.onStorage && source) {
    const bag = getBag(e);
    try {
      job.onStorage(e, source, bag, (id) => getOption(e, job, id));
    } catch (err) {
      console.warn(`[blockAI] onStorage error: ${err}`);
    }
    setBag(e, bag);
  }
  return result;
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
