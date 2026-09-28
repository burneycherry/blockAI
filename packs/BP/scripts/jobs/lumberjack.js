// 木こり（基本パック）: 村の周りの自然の木を切り、苗木を植え直す
import { system } from "@minecraft/server";
import { RETRY_TICKS } from "../core/config.js";
import { getStock } from "../core/storage.js";
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
  "minecraft:poplar_log": "minecraft:poplar_sapling",
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
  "minecraft:poplar_log",
];

/** 苗木（道具袋に持つ分。合計） */
const BAG_MAX = 32;
/** 倉庫から1種類あたりに持ち出す苗木の数 */
const TAKE_EACH = 8;
/** 植え直しの仕事が消えるまで（誰も受け持たないとき） */
const PLANT_TTL = 1200;
/** 近くに落ちていたら拾う物（葉が自然に消えて落ちた苗木など） */
const PICKUP = new Set([...Object.values(SAPLINGS), "minecraft:stick", "minecraft:apple"]);

/** 苗木が無くて植え直せなかった根元 → 苗木の種類 */
/** @type {Map<string, { p: import("../core/registry.js").Pos, sapling: string }>} */
const unplanted = new Map();
/** 最近切った・見かけた木の苗木 → tick（倉庫から持ち出す種類の目安） */
/** @type {Map<string, number>} */
const recentSaplings = new Map();
/** 苗木を道具袋に持っている木こりがいた tick */
/** @type {Map<string, number>} */
const heldSaplings = new Map();

/** @param {Record<string, number>} bag */
function saplingCount(bag) {
  let n = 0;
  for (const s of PICKUP) if (s !== "minecraft:stick" && s !== "minecraft:apple") n += bag[s] ?? 0;
  return n;
}

/** @param {string} id */
function isSapling(id) {
  return Object.values(SAPLINGS).includes(id);
}

/** 苗木が手に入るか（倉庫にある・誰かの道具袋にある） @param {string} s */
function saplingAvailable(s) {
  if ((getStock()[s] ?? 0) > 0) return true;
  const t = heldSaplings.get(s);
  return t !== undefined && system.currentTick - t <= RETRY_TICKS;
}

/** 苗木を1つ使う（道具袋 → 持ち物の順）。無ければ false
 * @param {Record<string, number>} bag
 * @param {Record<string, number>} carry
 * @param {string} s
 */
function useSapling(bag, carry, s) {
  if ((bag[s] ?? 0) > 0) {
    bag[s] -= 1;
    return true;
  }
  if ((carry[s] ?? 0) > 0) {
    carry[s] -= 1;
    return true;
  }
  return false;
}

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
  description: "村の周りの自然の木を切り、倉庫から持ち出した苗木で植え直して、原木を倉庫へ運びます。建物の柱は切りません。",
  status: { going: "木を切りに向かっている", working: "伐採中", waiting: "切れる木を探している" },
  maxTasks: 6,
  reach: 4,
  pickup: PICKUP,
  options: [
    { id: "replant", label: "切った後に苗木を植え直す", default: true },
    { id: "leaf_blocks", label: "葉っぱ払い（Lv5）のとき、葉っぱのブロックも持ち帰る", default: false },
  ],
  skills: [
    { id: "leaves", level: 5, name: "葉っぱ払い", description: "木を切り終えると葉もきれいに片付け、リンゴ・棒・苗木を拾ってくる" },
    { id: "grow", level: 8, name: "植林名人", description: "植え直した苗木に骨粉をまいて、早く育つようにする" },
    { id: "felling", level: 10, name: "倒木", description: "木を根元から一気に切り倒す。木が倒れて消えると、原木がまとめて手に入る" },
  ],

  accepts(task, opt, bag) {
    for (const k of Object.keys(bag)) if (bag[k] > 0 && isSapling(k)) heldSaplings.set(k, system.currentTick);
    if (task.data.kind !== "plant") return true;
    // 苗木を持っている（無ければ倉庫にある）ときだけ植えに行く
    const s = task.data.sapling;
    return opt("replant") && ((bag[s] ?? 0) > 0 || (getStock()[s] ?? 0) > 0);
  },

  scan(dim, top, addTask, isClaimed, opt) {
    // 苗木が無くて植え直せなかった根元 → 苗木が手に入れば植えに行く
    if (SOIL.has(top.typeId)) {
      const p = { x: top.x, y: top.y + 1, z: top.z };
      const u = unplanted.get(key(p));
      if (!u) return;
      const here = safeBlock(dim, p);
      if (!here || !here.isAir) {
        unplanted.delete(key(p));
        return;
      }
      if (opt("replant") && !isClaimed(p) && saplingAvailable(u.sapling)) {
        addTask(standPosNear(dim, p), [p], { kind: "plant", sapling: u.sapling, ttl: PLANT_TTL });
      }
      return;
    }
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
    const baseType = safeBlock(dim, base)?.typeId;
    if (baseType && SAPLINGS[baseType]) recentSaplings.set(SAPLINGS[baseType], system.currentTick);

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
    if (task.data.kind === "plant") return plantLater(ctx);
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

  // 倉庫から苗木を持ち出す（最近切った木の種類と、植え直せなかった根元の分）
  onStorage(e, source, bag, opt) {
    if (!opt("replant")) {
      // 植え直さないなら苗木は倉庫へ戻す
      for (const s of Object.keys(bag)) if (isSapling(s) && bag[s] > 0) bag[s] -= source.put(s, bag[s]);
      return;
    }
    for (const s of wantedSaplings()) {
      const room = BAG_MAX - saplingCount(bag);
      const limit = Math.min(room, TAKE_EACH - (bag[s] ?? 0));
      if (limit <= 0) continue;
      const got = source.take(s, limit);
      if (got > 0) bag[s] = (bag[s] ?? 0) + got;
    }
  },

  needsSupply(e, bag, opt) {
    if (!opt("replant")) return Object.keys(bag).some((s) => isSapling(s) && bag[s] > 0);
    const stock = getStock();
    return wantedSaplings().some((s) => (bag[s] ?? 0) === 0 && (stock[s] ?? 0) > 0);
  },
});

