// 木こり（基本パック）: 村の周りの自然の木を切り、苗木を植え直す
import { registerJob } from "../core/registry.js";
import { addCarry, center, key, lookAt, safeBlock, standPosNear } from "../core/blocks.js";
import { takeBlock } from "../core/tasks.js";

const SOIL = new Set([
  "minecraft:dirt",
  "minecraft:grass_block",
  "minecraft:podzol",
  "minecraft:coarse_dirt",
  "minecraft:mycelium",
  "minecraft:moss_block",
  "minecraft:rooted_dirt",
  "minecraft:mud",
  "minecraft:muddy_mangrove_roots",
  "minecraft:dirt_with_roots",
]);

/** @type {Record<string, string>} */
const SAPLINGS = {
  "minecraft:oak_log": "minecraft:oak_sapling",
  "minecraft:spruce_log": "minecraft:spruce_sapling",
  "minecraft:birch_log": "minecraft:birch_sapling",
  "minecraft:jungle_log": "minecraft:jungle_sapling",
  "minecraft:acacia_log": "minecraft:acacia_sapling",
  "minecraft:dark_oak_log": "minecraft:dark_oak_sapling",
  "minecraft:cherry_log": "minecraft:cherry_sapling",
  "minecraft:mangrove_log": "minecraft:mangrove_propagule",
  "minecraft:pale_oak_log": "minecraft:pale_oak_sapling",
};

/** @param {string} id */
function isLog(id) {
  return id.endsWith("_log") && !id.includes("stripped");
}

/** @param {string} id */
function isLeaves(id) {
  return id.endsWith("_leaves") || id === "minecraft:azalea_leaves_flowered";
}

/** 幹を探して下へたどるときに通り抜けてよいブロック @param {string} id */
function isPassable(id) {
  return (
    id === "minecraft:air" ||
    isLeaves(id) ||
    id === "minecraft:vine" ||
    id === "minecraft:snow_layer" ||
    id.endsWith("_propagule") ||
    id === "minecraft:bee_nest" ||
    id === "minecraft:cocoa"
  );
}

registerJob({
  id: "lumberjack",
  name: "木こり",
  skin: 4,
  pack: "基本",
  description: "村の周りの自然の木を切り、苗木を植え直して原木を倉庫へ運びます。建物の柱は切りません。",
  status: { going: "木を切りに向かっている", working: "伐採中", waiting: "切れる木を探している" },
  maxTasks: 6,

  scan(dim, top, addTask, isClaimed) {
    if (!isLeaves(top.typeId) && !isLog(top.typeId)) return;
    const { x, z } = top;
    // 上から下へ幹の根元を探す
    let base = /** @type {import("../core/registry.js").Pos | undefined} */ (undefined);
    for (let y = top.y; y > top.y - 40; y--) {
      const b = safeBlock(dim, { x, y, z });
      if (!b) return;
      if (isLog(b.typeId)) {
        const below = safeBlock(dim, { x, y: y - 1, z });
        if (below && SOIL.has(below.typeId)) {
          base = { x, y, z };
          break;
        }
        continue;
      }
      if (!isPassable(b.typeId)) return;
    }
    if (!base || isClaimed(base)) return;

    // 幹をたどって木全体の原木を集める
    const logs = [];
    const seen = new Set([key(base)]);
    const queue = [base];
    let naturalLeaves = 0;
    let playerLeaves = 0;
    while (queue.length > 0 && logs.length < 200) {
      const p = /** @type {import("../core/registry.js").Pos} */ (queue.shift());
      logs.push(p);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = 0; dy <= 1; dy++) {
          for (let dz = -1; dz <= 1; dz++) {
            if (dx === 0 && dy === 0 && dz === 0) continue;
            const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
            if (Math.abs(q.x - base.x) > 6 || Math.abs(q.z - base.z) > 6) continue;
            const k = key(q);
            if (seen.has(k)) continue;
            seen.add(k);
            const b = safeBlock(dim, q);
            if (!b) continue;
            if (isLog(b.typeId)) {
              if (isClaimed(q)) return; // 他の仕事と重なっている
              queue.push(q);
            } else if (isLeaves(b.typeId)) {
              if (b.permutation.getState("persistent_bit") === true) playerLeaves++;
              else naturalLeaves++;
            }
          }
        }
      }
    }
    // 自然の葉がついていない＝建物の柱などの可能性があるので切らない
    if (naturalLeaves < 3 || playerLeaves > naturalLeaves) return;

    const minY = Math.min(...logs.map((p) => p.y));
    const bases = logs.filter((p) => {
      if (p.y !== minY) return false;
      const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
      return !!below && SOIL.has(below.typeId);
    });
    // 末尾から取り出すので、上の原木から切っていく
    logs.sort((a, b) => a.y - b.y);
    addTask(standPosNear(dim, base), logs, { bases });
  },

  work(e, task, carry, watched) {
    const p = takeBlock(task);
    if (!p) return false;
    const dim = e.dimension;
    const b = safeBlock(dim, p);
    if (!b || !isLog(b.typeId)) return false;
    const logType = b.typeId;
    b.setType("minecraft:air");
    addCarry(carry, logType, 1);
    if (watched) {
      dim.playSound("dig.wood", center(p));
      lookAt(e, center(p));
    }
    if (task.blocks.length === 0) replant(dim, task.data.bases ?? [], logType);
    return true;
  },
});

/**
 * 切り終わった木の根元に苗木を植える
 * @param {import("@minecraft/server").Dimension} dim
 * @param {import("../core/registry.js").Pos[]} allBases
 * @param {string} logType
 */
function replant(dim, allBases, logType) {
  const sapling = SAPLINGS[logType];
  if (!sapling) return;
  // 2x2 の木（ダークオークなど）は4本、それ以外は1本
  const big = sapling === "minecraft:dark_oak_sapling" || sapling === "minecraft:pale_oak_sapling";
  const bases = big ? allBases.slice(0, 4) : allBases.slice(0, 1);
  for (const p of bases) {
    const b = safeBlock(dim, p);
    const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
    if (b && below && b.isAir && SOIL.has(below.typeId)) {
      try {
        b.setType(sapling);
      } catch (e) {
        // 植えられない場合は諦める
      }
    }
  }
}
