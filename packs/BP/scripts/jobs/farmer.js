// 農家（農業パック予定）: 実った作物を収穫して植え直す。空いている畑には倉庫の種をまく
import { registerJob } from "../core/registry.js";
import { addCarry, center, dist2, lookAt, safeBlock } from "../core/blocks.js";
import { takeBlock, tasks } from "../core/tasks.js";

/** 収穫できる作物: 収穫物と種 */
/** @type {Record<string, { item: string, min: number, max: number, seed: string }>} */
const CROPS = {
  "minecraft:wheat": { item: "minecraft:wheat", min: 1, max: 1, seed: "minecraft:wheat_seeds" },
  "minecraft:carrots": { item: "minecraft:carrot", min: 2, max: 4, seed: "minecraft:carrot" },
  "minecraft:potatoes": { item: "minecraft:potato", min: 2, max: 4, seed: "minecraft:potato" },
  "minecraft:beetroot": { item: "minecraft:beetroot", min: 1, max: 1, seed: "minecraft:beetroot_seeds" },
};

/** 種 → 植えたときのブロック */
/** @type {Record<string, string>} */
const SEED_TO_CROP = {
  "minecraft:wheat_seeds": "minecraft:wheat",
  "minecraft:beetroot_seeds": "minecraft:beetroot",
  "minecraft:carrot": "minecraft:carrots",
  "minecraft:potato": "minecraft:potatoes",
};

/** 倉庫から持ち出す量の上限 */
const BAG_MAX = 32;
/** ニンジン・ジャガイモは食料でもあるので、持ち出しは控えめに */
const FOOD_SEED_MAX = 8;
/** 種まきの仕事は同時にこれだけ（収穫の仕事の邪魔をしない） */
const MAX_PLANT_TASKS = 2;

/** @param {import("@minecraft/server").Block} b */
function isMatureCrop(b) {
  if (!(b.typeId in CROPS)) return false;
  const g = b.permutation.getState("growth");
  return typeof g === "number" && g >= 7;
}

/**
 * 種をまける畑か（耕した土で、上が空いている）
 * @param {import("@minecraft/server").Dimension} dim
 * @param {import("../core/registry.js").Pos} p 植える場所（畑の1つ上）
 */
function isEmptyFarmland(dim, p) {
  const b = safeBlock(dim, p);
  const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
  return !!b && !!below && b.isAir && below.typeId === "minecraft:farmland";
}

/** @param {Record<string, number>} bag */
function seedCount(bag) {
  let n = 0;
  for (const k of Object.keys(SEED_TO_CROP)) n += bag[k] ?? 0;
  return n;
}

function pendingPlantTasks() {
  let n = 0;
  for (const t of tasks.values()) if (t.jobId === "farmer" && t.data.kind === "plant") n++;
  return n;
}

/**
 * 周りの作物に合わせて、まく種を決める（畑の列をぐちゃぐちゃにしない）
 * @param {import("@minecraft/server").Dimension} dim
 * @param {import("../core/registry.js").Pos} p
 * @param {Record<string, number>} bag
 */
function chooseSeed(dim, p, bag) {
  /** @type {Record<string, number>} */
  const votes = {};
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [2, 0], [-2, 0], [0, 2], [0, -2]]) {
    const b = safeBlock(dim, { x: p.x + dx, y: p.y, z: p.z + dz });
    const crop = b && CROPS[b.typeId];
    if (crop) votes[crop.seed] = (votes[crop.seed] ?? 0) + 1;
  }
  const ranked = Object.keys(votes).sort((a, b) => votes[b] - votes[a]);
  if (ranked.length > 0) {
    // 周りと同じ種が無ければまかない（違う作物を混ぜない）
    return (bag[ranked[0]] ?? 0) > 0 ? ranked[0] : undefined;
  }
  // 周りに作物が無い新しい畑なら、持っている種をまく
  return Object.keys(SEED_TO_CROP).find((k) => (bag[k] ?? 0) > 0);
}

