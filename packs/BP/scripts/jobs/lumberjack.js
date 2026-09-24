// 木こり（基本パック）: 村の周りの自然の木を切り、苗木を植え直す
import { system } from "@minecraft/server";
import { registerJob } from "../core/registry.js";
import { addCarry, center, key, lookAt, safeBlock, standPosNear } from "../core/blocks.js";
import { activeProps, takeBlock } from "../core/tasks.js";

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

/** 倒木モデルの木の種類（tools/gen-tree.mjs の WOODS と同じ順番） */
const WOODS = [
  "minecraft:oak_log",
  "minecraft:spruce_log",
  "minecraft:birch_log",
  "minecraft:jungle_log",
  "minecraft:acacia_log",
  "minecraft:dark_oak_log",
  "minecraft:cherry_log",
  "minecraft:mangrove_log",
  "minecraft:pale_oak_log",
];

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
  skin: 2,
  pack: "基本",
  description: "村の周りの自然の木を切り、苗木を植え直して原木を倉庫へ運びます。建物の柱は切りません。",
  status: { going: "木を切りに向かっている", working: "伐採中", waiting: "切れる木を探している" },
  maxTasks: 6,
  options: [{ id: "replant", label: "切った後に苗木を植え直す", default: true }],
  skills: [
    { id: "leaves", level: 5, name: "葉っぱ払い", description: "木を切り終えると葉もきれいに片付け、リンゴ・棒・苗木を拾ってくる" },
    { id: "grow", level: 8, name: "植林名人", description: "植え直した苗木に骨粉をまいて、早く育つようにする" },
    { id: "felling", level: 10, name: "倒木", description: "木を根元から一気に切り倒す。木が倒れて消えると、原木がまとめて手に入る" },
  ],

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
    addTask(standPosNear(dim, base), logs, { bases, box: boxOf(logs) });
  },

  work(ctx) {
    const { e, task, carry, watched, opt } = ctx;
    // 特技「倒木」: 木を丸ごと切り倒す
    if (ctx.skill("felling")) return fellTree(ctx);

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
    if (task.blocks.length === 0) afterTree(ctx, logType);
    return true;
  },
});

/**
 * 木を1本丸ごと切り倒す（Lv10 の特技）
 * 見えているときは、倒れるアニメーションを出してから消える
 * @param {import("../core/registry.js").WorkContext} ctx
 */
function fellTree(ctx) {
  const { e, task, carry, watched, opt } = ctx;
  const dim = e.dimension;
  /** @type {import("../core/registry.js").Pos[]} */
  const logs = [];
  /** @type {Record<string, number>} */
  const counts = {};
  for (let p = takeBlock(task); p; p = takeBlock(task)) {
    const b = safeBlock(dim, p);
    if (!b || !isLog(b.typeId)) continue;
    counts[b.typeId] = (counts[b.typeId] ?? 0) + 1;
    logs.push(p);
  }
  if (logs.length === 0) return 0;
  const mainLog = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  const minY = Math.min(...logs.map((p) => p.y));
  const maxY = Math.max(...logs.map((p) => p.y));
  const base = logs.find((p) => p.y === minY) ?? logs[0];

  // 原木と、その木の自然の葉を消す（倒れた木のモデルに置き換える）
  for (const p of logs) safeBlock(dim, p)?.setType("minecraft:air");
  const leaves = clearLeaves(dim, task.data.box ?? boxOf(logs));
  if (ctx.skill("leaves")) leafDrops(carry, mainLog, leaves);
  for (const id of Object.keys(counts)) addCarry(carry, id, counts[id]);

  if (watched) {
    showFallingTree(e, base, maxY - minY + 1, mainLog);
    lookAt(e, center(base));
    // 木が倒れて消えるまで見届ける
    ctx.wait(70);
  }
  afterTree(ctx, mainLog, true);
  return logs.length;
}

/**
 * 倒れる木のモデルを出して、しばらくしたら消す
 * @param {import("@minecraft/server").Entity} e 木こり
 * @param {import("../core/registry.js").Pos} base
 * @param {number} height
 * @param {string} logType
 */
function showFallingTree(e, base, height, logType) {
  const dim = e.dimension;
  const at = { x: base.x + 0.5, y: base.y, z: base.z + 0.5 };
  try {
    const tree = dim.spawnEntity("blockai:falling_tree", at);
    activeProps.add(tree.id);
    tree.setProperty("blockai:height", Math.max(1, Math.min(16, height)));
    tree.setProperty("blockai:wood", Math.max(0, WOODS.indexOf(logType)));
    // 木こりと反対側へ倒れるように向ける
    const dx = at.x - e.location.x;
    const dz = at.z - e.location.z;
    const yaw = (Math.atan2(-dx, dz) * 180) / Math.PI;
    tree.teleport(at, { rotation: { x: 0, y: yaw } });
    dim.playSound("dig.wood", at, { volume: 1.2, pitch: 0.7 });
    // 地面に倒れた音
    system.runTimeout(() => {
      try {
        dim.playSound("step.wood", at, { volume: 1.5, pitch: 0.5 });
        dim.playSound("dig.wood", at, { volume: 1.0, pitch: 0.5 });
      } catch (err) {
        // 無視
      }
    }, 24);
    // 少し置いてから消える
    system.runTimeout(() => {
      activeProps.delete(tree.id);
      try {
        if (!tree.isValid) return;
        const l = tree.location;
        for (let i = 0; i < Math.min(height, 8); i++) {
          dim.spawnParticle("minecraft:villager_happy", { x: l.x, y: l.y + 0.5, z: l.z });
        }
        tree.remove();
      } catch (err) {
        // 無視
      }
    }, 60);
  } catch (err) {
    // モデルが出せなくても、原木は手に入る
  }
}

