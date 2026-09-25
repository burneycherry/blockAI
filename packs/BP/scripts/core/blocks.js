// ブロックや座標を扱う共通の道具（どの職業からも使う）

/**
 * @typedef {import("./registry.js").Pos} Pos
 * @typedef {import("@minecraft/server").Dimension} Dimension
 * @typedef {import("@minecraft/server").Entity} Entity
 */

/** @param {Pos} p */
export const key = (p) => `${p.x},${p.y},${p.z}`;

/**
 * ブロックを安全に取得（未ロードなら undefined）
 * @param {Dimension} dim
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

/** 通り抜けられる（体が入ってもよい）ブロック */
const PASSABLE = new Set([
  "minecraft:snow_layer",
  "minecraft:short_grass",
  "minecraft:tall_grass",
  "minecraft:fern",
  "minecraft:large_fern",
  "minecraft:deadbush",
  "minecraft:vine",
  "minecraft:glow_lichen",
  "minecraft:pink_petals",
]);

/**
 * 空気・雪の層・草花など、歩いて通れるブロックか
 * @param {import("@minecraft/server").Block} b
 */
export function isPassable(b) {
  if (b.isAir) return true;
  const id = b.typeId;
  return PASSABLE.has(id) || id.endsWith("_sapling") || id.endsWith("_tulip") || id.includes("flower") || id.endsWith("_mushroom");
}

/**
 * 村人が立てる場所か（足元が固く、体の2マスが通れる。葉っぱの上には立たない）
 * @param {Dimension} dim
 * @param {Pos} p
 */
export function canStand(dim, p) {
  const feet = safeBlock(dim, p);
  const head = safeBlock(dim, { x: p.x, y: p.y + 1, z: p.z });
  const floor = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
  if (!feet || !head || !floor) return false;
  if (floor.isLiquid || isPassable(floor) || floor.typeId.includes("leaves")) return false;
  return isPassable(feet) && isPassable(head);
}

/**
 * 指定した場所の周りで、村人が立てる場所を探す
 * @param {Dimension} dim
 * @param {Pos} p
 */
export function standPosNear(dim, p) {
  const dirs = [
    [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1],
  ];
  for (const [dx, dz] of dirs) {
    for (const dy of [0, 1, -1]) {
      const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
      if (canStand(dim, q)) return q;
    }
  }
  return { x: p.x, y: p.y, z: p.z };
}

/**
 * @param {Pos} a
 * @param {Pos} b
 */
export function dist2(a, b) {
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

/**
 * 村人をブロックの方に向かせる
 * @param {Entity} e
 * @param {Pos} target
 */
export function lookAt(e, target) {
  try {
    e.teleport(e.location, { facingLocation: target });
  } catch (err) {
    // 無視
  }
}

/**
 * 作業した場所の中心
 * @param {Pos} p
 */
export function center(p) {
  return { x: p.x + 0.5, y: p.y + 0.5, z: p.z + 0.5 };
}

/**
 * 持ち物に追加する
 * @param {Record<string, number>} carry
 * @param {string} itemId
 * @param {number} n
 */
export function addCarry(carry, itemId, n) {
  if (n > 0) carry[itemId] = (carry[itemId] || 0) + n;
}