registerJob({
  id: "farmer",
  name: "農家",
  skin: 1,
  pack: "農業パック",
  description: "実った作物を収穫して植え直し、倉庫へ運びます。空いている畑には倉庫の種をまきます（新しく耕すことはしません）。",
  status: { going: "畑に向かっている", working: "畑仕事中", waiting: "実った作物を待っている" },
  maxTasks: 6,
  options: [
    { id: "plant", label: "空いている畑に倉庫の種をまく", default: true },
    { id: "food_seeds", label: "ニンジン・ジャガイモも倉庫から持ち出して植える", default: false },
  ],

  scan(dim, top, addTask, isClaimed) {
    // 実った作物 → 収穫
    if (isMatureCrop(top) && !isClaimed(top)) {
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
      addTask({ x: top.x, y: top.y, z: top.z }, blocks, { kind: "harvest" });
      return;
    }
    // 何も植わっていない畑 → 種まき
    if (top.typeId !== "minecraft:farmland" || pendingPlantTasks() >= MAX_PLANT_TASKS) return;
    const first = { x: top.x, y: top.y + 1, z: top.z };
    if (isClaimed(first)) return;
    const blocks = [];
    for (let dx = -2; dx <= 2; dx++) {
      for (let dz = -2; dz <= 2; dz++) {
        const p = { x: first.x + dx, y: first.y, z: first.z + dz };
        if (!isClaimed(p) && isEmptyFarmland(dim, p)) blocks.push(p);
      }
    }
    blocks.sort((a, b) => dist2(b, first) - dist2(a, first));
    addTask(first, blocks, { kind: "plant" });
  },

  work({ e, task, carry, watched, opt, bag }) {
    const p = takeBlock(task);
    if (!p) return false;
    const dim = e.dimension;
    const b = safeBlock(dim, p);
    if (!b) return false;

    if (task.data.kind === "plant") {
      if (!opt("plant") || !isEmptyFarmland(dim, p)) return false;
      const seed = chooseSeed(dim, p, bag);
      if (!seed) return false;
      b.setType(SEED_TO_CROP[seed]);
      bag[seed] -= 1;
      if (watched) {
        dim.playSound("use.grass", center(p));
        lookAt(e, center(p));
      }
      return true;
    }

    if (!isMatureCrop(b)) return false;
    const crop = CROPS[b.typeId];
    // 収穫して、すぐに植え直す
    b.setPermutation(b.permutation.withState("growth", 0));
    addCarry(carry, crop.item, crop.min + Math.floor(Math.random() * (crop.max - crop.min + 1)));
    if (crop.seed !== crop.item && Math.random() < 0.5) addCarry(carry, crop.seed, 1);
    if (watched) {
      dim.playSound("dig.grass", center(p));
      lookAt(e, center(p));
    }
    return true;
  },

  // 倉庫から種を持ち出す
  onStorage(e, container, bag, opt) {
    if (!opt("plant")) return;
    for (let i = 0; i < container.size && seedCount(bag) < BAG_MAX; i++) {
      const item = container.getItem(i);
      if (!item || !(item.typeId in SEED_TO_CROP)) continue;
      const isFood = item.typeId === "minecraft:carrot" || item.typeId === "minecraft:potato";
      if (isFood && !opt("food_seeds")) continue;
      const limit = isFood ? FOOD_SEED_MAX - (bag[item.typeId] ?? 0) : BAG_MAX - seedCount(bag);
      const take = Math.min(item.amount, limit, BAG_MAX - seedCount(bag));
      if (take <= 0) continue;
      bag[item.typeId] = (bag[item.typeId] ?? 0) + take;
      if (take >= item.amount) container.setItem(i, undefined);
      else {
        item.amount -= take;
        container.setItem(i, item);
      }
    }
  },

  needsSupply(e, bag, opt) {
    return opt("plant") && seedCount(bag) === 0 && pendingPlantTasks() > 0;
  },
});