/** 持っておきたい苗木（植え直せなかった根元の分を先に。最近切った木は5分以内） */
function wantedSaplings() {
  const out = new Set([...unplanted.values()].map((u) => u.sapling));
  for (const [s, t] of recentSaplings) {
    if (system.currentTick - t <= 6000) out.add(s);
    else recentSaplings.delete(s);
  }
  return [...out];
}

/**
 * 植え直せなかった根元に、後から苗木を植える
 * @param {import("../core/registry.js").WorkContext} ctx
 */
function plantLater(ctx) {
  const { e, task, carry, watched } = ctx;
  const p = takeBlock(task);
  if (!p) return false;
  const dim = e.dimension;
  const s = task.data.sapling;
  const b = safeBlock(dim, p);
  const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
  if (!b || !below || !b.isAir || !SOIL.has(below.typeId)) {
    unplanted.delete(key(p));
    return false;
  }
  if (!useSapling(ctx.bag, carry, s)) return false;
  try {
    b.setType(s);
  } catch (err) {
    addCarry(carry, s, 1);
    return false;
  }
  unplanted.delete(key(p));
  if (ctx.skill("grow")) boneMeal(dim, p, watched);
  if (watched) {
    dim.playSound("dig.grass", center(p));
    lookAt(e, center(p));
  }
  return true;
}

/**
 * 植林名人：骨粉の効果（次の成長のタイミングで木になる）
 * @param {import("@minecraft/server").Dimension} dim
 * @param {import("../core/registry.js").Pos} p
 * @param {boolean} watched
 */
function boneMeal(dim, p, watched) {
  const b = safeBlock(dim, p);
  if (!b) return;
  try {
    b.setPermutation(b.permutation.withState("age_bit", true));
  } catch (err) {
    // age_bit が無い苗木（マングローブ等）は何もしない
  }
  if (watched) dim.spawnParticle("minecraft:crop_growth_emitter", center(p));
}

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
  if (ctx.skill("leaves")) collectLeaves(ctx, mainLog, leaves);
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
    const cleared = clearLeaves(dim, task.data.box);
    collectLeaves(ctx, logType, cleared);
    if (watched && cleared.n > 0) dim.playSound("dig.grass", e.location);
  }
  // 開拓したいときは植え直さない
  if (!ctx.opt("replant")) return;
  const planted = replant(ctx, task.data.bases ?? [], logType);
  if (ctx.skill("grow")) for (const p of planted) boneMeal(dim, p, watched);
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
  /** @type {Record<string, number>} 片付けた葉の種類と数 */
  const kinds = {};
  let n = 0;
  /** @param {import("@minecraft/server").Block | undefined} b */
  const natural = (b) => !!b && isLeaves(b.typeId) && b.permutation.getState("persistent_bit") !== true;
  /** @type {import("../core/registry.js").Pos[]} */
  let front = [];
  /** @param {import("../core/registry.js").Pos} p */
  const take = (p) => {
    const b = safeBlock(dim, p);
    if (!b || !natural(b)) return;
    kinds[b.typeId] = (kinds[b.typeId] ?? 0) + 1;
    b.setType("minecraft:air");
    n++;
    front.push(p);
  };
  for (let x = box.minX - 3; x <= box.maxX + 3; x++) {
    for (let z = box.minZ - 3; z <= box.maxZ + 3; z++) {
      for (let y = box.minY; y <= box.maxY + 3; y++) take({ x, y, z });
    }
  }
  // 形の大きい木（ポプラなど）：残った葉を、つながりをたどって片付ける（隣の木の幹に付いている葉は残す）
  const touchesLog = (/** @type {import("../core/registry.js").Pos} */ p) =>
    NEAR.some(([dx, dy, dz]) => {
      const b = safeBlock(dim, { x: p.x + dx, y: p.y + dy, z: p.z + dz });
      return !!b && isLog(b.typeId);
    });
  for (let step = 0; step < 5 && front.length > 0 && n < 600; step++) {
    const cur = front;
    front = [];
    for (const p of cur) {
      for (const [dx, dy, dz] of NEAR) {
        const q = { x: p.x + dx, y: p.y + dy, z: p.z + dz };
        if (q.x < box.minX - 8 || q.x > box.maxX + 8 || q.z < box.minZ - 8 || q.z > box.maxZ + 8) continue;
        if (q.y < box.minY || q.y > box.maxY + 8) continue;
        if (natural(safeBlock(dim, q)) && !touchesLog(q)) take(q);
      }
    }
  }
  return { n, kinds };
}