/**
 * 切り終わった後の片付け
 *  - 葉っぱ払い（Lv5）: 葉を片付けて、リンゴ・棒・苗木を拾う（倒木では済んでいる）
 *  - 植え直す / 苗木を持ち帰る。植林名人（Lv8）なら骨粉をまく
 * @param {import("../core/registry.js").WorkContext} ctx
 * @param {string} logType
 * @param {boolean} [leavesDone]
 */
function afterTree(ctx, logType, leavesDone = false) {
  const { e, task, carry, watched } = ctx;
  const dim = e.dimension;
  if (!leavesDone && ctx.skill("leaves") && task.data.box) {
    const n = clearLeaves(dim, task.data.box);
    leafDrops(carry, logType, n);
    if (watched && n > 0) dim.playSound("dig.grass", e.location);
  }
  if (!ctx.opt("replant")) {
    // 開拓したいときは植え直さない（苗木は持ち帰る）
    if (SAPLINGS[logType]) addCarry(carry, SAPLINGS[logType], 1);
    return;
  }
  const planted = replant(dim, task.data.bases ?? [], logType);
  if (ctx.skill("grow")) {
    for (const p of planted) {
      const b = safeBlock(dim, p);
      if (!b) continue;
      try {
        // 骨粉の効果: 次の成長のタイミングで木になる
        b.setPermutation(b.permutation.withState("age_bit", true));
      } catch (err) {
        // age_bit が無い苗木（マングローブ等）は何もしない
      }
      if (watched) dim.spawnParticle("minecraft:crop_growth_emitter", center(p));
    }
  }
}

/**
 * 原木の範囲を囲む箱
 * @param {import("../core/registry.js").Pos[]} logs
 */
function boxOf(logs) {
  return {
    minX: Math.min(...logs.map((p) => p.x)),
    maxX: Math.max(...logs.map((p) => p.x)),
    minY: Math.min(...logs.map((p) => p.y)),
    maxY: Math.max(...logs.map((p) => p.y)),
    minZ: Math.min(...logs.map((p) => p.z)),
    maxZ: Math.max(...logs.map((p) => p.z)),
  };
}

/**
 * 木の周りの自然の葉を消す（プレイヤーが置いた葉は残す）。消した数を返す
 * @param {import("@minecraft/server").Dimension} dim
 * @param {{minX:number,maxX:number,minY:number,maxY:number,minZ:number,maxZ:number}} box
 */
function clearLeaves(dim, box) {
  let n = 0;
  for (let x = box.minX - 3; x <= box.maxX + 3; x++) {
    for (let z = box.minZ - 3; z <= box.maxZ + 3; z++) {
      for (let y = box.minY; y <= box.maxY + 3; y++) {
        const b = safeBlock(dim, { x, y, z });
        if (b && isLeaves(b.typeId) && b.permutation.getState("persistent_bit") !== true) {
          b.setType("minecraft:air");
          n++;
        }
      }
    }
  }
  return n;
}

/**
 * 葉から拾える物（バニラの落下率よりは少し多め）
 * @param {Record<string, number>} carry
 * @param {string} logType
 * @param {number} leaves 片付けた葉の数
 */
function leafDrops(carry, logType, leaves) {
  if (leaves <= 0) return;
  const roll = (per) => Math.floor(leaves / per) + (Math.random() < (leaves % per) / per ? 1 : 0);
  addCarry(carry, "minecraft:stick", roll(20));
  if (SAPLINGS[logType]) addCarry(carry, SAPLINGS[logType], roll(25));
  if (logType === "minecraft:oak_log" || logType === "minecraft:dark_oak_log") addCarry(carry, "minecraft:apple", roll(40));
}

/**
 * 切り終わった木の根元に苗木を植える
 * @param {import("@minecraft/server").Dimension} dim
 * @param {import("../core/registry.js").Pos[]} allBases
 * @param {string} logType
 */
function replant(dim, allBases, logType) {
  /** @type {import("../core/registry.js").Pos[]} */
  const planted = [];
  const sapling = SAPLINGS[logType];
  if (!sapling) return planted;
  // 2x2 の木（ダークオークなど）は4本、それ以外は1本
  const big = sapling === "minecraft:dark_oak_sapling" || sapling === "minecraft:pale_oak_sapling";
  const bases = big ? allBases.slice(0, 4) : allBases.slice(0, 1);
  for (const p of bases) {
    const b = safeBlock(dim, p);
    const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
    if (b && below && b.isAir && SOIL.has(below.typeId)) {
      try {
        b.setType(sapling);
        planted.push(p);
      } catch (e) {
        // 植えられない場合は諦める
      }
    }
  }
  return planted;
}
