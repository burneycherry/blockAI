// 村人の生死：倒れたときの記録と、翌朝の復活
import { ItemStack, world } from "@minecraft/server";
import { VILLAGER_ID } from "./config.js";
import { getVillage, reviveOn } from "./village.js";
import { nearestStorePoint, standFor } from "./storage.js";
import { isNight } from "./beds.js";
import { getAllVillagers, getCarry, refreshLooks } from "./villager.js";

const ROSTER_KEY = "blockai:roster";
const FALLEN_KEY = "blockai:fallen";

/**
 * @typedef {Record<string, string | number | boolean>} Props
 * @typedef {{ props: Props, day: number }} Fallen
 */

/**
 * 村人の保存データ（blockai: で始まるダイナミックプロパティ）を全部取り出す
 * @param {import("@minecraft/server").Entity} e
 * @returns {Props}
 */
function snapshot(e) {
  /** @type {Props} */
  const props = {};
  for (const id of e.getDynamicPropertyIds()) {
    const v = e.getDynamicProperty(id);
    if (id.startsWith("blockai:") && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) props[id] = v;
  }
  return props;
}

/** @returns {Record<string, Props>} */
function readRoster() {
  const raw = world.getDynamicProperty(ROSTER_KEY);
  if (typeof raw !== "string") return {};
  try {
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

/** 全村人の保存データの控えを取る（倒れた瞬間に読めなかったときのため） */
export function saveRoster() {
  /** @type {Record<string, Props>} */
  const roster = {};
  for (const e of getAllVillagers()) {
    try {
      // 倒れている最中の村人は控えに入れない
      if ((e.getComponent("minecraft:health")?.currentValue ?? 1) <= 0) continue;
      roster[e.id] = snapshot(e);
    } catch (err) {
      // 無視
    }
  }
  // 読み込まれていない村人の控えは残す
  const old = readRoster();
  for (const id of Object.keys(old)) if (!(id in roster)) roster[id] = old[id];
  world.setDynamicProperty(ROSTER_KEY, JSON.stringify(roster));
}

/**
 * 控えから消す（解雇したときなど）
 * @param {string} id
 */
export function forget(id) {
  const roster = readRoster();
  if (!(id in roster)) return;
  delete roster[id];
  world.setDynamicProperty(ROSTER_KEY, JSON.stringify(roster));
}

/** @returns {Fallen[]} */
function readFallen() {
  const raw = world.getDynamicProperty(FALLEN_KEY);
  if (typeof raw !== "string") return [];
  try {
    return JSON.parse(raw);
  } catch (err) {
    return [];
  }
}

/** @param {Fallen[]} list */
function saveFallen(list) {
  world.setDynamicProperty(FALLEN_KEY, list.length > 0 ? JSON.stringify(list) : undefined);
}

/** 倒れていて、翌朝戻ってくる村人の数 */
export function fallenCount() {
  return readFallen().length;
}

/** 倒れていて、翌朝戻ってくる村人の名前 */
export function fallenNames() {
  return readFallen().map((f) => String(f.props["blockai:name"] ?? "名無し"));
}

/**
 * 村人が倒れた
 * @param {import("@minecraft/server").Entity} e
 */
export function onVillagerDie(e) {
  const id = e.id;
  /** @type {Props | undefined} */
  let props;
  try {
    props = snapshot(e);
  } catch (err) {
    props = readRoster()[id];
  }
  forget(id);
  if (!props) return;
  const name = String(props["blockai:name"] ?? "名無し");
  // 持っていた物はその場に落とす
  try {
    const carry = getCarry(e);
    for (const k of Object.keys(carry)) {
      let n = carry[k];
      while (n > 0) {
        const amount = Math.min(n, 64);
        e.dimension.spawnItem(new ItemStack(k, amount), e.location);
        n -= amount;
      }
    }
  } catch (err) {
    // 無視
  }
  delete props["blockai:carry"];
  if (reviveOn(getVillage())) {
    const list = readFallen();
    list.push({ props, day: world.getDay() });
    saveFallen(list);
    world.sendMessage(`§c[blockAI] ${name} が倒れました…§r §7明日の朝、元気になって村に戻ってきます。`);
  } else {
    world.sendMessage(`§c[blockAI] ${name} が亡くなりました…`);
  }
}

/** 朝になったら、倒れた村人を倉庫の横に戻す */
export function reviveFallen() {
  const list = readFallen();
  if (list.length === 0 || isNight()) return;
  const village = getVillage();
  if (!village) return;
  const today = world.getDay();
  const dim = world.getDimension(village.dim);
  const point = nearestStorePoint(village, village.center);
  const at = point ? standFor(dim, point) : village.center;
  if (!dim.isChunkLoaded(at)) return;
  /** @type {Fallen[]} */
  const rest = [];
  for (const f of list) {
    if (f.day >= today) {
      rest.push(f);
      continue;
    }
    try {
      const e = dim.spawnEntity(VILLAGER_ID, { x: at.x + 0.5, y: at.y, z: at.z + 0.5 });
      for (const k of Object.keys(f.props)) e.setDynamicProperty(k, f.props[k]);
      // 体力の段階を付け直す
      e.setDynamicProperty("blockai:hp", undefined);
      refreshLooks(e);
      world.sendMessage(`§a[blockAI] ${String(f.props["blockai:name"] ?? "名無し")} が元気になって村に戻ってきました！`);
    } catch (err) {
      rest.push(f);
    }
  }
  saveFallen(rest);
}