/** となり6方向 */
const NEAR = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

/**
 * 葉っぱ払いの収穫：リンゴ・棒・苗木。設定がONなら葉っぱのブロックそのものも持ち帰る
 * @param {import("../core/registry.js").WorkContext} ctx
 * @param {string} logType
 * @param {{ n: number, kinds: Record<string, number> }} cleared
 */
function collectLeaves(ctx, logType, cleared) {
  leafDrops(ctx.carry, logType, cleared.n, ctx.opt("replant") ? ctx.bag : undefined);
  if (ctx.opt("leaf_blocks")) for (const id of Object.keys(cleared.kinds)) addCarry(ctx.carry, id, cleared.kinds[id]);
}

/**
 * 葉から拾える物（バニラの落下率よりは少し多め）
 * @param {Record<string, number>} carry
 * @param {string} logType
 * @param {number} leaves 片付けた葉の数
 * @param {Record<string, number>} [bag] 道具袋（苗木を入れる）
 */
function leafDrops(carry, logType, leaves, bag) {
  if (leaves <= 0) return;
  const roll = (per) => Math.floor(leaves / per) + (Math.random() < (leaves % per) / per ? 1 : 0);
  addCarry(carry, "minecraft:stick", roll(20));
  const s = SAPLINGS[logType];
  if (s) {
    // 苗木は植え直しに使うので道具袋へ（いっぱいなら倉庫へ運ぶ）
    const n = roll(25);
    const toBag = bag ? Math.max(0, Math.min(n, BAG_MAX - saplingCount(bag))) : 0;
    if (bag && toBag > 0) bag[s] = (bag[s] ?? 0) + toBag;
    addCarry(carry, s, n - toBag);
  }
  if (logType === "minecraft:oak_log" || logType === "minecraft:dark_oak_log") addCarry(carry, "minecraft:apple", roll(40));
}

/**
 * 切り終わった木の根元に苗木を植える（道具袋の苗木を使う。無ければ持ち物、それも無ければ後で植えに来る）
 * @param {import("../core/registry.js").WorkContext} ctx
 * @param {import("../core/registry.js").Pos[]} allBases
 * @param {string} logType
 */
function replant(ctx, allBases, logType) {
  const dim = ctx.e.dimension;
  /** @type {import("../core/registry.js").Pos[]} */
  const planted = [];
  const sapling = SAPLINGS[logType];
  if (!sapling) return planted;
  recentSaplings.set(sapling, system.currentTick);
  // 2x2 の木（ダークオークなど）は4本、それ以外は1本
  const big = sapling === "minecraft:dark_oak_sapling" || sapling === "minecraft:pale_oak_sapling";
  const bases = big ? allBases.slice(0, 4) : allBases.slice(0, 1);
  for (const p of bases) {
    const b = safeBlock(dim, p);
    const below = safeBlock(dim, { x: p.x, y: p.y - 1, z: p.z });
    if (!b || !below || !b.isAir || !SOIL.has(below.typeId)) continue;
    if (!useSapling(ctx.bag, ctx.carry, sapling)) {
      unplanted.set(key(p), { p, sapling });
      continue;
    }
    try {
      b.setType(sapling);
      planted.push(p);
    } catch (e) {
      // 植えられない場合は苗木を持ち帰る
      addCarry(ctx.carry, sapling, 1);
    }
  }
  return planted;
}
