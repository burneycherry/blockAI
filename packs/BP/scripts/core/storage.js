// 村の倉庫
//   - 専用の倉庫（blockai:storehouse）：村の中に何個も置ける。中身は全部の倉庫で共有し、容量は村レベルで増える
import { ItemStack, system, world } from "@minecraft/server";
import { STOREHOUSE_BLOCK_ID, STOREHOUSE_ID } from "./config.js";
import { villageLevel } from "./village.js";
import { dist2h, standPosNear } from "./blocks.js";

/**
 * @typedef {{x:number,y:number,z:number}} Pos
 * @typedef {import("./village.js").VillageData} VillageData
 * @typedef {{ pos: Pos, entity: import("@minecraft/server").Entity }} StorePoint
 * @typedef {{ count: (id: string) => number, take: (id: string, n: number) => number }} StoreSource
 */

/** 村レベルごとの容量（スタック数。チェストの1マスに入る分が1スタック）と、置ける倉庫の数 */
export const HOUSE_SLOTS = [54, 108, 216, 432, 864];
export const HOUSE_COUNT = [1, 2, 3, 4, 5];
const STOCK_KEY = "blockai:stock";

// ---------------------------------------------------------------
// 共有の在庫（ワールドのダイナミックプロパティに保存）
// ---------------------------------------------------------------

/** @type {Record<string, number> | undefined} */
let stockCache;

/** @returns {Record<string, number>} */
export function getStock() {
  if (stockCache) return stockCache;
  const raw = world.getDynamicProperty(STOCK_KEY);
  try {
    stockCache = typeof raw === "string" ? JSON.parse(raw) : {};
  } catch (err) {
    stockCache = {};
  }
  return /** @type {Record<string, number>} */ (stockCache);
}

/** @param {Record<string, number>} stock */
function saveStock(stock) {
  for (const k of Object.keys(stock)) if (!(stock[k] > 0)) delete stock[k];
  stockCache = stock;
  world.setDynamicProperty(STOCK_KEY, JSON.stringify(stock));
}

/** @type {Map<string, number>} */
const stackCache = new Map();

/** 1スタックの数（ふつうは64。卵・雪玉などは16） @param {string} id */
export function stackSize(id) {
  let n = stackCache.get(id);
  if (n === undefined) {
    try {
      n = Math.max(1, new ItemStack(id, 1).maxAmount);
    } catch (err) {
      n = 64;
    }
    stackCache.set(id, n);
  }
  return n;
}

/** 使っているスタック数（チェストと同じく、種類ごとに数える） @param {Record<string, number>} stock */
export function usedSlots(stock) {
  let n = 0;
  for (const k of Object.keys(stock)) n += Math.ceil(stock[k] / stackSize(k));
  return n;
}

/** @param {VillageData} village */
export function capacitySlots(village) {
  return HOUSE_SLOTS[villageLevel(village).level - 1];
}

/** @param {VillageData} village */
export function maxHouses(village) {
  return HOUSE_COUNT[villageLevel(village).level - 1];
}

/**
 * 在庫に入れる。入った数を返す
 * @param {VillageData} village
 * @param {string} id
 * @param {number} n
 */
export function addToStock(village, id, n) {
  const stock = getStock();
  const cur = stock[id] ?? 0;
  const free = capacitySlots(village) - usedSlots(stock);
  const size = stackSize(id);
  const room = Math.max(0, (Math.ceil(cur / size) + free) * size - cur);
  const put = Math.min(n, room);
  if (put > 0) {
    stock[id] = cur + put;
    saveStock(stock);
  }
  return put;
}

/**
 * 在庫から出す。出せた数を返す
 * @param {string} id
 * @param {number} n
 */
export function takeFromStock(id, n) {
  const stock = getStock();
  const got = Math.min(n, stock[id] ?? 0);
  if (got > 0) {
    stock[id] -= got;
    saveStock(stock);
  }
  return got;
}

// ---------------------------------------------------------------
// 倉庫の場所
// ---------------------------------------------------------------

let housesTick = -1;
/** @type {import("@minecraft/server").Entity[]} */
let housesCache = [];

/**
 * 置かれている専用の倉庫（同じ tick の間は使い回す）
 * @param {VillageData} village
 */
export function getHouses(village) {
  if (housesTick === system.currentTick) return housesCache;
  housesTick = system.currentTick;
  try {
    housesCache = world.getDimension(village.dim).getEntities({ type: STOREHOUSE_ID });
  } catch (err) {
    housesCache = [];
  }
  return housesCache;
}

/** 倉庫の数が変わったとき（置いた・片付けた）に呼ぶ */
export function forgetHouses() {
  housesTick = -1;
}

/**
 * 倉庫をマスの真ん中に、真っ直ぐ（東西南北のどれか）向けて置き直す。ずれていなければ何もしない
 * @param {import("@minecraft/server").Entity} house
 * @param {number} [yaw] 向き（省略すると今の向きに近い方）
 */
