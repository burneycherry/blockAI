// 農家（農業パック予定）: 実った作物を収穫して、すぐに植え直す
import { registerJob } from "../core/registry.js";
import { addCarry, center, dist2, lookAt, safeBlock } from "../core/blocks.js";
import { takeBlock } from "../core/tasks.js";

/** 収穫できる作物: 収穫物と種 */
/** @type {Record<string, { item: string, min: number, max: number, seed?: string }>} */
const CROPS = {
  "minecraft:wheat": { item: "minecraft:wheat", min: 1, max: 1, seed: "minecraft:wheat_seeds" },
  "minecraft:carrots": { item: "minecraft:carrot", min: 2, max: 4 },
  "minecraft:potatoes": { item: "minecraft:potato", min: 2, max: 4 },
  "minecraft:beetroot": { item: "minecraft:beetroot", min: 1, max: 1, seed: "minecraft:beetroot_seeds" },
};

/** @param {import("@minecraft/server").Block} b */
function isMatureCrop(b) {
  if (!(b.typeId in CROPS)) return false;
  const g = b.permutation.getState("growth");
  return typeof g === "number" && g >= 7;
}

registerJob({
  id: "farmer",
  name: "農家",
  skin: 1,
  pack: "農業パック",
  description: "実った小麦・ニンジン・ジャガイモ・ビートルートを収穫して植え直し、倉庫へ運びます。",
  status: { going: "畑に向かっている", working: "収穫中", waiting: "実った作物を待っている" },
  maxTasks: 6,

  scan(dim, top, addTask, isClaimed) {
    if (!isMatureCrop(top) || isClaimed(top)) return;
    const blocks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const p = { x: top.x + dx, y: top.y, z: top.z + dz };
        if (isClaimed(p)) continue;
        const b = safeBlock(dim, p);
        if (b && isMatureCrop(b)) blocks.push(p);
      }
    }
    // 末尾から取り出すので、近い順になるよう並べる
    blocks.sort((a, b) => dist2(b, top) - dist2(a, top));
    addTask({ x: top.x, y: top.y, z: top.z }, blocks);
  },

  work(e, task, carry, watched) {
    const p = takeBlock(task);
    if (!p) return false;
    const dim = e.dimension;
    const b = safeBlock(dim, p);
    if (!b || !isMatureCrop(b)) return false;
    const crop = CROPS[b.typeId];
    b.setPermutation(b.permutation.withState("growth", 0));
    addCarry(carry, crop.item, crop.min + Math.floor(Math.random() * (crop.max - crop.min + 1)));
    if (crop.seed && Math.random() < 0.5) addCarry(carry, crop.seed, 1);
    if (watched) {
      dim.playSound("dig.grass", center(p));
      lookAt(e, center(p));
    }
    return true;
  },
});