export function alignHouse(house, yaw) {
  try {
    if (!house.isValid) return;
    const saved = house.getDynamicProperty("blockai:yaw");
    const want = snapYaw(yaw ?? (typeof saved === "number" ? saved : house.getRotation().y));
    if (saved !== want) house.setDynamicProperty("blockai:yaw", want);
    const p = house.location;
    const to = { x: Math.floor(p.x) + 0.5, y: p.y, z: Math.floor(p.z) + 0.5 };
    const rot = house.getRotation().y;
    const off = Math.abs(to.x - p.x) + Math.abs(to.z - p.z);
    const turn = Math.abs(((rot - want + 540) % 360) - 180);
    if (off > 0.01 || turn > 0.5) house.teleport(to, { rotation: { x: 0, y: want } });
    ensureHouseBlock(house);
  } catch (err) {
    // 無視
  }
}

/** 倉庫のブロックに置き換えてよい物（空気・雪の層・草花） */
const REPLACEABLE = new Set([
  "minecraft:air",
  "minecraft:snow_layer",
  "minecraft:short_grass",
  "minecraft:tall_grass",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:deadbush",
  "minecraft:short_dry_grass",
  "minecraft:tall_dry_grass",
]);

/**
 * 倉庫の場所に当たり判定のブロックを置く（無ければ）
 * @param {import("@minecraft/server").Entity} house
 */
function ensureHouseBlock(house) {
  const p = house.location;
  const block = house.dimension.getBlock({ x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) });
  if (!block || block.typeId === STOREHOUSE_BLOCK_ID) return;
  if (REPLACEABLE.has(block.typeId)) block.setType(STOREHOUSE_BLOCK_ID);
}

/**
 * 倉庫の当たり判定のブロックを消す（片付けるとき）
 * @param {import("@minecraft/server").Entity} house
 */
export function removeHouseBlock(house) {
  try {
    const p = house.location;
    const block = house.dimension.getBlock({ x: Math.floor(p.x), y: Math.floor(p.y + 0.01), z: Math.floor(p.z) });
    if (block?.typeId === STOREHOUSE_BLOCK_ID) block.setType("minecraft:air");
  } catch (err) {
    // 無視
  }
}

/**
 * そのブロックの場所にある倉庫
 * @param {import("@minecraft/server").Block} block
 */
export function houseAt(block) {
  try {
    return block.dimension
      .getEntities({ type: STOREHOUSE_ID, location: { x: block.x + 0.5, y: block.y, z: block.z + 0.5 }, maxDistance: 1.5 })
      .find((h) => Math.floor(h.location.x) === block.x && Math.floor(h.location.z) === block.z);
  } catch (err) {
    return undefined;
  }
}

/** 向きを 0/90/180/270 度にそろえる @param {number} yaw */
function snapYaw(yaw) {
  const r = Math.round(yaw / 90) * 90;
  return ((r + 180) % 360 + 360) % 360 - 180;
}

/**
 * 村人が荷物を運べる場所の一覧
 * @param {VillageData} village
 * @returns {StorePoint[]}
 */
export function storePoints(village) {
  return getHouses(village).map((entity) => ({
    entity,
    pos: { x: Math.floor(entity.location.x), y: Math.floor(entity.location.y), z: Math.floor(entity.location.z) },
  }));
}

/** @param {VillageData | null} village */
export function hasStorage(village) {
  return !!village && storePoints(village).length > 0;
}

/**
 * 一番近い倉庫
 * @param {VillageData} village
 * @param {Pos} from
 */
export function nearestStorePoint(village, from) {
  let best = /** @type {StorePoint | undefined} */ (undefined);
  let bestD = Infinity;
  for (const p of storePoints(village)) {
    const d = dist2h(p.pos, from, true);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}

/**
 * 倉庫の前の立ち位置
 * @param {import("@minecraft/server").Dimension} dim
 * @param {StorePoint} p
 */
export function standFor(dim, p) {
  return standPosNear(dim, p.pos);
}

// ---------------------------------------------------------------
// 出し入れ
// ---------------------------------------------------------------

/**
 * ふたを開けて、少ししたら閉める
 * @param {import("@minecraft/server").Entity} house
 */
export function openLid(house) {
  setLid(house, true);
  system.runTimeout(() => setLid(house, false), 30);
}

/**
 * ふたを開ける・閉める（音つき）
 * @param {import("@minecraft/server").Entity} house
 * @param {boolean} open
 */
export function setLid(house, open) {
  try {
    if (!house.isValid || house.getProperty("blockai:open") === open) return;
    house.setProperty("blockai:open", open);
    house.dimension.playSound(open ? "random.chestopen" : "random.chestclosed", house.location, { volume: 0.6 });
  } catch (err) {
    // 無視
  }
}

/**
 * 荷物をしまう。carry から入った分を減らす
 * @param {VillageData} village
 * @param {StorePoint} p
 * @param {Record<string, number>} carry
 * @param {(id: string, n: number) => void} onPut 入った数の記録
 * @returns {"ok" | "full" | "missing"}
 */
export function depositInto(village, p, carry, onPut) {
  if (!p.entity.isValid) return "missing";
  openLid(p.entity);
  let left = 0;
  for (const id of Object.keys(carry)) {
    const put = addToStock(village, id, carry[id]);
    if (put > 0) onPut(id, put);
    carry[id] -= put;
    left += carry[id];
  }
  return left > 0 ? "full" : "ok";
}

/**
 * 職業が材料を持ち出すための窓口（共有の在庫）
 * @param {VillageData} village
 * @param {StorePoint} p
 * @returns {StoreSource | undefined}
 */
export function sourceOf(village, p) {
  return { count: (id) => getStock()[id] ?? 0, take: (id, n) => takeFromStock(id, n) };
}
